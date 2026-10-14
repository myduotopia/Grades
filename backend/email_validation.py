"""Student email normalisation + validation (#261).

One helper shared by every path that writes `student.email` — single
create/update (`routers/student.py`) and the Excel roster import — so the
rules can't drift between them:

- Normalise: `strip()` then `lower()`. Empty string → None (email is 選填).
- Validate: a pragmatic format check (local@domain.tld, no spaces, ≤255).
  We don't try to be RFC 5322-complete — the address only has to match the
  Google account a student signs in with.
- Duplicates inside one classroom are only a WARNING (`duplicate_emails`),
  never an error; blocking happens later when the teacher tries to make the
  student a 小老師 (#262).

Login binding (`identity.py`) compares against the normalised value, which is
why the matching migration lower()/trim()s every existing row.
"""
from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable
from typing import Any

EMAIL_MAX_LENGTH = 255

# local part: printable ASCII except whitespace / '@'; domain: dot-separated
# labels of letters/digits/hyphens (no leading/trailing hyphen), ≥ 1 dot.
_EMAIL_RE = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+"
    r"@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
)


class InvalidEmail(ValueError):
    """Raised by `clean_email` when a non-empty value isn't a valid email."""


def normalize_email(raw: Any) -> str | None:
    """strip + lower; None / blank → None. Does NOT validate."""
    if raw is None:
        return None
    value = str(raw).strip().lower()
    return value or None


def is_valid_email(value: str) -> bool:
    return len(value) <= EMAIL_MAX_LENGTH and bool(_EMAIL_RE.match(value))


def clean_email(raw: Any) -> str | None:
    """Normalise and validate. Returns None for blank input; raises
    `InvalidEmail` for a non-blank value that isn't a valid address."""
    value = normalize_email(raw)
    if value is None:
        return None
    if not is_valid_email(value):
        raise InvalidEmail(value)
    return value


def duplicate_emails(emails: Iterable[str | None]) -> set[str]:
    """Normalised emails that appear more than once (None ignored)."""
    counts = Counter(e for e in (normalize_email(x) for x in emails) if e)
    return {e for e, n in counts.items() if n > 1}
