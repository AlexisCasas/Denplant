---
module: odontogram
last_verified_commit: 0000000
---

# Odontogram

> _Scaffolded stub — replace with proper documentation when this module is next touched._

Landing page for the `odontogram` module in the end-user manual.

## Screens

This module ships no Nuxt pages of its own.

## Permissions

- `odontogram.read`
- `odontogram.write`
- `odontogram.treatments.read`
- `odontogram.treatments.write`

## Printing the odontogram (NTS N.° 188)

With the **MINSA Perú (NTS N.° 188)** profile active, the odontogram on screen
can be printed as an A4 sheet. The **Print** button sits above the chart and
always refers to the record you are looking at: the historical one if you
opened it, the draft if there is one, otherwise the record in force.

### Before printing

Pressing **Print** opens a window with the four settings you need to confirm
in the browser's own dialog:

- **Paper:** A4
- **Orientation:** portrait
- **Scale:** 100%
- **Colour:** print in colour

> **Do not use "Fit to page".** It shrinks the chart below the minimum crown
> size the norm requires (§5.17). Red and blue are what tell each finding's
> clinical state apart (§5.12–5.13), so a black-and-white print loses that
> information.

If the record contains findings DenPlant does not fully draw, the window tells
you how many before printing, and the sheet carries a system note identifying
them. It does not prevent printing.

### When printing is unavailable

The sheet is composed from the **saved** record, so the button is disabled —
with the reason shown — while anything would make it inaccurate:

| Situation | What to do |
|---|---|
| You have unsaved text | Save or discard your changes |
| A change is in flight | Wait for it to finish |
| It saved but could not be read back | Press retry on the notice |
| Another session changed this odontogram | Review the conflict notice |

### Records that are not the one in force

A draft, a discarded record or a superseded one **can** be printed. The sheet
says so at the top, before the chart: `DRAFT`, `DISCARDED` (with its reason)
or `SUPERSEDED RECORD`. A draft also states how many carried-forward findings
are still awaiting review.

## Technical references

- [Technical overview](../../../technical/odontogram/overview.md)
- [Permissions](../../../technical/odontogram/permissions.md)
- [Events](../../../technical/odontogram/events.md)
