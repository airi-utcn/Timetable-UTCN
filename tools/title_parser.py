#!/usr/bin/env python3
"""Structured parser for academic event titles.

Canonical input format (with tolerated variations):

    Functional Programming (exam) 3rd year R. Slavescu
    Artificial Intelligence (lecture) 3rd year, A. Groza
    Algorithms (laboratory) 2nd year/30221 R. Potolea

Structure:
    subject name   – text before the parentheses
    activity type  – inside parentheses, normalized (RO + EN synonyms)
    study year     – e.g. "3rd year", "an 2", "anul III", "year 1"
    group          – optional, e.g. "/30221" or "grupa 30221"
    professor      – the remaining trailing name

The room is intentionally NOT parsed from the title: it must be resolved
from the Outlook room calendar the event came from (the `source` hash).

Guarantees:
    * parse_structured() NEVER raises — malformed input returns a result
      with warnings instead of being dropped
    * tolerates commas, extra spaces, missing group, RO/EN activity names
    * unknown activity names are preserved verbatim with a warning
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import List, Optional

log = logging.getLogger("title_parser")

# Normalized activity types (canonical English keys)
ACTIVITY_TYPE_SYNONYMS = {
    # exam family
    'exam': 'exam', 'examen': 'exam', 'examination': 'exam',
    'colocviu': 'exam', 'colloquium': 'exam', 'partial': 'exam',
    'midterm': 'exam', 'restanta': 'exam', 'retake': 'exam',
    # lecture family
    'lecture': 'lecture', 'curs': 'lecture', 'course': 'lecture',
    # laboratory family
    'laboratory': 'laboratory', 'lab': 'laboratory', 'laborator': 'laboratory',
    'practice': 'laboratory', 'practica': 'laboratory',
    # seminar family
    'seminar': 'seminar', 'seminarii': 'seminar', 'sem': 'seminar',
    # project family
    'project': 'project', 'proiect': 'project',
    # other recognized kinds (kept as-is)
    'conference': 'conference', 'conferinta': 'conference',
    'workshop': 'workshop',
}

ACTIVITY_LABELS = {
    'exam': 'Exam', 'lecture': 'Lecture', 'laboratory': 'Laboratory',
    'seminar': 'Seminar', 'project': 'Project', 'conference': 'Conference',
    'workshop': 'Workshop',
}

_ROMAN_YEARS = {'i': '1', 'ii': '2', 'iii': '3', 'iv': '4', 'v': '5', 'vi': '6'}

# trailing "[In-person]" / "[Online]" markers Outlook sometimes appends
_MODALITY_RE = re.compile(r'\[\s*([^\]]+?)\s*\]\s*$')

# "(type)" anywhere in the title — content checked against synonyms
_PAREN_RE = re.compile(r'\(\s*([^()]{1,40}?)\s*\)')

_ORDINAL_YEAR_RE = re.compile(
    r'\b([1-6])\s*(?:st|nd|rd|th)?\s*year\b', re.IGNORECASE)
_YEAR_N_RE = re.compile(r'\byear\s*[:\-]?\s*([1-6])\b', re.IGNORECASE)
_AN_RE = re.compile(r'\ban(?:ul)?\s*[:\-]?\s*([1-6]|i{1,3}v?|vi?)\b', re.IGNORECASE)

# group attached to year via slash: "2nd year/30221", "an 2 / 30221"
_YEAR_GROUP_RE = re.compile(
    r'\b(?:[1-6]\s*(?:st|nd|rd|th)?\s*year|an(?:ul)?\s*(?:[1-6]|i{1,3}v?|vi?))\s*/\s*([A-Za-z0-9]+)\b',
    re.IGNORECASE)
_GRUPA_RE = re.compile(r'\bgrup[ae]?\s*[:\-]?\s*([A-Za-z0-9]+)\b', re.IGNORECASE)
_GROUP_EN_RE = re.compile(r'\bgroup\s*[:\-]?\s*([A-Za-z0-9]+)\b', re.IGNORECASE)
_BARE_GROUP_RE = re.compile(r'(?:^|[\s,/])(\d{4,6})(?=[\s,/]|$)')

# professor name heuristics: "R. Slavescu", "A. D. Popescu", "Rodica Potolea"
_NAME_RES = [
    re.compile(r'^[A-ZĂÂÎȘȚ]\.\s*[A-ZĂÂÎȘȚ]\.\s*[A-ZĂÂÎȘȚ][\w\-ăâîșțĂÂÎȘȚ]+$'),
    re.compile(r'^[A-ZĂÂÎȘȚ]\.\s*[A-ZĂÂÎȘȚ][\w\-ăâîșțĂÂÎȘȚ]+$'),
    re.compile(r'^[A-ZĂÂÎȘȚ][\w\-ăâîșțéü]+\s+[A-ZĂÂÎȘȚ][\w\-ăâîșțéü]+(?:\s+[A-ZĂÂÎȘȚ][\w\-ăâîșțéü]+)?$'),
]

_NOT_NAME_WORDS = {
    'programming', 'systems', 'engineering', 'intelligence', 'processing',
    'structures', 'computer', 'software', 'design', 'analysis', 'networks',
    'databases', 'security', 'algorithms', 'operating', 'functional',
    'graphics', 'parallel', 'distributed', 'machine', 'learning',
    'laboratory', 'lecture', 'exam', 'seminar', 'project', 'year', 'sala',
    'room', 'online', 'person',
}


@dataclass
class ParsedTitle:
    """Structured result of parsing an event title (room comes from the
    source room calendar, never from here)."""
    raw_title: str = ''
    subject_name: str = ''
    activity_type: str = ''        # normalized: exam/lecture/laboratory/seminar/project/…
    activity_label: str = ''       # capitalized display label
    study_year: str = ''           # canonical digit as string, e.g. "3"
    group: str = ''                # e.g. "30221"
    professor_name: str = ''
    modality: str = ''             # e.g. "In-person", "Online" (from [..] suffix)
    warnings: List[str] = field(default_factory=list)
    matched: bool = False          # True when the canonical pattern matched

    @property
    def parse_confidence(self) -> float:
        if not self.raw_title.strip():
            return 0.0
        score = 0.3
        if self.matched:
            score += 0.3
        if self.activity_type:
            score += 0.15
        if self.professor_name:
            score += 0.15
        if self.study_year:
            score += 0.1
        return min(score, 1.0)

    def to_dict(self) -> dict:
        return {
            'rawTitle': self.raw_title,
            'subjectName': self.subject_name,
            'activityType': self.activity_type,
            'studyYear': self.study_year,
            'group': self.group,
            'professorName': self.professor_name,
            'modality': self.modality,
            'parseWarnings': list(self.warnings),
            'parseConfidence': round(self.parse_confidence, 2),
        }


def _looks_like_person(s: str) -> bool:
    s = (s or '').strip()
    if not s or len(s.split()) > 4:
        return False
    low = s.lower()
    for w in _NOT_NAME_WORDS:
        if w in low:
            return False
    return any(rx.match(s) for rx in _NAME_RES)


def _normalize_year(token: str) -> str:
    t = (token or '').strip().lower()
    if t.isdigit():
        return t
    return _ROMAN_YEARS.get(t, '')


def _clean_subject(s: str) -> str:
    s = re.sub(r'\s+', ' ', s or '').strip(' ,;-–—/')
    return s


def parse_structured(title: str) -> ParsedTitle:
    """Parse an event title into structured fields. Never raises."""
    try:
        return _parse(title)
    except Exception as e:  # absolute last-resort guard
        log.warning("title parse crashed for %r: %s", title, e)
        return ParsedTitle(
            raw_title=title or '',
            subject_name=_clean_subject(title or ''),
            warnings=[f'parser error: {e}'],
        )


def _parse(title: str) -> ParsedTitle:
    result = ParsedTitle(raw_title=title or '')
    if not title or not title.strip():
        result.warnings.append('empty title')
        return result

    text = re.sub(r'\s+', ' ', str(title)).strip()

    # 1) modality suffix "[In-person]" / "[Online]"
    m = _MODALITY_RE.search(text)
    if m:
        result.modality = m.group(1).strip()
        text = text[:m.start()].strip()

    # 2) find "(activity type)" — first parenthetical whose content is a
    #    known synonym; everything before it is the subject name
    type_match = None
    for pm in _PAREN_RE.finditer(text):
        key = pm.group(1).strip().lower()
        if key in ACTIVITY_TYPE_SYNONYMS:
            type_match = pm
            result.activity_type = ACTIVITY_TYPE_SYNONYMS[key]
            result.activity_label = ACTIVITY_LABELS.get(
                result.activity_type, result.activity_type.capitalize())
            break

    if type_match:
        result.matched = True
        result.subject_name = _clean_subject(text[:type_match.start()])
        rest = text[type_match.end():]
    else:
        # No recognizable "(type)" — check for an unknown parenthetical
        pm = _PAREN_RE.search(text)
        if pm:
            result.warnings.append(
                f'unknown activity type "({pm.group(1)})" — kept verbatim')
            result.activity_type = ''
            result.subject_name = _clean_subject(text[:pm.start()])
            rest = text[pm.end():]
        else:
            result.warnings.append('no activity type found in title')
            result.subject_name = _clean_subject(
                re.split(r'\s+-\s+', text, maxsplit=1)[0])
            rest = text[len(result.subject_name):] if text.startswith(result.subject_name) else text

    if not result.subject_name:
        result.warnings.append('empty subject name')

    rest = (rest or '').strip(' ,;-–—')

    # 3) study year
    year = ''
    m = _ORDINAL_YEAR_RE.search(rest) or _YEAR_N_RE.search(rest)
    if m:
        year = _normalize_year(m.group(1))
    else:
        m = _AN_RE.search(rest)
        if m:
            year = _normalize_year(m.group(1))
    result.study_year = year

    # 4) group: "year/30221" form first, then explicit grupa/group, then bare code
    mg = _YEAR_GROUP_RE.search(rest)
    if mg:
        result.group = mg.group(1)
    else:
        mg = _GRUPA_RE.search(rest) or _GROUP_EN_RE.search(rest)
        if mg:
            result.group = mg.group(1)
        else:
            mg = _BARE_GROUP_RE.search(rest)
            if mg:
                result.group = mg.group(1)

    # 5) professor: clean year/group tokens out of the trailing text
    clean = rest
    clean = _YEAR_GROUP_RE.sub(' ', clean)
    clean = _ORDINAL_YEAR_RE.sub(' ', clean)
    clean = _YEAR_N_RE.sub(' ', clean)
    clean = _AN_RE.sub(' ', clean)
    clean = _GRUPA_RE.sub(' ', clean)
    clean = _GROUP_EN_RE.sub(' ', clean)
    if result.group:
        clean = re.sub(r'(?:^|[\s,/])' + re.escape(result.group) + r'(?=[\s,/]|$)', ' ', clean)
    clean = re.sub(r'[,/]+', ' ', clean)
    clean = re.sub(r'\s*[-–—]\s*', ' ', clean)
    clean = re.sub(r'\s+', ' ', clean).strip()

    if clean:
        if _looks_like_person(clean):
            result.professor_name = clean
        else:
            # try trailing token pairs (e.g. "… R. Slavescu")
            toks = clean.split()
            found = ''
            for i in range(len(toks) - 1, 0, -1):
                cand = toks[i - 1] + ' ' + toks[i]
                if _looks_like_person(cand):
                    found = cand
                    break
            if not found:
                for tok in reversed(toks):
                    if _looks_like_person(tok):
                        found = tok
                        break
            if found:
                result.professor_name = found
                leftover = clean.replace(found, '').strip()
                if leftover:
                    result.warnings.append(f'unparsed text: "{leftover}"')
            else:
                result.warnings.append(
                    f'could not identify professor in: "{clean}"')

    if result.warnings:
        log.info("title parse warnings for %r: %s", title, '; '.join(result.warnings))

    return result


def display_title(parsed: ParsedTitle) -> str:
    """Compose a clean display title from structured fields."""
    parts = [parsed.subject_name or parsed.raw_title]
    if parsed.activity_label:
        parts.append(f'({parsed.activity_label})')
    return ' '.join(p for p in parts if p).strip()


if __name__ == '__main__':
    samples = [
        "Functional Programming (exam) 3rd year R. Slavescu",
        "Artificial Intelligence (lecture) 3rd year, A. Groza",
        "Algorithms (laboratory) 2nd year/30221 R. Potolea",
        "Baze de date (laborator) anul II grupa 30221 M. Dinsoreanu",
        "Proiect diploma (proiect) an 4 I. Salomie",
        "Some Random Meeting",
        "",
        "   (exam)   ",
    ]
    for s in samples:
        p = parse_structured(s)
        print(f"{s!r}\n  -> {p.to_dict()}\n")
