#!/usr/bin/env python3
"""Helpers for deriving canonical room/building info from the publisher CSV.

The authoritative room identity comes from the calendar itself (column
`Nume_Sala`, e.g. "UTCN - AC Bar - Sala 40"), NOT from event titles.
Numeric rooms like "40" are perfectly valid and must survive unchanged.
"""

from __future__ import annotations

import re
from typing import Optional


def room_from_sala_name(nume_sala: str) -> Optional[str]:
    """Extract the room label from a CSV `Nume_Sala` value.

    Examples:
        "UTCN - AC Bar - Sala 40"            -> "40"
        "UTCN - AC Bar - Sala BT 503"        -> "BT 503"
        "UTCN - AC Bar - Sala P03"           -> "P03"
        "UTCN - Aula Domsa"                  -> "Aula Domsa"
        "UTCN - Dorobantilor 71-73 - DECIDFR" -> "DECIDFR"
    """
    if not nume_sala:
        return None
    s = str(nume_sala).strip()
    # take the last " - " separated segment
    parts = [p.strip() for p in s.split(' - ') if p.strip()]
    if not parts:
        return None
    last = parts[-1]
    # strip a leading "Sala " / "Room " prefix
    m = re.match(r'(?i)^(?:sala|room)\s+(.+)$', last)
    if m:
        last = m.group(1).strip()
    # drop a bare leading "UTCN" if it is all that remains
    if last.upper() == 'UTCN' and len(parts) >= 2:
        last = parts[-2]
    return last or None


def site_from_sala_name(nume_sala: str) -> Optional[str]:
    """Extract the campus/site segment, e.g. "AC Bar" from
    "UTCN - AC Bar - Sala 40". Returns None when not derivable."""
    if not nume_sala:
        return None
    parts = [p.strip() for p in str(nume_sala).split(' - ') if p.strip()]
    if len(parts) >= 3:
        return parts[1]
    return None
