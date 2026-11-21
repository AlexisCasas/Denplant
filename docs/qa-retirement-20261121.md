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
| `preserve/20261121-dp33-demo-integration-prod-f58a09f` | `f58a09f` | DP-33 integrado sobre el baseline demo, incluye rediseño del presupuesto en 3 pasos y acceso a paciente archivado. **Es el commit que corre hoy en producción** | Árbol de integración DP-33 | PR Draft #27 por revisar |
| `preserve/20261121-dp17-patient-info-integrated` | `99c0654` | Pestañas clínicas del paciente junto con el selector de dentición (DP-17) | QA `dp17qa` | PR Draft #28 por revisar |
| `preserve/20261121-dp17-dentition-selector` | `d5433e9` | Selector de dentición permanente/temporal (subconjunto de la anterior) | QA `dp17qa` | Preservación |
| `preserve/20261121-payment-allocations-current` | `3d14d0e` | Asignación de pagos parciales por tratamiento (sobre la base actual) | QA `denplant_payment_qa` | PR Draft #26 por revisar |
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
