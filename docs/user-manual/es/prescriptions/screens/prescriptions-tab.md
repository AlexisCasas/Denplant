---
module: prescriptions
screen: prescriptions-tab
route: /patients/{id}?tab=clinical&clinicalMode=prescriptions
related_endpoints:
  - GET /api/v1/prescriptions
  - GET /api/v1/prescriptions/{prescription_id}
  - GET /api/v1/prescriptions/{prescription_id}/pdf
  - POST /api/v1/prescriptions
  - POST /api/v1/prescriptions/{prescription_id}/void
related_permissions:
  - prescriptions.read
  - prescriptions.prescribe
  - prescriptions.void
related_paths:
  - backend/app/modules/prescriptions/frontend/components/PrescriptionsView.vue
  - backend/app/modules/prescriptions/frontend/components/PrescriptionDetailModal.vue
  - backend/app/modules/prescriptions/frontend/components/PrescriptionCreateModal.vue
  - backend/app/modules/prescriptions/frontend/components/PrescriptionVoidModal.vue
  - backend/app/modules/prescriptions/router.py
last_verified_commit: 588f47b
---

# Pestaña Recetas

La pestaña **Recetas** reúne todas las recetas de un paciente y es el lugar
desde donde se redacta una nueva, se imprime o se anula.

## Dónde encontrarla

*Pacientes →* el paciente *→ Clínico → Recetas*. Está entre **Citas** e
**Histórico**. Solo aparece si tu rol puede ver recetas (odontólogos y
administradores).

## El histórico

Muestra las recetas del paciente, de la más reciente a la más antigua, de 10 en
10. Si hay más de una página, usa **Anterior** y **Siguiente**.

Cada fila indica:

- **Fecha** de emisión.
- **Número** de la receta.
- **Odontólogo** que la emitió.
- **Medicamentos**: cuántos lleva.
- **Estado**: *Emitida* o *Anulada*.
- Dos botones: **Ver** y **Imprimir**.

Si el paciente aún no tiene recetas, aparece un mensaje indicándolo.

## Nueva receta

El botón **Nueva receta** aparece arriba a la derecha, solo para el
**odontólogo**. Para poder emitir:

- Tu **colegiatura** debe estar registrada en tu perfil. Si falta, el botón sale
  desactivado con el aviso *«Tu colegiatura no está registrada. Contacta al
  administrador.»*
- El paciente debe tener **fecha de nacimiento**. Si falta, el botón sale
  desactivado con el aviso *«Complete la fecha de nacimiento del paciente antes
  de emitir una receta.»* Complétala en la ficha del paciente y vuelve aquí.
  Si el sistema no pudo comprobarlo de antemano, te lo indicará al intentar
  emitir, sin perder lo que escribiste.

Un administrador no ve este botón.

### Datos de la receta

Arriba verás, **solo para consulta**, el paciente, tu nombre, tu colegiatura y la
clínica. Esos datos los toma el sistema y no se pueden cambiar aquí.

- **Vigencia hasta**: el último día en que la receta es válida. Es obligatorio y
  empieza vacío: tú decides la fecha. No puede ser anterior al día de emisión,
  que fija el sistema con la zona horaria de la clínica.

### Medicamentos

Cada receta lleva uno o varios medicamentos, cada uno en su propia tarjeta
(*Medicamento 1*, *Medicamento 2*…). Los campos marcados con * son obligatorios.

| Campo | Obligatorio | Qué escribir |
|-------|:-----------:|--------------|
| Principio activo (DCI) | Sí | La denominación común del fármaco. |
| Nombre comercial | No | La marca, si quieres indicarla. |
| Concentración | Sí | Por ejemplo, *500 mg*. |
| Forma farmacéutica | Sí | Por ejemplo, *cápsula* o *tableta*. |
| Presentación | No | El envase, por ejemplo *caja x 21*. |
| Dosis | Sí | Cuánto tomar cada vez. |
| Vía | Sí | Por ejemplo, *vía oral*. |
| Frecuencia | Sí | Cada cuánto tiempo. |
| Duración | Sí | Durante cuánto tiempo. |
| Cantidad total | Sí | Cuánto entregar en total. |
| Indicaciones | No | Instrucciones adicionales (hasta 4000 caracteres). |

Todos los campos son texto libre: DenPlant no sugiere ni autocompleta
medicamentos, no calcula dosis y no avisa de interacciones.

Para **añadir otro medicamento**, pulsa **Añadir medicamento** (hasta 50). Para
quitar uno, usa el botón de la papelera de su tarjeta; la receta siempre lleva al
menos uno.

### Emitir

Pulsa **Emitir receta**. Si falta algún dato obligatorio, el sistema marca los
campos y te lleva al primero.

Antes de guardar, aparece una **confirmación**:

> Al emitir la receta ya no podrá editarse. Si necesita corregirla deberá
> anularla y emitir una nueva.

Elige **Volver** para seguir revisando (no se pierde nada) o **Emitir receta**
para confirmar. Al emitirla se abre el **detalle** de la receta recién creada,
para que compruebes lo que has emitido. No se imprime sola.

Si cierras el formulario con datos escritos, te pregunta antes de descartarlos.
Si cambias de paciente, el borrador se descarta sin preguntar. Si algo falla al
emitir, el formulario sigue abierto con todo lo que escribiste.

## El detalle

**Ver** abre la receta completa, tal como se emitió: número, estado, fecha de
emisión, vigencia, datos del paciente (nombre, documento y fecha de nacimiento),
datos del odontólogo (nombre y colegiatura) y todos los medicamentos.

Desde aquí también puedes **Imprimir** y, si tienes permiso, **Anular receta**.

## Imprimir

**Imprimir** abre la receta como **PDF en una pestaña nueva**, lista para
imprimir. Si tu navegador bloquea la ventana emergente, el PDF se descarga en su
lugar.

> El PDF está diseñado para impresión y requiere **firma y sello manuscrito** del
> odontólogo. No es una receta electrónica ni lleva firma digital.

Se puede imprimir tantas veces como haga falta, también las recetas anuladas.

## Anular una receta

Anular sirve para corregir un error: no se edita la receta, se anula y se emite
otra.

- Pueden anularla **el odontólogo que la emitió** o **un administrador**. Otro
  odontólogo no puede anular una receta ajena.
- Solo se anulan las recetas *Emitidas*; una anulada no vuelve a anularse.
- El botón **Anular receta** está **solo en el detalle**, no en la lista.

Al pulsarlo se abre una ventana que avisa: *«La anulación no se puede
revertir.»* Escribe el **motivo de anulación** (obligatorio) y confirma con
**Anular receta**.

Después:

- La receta pasa a estado **Anulada** y el detalle muestra el motivo y la fecha
  de anulación.
- Si la imprimes de nuevo, el PDF lleva la marca de agua **ANULADA** en todas las
  páginas. El motivo no se imprime.
- Si otra persona la anuló mientras tanto, el sistema te lo indica y actualiza lo
  que ves.

## Si algo no aparece

- **No veo la pestaña Recetas.** Tu rol no puede ver recetas; pide acceso a un
  administrador.
- **No veo «Nueva receta».** Solo la ve el odontólogo.
- **No veo «Anular receta».** Solo la ve quien emitió la receta, o un
  administrador, y solo mientras esté *Emitida*.
