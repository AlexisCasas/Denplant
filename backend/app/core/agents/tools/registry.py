"""Global tool registry and single-chokepoint invocation path."""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

from app.core.agents.tools.schema import tool_to_anthropic_schema, tool_to_openai_schema
from app.core.agents.tools.tool import Tool, ToolResult

if TYPE_CHECKING:
    from app.core.agents.context import AgentContext
    from app.core.plugins.base import BaseModule

logger = logging.getLogger(__name__)


class ToolRegistryError(Exception):
    """Raised for registration conflicts or invocation failures."""


class ToolRegistry:
    """Namespace-aware registry of all tools exposed by loaded modules.

    Tools are keyed by their *qualified name* — ``{module}.{tool}`` —
    which mirrors how :mod:`app.core.plugins.registry` namespaces
    permissions. The registry is the single entry point agents must
    use to invoke tools: :meth:`call` enforces permission checks,
    guardrails, input validation and audit logging on every call.
    """

    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}
        self._owners: dict[str, str] = {}  # qualified_name -> module_name

    # --- Registration ---------------------------------------------------

    def register_from(self, module: BaseModule) -> None:
        """Collect and namespace every tool a module exposes."""
        for tool in module.get_tools():
            qualified = f"{module.name}.{tool.name}"
            if qualified in self._tools:
                raise ToolRegistryError(
                    f"Tool '{qualified}' is already registered (owner: {self._owners[qualified]})"
                )
            self._tools[qualified] = tool
            self._owners[qualified] = module.name
            logger.info("Registered tool: %s (category=%s)", qualified, tool.category.value)

    def unregister_module(self, module_name: str) -> None:
        """Drop every tool owned by ``module_name`` (for module uninstall)."""
        to_drop = [q for q, owner in self._owners.items() if owner == module_name]
        for qualified in to_drop:
            del self._tools[qualified]
            del self._owners[qualified]

    def clear(self) -> None:
        """Reset the registry. Test-only."""
        self._tools.clear()
        self._owners.clear()

    # --- Introspection --------------------------------------------------

    def get(self, qualified_name: str) -> Tool | None:
        return self._tools.get(qualified_name)

    def list(self) -> list[str]:
        """All qualified tool names currently registered."""
        return sorted(self._tools.keys())

    def schemas_for(self, qualified_names: list[str], dialect: str = "anthropic") -> list[dict]:
        """Return JSON Schemas for a subset of tools, for LLM prompts.

        ``dialect`` is ``"anthropic"`` or ``"openai"``.
        """
        serializer = tool_to_anthropic_schema if dialect == "anthropic" else tool_to_openai_schema
        out: list[dict] = []
        for qualified in qualified_names:
            tool = self._tools.get(qualified)
            if tool is None:
                raise ToolRegistryError(f"Unknown tool: {qualified}")
            out.append(serializer(tool, qualified))
        return out

    # --- Invocation (the chokepoint) ------------------------------------

    async def call(
        self,
        ctx: AgentContext,
        qualified_name: str,
        arguments: dict[str, Any],
    ) -> ToolResult:
        """Invoke a tool with enforcement.

        Enforcement order:

        1. Tool exists
        2. Guardrails check (rate limit, blocked, require-approval)
        3. RBAC permission check against ``ctx.permissions``
        4. Pydantic validation of ``arguments``
        5. Handler execution
        6. Audit-log write (regardless of success/failure)
        """
        from app.core.agents.guardrails import GuardrailDecision
        from app.core.agents.guardrails import check as guardrails_check
        from app.core.agents.service import ApprovalService, AuditService
        from app.core.agents.tooling import jsonify
        from app.core.auth.financial_visibility import FinancialVisibilityPolicy, strip_financial_fields
        from app.core.auth.models import ClinicMembership, User
        from app.core.auth.permissions import get_role_permissions, permission_matches
        from sqlalchemy import select

        tool = self._tools.get(qualified_name)
        if tool is None:
            raise ToolRegistryError(f"Unknown tool: {qualified_name}")

        # A tool must always run on behalf of a currently authenticated
        # clinic member.  Agent/supervisor ids are audit metadata, never an
        # authorization substitute.
        if ctx.actor_user_id is None or ctx.actor_role is None:
            await AuditService.record(
                ctx,
                qualified_name,
                arguments,
                error="missing effective actor",
                status="BLOCKED",
                execution_time_ms=0,
            )
            return ToolResult(ok=False, error="missing effective actor")

        # Contexts can outlive a membership change (queued work, an open
        # copilot session). Re-read the current active membership instead of
        # trusting the role captured when the context was built.
        current_role = await ctx.db.scalar(
            select(ClinicMembership.role)
            .join(User, User.id == ClinicMembership.user_id)
            .where(
                ClinicMembership.user_id == ctx.actor_user_id,
                ClinicMembership.clinic_id == ctx.clinic_id,
                User.is_active.is_(True),
            )
        )
        if current_role is None:
            await AuditService.record(
                ctx,
                qualified_name,
                arguments,
                error="effective actor has no active clinic membership",
                status="BLOCKED",
                execution_time_ms=0,
            )
            return ToolResult(ok=False, error="effective actor has no active clinic membership")
        ctx.actor_role = current_role
        ctx.permissions = get_role_permissions(current_role)

        decision = guardrails_check(ctx, tool, qualified_name, ctx.guardrail_config)
        if decision is GuardrailDecision.BLOCK:
            await AuditService.record(
                ctx,
                qualified_name,
                arguments,
                error="blocked by guardrails",
                status="BLOCKED",
                execution_time_ms=0,
            )
            return ToolResult(ok=False, error="blocked by guardrails")

        if decision is GuardrailDecision.REQUIRE_APPROVAL:
            request = await ApprovalService.request_approval(
                ctx,
                qualified_name,
                arguments,
                reason="guardrail policy requires review",
            )
            await AuditService.record(
                ctx,
                qualified_name,
                arguments,
                result={"approval_request_id": str(request.id)},
                status="PENDING_APPROVAL",
                execution_time_ms=0,
            )
            return ToolResult(
                ok=False,
                data={"approval_request_id": str(request.id)},
                error="pending approval",
            )

        for required in tool.permissions:
            if not any(permission_matches(required, granted) for granted in ctx.permissions):
                await AuditService.record(
                    ctx,
                    qualified_name,
                    arguments,
                    error=f"permission denied: {required}",
                    status="BLOCKED",
                    execution_time_ms=0,
                )
                return ToolResult(ok=False, error=f"permission denied: {required}")

        try:
            validated = tool.parameters.model_validate(arguments)
        except Exception as exc:
            await AuditService.record(
                ctx,
                qualified_name,
                arguments,
                error=f"validation error: {exc}",
                status="FAILED",
                execution_time_ms=0,
            )
            return ToolResult(ok=False, error=f"validation error: {exc}")

        t0 = time.monotonic()
        try:
            raw = await tool.handler(ctx, validated)
            data = jsonify(raw)
            if not FinancialVisibilityPolicy.can_role_view_financial_amounts(ctx.actor_role):
                data = strip_financial_fields(data)
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            await AuditService.record(
                ctx,
                qualified_name,
                arguments,
                result=data,
                status="SUCCESS",
                execution_time_ms=elapsed_ms,
            )
            return ToolResult(ok=True, data=data, execution_time_ms=elapsed_ms)
        except Exception as exc:
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            await AuditService.record(
                ctx,
                qualified_name,
                arguments,
                error=str(exc),
                status="FAILED",
                execution_time_ms=elapsed_ms,
            )
            logger.exception("Tool %s raised", qualified_name)
            return ToolResult(ok=False, error=str(exc), execution_time_ms=elapsed_ms)


# Global singleton
tool_registry = ToolRegistry()
