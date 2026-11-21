# DenPlant modular frontend deployment runbook

This runbook applies to a DenPlant frontend that uses Nuxt Layers from
`backend/app/modules`. It is intended for QA and production-like deployments.

## Why the production Dockerfile is mandatory

The application routes are not all under `frontend/app/pages`. Feature modules
contribute pages through Nuxt Layers, including patients, catalog, odontogram,
agenda and treatment plans.

`frontend/Dockerfile` with `frontend/` as its build context does **not** copy
`backend/app/modules`; it therefore cannot provide `/module_layers` to Nuxt.
A build made that way can pass a generic healthcheck while omitting modular
routes such as `/patients`.

Use `frontend/Dockerfile.prod` with the repository root as its context. It:

1. copies `backend/app/modules` to `/module_layers`;
2. regenerates `frontend/modules.json` from those layers; and
3. builds the complete Nuxt route graph.

## Build

From the repository root:

```bash
cd /opt/apps/denplant-src

docker build \
  -f frontend/Dockerfile.prod \
  -t denplant-frontend:<tag> \
  .
```

Do not use either of these for a modular deployment:

```bash
docker build -f frontend/Dockerfile frontend
docker build -f frontend/Dockerfile.prod frontend
```

Both omit the backend module source from the Docker context.

## Validate the image before deployment

Confirm that compiled output contains the expected modular routes and modules.
The exact chunk names are hashed, so search the output rather than relying on
filenames:

```bash
docker run --rm --entrypoint sh denplant-frontend:<tag> -c '
  grep -R -l -m1 "/patients" /app/.output/server /app/.output/public
  grep -R -l -m1 "/settings/catalog" /app/.output/server /app/.output/public
  grep -R -l -m1 "TreatmentPlan" /app/.output/server/chunks/build
'
```

Compare the artifact count and route evidence with the current stable image
when investigating a regression. A Docker healthcheck only proves that Nuxt is
listening; it does not prove that module routes were compiled.

## Backup and deployment

1. Record the current frontend image ID and copy the compose override.
2. Reuse a verified database backup only when this is a frontend-only change;
   do not run migrations for this procedure.
3. Change only the `frontend` image reference in the deployment override.
4. Recreate only frontend, without dependencies:

```bash
cd /opt/apps/dentalpin
docker compose -f docker-compose.prod.yml \
  -f docker-compose.denplant.override.yml \
  up -d --no-deps frontend
```

Do not recreate PostgreSQL, Caddy or backend for a frontend-only route fix.

## Post-deployment smoke tests

Verify container health and the backend health endpoint through the internal
network. Then check HTTPS and protected routes:

```bash
curl -fsS -L -o /dev/null -w '%{http_code}\n' https://<host>/
curl -sS -I https://<host>/patients
curl -sS -I https://<host>/dashboard
curl -sS -I https://<host>/settings/catalog
```

For an unauthenticated request, a `302` to `/login` is expected for protected
routes. It is not evidence of a missing route. Validate authenticated
navigation separately with an authorized QA account; do not use clinical data
for smoke tests.

## Rollback

If the new frontend is unhealthy or lacks route evidence, restore the previous
frontend image tag in the override and recreate only `frontend` with the same
`--no-deps` command. Keep backend unchanged unless compatibility has been
explicitly disproven. Do not restore PostgreSQL automatically for a frontend
rollback.
