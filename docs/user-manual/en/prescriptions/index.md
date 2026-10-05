---
module: prescriptions
last_verified_commit: 588f47b
---

# Prescriptions

The **prescriptions** module lets the dentist write medication prescriptions for
a patient, print them and sign them by hand. It lives inside the patient record,
under *Clinical → Prescriptions*.

Every issued prescription is stored with its **number** (for example
`RX-2026-000004`), with the patient's, the dentist's and the clinic's details as
they were on the day it was issued, and with its list of medications. An issued
prescription **cannot be edited or deleted**: if there is a mistake, void it and
issue a new one.

## Screens

- [Prescriptions tab](./screens/prescriptions-tab.md) — the patient's
  prescription history, new prescription, detail, printing and voiding.

## What it is, and what it is not

- It is a **printable prescription document**. The PDF needs the dentist's
  **handwritten signature and stamp** before it is given to the patient.
- It is **not an electronic prescription** and it carries no digital signature.
  DenPlant does not send the prescription to any pharmacy or external system.
- DenPlant **does not choose medications, calculate doses or check interactions**,
  and it does not replace professional judgement: everything on the prescription
  is text the dentist writes.

## Who can do what

| Action | Who |
|--------|-----|
| View the history and the detail, print | Dentists and administrators. |
| Issue a prescription | Only the **dentist**, with their **professional registration number** set in their profile. |
| Void a prescription | The dentist who issued it, or an administrator. |

Administrators can view, print and void prescriptions but **cannot issue them**.
The rest of the team (hygienists, assistants and reception) does not see the
Prescriptions tab.

## Known limitations

- Prescriptions of archived patients cannot be viewed.
- The PDF has Spanish and English texts only.
- Reprinting a prescription uses the clinic's current logo; everything else is as
  it was on the issue date.
