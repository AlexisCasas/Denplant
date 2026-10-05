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

# Prescriptions tab

The **Prescriptions** tab gathers all of a patient's prescriptions, and it is
where a new one is written, printed or voided.

## Where to find it

*Patients →* the patient *→ Clinical → Prescriptions*. It sits between
**Appointments** and **History**. It only appears if your role can view
prescriptions (dentists and administrators).

## The history

It lists the patient's prescriptions, newest first, 10 per page. When there is
more than one page, use **Previous** and **Next**.

Each row shows:

- The **date** it was issued.
- The prescription **number**.
- The **dentist** who issued it.
- **Medications**: how many it has.
- The **status**: *Issued* or *Voided*.
- Two buttons: **View** and **Print**.

If the patient has no prescriptions yet, a message says so.

## New prescription

The **New prescription** button is at the top right, for the **dentist** only. To
issue one:

- Your **professional registration number** must be set in your profile. If it
  is missing, the button is disabled with the notice *"Your professional ID is
  not registered. Contact the administrator."*
- The patient must have a **date of birth**. If it is missing, the button is
  disabled with the notice *"Complete the patient's date of birth before issuing
  a prescription."* Fill it in on the patient's record and come back. If the
  system could not check this beforehand, it tells you when you try to issue,
  without losing what you wrote.

An administrator does not see this button.

### Prescription details

At the top you will see, **for reference only**, the patient, your name, your
registration number and the clinic. The system supplies them and they cannot be
changed here.

- **Valid until**: the last day the prescription is valid. It is required and
  starts empty: you decide the date. It cannot be before the day of issue, which
  the system sets using the clinic's timezone.

### Medications

A prescription has one or more medications, each in its own card (*Medication
1*, *Medication 2*…). Fields marked * are required.

| Field | Required | What to write |
|-------|:--------:|---------------|
| Active ingredient (INN) | Yes | The generic name of the drug. |
| Brand name | No | The brand, if you want to state it. |
| Strength | Yes | For example, *500 mg*. |
| Pharmaceutical form | Yes | For example, *capsule* or *tablet*. |
| Presentation | No | The pack, for example *box of 21*. |
| Dose | Yes | How much to take each time. |
| Route | Yes | For example, *oral*. |
| Frequency | Yes | How often. |
| Duration | Yes | For how long. |
| Total quantity | Yes | How much to dispense in total. |
| Instructions | No | Extra directions (up to 4,000 characters). |

All fields are free text: DenPlant does not suggest or autocomplete medications,
does not calculate doses and does not warn about interactions.

To **add another medication**, press **Add medication** (up to 50). To remove
one, use the bin button on its card; a prescription always keeps at least one.

### Issuing

Press **Issue prescription**. If a required field is missing, the system marks
the fields and takes you to the first one.

Before anything is saved, a **confirmation** appears:

> Once issued, the prescription can no longer be edited. To correct it you must
> void it and issue a new one.

Choose **Back** to keep reviewing (nothing is lost) or **Issue prescription** to
confirm. Once issued, the **detail** of the new prescription opens so you can
check what you issued. It is not printed automatically.

If you close the form with something written, it asks before discarding it. If
you switch patient, the draft is discarded without asking. If issuing fails, the
form stays open with everything you wrote.

## The detail

**View** opens the full prescription as it was issued: number, status, issue
date, validity, the patient's details (name, ID and date of birth), the dentist's
details (name and registration number) and every medication.

From here you can also **Print** and, if you are allowed, **Void prescription**.

## Printing

**Print** opens the prescription as a **PDF in a new tab**, ready to print. If
your browser blocks the pop-up, the PDF is downloaded instead.

> The PDF is designed for printing and requires the dentist's **handwritten
> signature and stamp**. It is not an electronic prescription and carries no
> digital signature.

You can print as many times as needed, including voided prescriptions.

## Voiding a prescription

Voiding is for correcting a mistake: the prescription is not edited, it is voided
and another one is issued.

- It can be voided by **the dentist who issued it** or by **an administrator**.
  Another dentist cannot void someone else's prescription.
- Only *Issued* prescriptions can be voided; a voided one cannot be voided again.
- The **Void prescription** button is **in the detail only**, not in the list.

Pressing it opens a window that warns: *"Voiding cannot be undone."* Write the
**reason for voiding** (required) and confirm with **Void prescription**.

Afterwards:

- The prescription becomes **Voided**, and the detail shows the reason and the
  date it was voided.
- If you print it again, the PDF carries a **VOIDED** watermark on every page.
  The reason is not printed.
- If someone else voided it in the meantime, the system tells you and refreshes
  what you see.

## If something is missing

- **I cannot see the Prescriptions tab.** Your role cannot view prescriptions;
  ask an administrator for access.
- **I cannot see "New prescription".** Only the dentist sees it.
- **I cannot see "Void prescription".** Only whoever issued the prescription, or
  an administrator, sees it, and only while it is *Issued*.
