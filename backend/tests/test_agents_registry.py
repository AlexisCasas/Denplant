"""Tests for the tool registry and its invocation chokepoint."""

from __future__ import annotations

import pytest
from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.agents import AgentContext, AgentMode, Tool, ToolCategory, tool_registry
from app.core.agents.guardrails import reset_counters
from app.core.agents.models import Agent, AgentSession
from app.core.auth.models import Clinic, ClinicMembership, User
from app.core.plugins.base import BaseModule


class _PingArgs(BaseModel):
    message: str


async def _ping_handler(ctx: AgentContext, params: _PingArgs) -> dict:
    return {"echo": params.message, "clinic": str(ctx.clinic_id)}


async def _financial_handler(ctx: AgentContext, params: _PingArgs) -> dict:
    return {"clinical_note": params.message, "amount": 137.45, "price_snapshot": 872.30}


class _FixtureModule(BaseModule):
    """Throwaway module used only in tests."""

    manifest = {
        "name": "fixture_agents",
        "version": "0.0.1",
        "summary": "Throwaway fixture.",
        "category": "official",
        "installable": True,
        "auto_install": True,
        "removable": True,
    }

    def get_models(self) -> list:
        return []

    def get_router(self) -> APIRouter:
        return APIRouter()

    def get_tools(self) -> list[Tool]:
        return [
            Tool(
                name="ping",
                description="Echo a message back.",
                parameters=_PingArgs,
                handler=_ping_handler,
                permissions=["fixture_agents.ping"],
                category=ToolCategory.READ,
            ),
            Tool(
                name="delete_everything",
                description="Pretend to delete everything. Used for guardrail tests.",
                parameters=_PingArgs,
                handler=_ping_handler,
                permissions=["fixture_agents.delete"],
                category=ToolCategory.DESTRUCTIVE,
            ),
            Tool(
                name="financial_echo",
                description="Returns fixture financial values for redaction tests.",
                parameters=_PingArgs,
                handler=_financial_handler,
                permissions=[],
                category=ToolCategory.READ,
            ),
        ]


async def _make_agent_and_session(db: AsyncSession, clinic_id) -> tuple:
    agent = Agent(
        clinic_id=clinic_id,
        name="test",
        type="fixture",
        mode="autonomous",
        config={},
    )
    db.add(agent)
    await db.flush()
    session = AgentSession(agent_id=agent.id, clinic_id=clinic_id)
    db.add(session)
    await db.flush()
    return agent, session


async def _effective_actor(db: AsyncSession, clinic_id) -> tuple:
    membership = await db.scalar(
        select(ClinicMembership).where(ClinicMembership.clinic_id == clinic_id)
    )
    assert membership is not None
    return membership.user_id, membership.role


@pytest.fixture(autouse=True)
def _register_fixture_module():
    module = _FixtureModule()
    tool_registry.register_from(module)
    reset_counters()
    yield
    tool_registry.unregister_module("fixture_agents")
    reset_counters()


def test_tools_are_namespaced_by_module():
    names = tool_registry.list()
    assert "fixture_agents.ping" in names
    assert "fixture_agents.delete_everything" in names


def test_duplicate_registration_raises():
    from app.core.agents.tools.registry import ToolRegistryError

    with pytest.raises(ToolRegistryError):
        tool_registry.register_from(_FixtureModule())


def test_schemas_for_anthropic_dialect():
    schemas = tool_registry.schemas_for(["fixture_agents.ping"], dialect="anthropic")
    assert schemas[0]["name"] == "fixture_agents.ping"
    assert "input_schema" in schemas[0]
    assert schemas[0]["input_schema"]["properties"]["message"]["type"] == "string"


def test_schemas_for_openai_dialect():
    schemas = tool_registry.schemas_for(["fixture_agents.ping"], dialect="openai")
    assert schemas[0]["type"] == "function"
    assert schemas[0]["function"]["name"] == "fixture_agents.ping"


@pytest.mark.asyncio
async def test_call_success_writes_audit_row(db_session, test_clinic):
    agent, session = await _make_agent_and_session(db_session, test_clinic.id)
    actor_user_id, actor_role = await _effective_actor(db_session, test_clinic.id)
    ctx = AgentContext(
        agent_id=agent.id,
        session_id=session.id,
        clinic_id=test_clinic.id,
        mode=AgentMode.AUTONOMOUS,
        permissions=["fixture_agents.ping"],
        tools=tool_registry,
        db=db_session,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
    )

    result = await tool_registry.call(ctx, "fixture_agents.ping", {"message": "hi"})

    assert result.ok is True
    assert result.data == {"echo": "hi", "clinic": str(test_clinic.id)}

    from sqlalchemy import select

    from app.core.agents.models import AgentAuditLog

    rows = (
        (
            await db_session.execute(
                select(AgentAuditLog).where(AgentAuditLog.session_id == session.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].status == "SUCCESS"
    assert rows[0].tool_name == "fixture_agents.ping"


@pytest.mark.asyncio
async def test_call_unknown_tool_raises(db_session, test_clinic):
    agent, session = await _make_agent_and_session(db_session, test_clinic.id)
    ctx = AgentContext(
        agent_id=agent.id,
        session_id=session.id,
        clinic_id=test_clinic.id,
        mode=AgentMode.AUTONOMOUS,
        permissions=["*"],
        tools=tool_registry,
        db=db_session,
    )
    from app.core.agents.tools.registry import ToolRegistryError

    with pytest.raises(ToolRegistryError):
        await tool_registry.call(ctx, "fixture_agents.does_not_exist", {})


@pytest.mark.asyncio
async def test_call_missing_permission_blocks(db_session, test_clinic):
    agent, session = await _make_agent_and_session(db_session, test_clinic.id)
    actor_user_id, actor_role = await _effective_actor(db_session, test_clinic.id)
    membership = await db_session.scalar(
        select(ClinicMembership).where(ClinicMembership.user_id == actor_user_id)
    )
    assert membership is not None
    membership.role = "hygienist"
    await db_session.flush()
    ctx = AgentContext(
        agent_id=agent.id,
        session_id=session.id,
        clinic_id=test_clinic.id,
        mode=AgentMode.AUTONOMOUS,
        permissions=["fixture_agents.ping"],  # stale context must not authorize
        tools=tool_registry,
        db=db_session,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
    )
    result = await tool_registry.call(ctx, "fixture_agents.ping", {"message": "x"})
    assert result.ok is False
    assert "permission denied" in (result.error or "")


@pytest.mark.asyncio
async def test_call_validation_error_records_failure(db_session, test_clinic):
    agent, session = await _make_agent_and_session(db_session, test_clinic.id)
    actor_user_id, actor_role = await _effective_actor(db_session, test_clinic.id)
    ctx = AgentContext(
        agent_id=agent.id,
        session_id=session.id,
        clinic_id=test_clinic.id,
        mode=AgentMode.AUTONOMOUS,
        permissions=["fixture_agents.ping"],
        tools=tool_registry,
        db=db_session,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
    )
    # missing required 'message' arg
    result = await tool_registry.call(ctx, "fixture_agents.ping", {})
    assert result.ok is False
    assert "validation error" in (result.error or "")


async def _context_for_actor(db_session, clinic_id, actor_user_id=None, actor_role=None):
    agent, session = await _make_agent_and_session(db_session, clinic_id)
    return AgentContext(
        agent_id=agent.id,
        session_id=session.id,
        clinic_id=clinic_id,
        mode=AgentMode.AUTONOMOUS,
        permissions=["*"],
        tools=tool_registry,
        db=db_session,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
    )


@pytest.mark.asyncio
async def test_call_without_effective_actor_fails_closed(db_session, test_clinic):
    ctx = await _context_for_actor(db_session, test_clinic.id)
    result = await tool_registry.call(ctx, "fixture_agents.ping", {"message": "x"})
    assert result.ok is False
    assert result.error == "missing effective actor"


@pytest.mark.asyncio
async def test_call_with_inactive_or_removed_actor_fails_closed(db_session, test_clinic):
    actor_user_id, actor_role = await _effective_actor(db_session, test_clinic.id)
    user = await db_session.get(User, actor_user_id)
    assert user is not None
    user.is_active = False
    await db_session.flush()
    ctx = await _context_for_actor(db_session, test_clinic.id, actor_user_id, actor_role)
    result = await tool_registry.call(ctx, "fixture_agents.ping", {"message": "x"})
    assert result.ok is False
    assert result.error == "effective actor has no active clinic membership"

    user.is_active = True
    membership = await db_session.scalar(
        select(ClinicMembership).where(
            ClinicMembership.user_id == actor_user_id,
            ClinicMembership.clinic_id == test_clinic.id,
        )
    )
    assert membership is not None
    await db_session.delete(membership)
    await db_session.flush()
    ctx = await _context_for_actor(db_session, test_clinic.id, actor_user_id, actor_role)
    result = await tool_registry.call(ctx, "fixture_agents.ping", {"message": "x"})
    assert result.ok is False
    assert result.error == "effective actor has no active clinic membership"


@pytest.mark.asyncio
async def test_call_with_actor_from_another_clinic_fails_closed(db_session, test_clinic):
    actor_user_id, actor_role = await _effective_actor(db_session, test_clinic.id)
    other_clinic = Clinic(name="Other clinic", tax_id="B87654321", phone="600000000")
    db_session.add(other_clinic)
    await db_session.flush()
    ctx = await _context_for_actor(db_session, other_clinic.id, actor_user_id, actor_role)
    result = await tool_registry.call(ctx, "fixture_agents.ping", {"message": "x"})
    assert result.ok is False
    assert result.error == "effective actor has no active clinic membership"


@pytest.mark.asyncio
async def test_current_dentist_role_redacts_before_return_and_audit(db_session, test_clinic):
    from app.core.agents.models import AgentAuditLog

    actor_user_id, _ = await _effective_actor(db_session, test_clinic.id)
    membership = await db_session.scalar(
        select(ClinicMembership).where(
            ClinicMembership.user_id == actor_user_id,
            ClinicMembership.clinic_id == test_clinic.id,
        )
    )
    assert membership is not None
    membership.role = "dentist"
    await db_session.flush()
    ctx = await _context_for_actor(db_session, test_clinic.id, actor_user_id, "admin")
    result = await tool_registry.call(ctx, "fixture_agents.financial_echo", {"message": "clinical"})
    assert result.ok is True
    assert result.data == {"clinical_note": "clinical"}
    audit = await db_session.scalar(
        select(AgentAuditLog).where(AgentAuditLog.session_id == ctx.session_id)
    )
    assert audit is not None
    assert audit.result == {"clinical_note": "clinical"}


@pytest.mark.asyncio
async def test_current_admin_role_overrides_stale_dentist_context(db_session, test_clinic):
    actor_user_id, _ = await _effective_actor(db_session, test_clinic.id)
    ctx = await _context_for_actor(db_session, test_clinic.id, actor_user_id, "dentist")
    result = await tool_registry.call(ctx, "fixture_agents.ping", {"message": "current admin"})
    assert result.ok is True
    assert ctx.actor_role == "admin"


def test_unregister_module_drops_tools():
    assert "fixture_agents.ping" in tool_registry.list()
    tool_registry.unregister_module("fixture_agents")
    assert "fixture_agents.ping" not in tool_registry.list()
    # Re-register so the teardown is idempotent.
    tool_registry.register_from(_FixtureModule())


@pytest.mark.asyncio
async def test_every_existing_module_returns_a_list_of_tools():
    """Every module's get_tools() must return a list (default is empty)."""
    from app.core.plugins.registry import module_registry

    modules = module_registry.list_discovered()
    assert modules, "no modules loaded — conftest register_discovered failed"
    for module in modules:
        tools = module.get_tools()
        assert isinstance(tools, list), f"{module.name}.get_tools() must return list"
        for tool in tools:
            assert hasattr(tool, "name")
            assert hasattr(tool, "handler")
