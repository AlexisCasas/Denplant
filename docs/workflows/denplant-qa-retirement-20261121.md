# Retiro de entornos QA de Denplant — 2026-11-21

Bitácora histórica y de cierre. Registra qué entornos QA se retiraron del VPS, qué código se preservó en GitHub, el cierre del PR #30, las auditorías de procedencia y las tareas residuales. Las fases iniciales se presentan cronológicamente: **el código sí se integró posteriormente en `main`**, mediante el PR #30. Ninguna de las actuaciones documentales de esta fase modificó la producción.

## 1. Resumen

| Concepto | Resultado |
|---|---|
| Contenedores eliminados | 67 |
| Volúmenes eliminados | 19 |
| Imágenes eliminadas | 18 |
| Redes eliminadas | 8 |
| Disco recuperado | ~15 GB (141 GB → 126 GB usados) |
| RAM en uso | 10.792 MB → 8.771 MB (~2.000 MB menos) |
| Producción Denplant | Sin cambios (backend, frontend, BD y Caddy sanos) |

## 2. Código preservado (ramas de GitHub)

Estos commits existían **solo** en el VPS (no estaban en ningún remoto). Se publicaron sin reescribir historia.

| Rama | Commit | Funcionalidad | Origen | Estado |
|---|---|---|---|---|
| `preserve/20261121-dp33-demo-integration-prod-f58a09f` | `f58a09f` | DP-33 integrado sobre el baseline demo, incluye rediseño del presupuesto en 3 pasos y acceso a paciente archivado. **Referencia auditada del backend productivo** | Árbol de integración DP-33 | PR #26 integrado por ancestría tras el merge del #30 |
| `preserve/20261121-dp17-patient-info-integrated` | `99c0654` | Pestañas clínicas del paciente junto con el selector de dentición (DP-17) | QA `dp17qa` | PR Draft #27 por revisar |
| `preserve/20261121-dp17-dentition-selector` | `d5433e9` | Selector de dentición permanente/temporal (subconjunto de la anterior) | QA `dp17qa` | Preservación |
| `preserve/20261121-payment-allocations-current` | `3d14d0e` | Asignación de pagos parciales por tratamiento (sobre la base actual) | QA `denplant_payment_qa` | PR Draft #28 por revisar |
| `preserve/20261121-payment-allocations-by-budget-item` | `1ca8e5d` | Misma funcionalidad sobre la base anterior | QA `denplant_payment_qa` | Preservación |
| `preserve/20261121-dp33-patient-lifecycle` | `811206c` | Ciclo de vida del paciente DP-33 (versión anterior de la integración) | Auditoría DP-33 | Preservación |

Revisión previa a publicar: sin claves privadas, tokens ni `.env`; sin archivos mayores de 1 MB ni dumps de BD; solo datos de prueba sintéticos en los tests (`example.test`, identificadores ficticios).

## 3. Pendiente de integración

- Los tres PR Draft requieren revisión humana antes de cualquier merge. Ninguno se ha fusionado.
- **`main` no contiene el código que corre en producción** (`f58a09f`). Conviene integrarlo para que el repositorio refleje producción.
- Las dos variantes de pagos (`current` y `by-budget-item`) tienen bases distintas; elegir una.

## 4. Entornos retirados

**Grupo A (obsoletos):** `dp33demointegrationqa`, `dp33qa2`, contenedores sueltos de pruebas dp33, `denplant-fav-ci`, `payment-final-proof` y `visual-probe` detenidos, QA de favoritos de prescripción (`denplant-prescription-favorites-qa`, `denplant-production-favorites-candidate`), cuatro BD de pytest de pagos y sus volúmenes, redes e imágenes exclusivos.

**Grupo B (tras preservar el código):** `dp17qa` (frontend, backend, BD), `denplant_payment_qa` (frontend, backend, BD), `denplant-payment-current-validation-db`, `denplant-payment-final-proof-db`, con sus volúmenes, redes e imágenes.

Las BD de estos entornos tenían ~15 MB con datos de prueba (por ejemplo, 4 y 15 pacientes ficticios). Se guardó un volcado privado en el VPS (solo root); no se publica.

## 5. Conservado

- Producción: `dentalpin-*` (backend, frontend, BD, Caddy), sus volúmenes e imágenes (`dp33-f58a09f`, `dp33-f10b358`, `postgres:15-alpine`).
- Directorios de código y líneas base en el VPS (no se borraron).
- Cuatro volúmenes antiguos de BD QA sin contenedor (octubre): pendientes de decisión.

## 6. Reconstruir un QA desde el repositorio

Procedimiento orientativo, **no probado durante esta limpieza**:

1. Clonar el repo y hacer checkout de la rama `preserve/...` que corresponda.
2. Copiar el archivo de entorno de ejemplo del repo y completar valores locales. **Nunca commitear el `.env`.**
3. Levantar con un nombre de proyecto propio para aislarlo, por ejemplo `docker compose -p dpqa-<tema> up -d --build` usando `docker-compose.yml`.
4. Publicar los puertos solo en `127.0.0.1` (la BD no debe exponerse en `0.0.0.0`) y usar puertos distintos de los de producción.
5. Aplicar migraciones con el comando `dentalpin db upgrade`.
6. Crear datos de prueba sintéticos. No usar datos de pacientes reales.
7. Al terminar, retirar contenedores, volúmenes y red del proyecto por nombre.

## 7. Riesgos y pendientes

- El VPS publica puertos de Docker sin que ufw los filtre (Docker salta ufw). Conviene añadir reglas en la cadena `DOCKER-USER` o publicar solo en `127.0.0.1`.
- Los archivos compose de los QA estaban en `/tmp` y no forman parte del repo; no se pueden reconstruir idénticos.
- Los directorios de código con cambios locales sin commit (p. ej. pestañas de paciente, dp09) siguen en el VPS y no se tocaron.

## 8. Anexo de cierre operativo y residuos pendientes (2026-11-21)

### Medición antes/después

| Métrica | Previa | Posterior | Variación aproximada |
|---|---:|---:|---:|
| Disco usado | 141 GB | 126 GB | -15 GB (grupo A ~9 GB; B ~6 GB) |
| Disco libre | 53 GB | 68 GB | +15 GB |
| RAM en uso | 10.792 MB | 8.771 MB | -2.021 MB; incluye cambios de caché y otros procesos |
| RAM disponible | 5.199 MB | 7.156 MB | +1.957 MB |

Se reportaron **67 contenedores, 19 volúmenes, 18 imágenes y 8 redes retirados**. Estado final comunicado: **49 contenedores en total, 33 activos**. Los recuentos globales pueden variar por otras tareas ejecutadas en el mismo host; no derivar un ahorro de RAM exacto únicamente de la variación de memoria total.

### Backups privados de los QA retirados

Antes de eliminar el grupo B se generaron cuatro volcados comprimidos en la VPS: `/opt/backups/denplant-qa-retired-20261121/`. El informe del operador registra permisos restringidos a root (archivos 0600) y prueba de integridad `gzip -t` correcta; tamaños reportados: 53 KB, 83 KB, 24 KB y 366 bytes. **No son parte del repositorio público**, no equivalen a un ensayo de restauración y su persistencia fuera de la VPS no fue verificada. La eliminación o traslado de esos respaldos requiere una decisión separada.

### Cuatro volúmenes de BD QA anteriores, preservados

No pertenecían a los grupos A/B expresamente autorizados y por eso no fueron eliminados. Consumo total aproximado: **0,3 GB**.

- `denplant-c2a_c2a_pg`
- `denplant-c2b-b02-r3-20261020t2310z_b02r3_pg`
- `denplant-rc012-clinical-r2-20261024-pg`
- `denplant_clinical_reconcile_qa_pgdata`

Antes de un eventual retiro: comprobar ausencia de consumidores y datos únicos, registrar inventario/respaldos si corresponde y autorizar una nueva operación específica. Los directorios del grupo C con cambios locales **también se conservaron**.

### Validaciones y riesgos aún abiertos

- Verificación HTTP posterior comunicada: Denplant `302`, CRM `307`, Supabase `401`, coincidente con la línea base. Esta verificación no sustituye QA funcional extremo a extremo.
- Los puertos QA `5432, 13001, 18001, 15433, 13080, 18080, 28080, 28081, 28432, 25432` dejaron de escuchar según el informe de limpieza.
- `ufw` activo, pero las publicaciones Docker pueden eludir sus reglas; la cadena `DOCKER-USER` estaba vacía al auditar. **No se cambiaron reglas de firewall**. Evaluar restricción de puertos y pruebas desde el exterior en una tarea de seguridad independiente.
- **Riesgo de trazabilidad:** `main` no refleja la versión desplegada `f58a09f`. Código preservado en la rama `preserve/20261121-dp33-demo-integration-prod-f58a09f` y PR Draft [#26](https://github.com/AlexisCasas/Denplant/pull/26). No integrar directamente sin revisión de diferencias y estrategia de sincronización; la preservación no constituye aprobación de despliegue.
- PR Draft [#27](https://github.com/AlexisCasas/Denplant/pull/27) (DP-17) y [#28](https://github.com/AlexisCasas/Denplant/pull/28) (pagos) siguen pendientes de evaluación.

**Alcance de esta bitácora:** hechos y cifras informados por la ejecución de Claude Code en la VPS. La actualización documental en GitHub no implica una nueva ejecución ni comprobación independiente del host.


## 9. Integración de baseline productivo en `main` (2026-11-21)

**Cierre de integración de código — PR #30.** Este apartado actualiza el riesgo de trazabilidad descrito en la sección 8, que refleja la situación previa al merge.

| Campo | Evidencia |
|---|---|
| PR de integración | [#30](https://github.com/AlexisCasas/Denplant/pull/30) — merged |
| Commit original de producción preservado | `f58a09f5672baa203865ff8ba382babfaf813ccf` |
| Commit correctivo validado | `46ee55a5ecc50bd4b1f560cab46afd908574b6ca` |
| Validación previa | [GitHub Actions #44932807930](https://github.com/AlexisCasas/Denplant/actions/runs/44932807930): 10/10 PASS |
| Commit merge a `main` | `e41307742d235c2eb95bac878d4af32fe926d122` |
| PR original de preservación | [#26](https://github.com/AlexisCasas/Denplant/pull/26), marcado merged automáticamente al quedar su SHA en `main` |
| CI de `main` posterior al merge | [#44938682765](https://github.com/AlexisCasas/Denplant/actions/runs/44938682765), iniciado; resultado final pendiente en el momento de esta anotación |

El merge se realizó mediante commit de merge, con condición de SHA esperado. GitHub verificó `main=e41307742d235c2eb95bac878d4af32fe926d122` y PR #30 fusionado. La línea preservada es ancestro de `main`, aunque `main` incorpora correcciones posteriores, de modo que **no representa los mismos binarios desplegados**.

### Límites de la verificación

- En GitHub solo se verificaron workflows `CI`, `Release` e `Images health`. El workflow `Release` se activa por etiquetas `v*` o manualmente, no por un push normal a `main`. No se corroboraron automatizaciones externas.
- **No se realizó deploy, reinicio, cambio de base de datos ni migración en VPS desde esta integración.** No se puede afirmar que la producción actual haya sido auditada después del merge.
- **Gate pendiente de solo lectura en VPS:** cotejar imágenes Docker reales/digests y provenance con commits `f58a09f` (backend) y `f10b358` (frontend), y comprobar revisiones Alembic aplicadas. Los nombres de etiquetas por sí solos no prueban el origen.
- **Gate operativo pendiente:** CI de `main` al completar la ejecución posterior al merge, más observación de salud y confirmación de ausencia de autodeploy externo.
- Los PR [#27](https://github.com/AlexisCasas/Denplant/pull/27) y [#28](https://github.com/AlexisCasas/Denplant/pull/28), los cuatro volúmenes QA antiguos y directorios C permanecen como actividades separadas, no incluidas en el merge.

**Estado:** `PR30_MERGE=PASS`; `MAIN_CI=RUNNING` al documentar; `VPS_PROVENANCE=UNVERIFIED`. No equiparar merge exitoso con cierre de la auditoría operativa.


## 10. Resultado definitivo del CI de `main` (2026-11-21)

GitHub Actions [run #44938682765](https://github.com/AlexisCasas/Denplant/actions/runs/44938682765) terminó **`completed/success`** sobre `main` en el commit de merge `e41307742d235c2eb95bac878d4af32fe926d122`. Se verificaron **10/10 jobs PASS**: `catalog-freshness`, `docs-layout`, `frontend-test`, `e2e`, `backend-test` (incluido Alembic round-trip), `frontend-typecheck`, `backend-lint`, `manifest-consistency`, `docs-portal-build` y `frontend-lint`.

**`PR30_MERGE=PASS; MAIN_CI=PASS; VPS_PROVENANCE=UNVERIFIED`.** Lo anterior completa la **integración de código**. Sigue pendiente el gate de auditoría de solo lectura en VPS de procedencia real de imágenes, revisiones aplicadas de Alembic, salud productiva posterior y revisión de automatizaciones externas. No equivale a un despliegue ni verifica el estado de la VPS.


## 11. Auditoría VPS de procedencia y migraciones (2026-11-21)

Se recibió informe de auditoría **solo lectura** desde `srv1917080`:
- `PROVENANCE_BACKEND=PASS`: se extrajeron `/app/app`, `/app/alembic`, `pyproject.toml` de la imagen ejecutada `denplant-backend:dp33-f58a09f` y se compararon con `git archive f58a09f`, **0 diferencias** según el informe del operador.
- `PROVENANCE_FRONTEND=UNVERIFIED`: la imagen `denplant-frontend:dp33-f10b358` solo contiene el build `.output`. Etiqueta, compose e intervalo de 8 minutos desde el commit son indicios, **no prueba criptográfica de procedencia**. No se ejecutó rebuild ni deploy.
- `PRODUCTION_HEALTH=PASS`: backend, frontend y PostgreSQL sanos, Caddy activo y validado; HTTP Denplant 302, CRM 307, Supabase 401; WACRM/Supabase contenedores sanos según observación.
- `EXTERNAL_DEPLOY_TRIGGERS=NONE` **dentro de los mecanismos auditados**: crontab, systemd timers/services, runners/webhooks, Watchtower y workflows GitHub. No se verificaron todos los sistemas externos.
- Hay backups anteriores al despliegue en `/opt/apps/dentalpin/backups`; su restaurabilidad **no se probó** y no se identificó la imagen backend previa disponible en VPS.

### Migraciones con mismo ID, contenido reformateado

Se cotejó el código de `f58a09f` vs `main` para `ag_0007`, `pc_0002` y `pay_0005`. Se hizo una comparación de diferencias por líneas y una segunda comparación por secuencia de tokens, ignorando únicamente blancos, comentarios y comas finales opcionales. Las tres secuencias resultaron **idénticas**. No se observaron cambios semánticos en las operaciones Alembic. Esto elimina la sospecha de cambio funcional de esas tres migraciones, **sin demostrar por sí solo la equivalencia del esquema físico de la BD**.

### Copilot / `cop_0004`: diagnóstico pendiente

La BD de producción registra 20 cabezas de Alembic de 21 que existen en el código: falta `cop_0004` y el operador no encontró tablas `copilot*`. Esto puede significar un módulo no instalado, pero requiere verificación.

**Hallazgo del código:** `CopilotModule.manifest.auto_install=True` en `backend/app/modules/copilot/__init__.py`, mientras `ModuleService.reconcile_with_db` conserva `state` de módulos ya registrados: el auto-install inicial aplica **solo si el registro aún no existía**. El arranque monta únicamente módulos `core_module.state='installed'`. Por tanto el estado persistido determina la interpretación; **no ejecutar migraciones automáticamente**.

Verificación pendiente en SQL exclusivamente lectura, sin valores sensibles:
```sql
BEGIN TRANSACTION READ ONLY;
SELECT name, state, auto_install, installed_at, base_revision, applied_revision,
       last_state_change
FROM core_module WHERE name = 'copilot';

SELECT operation, step, status, created_at
FROM core_module_operation_log
WHERE module_name = 'copilot'
ORDER BY created_at DESC LIMIT 20;

SELECT version_num FROM alembic_version WHERE version_num LIKE 'cop_%' ORDER BY version_num;
SELECT to_regclass('public.copilot_conversations') AS copilot_conversations;
ROLLBACK;
```
Si el módulo aparece `uninstalled` o `disabled`, confirmar si fue decisión funcional y registrar excepción de instalación. Si aparece `installed` sin tablas/migraciones, tratarlo como **inconsistencia real**: investigar logs/estado antes de decidir activar o corregir, sin aplicar `upgrade`, `stamp` ni reinicios no autorizados.

**Estado operativo:** `MAIN_CI=PASS`; `VPS_HEALTH=PASS`; `BACKEND_PROVENANCE=PASS`; `FRONTEND_PROVENANCE=UNVERIFIED`; `COPILOT_MODULE_STATE=PENDING`; `CLOSURE_GATE=BLOCKED`. Las dudas pendientes no invalidan el merge ya completado del PR #30.


## 12. Aclaración final de Copilot y política de instalación (2026-11-21)

**Decisión operativa del propietario: Copilot no se necesita y debe permanecer desinstalado.** No se solicitaron ni ejecutaron migraciones, instalación ni cambios de configuración en producción.

### Evidencia de la base de datos — auditoría READ ONLY

- `core_module.name='copilot'`: `state='uninstalled'`, `installed_at=NULL`, `applied_revision=NULL`, `base_revision='cop_0004'`.
- `core_module_operation_log`: desinstalación el 2026-10-09 16:25:18–16:25:23 UTC, con cinco etapas completas: `backup`, `lifecycle`, `delete_data`, `migrate_down`, `finalize`.
- `alembic_version`: sin `cop_%`. Las tres tablas investigadas `copilot_settings`, `copilot_conversations`, `copilot_messages` no existen.
- El respaldo generado por el paso `backup` de esa desinstalación no fue localizado ni restaurado; la auditoría no atribuyó quién ordenó la operación. Esta evidencia demuestra una desinstalación **técnicamente completada**, no una intención histórica documentada.
- La etiqueta `COPILOT_DB_STATE=OTHER` en un informe intermedio obedeció a un problema de enumeración del informe; el **valor real de la BD es `uninstalled`**.

**Conclusión:** la ausencia de `cop_0004` es coherente con la desinstalación: `COPILOT_CAUSE=EXPLAINED`, `MIGRATIONS_ACTION_REQUIRED=NO`, `PRODUCTION_MODIFIED=NO`.

### Auditoría de arranque en el código realmente desplegado (`f58a09f`)

Se revisaron `backend/docker-entrypoint.sh`, `backend/app/cli/db.py`, `backend/app/core/plugins/alembic_paths.py`, `backend/app/core/plugins/service.py`, `backend/app/core/plugins/processor.py` y `backend/app/main.py` en `f58a09f`.

1. El entrypoint usa `python -m app.cli db upgrade`, **no** `alembic upgrade heads` indiscriminado.
2. `_cmd_upgrade` decide instalar una rama solo cuando su registro de `core_module` está en `installed`; `manifest.auto_install` se consulta como valor supletorio **únicamente si falta la fila del módulo**.
3. `boot_upgrade_targets` omite las ramas cuyo módulo no está instalado. Por lo tanto la rama `copilot` se omite con el registro actual `uninstalled`.
4. El reconciliador conserva `state` de los módulos ya existentes, y `PendingProcessor` actúa solo sobre estados pendientes; el montaje de rutas/trabajos del módulo también se limita a registros `installed`.

**Resultado acotado:** con la fila actual `core_module.state='uninstalled'`, un arranque normal del código `f58a09f` **no debería reinstalar Copilot ni aplicar `cop_0004`**. Este control deriva de lectura estática del código y del estado reportado, no de un reinicio experimental.

**Riesgo futuro:** `CopilotModule.manifest.auto_install=True` sigue en el código. En una BD recién inicializada o si desaparece la fila de `core_module`, este valor permitiría instalarlo automáticamente. Si la política de producto exige **Copilot siempre desactivado incluso en instalaciones nuevas**, proponer cambio `auto_install=False` mediante PR independiente, revisión y QA. No es condición para mantenerlo desinstalado en la BD actual.

### Equivalencia entre archivos Alembic `f58a09f` y `main`

`ag_0007`, `pc_0002`, `pay_0005` tienen el mismo contenido operativo según comparación por líneas y secuencia de tokens fuente excluyendo blancos, comentarios y comas finales opcionales. **Las tres secuencias de tokens coinciden**. Las modificaciones corresponden a formato, no a alteraciones de DDL. No repetir migraciones existentes ni hacer `stamp` por esos cambios.

### Estado del cierre

- `GITHUB_MAIN_MERGE=PASS` (`e4130774`).
- `MAIN_CI=PASS` (10/10 en run `44938682765`).
- `BACKEND_PROVENANCE=PASS`.
- `COPILOT_STATE=UNINSTALLED_CONFIRMED`, `COPILOT_EXCEPTION=EXPLAINED`.
- `ALEMBIC_PC0002_SOURCE_EQUIVALENCE=PASS`; el esquema físico no fue comparado exhaustivamente.
- `PRODUCTION_HEALTH=PASS` en la auditoría del operador.
- `FRONTEND_PROVENANCE=UNVERIFIED`, pendiente como excepción de trazabilidad **no resuelta**. No reconstruir ni desplegar frontend productivo por esta sola auditoría.

**La prioridad de sincronización GitHub/CI está finalizada.** El cierre de trazabilidad binaria de frontend es distinto y sigue abierto sin evidencia nueva; no presentar un resultado no verificado como PASS.

## 13. Acta final de cierre y aceptación de excepción de procedencia frontend (2026-11-21)

**Decisión de la persona responsable del proyecto:** se **acepta expresamente** la evidencia disponible del frontend desplegado, a efectos de **cerrar esta prioridad de saneamiento QA y sincronización del repositorio**. Esta aceptación **no convierte la procedencia del binario frontend en verificada** ni autoriza reconstruirlo o desplegarlo. No se declara equivalencia binaria con los fuentes de `f10b358`.

### Alcance de la excepción aceptada

| Campo | Estado y sustento |
|---|---|
| Artefacto afectado | Frontend Docker `denplant-frontend:dp33-f10b358`, imagen en ejecución ID informado `sha256:ffe3be58…a16e` |
| Versión fuente candidata | Commit `f10b358`, antecesor del commit backend `f58a09f` y de `main` |
| Evidencia disponible | Compose de release referencia dicha etiqueta; build de imagen 2026-11-18 23:51 UTC, ~8 min después del commit; contenedor estable; verificaciones de salud y HTTP reportadas |
| Evidencia **no disponible** | SHA/label de commit dentro del binario, build reproducible aislado y coincidencia de digest contra una reconstrucción controlada |
| Clasificación técnica | `FRONTEND_PROVENANCE=UNVERIFIED` |
| Decisión de cierre | `FRONTEND_PROVENANCE_RISK=ACCEPTED_FOR_THIS_CLOSURE` |
| Exclusiones | No autoriza asumir coincidencia criptográfica, instalar nuevas versiones, cambiar contenedores ni ejecutar migraciones de BD |

El riesgo residual es que el frontend construido **pueda** diferir del contenido fuente atribuido por la etiqueta. La aceptación se limita al **entorno productivo observado** y a la **prioridad de documentación/integración GitHub**, no a futuras versiones, rollbacks o nuevos despliegues. Para futuras imágenes, adjuntar procedencia de Git (`org.opencontainers.image.revision`), digests inmutables y evidencia de build verificada fuera de producción.

### Resultado consolidado

| Línea de trabajo | Resultado |
|---|---|
| Limpieza QA grupos A+B | `PASS`. Reporte operativo: 67 contenedores, 19 volúmenes, 18 imágenes y 8 redes retirados; ~15 GB de disco recuperados y ~2 GB de RAM menos en uso (esta última es estimación afectada por caché). |
| Preservación código local | `PASS`. Seis ramas `preserve/...` publicadas en GitHub, con SHAs cotejados por el ejecutor. |
| Integración de baseline a GitHub | `PASS`. PR [#30](https://github.com/AlexisCasas/Denplant/pull/30) merged, `main=e41307742d235c2eb95bac878d4af32fe926d122`; PR #26 quedó absorbido como antecedente. |
| Pruebas GitHub Actions sobre `main` | `PASS` — 10/10 en [run 44938682765](https://github.com/AlexisCasas/Denplant/actions/runs/44938682765). |
| Procedencia backend | `PASS` sobre `f58a09f`, según auditoría de solo lectura del operador: 0 diferencias en rutas fuente extraídas de la imagen. |
| Procedencia frontend | `UNVERIFIED / ACCEPTED_RISK`, no `PASS`. |
| Migraciones ya aplicadas `ag_0007`, `pc_0002`, `pay_0005` | Comparación de secuencias de tokens `f58a09f` frente a `main`: `PASS` (formateo sin cambio operacional detectado). No equivale a auditoría física exhaustiva del esquema. |
| Copilot / `cop_0004` | `EXPLAINED`. `core_module.state=uninstalled`, desinstalación completa 2026-10-09; ausencia de migración/tablas es coherente. El responsable **no necesita instalar Copilot**. |
| Salud producción y servicios compartidos | `PASS` conforme a la auditoría de solo lectura de la VPS; respuesta HTTP Denplant 302, CRM 307, Supabase 401 sin cambios respecto a la línea base. |
| Despliegue de nuevas imágenes / migraciones durante este cierre | **NINGUNO**. |

**Interpretación operativa:** la prioridad de **retirar QA A/B, preservar código, sincronizar `main`, obtener CI verde y documentar** se declara **CERRADA**, con la excepción frontend **aceptada y registrada**. No afirmar que se verificó la trazabilidad binaria frontend.

### Exclusiones y seguimiento independiente

- Cuatro volúmenes antiguos de PostgreSQL QA sin contenedores (~0,3 GB) y los directorios locales protegidos del grupo C continúan sujetos a auditoría y autorización propia.
- [PR #27](https://github.com/AlexisCasas/Denplant/pull/27) (DP-17) y [PR #28](https://github.com/AlexisCasas/Denplant/pull/28) (pagos) permanecen como revisión funcional separada.
- Respaldos de BD en la VPS **no fueron restaurados** en un ensayo verificable; el respaldo previo de la versión anterior de backend no se comprobó recuperable. La protección de puertos Docker (`DOCKER-USER`) sigue como mejora de seguridad independiente.
- En el código desplegado, `auto_install=True` de Copilot solo aplica si no hay fila previa en `core_module`; con el registro productivo `uninstalled` el arranque normal omite migraciones de Copilot. Para nuevas instalaciones podría autoactivarse. Una política de desactivación por defecto en instancias nuevas requeriría PR separado; **no instalar ni ejecutar `alembic upgrade heads` indiscriminadamente**.
- Se desconocen autor y motivo originales de la desinstalación histórica de Copilot. El respaldo de aquella operación no se localizó ni verificó.
- Esta acta no representa autorización de deploy ni un nuevo examen directo del servidor desde GitHub.

### Referencias

- [PR #29 — bitácora y cierre](https://github.com/AlexisCasas/Denplant/pull/29)
- [PR #30 — integración de baseline productivo](https://github.com/AlexisCasas/Denplant/pull/30)
- [GitHub Actions — CI `main` 10/10](https://github.com/AlexisCasas/Denplant/actions/runs/44938682765)
