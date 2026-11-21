"""The age printed on a prescription: pure functions of two dates."""

from datetime import date

import pytest

from app.modules.prescriptions.age import age_at, age_months_at, format_age


def test_a_birthday_that_already_happened_counts():
    assert age_at(date(1990, 5, 17), date(2026, 10, 3)) == 36
    # ...including on the day itself
    assert age_at(date(1990, 5, 17), date(2026, 5, 17)) == 36


def test_a_birthday_that_has_not_happened_yet_does_not():
    assert age_at(date(1990, 5, 17), date(2026, 5, 16)) == 35
    assert age_at(date(1990, 12, 31), date(2026, 10, 3)) == 35


def test_the_age_does_not_depend_on_today():
    # The same prescription gives the same age whenever it is printed.
    assert age_at(date(2000, 1, 1), date(2010, 6, 1)) == 10
    assert age_at(date(2000, 1, 1), date(2010, 6, 1)) == 10


@pytest.mark.parametrize(
    ("issue", "expected"),
    [
        (date(2025, 2, 28), 0),  # 29 Feb 2024 -> still the younger age on 28 Feb...
        (date(2025, 3, 1), 1),  # ...and the older one on 1 March
        (date(2026, 2, 28), 1),
        (date(2026, 3, 1), 2),
    ],
)
def test_a_leap_day_birthday_is_the_first_of_march_in_a_common_year(issue, expected):
    assert age_at(date(2024, 2, 29), issue) == expected


def test_a_leap_day_birthday_in_a_leap_year_is_the_29th():
    assert age_at(date(2020, 2, 29), date(2024, 2, 28)) == 3
    assert age_at(date(2020, 2, 29), date(2024, 2, 29)) == 4


def test_an_issue_date_before_the_birth_is_an_error():
    with pytest.raises(ValueError):
        age_at(date(2026, 10, 4), date(2026, 10, 3))
    with pytest.raises(ValueError):
        age_months_at(date(2026, 10, 4), date(2026, 10, 3))
    with pytest.raises(ValueError):
        format_age(date(2026, 10, 4), date(2026, 10, 3))


def test_the_day_of_birth_is_zero():
    assert age_at(date(2026, 10, 3), date(2026, 10, 3)) == 0
    assert age_months_at(date(2026, 10, 3), date(2026, 10, 3)) == 0


@pytest.mark.parametrize(
    ("dob", "issue", "months"),
    [
        (date(2026, 1, 15), date(2026, 10, 14), 8),
        (date(2026, 1, 15), date(2026, 10, 15), 9),
        (date(2025, 10, 31), date(2025, 11, 30), 0),  # the 31st has not come round
        (date(2025, 10, 3), date(2026, 10, 2), 11),
        (date(2024, 2, 29), date(2025, 2, 28), 11),
        (date(2024, 2, 29), date(2025, 3, 1), 12),
    ],
)
def test_whole_months(dob, issue, months):
    assert age_months_at(dob, issue) == months


def test_from_one_year_it_is_written_in_years():
    assert format_age(date(1990, 5, 17), date(2026, 10, 3)) == "36 años"
    assert format_age(date(2025, 10, 3), date(2026, 10, 3)) == "1 año"
    assert format_age(date(1990, 5, 17), date(2026, 10, 3), locale="en") == "36 years"
    assert format_age(date(2025, 10, 3), date(2026, 10, 3), locale="en") == "1 year"


def test_below_one_year_it_is_written_in_months_never_days():
    assert format_age(date(2026, 1, 15), date(2026, 10, 14)) == "8 meses"
    assert format_age(date(2026, 1, 15), date(2026, 10, 14), locale="en") == "8 months"
    assert format_age(date(2026, 8, 20), date(2026, 9, 20)) == "1 mes"
    assert format_age(date(2026, 8, 20), date(2026, 9, 20), locale="en") == "1 month"
    # A newborn is 0 months, not "5 days".
    assert format_age(date(2026, 10, 1), date(2026, 10, 3)) == "0 meses"


def test_an_unknown_locale_is_spanish():
    assert format_age(date(1990, 5, 17), date(2026, 10, 3), locale="fr") == "36 años"
