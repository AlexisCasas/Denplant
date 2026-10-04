"""The patient's age on the day a prescription was issued.

Pure functions of two dates, and nothing else. They never read the clock: a
prescription from 2026 must say the same age in 2028, so the age is always
measured **at ``issue_date``**, from the date of birth frozen on the
prescription.

Leap day. Someone born on 29 February has their birthday on **1 March** in a
year that is not a leap year (they are still the younger age on 28 February and
the older one on 1 March). That is simply what comparing ``(month, day)``
tuples gives, and it is pinned by tests; it is a convention, not a legal rule.
"""

from __future__ import annotations

from datetime import date

#: Wording of the age on the printed document, per locale.
_UNITS = {
    "es": {"year": ("año", "años"), "month": ("mes", "meses")},
    "en": {"year": ("year", "years"), "month": ("month", "months")},
}


def _check(date_of_birth: date, issue_date: date) -> None:
    if issue_date < date_of_birth:
        raise ValueError("the issue date is before the date of birth")


def age_at(date_of_birth: date, issue_date: date) -> int:
    """Whole years completed on ``issue_date``."""
    _check(date_of_birth, issue_date)
    years = issue_date.year - date_of_birth.year
    if (issue_date.month, issue_date.day) < (date_of_birth.month, date_of_birth.day):
        years -= 1
    return years


def age_months_at(date_of_birth: date, issue_date: date) -> int:
    """Whole months completed on ``issue_date``."""
    _check(date_of_birth, issue_date)
    months = (issue_date.year - date_of_birth.year) * 12 + (issue_date.month - date_of_birth.month)
    if issue_date.day < date_of_birth.day:
        months -= 1
    return months


def format_age(date_of_birth: date, issue_date: date, *, locale: str = "es") -> str:
    """``"34 años"`` from one year of age; ``"8 meses"`` below it. Never days."""
    units = _UNITS.get(locale, _UNITS["es"])
    years = age_at(date_of_birth, issue_date)
    if years >= 1:
        singular, plural = units["year"]
        return f"{years} {singular if years == 1 else plural}"
    months = age_months_at(date_of_birth, issue_date)
    singular, plural = units["month"]
    return f"{months} {singular if months == 1 else plural}"
