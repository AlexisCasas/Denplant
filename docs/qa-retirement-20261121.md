# Retiro de entornos QA de Denplant — 2026-11-21

Documento de traspaso. Registra qué entornos QA se retiraron del VPS, qué trabajo se preservó en GitHub y cómo reconstruir un QA desde el repositorio. **No modifica `main` ni producción.**

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
| `preserve/20261121-dp33-demo-integration-prod-f58a09f` | `f58a09f` | DP-33 integrado sobre el baseline demo, incluye rediseño del presupuesto en 3 pasos y acceso a paciente archivado. **Es el commit que corre hoy en producción** | Árbol de integración DP-33 | PR Draft #26 por revisar |
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
