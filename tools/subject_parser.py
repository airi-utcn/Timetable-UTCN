#!/usr/bin/env python3
"""Parser inteligent pentru titlurile evenimentelor din calendar.

Acest modul:
1. Extrage automat mapping-uri abreviere -> nume complet din titluri de forma
   "Nume complet (ABREV) - Profesor - Cod [In-person]"
2. Expandează abrevierile la numele complet în titluri scurte
3. Parsează și extrage informații structurate (materie, profesor, sală, tip)

Exemplu:
    "Functional programming (FP) - R. Slavescu - 40 [In-person]"
    -> extrage mapping: FP = Functional programming
    
    "FP 479 [In-person]"  
    -> expandează la: "Functional programming 479 [In-person]"
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


def _looks_like_name(s: str) -> bool:
    """Heuristic to detect a person name like 'A. Groza' or 'Adrian Groza'."""
    if not s:
        return False
    s = s.strip()
    # Reject if too many words (likely a subject)
    words = s.split()
    if len(words) > 3:
        return False
    lower = s.lower()
    subject_keywords = [
        'programming', 'systems', 'engineering', 'intelligence', 'processing',
        'structures', 'computer', 'software', 'design', 'analysis', 'networks',
        'databases', 'security', 'algorithms', 'operating', 'functional',
        'graphics', 'parallel', 'distributed', 'machine', 'learning', 'laboratory',
        'lecture', 'exam', 'seminar'
    ]
    for kw in subject_keywords:
        if kw in lower:
            return False
    if re.match(r'^[A-Z]\.[A-Za-z\-]+$', s):
        return True
    if re.match(r'^[A-Z]\.[A-Z]\.[A-Za-z\-]+$', s):
        return True
    if re.match(r'^[A-Z][a-z\-]+\s+[A-Z][a-z\-]+$', s) and len(words) == 2:
        return True
    if re.match(r'^[A-Z]\.?\s?[A-Za-z\-]+$', s):
        return True
    return False


@dataclass
class ParsedSubject:
    """Rezultatul parsării unui titlu de eveniment."""
    original: str
    subject_name: str  # Numele complet al materiei
    abbreviation: Optional[str] = None  # Abrevierea (dacă există)
    professor: Optional[str] = None  # Numele profesorului
    room_code: Optional[str] = None  # Codul sălii din titlu (ex: "479", "26B")
    event_type: Optional[str] = None  # "In-person", "Online", etc.
    is_practice: bool = False  # True dacă e laborator/seminar (conține "p" sau "seminar")
    display_title: str = ""  # Titlul formatat pentru afișare
    
    def __post_init__(self):
        if not self.display_title:
            self.display_title = self.original


class SubjectParser:
    """Parser pentru titluri de evenimente cu învățare automată a abrevierilor."""
    
    # Pattern pentru titluri complete: "Nume materie (ABREV) - Profesor - Cod [Tip]"
    FULL_TITLE_PATTERN = re.compile(
        r'^[\s]*'  # spații opționale la început
        r'(?P<name>[A-Za-z][A-Za-z\s\.\(\)]+?)'  # numele materiei
        r'\s*\((?P<abbrev>[A-Z]{2,6})\)'  # abrevierea în paranteze
        r'(?:\s*-\s*(?P<professor>[A-Z]\.\s*[A-Za-z]+(?:\s+[A-Za-z]+)?))?'  # profesor opțional
        r'(?:\s*-?\s*(?P<code>[A-Z]?\d{1,3}[A-Za-z]?|P\d{2}|D\d{2}))?'  # cod opțional
        r'(?:\s*\[(?P<type>[^\]]+)\])?'  # tip opțional [In-person]
        r'[\s]*$',
        re.IGNORECASE
    )
    
    # Pattern pentru titluri scurte: "ABREV [p] sala [Tip]"
    SHORT_TITLE_PATTERN = re.compile(
        r'^[\s]*'
        r'(?P<abbrev>[A-Z]{2,6})'  # abrevierea
        r'(?:\s+(?P<practice>p))?'  # "p" opțional pentru practică
        r'(?:\s+(?P<room>[A-Za-z0-9\.\-]+(?:\s*/\s*[A-Za-z0-9\.\-]+)*))?'  # sală
        r'(?:\s*\[(?P<type>[^\]]+)\])?'  # tip opțional
        r'[\s]*$',
        re.IGNORECASE
    )
    
    # Pattern alternativ pentru format "Materie - Profesor Sala - optional [Tip]"
    ALT_TITLE_PATTERN = re.compile(
        r'^[\s]*'
        r'(?P<name>[A-Za-z][A-Za-z\s\.]+?)'  # numele
        r'(?:\s*-\s*(?P<professor>[A-Z]\.\s*[A-Za-z]+))?'  # profesor
        r'(?:\s+(?P<room>[A-Z0-9\.\-]+(?:\s*\([^\)]+\))?))?'  # sală
        r'(?:\s*-\s*(?:optional|obligatoriu))?'  # opțional/obligatoriu
        r'(?:\s*\[(?P<type>[^\]]+)\])?'  # tip
        r'[\s]*$',
        re.IGNORECASE
    )

    # Pattern pentru formate de tip "Artificial Intelligence (lecture) - 3rd Year - A. Groza"
    DESC_TITLE_PATTERN = re.compile(
        r'^[\s]*'
        r'(?P<name>[A-Za-z][A-Za-z\s\.]+?)'  # numele materiei
        r'\s*\((?P<kind>lecture|laboratory|lab|seminar|exam|colocviu|curs|course)\)'  # tipul între paranteze
        r'\s*(?P<rest>.*)?'  # orice text rămas (an, profesor, sală)
        r'[\s]*$',
        re.IGNORECASE
    )
    
    def __init__(self):
        # Mapping-uri învățate: abreviere -> nume complet
        self._learned_mappings: Dict[str, str] = {}
        # Cache pentru parsări
        self._parse_cache: Dict[str, ParsedSubject] = {}
    
    @property
    def mappings(self) -> Dict[str, str]:
        """Returnează mapping-urile învățate (copie)."""
        return dict(self._learned_mappings)
    
    def learn_from_titles(self, titles: List[str]) -> Dict[str, str]:
        """Învață mapping-uri din o listă de titluri.
        
        Caută titluri de forma "Nume complet (ABREV) - ..." și extrage
        mapping-urile abreviere -> nume.
        
        Returns:
            Dict cu noile mapping-uri găsite
        """
        new_mappings = {}
        
        for title in titles:
            if not title:
                continue
            
            # Încearcă să potrivească pattern-ul complet
            match = self.FULL_TITLE_PATTERN.match(title.strip())
            if match:
                name = match.group('name').strip()
                abbrev = match.group('abbrev').upper()
                
                # Normalizează numele (prima literă mare pentru fiecare cuvânt)
                name = ' '.join(word.capitalize() for word in name.split())
                
                if abbrev and name and abbrev not in self._learned_mappings:
                    self._learned_mappings[abbrev] = name
                    new_mappings[abbrev] = name
        
        # Golește cache-ul când se adaugă noi mapping-uri
        if new_mappings:
            self._parse_cache.clear()
        
        return new_mappings
    
    def add_mapping(self, abbreviation: str, full_name: str):
        """Adaugă manual un mapping."""
        abbrev = abbreviation.upper().strip()
        name = full_name.strip()
        if abbrev and name:
            self._learned_mappings[abbrev] = name
            self._parse_cache.clear()
    
    def parse(self, title: str) -> ParsedSubject:
        """Parsează un titlu și returnează informațiile extrase."""
        if not title:
            return ParsedSubject(original="", subject_name="", display_title="")
        
        title = title.strip()
        
        # Verifică cache
        if title in self._parse_cache:
            return self._parse_cache[title]
        
        result = self._parse_internal(title)
        self._parse_cache[title] = result
        return result
    
    def _parse_internal(self, title: str) -> ParsedSubject:
        """Implementarea internă a parsării."""
        original = title
        
        # Extrage tipul evenimentului [In-person], [Online] etc.
        event_type = None
        type_match = re.search(r'\[([^\]]+)\]\s*$', title)
        if type_match:
            event_type = type_match.group(1).strip()
            title = title[:type_match.start()].strip()

        # Extrage tipul evenimentului din paranteze la final (ex: "(seminar)")
        paren_type = None
        m_paren = re.search(r'\((lecture|laboratory|lab|seminar|exam|colocviu|curs|course)\)\s*$', title, re.IGNORECASE)
        if m_paren:
            paren_type = m_paren.group(1).strip().lower()
            title = title[:m_paren.start()].strip()
            if not event_type:
                event_type = paren_type

        # Caz: "Artificial Intelligence (lecture) - 3rd Year - A. Groza"
        desc_match = self.DESC_TITLE_PATTERN.match(title)
        if desc_match:
            name = desc_match.group('name').strip()
            kind = desc_match.group('kind').strip() if desc_match.group('kind') else None
            rest = (desc_match.group('rest') or '').strip()
            professor = None
            if rest:
                # încearcă să extragă profesorul din segmentele despărțite de '-' sau din token-urile finale
                segments = [s.strip() for s in re.split(r'[-–]', rest) if s.strip()] or [rest]
                for seg in reversed(segments):
                    if _looks_like_name(seg):
                        professor = seg
                        break
                    toks = [t for t in seg.split() if t]
                    # întâi încearcă perechi (ex: "R. Slavescu") pentru a păstra inițiala
                    for i in range(len(toks)-1, 0, -1):
                        pair = toks[i-1] + ' ' + toks[i]
                        if _looks_like_name(pair):
                            professor = pair
                            break
                    if professor:
                        break
                    # apoi verifică token-uri individuale
                    for i in range(len(toks)-1, -1, -1):
                        if _looks_like_name(toks[i]):
                            professor = toks[i]
                            break
                    if professor:
                        break

            # Formatează numele materiei
            name = ' '.join(word.capitalize() for word in name.split())
            display = name
            if kind:
                display += f" ({kind.capitalize()})"
            if professor:
                display += f" - {professor}"

            return ParsedSubject(
                original=original,
                subject_name=name,
                abbreviation=None,
                professor=professor,
                room_code=None,
                event_type=kind or event_type,
                display_title=display
            )

        # Caz: titluri cu segmente separate prin "/" care includ an/seria/room
        # ex: "Fizica Seminar/ An I / Seria B/ 32109"
        segments = [seg.strip(' -') for seg in title.split('/') if seg.strip()]
        if len(segments) >= 2:
            subj_seg = segments[0]
            room_code = None
            group = None
            year = None
            for seg in segments[1:]:
                seg_low = seg.lower()
                if 'seria' in seg_low or 'serie' in seg_low:
                    m = re.search(r'(seria|serie)\s*([A-Za-z0-9]+)', seg, re.IGNORECASE)
                    if m:
                        group = m.group(2).upper()
                        continue
                if 'group' in seg_low:
                    m = re.search(r'group\s*([A-Za-z0-9]+)', seg, re.IGNORECASE)
                    if m:
                        group = m.group(1).upper()
                        continue
                if 'an' in seg_low:
                    m = re.search(r'an\s*([IVX0-9]+)', seg, re.IGNORECASE)
                    if m:
                        token = m.group(1).upper()
                        roman_map = {'I': '1', 'II': '2', 'III': '3', 'IV': '4'}
                        year = roman_map.get(token, token)
                        continue
                if re.match(r'^[0-9]{3,4}$', seg.strip()):
                    room_code = seg.strip()
                    continue
                # fallback: if contains digits, maybe room
                m = re.search(r'([0-9]{3,4})', seg)
                if m:
                    room_code = m.group(1)

            subject_name = ' '.join(word.capitalize() for word in subj_seg.split()) if subj_seg else subj_seg
            display = subject_name
            et_label = (event_type or '').capitalize() if event_type else None
            if et_label:
                display += f" ({et_label})"
            if group:
                display += f" - Group {group}"
            if year:
                display += f" - Year {year}"
            if room_code:
                display += f" - Room {room_code}"

            return ParsedSubject(
                original=original,
                subject_name=subject_name,
                abbreviation=None,
                professor=None,
                room_code=room_code,
                event_type=event_type,
                display_title=display
            )
        
        # Încearcă pattern-ul complet primul
        match = self.FULL_TITLE_PATTERN.match(original)
        if match:
            name = match.group('name').strip()
            abbrev = match.group('abbrev').upper() if match.group('abbrev') else None
            professor = match.group('professor').strip() if match.group('professor') else None
            room_code = match.group('code').strip() if match.group('code') else None
            
            # Formatează numele
            name = ' '.join(word.capitalize() for word in name.split())
            
            # Creează titlu de afișare
            display = name
            if professor:
                display += f" - {professor}"
            if room_code:
                display += f" ({room_code})"
            
            return ParsedSubject(
                original=original,
                subject_name=name,
                abbreviation=abbrev,
                professor=professor,
                room_code=room_code,
                event_type=event_type,
                display_title=display
            )
        
        # Încearcă pattern-ul scurt (doar abreviere + sală)
        match = self.SHORT_TITLE_PATTERN.match(title)
        if match:
            abbrev = match.group('abbrev').upper()
            is_practice = bool(match.group('practice'))
            room_code = match.group('room').strip() if match.group('room') else None
            
            # Caută numele complet în mapping-uri
            full_name = self._learned_mappings.get(abbrev, abbrev)
            
            # Creează titlu de afișare
            display = full_name
            if is_practice:
                display += " (Practice)"
            if room_code:
                # Curăță duplicatele din room (ex: "103 / 103")
                parts = [p.strip() for p in room_code.split('/')]
                unique_parts = []
                for p in parts:
                    if p and p not in unique_parts:
                        unique_parts.append(p)
                room_code = ' / '.join(unique_parts) if len(unique_parts) > 1 else (unique_parts[0] if unique_parts else None)
                if room_code:
                    display += f" - Room {room_code}"
            
            return ParsedSubject(
                original=original,
                subject_name=full_name,
                abbreviation=abbrev,
                room_code=room_code,
                event_type=event_type,
                is_practice=is_practice,
                display_title=display
            )
        
        # Încearcă să găsească o abreviere la începutul titlului
        abbrev_match = re.match(r'^[\s]*([A-Z]{2,6})[\s]+', title)
        if abbrev_match:
            abbrev = abbrev_match.group(1)
            if abbrev in self._learned_mappings:
                full_name = self._learned_mappings[abbrev]
                # Înlocuiește abrevierea cu numele complet
                rest = title[abbrev_match.end():].strip()
                
                # Verifică dacă e practică
                is_practice = rest.lower().startswith('p ') or ' p ' in rest.lower()
                if is_practice:
                    rest = re.sub(r'^p\s+', '', rest, flags=re.IGNORECASE)
                    rest = re.sub(r'\s+p\s+', ' ', rest, flags=re.IGNORECASE)
                
                display = full_name
                if is_practice:
                    display += " (Practice)"
                if rest:
                    # Curăță duplicatele
                    parts = [p.strip() for p in rest.split('/')]
                    unique = []
                    for p in parts:
                        p_clean = re.sub(r'\s+', ' ', p).strip()
                        if p_clean and p_clean not in unique:
                            unique.append(p_clean)
                    if unique:
                        display += f" - {' / '.join(unique)}"
                
                return ParsedSubject(
                    original=original,
                    subject_name=full_name,
                    abbreviation=abbrev,
                    event_type=event_type,
                    is_practice=is_practice,
                    display_title=display
                )
        
        # Fallback: returnează titlul curățat și normalizează descriptorii / numele
        clean_title = re.sub(r'\s+', ' ', title).strip()

        # Elimină descriptorii comuni din paranteze (lecture, laboratory, exam etc.) pentru numele materiei
        clean_title = re.sub(r'\((?i:lecture|laboratory|lab|seminar|exam|colocviu|course|curs|practice|p)\)', '', clean_title, flags=re.IGNORECASE).strip()

        # Dacă titlul conține un dash '-', considerăm partea din stânga ca nume materie
        left_part = re.split(r'\s*-\s*', clean_title, maxsplit=1)[0].strip()

        # Curăță indicatori "practice" rămași
        left_part = re.sub(r'\bpractice\b', '', left_part, flags=re.IGNORECASE).strip()

        # Normalizează spațiile multiple
        left_part = re.sub(r'\s+', ' ', left_part).strip()

        # Formatează numele cu prima literă mare pentru fiecare cuvânt
        subject_name = ' '.join(word.capitalize() for word in left_part.split()) if left_part else clean_title
        display = subject_name

        return ParsedSubject(
            original=original,
            subject_name=subject_name,
            event_type=event_type,
            display_title=display
        )
    
    def expand_title(self, title: str) -> str:
        """Expandează abrevierile din titlu și returnează versiunea curățată."""
        parsed = self.parse(title)
        return parsed.display_title
    
    def get_subject_name(self, title: str) -> str:
        """Extrage doar numele materiei din titlu."""
        parsed = self.parse(title)
        return parsed.subject_name


# Instanță globală pentru utilizare ușoară
_default_parser: Optional[SubjectParser] = None


def get_parser() -> SubjectParser:
    """Returnează parserul global (singleton)."""
    global _default_parser
    if _default_parser is None:
        _default_parser = SubjectParser()
    return _default_parser


def learn_from_events(events: List[dict]) -> Dict[str, str]:
    """Învață mapping-uri din lista de evenimente.
    
    Args:
        events: Lista de dicționare cu cheile 'title' sau 'subject'
    
    Returns:
        Mapping-urile nou învățate
    """
    parser = get_parser()
    titles = []
    for ev in events:
        if isinstance(ev, dict):
            title = ev.get('title') or ev.get('subject') or ''
            if title:
                titles.append(title)
    return parser.learn_from_titles(titles)


def expand_title(title: str) -> str:
    """Expandează abrevierile din titlu."""
    return get_parser().expand_title(title)


def parse_title(title: str) -> ParsedSubject:
    """Parsează un titlu și returnează informațiile structurate."""
    return get_parser().parse(title)


def get_mappings() -> Dict[str, str]:
    """Returnează mapping-urile învățate."""
    return get_parser().mappings


# Pentru compatibilitate cu codul existent
def expand_subject_abbreviation(subject: str) -> str:
    """Alias pentru expand_title - compatibilitate cu codul existent."""
    return expand_title(subject)


# =============================================================================
# PARSER PENTRU LOCAȚII - extrage clădirea și sala din formatul UTCN
# =============================================================================

@dataclass
class ParsedLocation:
    """Rezultatul parsării unei locații."""
    original: str
    building_code: Optional[str] = None  # "bar", "doro", "daic"
    building_name: Optional[str] = None  # "Barițiu", "Dorobanților", "DAIC"
    room: Optional[str] = None  # "107", "BT-503", "26B"
    room_normalized: Optional[str] = None  # "107", "BT5.03", "26B"
    display_name: str = ""  # "Dorobanților - Sala 107"


# Mapping pentru codurile clădirilor
BUILDING_CODES = {
    "bar": "Barițiu",
    "doro": "Dorobanților", 
    "daic": "Daicoviciu",
    "obs": "Observatorului",
}


def parse_location(location: str) -> ParsedLocation:
    """Parsează o locație și extrage clădirea și sala.
    
    Formate suportate:
        - utcn_room_ac_doro_107@campus.utcluj.ro -> Dorobanților, Sala 107
        - utcn_room_ac_bar_bt-503@campus.utcluj.ro -> Barițiu, Sala BT5.03
        - UTCN - AC Bar - Sala BT 503 -> Barițiu, Sala BT5.03
    """
    if not location:
        return ParsedLocation(original="", display_name="Unknown")
    
    original = location
    loc = location.strip()
    
    building_code = None
    building_name = None
    room = None
    room_normalized = None
    
    # Pattern 1: utcn_room_ac_XXX_YYY@campus.utcluj.ro
    match = re.match(
        r'utcn_room_ac_([a-z]+)_([a-z0-9\-]+)@',
        loc, re.IGNORECASE
    )
    if match:
        building_code = match.group(1).lower()
        room = match.group(2).upper()
        building_name = BUILDING_CODES.get(building_code, building_code.upper())
    else:
        # Pattern 2: UTCN - AC Bar - Sala XXX
        match = re.match(
            r'UTCN\s*-\s*AC\s+(\w+)\s*-\s*Sala\s+(.+)',
            loc, re.IGNORECASE
        )
        if match:
            building_code = match.group(1).lower()
            room = match.group(2).strip().upper()
            building_name = BUILDING_CODES.get(building_code, building_code.upper())
        else:
            # Pattern 3: încearcă să găsească orice cod de clădire
            for code in BUILDING_CODES:
                if code in loc.lower():
                    building_code = code
                    building_name = BUILDING_CODES[code]
                    # Încearcă să extragă sala
                    room_match = re.search(r'[-_]([a-z0-9\-\.]+)(?:@|$)', loc, re.IGNORECASE)
                    if room_match:
                        room = room_match.group(1).upper()
                    break
    
    # Normalizează sala
    if room:
        room_normalized = normalize_room_code(room)
    
    # Creează display name
    if building_name and room_normalized:
        display_name = f"{building_name} - Sala {room_normalized}"
    elif building_name:
        display_name = building_name
    elif room_normalized:
        display_name = f"Sala {room_normalized}"
    else:
        display_name = original
    
    return ParsedLocation(
        original=original,
        building_code=building_code,
        building_name=building_name,
        room=room,
        room_normalized=room_normalized,
        display_name=display_name
    )


def normalize_room_code(room: str) -> str:
    """Normalizează codul sălii.
    
    Exemple:
        bt-503 -> BT5.03
        BT-505 -> BT5.05
        p03 -> P03
        s42 -> S4.2
        d01 -> D01
    """
    if not room:
        return room
    
    r = room.strip().upper()
    
    # BT-503 sau BT503 -> BT5.03
    match = re.match(r'^BT[-_]?(\d)(\d{2})$', r)
    if match:
        return f"BT{match.group(1)}.{match.group(2)}"
    
    # S42 -> S4.2
    match = re.match(r'^S(\d)(\d)$', r)
    if match:
        return f"S{match.group(1)}.{match.group(2)}"
    
    # P03 rămâne P03
    # D01 rămâne D01
    # 107 rămâne 107
    # 26B rămâne 26B
    
    return r


def get_building_for_location(location: str) -> Optional[str]:
    """Returnează numele clădirii pentru o locație."""
    parsed = parse_location(location)
    return parsed.building_name


def get_all_buildings() -> Dict[str, str]:
    """Returnează toate clădirile cunoscute."""
    return dict(BUILDING_CODES)


if __name__ == '__main__':
    # Test rapid
    test_titles = [
        "Functional programming (FP) - R. Slavescu - 40 [In-person]",
        "Artificial intelligence (AI) - A. Groza - P03 [In-person]",
        "Structure of computer systems (SCS) - G. Sebestyen - D01 [In-person]",
        "FP 479 [In-person]",
        "AI 26B [In-person]",
        "SCS p 103 / SCS p 103\t [In-person]",
        "GP BT5.05 [In-person]",
        "Graphic processing (GP) - D. Gorgan - D01 [In-person]",
    ]
    
    parser = SubjectParser()
    
    # Mai întâi învață din titlurile complete
    learned = parser.learn_from_titles(test_titles)
    print("Mapping-uri învățate:")
    for abbrev, name in sorted(learned.items()):
        print(f"  {abbrev} -> {name}")
    print()
    
    # Apoi parsează toate titlurile
    print("Parsare titluri:")
    for title in test_titles:
        parsed = parser.parse(title)
        print(f"  Original: {title}")
        print(f"  Display:  {parsed.display_title}")
        print(f"  Subject:  {parsed.subject_name}, Prof: {parsed.professor}, Practice: {parsed.is_practice}")
        print()
    
    # Test locații
    print("\n" + "="*60)
    print("Test parsare locații:")
    test_locations = [
        "utcn_room_ac_doro_107@campus.utcluj.ro",
        "utcn_room_ac_bar_26b@campus.utcluj.ro",
        "utcn_room_ac_bar_bt-503@campus.utcluj.ro",
        "utcn_room_ac_daic_479@campus.utcluj.ro",
        "utcn_room_ac_bar_s42@campus.utcluj.ro",
        "UTCN - AC Bar - Sala BT 503",
    ]
    for loc in test_locations:
        parsed = parse_location(loc)
        print(f"  {loc}")
        print(f"    -> {parsed.display_name} (building: {parsed.building_code})")

