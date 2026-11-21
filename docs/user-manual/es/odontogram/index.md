---
module: odontogram
last_verified_commit: 0000000
---

# Odontogram

> _Esqueleto generado automáticamente — reemplazar con documentación real cuando se toque este módulo._

Página de aterrizaje del módulo `odontogram` en el manual de usuario.

## Pantallas

Este módulo no aporta páginas Nuxt propias.

## Permisos

- `odontogram.read`
- `odontogram.write`
- `odontogram.treatments.read`
- `odontogram.treatments.write`

## Imprimir el odontograma (NTS N.° 188)

Con el perfil **MINSA Perú (NTS N.° 188)** activo, el odontograma en pantalla
puede imprimirse como hoja A4. El botón **Imprimir** está sobre el gráfico y
siempre se refiere al registro que estás viendo: el histórico si abriste uno,
el borrador si lo hay, y si no, el registro vigente.

### Antes de imprimir

Al pulsar **Imprimir** se abre una ventana con las cuatro opciones que debes
confirmar en el diálogo del navegador:

- **Papel:** A4
- **Orientación:** vertical
- **Escala:** 100 %
- **Color:** imprime a color

> **No uses «Ajustar a página».** Reduce el gráfico por debajo del tamaño
> mínimo de corona que exige la norma (§5.17). El rojo y el azul distinguen el
> estado clínico de cada hallazgo (§5.12–5.13), así que una impresión en
> blanco y negro pierde esa información.

Si el registro contiene hallazgos que DenPlant no dibuja completamente, la
ventana te dice cuántos son antes de imprimir, y la hoja incluye una nota del
sistema que los identifica. No impide imprimir.

### Cuándo no se puede imprimir

La hoja se compone con el registro **guardado**, así que el botón se desactiva
—explicando el motivo— mientras haya algo que la haría inexacta:

| Situación | Qué hacer |
|---|---|
| Tienes texto sin guardar | Guarda o descarta tus cambios |
| Hay un cambio en curso | Espera a que termine |
| Se guardó pero no se pudo releer | Pulsa reintentar en el aviso |
| Otro registro cambió este odontograma | Revisa el aviso de conflicto |

### Registros que no son el vigente

Un borrador, un registro descartado o uno superado **sí** pueden imprimirse.
La hoja lo indica arriba, antes del gráfico: `BORRADOR`, `DESCARTADO` (con su
motivo) o `REGISTRO SUPERADO`. Un borrador indica además cuántos hallazgos
arrastrados siguen pendientes de revisión.

## Recursos técnicos

- [Resumen técnico](../../../technical/odontogram/overview.md)
- [Permisos](../../../technical/odontogram/permissions.md)
- [Eventos](../../../technical/odontogram/events.md)
