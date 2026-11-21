---
module: catalog
screen: catalog
route: /settings/catalog
related_endpoints:
  - DELETE /api/v1/catalog/categories/{category_id}
  - DELETE /api/v1/catalog/items/{item_id}
  - DELETE /api/v1/catalog/vat-types/{vat_type_id}
  - GET /api/v1/catalog/categories
  - GET /api/v1/catalog/categories/{category_id}
  - GET /api/v1/catalog/items
  - GET /api/v1/catalog/items/popular
  - GET /api/v1/catalog/items/search
  - GET /api/v1/catalog/items/{item_id}
  - GET /api/v1/catalog/odontogram-treatments
  - GET /api/v1/catalog/odontogram-treatments/by-category
  - GET /api/v1/catalog/vat-types
  - GET /api/v1/catalog/vat-types/default
  - GET /api/v1/catalog/vat-types/{vat_type_id}
  - POST /api/v1/catalog/categories
  - POST /api/v1/catalog/items
  - POST /api/v1/catalog/seed
  - POST /api/v1/catalog/vat-types
  - PUT /api/v1/catalog/categories/{category_id}
  - PUT /api/v1/catalog/items/{item_id}
  - PUT /api/v1/catalog/vat-types/{vat_type_id}
related_permissions:
  - catalog.read
  - catalog.write
  - catalog.admin
related_paths:
  - backend/app/modules/catalog/frontend/pages/settings/catalog/index.vue
  - backend/app/modules/catalog/frontend/components/catalog/CatalogCategoriesModal.vue
  - backend/app/modules/catalog/frontend/components/catalog/CatalogItemModal.vue
last_verified_commit: b2d359a8
---

# /settings/catalog

Catálogo de tratamientos: códigos, precios, IVA, duración y agrupación por
categorías. Es la fuente de precios de presupuestos, planes y facturas.

## Permisos

- `catalog.read` — ver el catálogo (todos los roles).
- `catalog.write` — crear, editar y desactivar tratamientos.
- `catalog.admin` — gestionar categorías y cargar el catálogo por defecto.

## Para qué sirve

- **Buscar y filtrar** tratamientos por texto o categoría; la vista agrupada
  se pliega/despliega por categoría.
- **Nuevo tratamiento** — el modal exige código, nombre y **categoría**;
  sin categorías no se puede guardar.
- **Categorías** (botón de cabecera, solo `catalog.admin`) — crear,
  renombrar, ordenar y desactivar/reactivar categorías. Las categorías del
  sistema (semilla) están bloqueadas: se muestran con candado y el servidor
  rechaza editarlas o borrarlas.
- **Cargar catálogo por defecto** — aparece en el estado vacío (sin
  tratamientos, sin filtros) para `catalog.admin`. Añade tipos de IVA según el
  país de la clínica, las categorías y los tratamientos de referencia (precios
  a 0 si la moneda no es EUR). Es idempotente: solo crea lo que falta. Es la
  vía de reparación cuando una instalación se creó antes de que existiera la
  siembra automática o esta falló; la tarjeta "Primeros pasos" del panel
  enlaza aquí cuando detecta el catálogo vacío.

## Pestaña Clínico: visualización en odontograma

Al crear o editar un tratamiento, la pestaña **Clínico** incluye la sección
**Visualización en Odontograma**, que vincula el tratamiento con su
representación en el odontograma del paciente.

- **Tipo de tratamiento** — elige cómo aparece el tratamiento en el
  odontograma, o **Sin asociación** si no debe aparecer. La lista solo ofrece
  tipos compatibles con el modelo clínico actual.
- **Categoría clínica** — obligatoria siempre que haya un tipo de tratamiento
  seleccionado. Mientras falte, el campo se marca como obligatorio, la pestaña
  **Clínico** muestra un indicador de error y **Guardar** queda deshabilitado.
  Algunos tipos (por ejemplo puentes y férulas) no rellenan la categoría
  automáticamente, así que hay que elegirla a mano.
- **Tratamientos antiguos** — si un tratamiento estaba asociado a un tipo
  antiguo con una equivalencia moderna directa, el formulario lo carga con el
  tipo equivalente ya seleccionado y, al guardar, se almacena el tipo moderno.
- **Tipos antiguos no compatibles** — si el tipo guardado ya no tiene una
  equivalencia segura, el formulario muestra una advertencia con su nombre y
  **Guardar** queda deshabilitado hasta seleccionar manualmente un tipo válido.
- **Editar sin cambiar el tipo** conserva la configuración visual propia del
  tratamiento (por ejemplo, un color o un patrón concretos). Elegir otro tipo
  aplica la apariencia por defecto de ese tipo.
