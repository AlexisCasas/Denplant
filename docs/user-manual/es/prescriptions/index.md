---
module: prescriptions
last_verified_commit: 588f47b
---

# Recetas

El módulo de **recetas** permite al odontólogo redactar recetas de medicamentos
para un paciente, imprimirlas y firmarlas a mano. Vive dentro de la ficha del
paciente, en *Clínico → Recetas*.

Cada receta emitida queda guardada con su **número** (por ejemplo
`RX-2026-000004`), con los datos del paciente, del odontólogo y de la clínica
tal como estaban el día de la emisión, y con la lista de medicamentos. Una receta
emitida **no se puede editar ni borrar**: si hay un error, se anula y se emite una
nueva.

## Pantallas

- [Pestaña Recetas](./screens/prescriptions-tab.md) — histórico de recetas del
  paciente, nueva receta, detalle, impresión y anulación.

## Qué es y qué no es

- Es un **documento imprimible**. El PDF requiere **firma y sello manuscritos**
  del odontólogo antes de entregarse al paciente.
- **No es una receta electrónica** ni lleva firma digital. DenPlant no envía la
  receta a ninguna farmacia ni a ningún sistema externo.
- DenPlant **no elige medicamentos, no calcula dosis, no comprueba interacciones**
  y no sustituye el criterio profesional: todo lo que aparece en la receta es
  texto que escribe el odontólogo.

## Quién puede hacer qué

| Acción | Quién |
|--------|-------|
| Ver el histórico, el detalle e imprimir | Odontólogos y administradores. |
| Emitir una receta | Solo el **odontólogo** con su **colegiatura registrada** en su perfil. |
| Anular una receta | El odontólogo que la emitió o un administrador. |

Los administradores pueden ver, imprimir y anular recetas, pero **no pueden
emitirlas**. El resto del equipo (higienistas, asistentes y recepción) no ve la
pestaña Recetas.

## Limitaciones conocidas

- Las recetas de pacientes archivados no se pueden consultar.
- El PDF solo tiene textos en español e inglés.
- Al reimprimir una receta se usa el logotipo actual de la clínica; el resto de
  los datos son los de la fecha de emisión.
