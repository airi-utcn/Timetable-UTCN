"""Tests for tools/title_parser.py — the structured event-title parser."""

import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))

from title_parser import parse_structured, display_title  # noqa: E402


# ── Canonical examples from the spec ──────────────────────────────────

def test_exam_example():
    p = parse_structured("Functional Programming (exam) 3rd year R. Slavescu")
    assert p.subject_name == "Functional Programming"
    assert p.activity_type == "exam"
    assert p.study_year == "3"
    assert p.group == ""
    assert p.professor_name == "R. Slavescu"
    assert p.matched
    assert p.warnings == []


def test_lecture_with_comma():
    p = parse_structured("Artificial Intelligence (lecture) 3rd year, A. Groza")
    assert p.subject_name == "Artificial Intelligence"
    assert p.activity_type == "lecture"
    assert p.study_year == "3"
    assert p.professor_name == "A. Groza"


def test_laboratory_with_group():
    p = parse_structured("Algorithms (laboratory) 2nd year/30221 R. Potolea")
    assert p.subject_name == "Algorithms"
    assert p.activity_type == "laboratory"
    assert p.study_year == "2"
    assert p.group == "30221"
    assert p.professor_name == "R. Potolea"


# ── Romanian synonyms / normalization ─────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("X (examen) 1st year A. Pop", "exam"),
    ("X (curs) 1st year A. Pop", "lecture"),
    ("X (laborator) 1st year A. Pop", "laboratory"),
    ("X (lab) 1st year A. Pop", "laboratory"),
    ("X (seminar) 1st year A. Pop", "seminar"),
    ("X (proiect) 1st year A. Pop", "project"),
    ("X (project) 1st year A. Pop", "project"),
    ("X (colocviu) 1st year A. Pop", "exam"),
])
def test_type_normalization(raw, expected):
    assert parse_structured(raw).activity_type == expected


def test_romanian_year_and_group():
    p = parse_structured("Baze de date (laborator) anul II grupa 30221 M. Dinsoreanu")
    assert p.activity_type == "laboratory"
    assert p.study_year == "2"
    assert p.group == "30221"
    assert p.professor_name == "M. Dinsoreanu"


# ── Tolerance: spaces, commas, missing parts ──────────────────────────

def test_extra_spaces_and_commas():
    p = parse_structured("  Computer   Networks   (lecture) ,  2nd year ,  V. Dobrota  ")
    assert p.subject_name == "Computer Networks"
    assert p.activity_type == "lecture"
    assert p.study_year == "2"
    assert p.professor_name == "V. Dobrota"


def test_missing_group_ok():
    p = parse_structured("Operating Systems (lecture) 2nd year A. Suciu")
    assert p.group == ""
    assert p.study_year == "2"


def test_missing_professor_warns_but_parses():
    p = parse_structured("Operating Systems (lecture) 2nd year")
    assert p.subject_name == "Operating Systems"
    assert p.professor_name == ""
    assert p.study_year == "2"


def test_modality_suffix_stripped():
    p = parse_structured("Functional programming (exam) 3rd year R. Slavescu [In-person]")
    assert p.modality == "In-person"
    assert p.professor_name == "R. Slavescu"


# ── Never crash / malformed input kept with warnings ──────────────────

@pytest.mark.parametrize("bad", [
    None, "", "   ", "(((((", ")(", "([)]", "\x00\x01", "a" * 5000,
    "(exam)", "1234567890", "///,,,---",
])
def test_never_crashes(bad):
    p = parse_structured(bad)
    assert p is not None
    assert isinstance(p.warnings, list)


def test_unmatched_title_keeps_subject_and_warns():
    p = parse_structured("Some Random Meeting")
    assert p.subject_name == "Some Random Meeting"
    assert not p.matched
    assert any('no activity type' in w for w in p.warnings)


def test_unknown_type_preserved_with_warning():
    p = parse_structured("Thesis Defense (festivitate) A. Pop")
    assert p.subject_name == "Thesis Defense"
    assert p.activity_type == ""
    assert any('unknown activity type' in w for w in p.warnings)


# ── Output structure ──────────────────────────────────────────────────

def test_to_dict_fields():
    d = parse_structured("Algorithms (laboratory) 2nd year/30221 R. Potolea").to_dict()
    for key in ('rawTitle', 'subjectName', 'activityType', 'studyYear',
                'group', 'professorName', 'parseWarnings', 'parseConfidence'):
        assert key in d
    assert d['parseConfidence'] == 1.0


def test_display_title():
    p = parse_structured("Algorithms (laboratory) 2nd year/30221 R. Potolea")
    assert display_title(p) == "Algorithms (Laboratory)"


def test_room_never_parsed_from_title():
    # Rooms must come from the source calendar, not from numbers in the title
    p = parse_structured("Economic law (lecture) 3rd year R. Cordos - 40")
    d = p.to_dict()
    assert 'room' not in {k.lower() for k in d}
