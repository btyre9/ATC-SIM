"""Builds fixes-data.js from the FAA's public Designated Points and NAVAID datasets (Aeronautical Information Services).

For each sector it picks a real STAR fix as the arrival fix and a real SID fix as the departure fix
for every entry gate, and keeps every fix and navaid nearby with a display tier so the scope can show
more detail as you zoom in:
  tier 1  arrival and departure fixes at the gates
  tier 2  other STAR and SID fixes
  tier 3  approach (IAP) fixes near the airport
  tier 4  enroute and other fixes
Run from the project folder:  python3 tools/build_fixes.py
To rebuild only some airports and keep the rest:  python3 tools/build_fixes.py KDTW
"""
import json
import math
import sys
import urllib.parse
import urllib.request

BASE = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/'
FIX_SERVICE = BASE + 'DesignatedPoints/FeatureServer/0/query'
NAVAID_SERVICE = BASE + 'NAVAIDSystem/FeatureServer/0/query'
SECTORS = {
    'KATL': (33.6407, -84.4277),
    'KSAN': (32.7336, -117.1897),
    'KCLT': (35.2140, -80.9431),
    'KDTW': (42.2124, -83.3534),
}
GATES = {'NE_GATE': 45, 'E_GATE': 90, 'SE_GATE': 135, 'SW_GATE': 225, 'W_GATE': 270, 'NW_GATE': 315}
GATE_NM = 38
FIX_SEARCH_NM = 60
FIX_KEEP_NM = 50
APPROACH_FIX_NM = 30
NAVAID_NM = 70


def fetch(service, fields, lat, lon, radius_nm):
    span_lat = radius_nm / 60
    span_lon = radius_nm / (60 * math.cos(math.radians(lat)))
    features, offset = [], 0
    while True:
        query = urllib.parse.urlencode({
            'where': '1=1', 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326, 'outSR': 4326,
            'geometry': f'{lon - span_lon},{lat - span_lat},{lon + span_lon},{lat + span_lat}',
            'outFields': fields, 'resultOffset': offset, 'resultRecordCount': 1000, 'f': 'json'})
        with urllib.request.urlopen(f'{service}?{query}', timeout=30) as response:
            data = json.load(response)
        if 'error' in data:
            raise SystemExit(f"FAA service error: {data['error']}")
        features += data['features']
        if not data.get('exceededTransferLimit'):
            return features
        offset += len(data['features'])


def offset_nm(lat0, lon0, lat, lon):
    return ((lon - lon0) * 60 * math.cos(math.radians(lat0)), (lat - lat0) * 60)


def navaid_type(class_text):
    """Chart symbol family from the FAA class, e.g. 'H-VORTACW' -> VORTAC, 'MHW' -> NDB."""
    text = (class_text or '').upper()
    if 'VORTAC' in text:
        return 'VORTAC'
    if 'VOR' in text:
        return 'VOR'
    if 'TACAN' in text:
        return 'TACAN'
    if 'DME' in text:
        return 'DME'
    if any(code in text for code in ('MHW', 'HW', 'MH', 'NDB', 'LOM', 'H-SAB', 'H')):
        return 'NDB'
    return None


def build(lat0, lon0):
    fixes = []
    for feature in fetch(FIX_SERVICE, 'IDENT,STRUCTURE', lat0, lon0, FIX_SEARCH_NM):
        tags = set(filter(None, (feature['attributes']['STRUCTURE'] or '').split('|')))
        east, north = offset_nm(lat0, lon0, feature['geometry']['y'], feature['geometry']['x'])
        kind = 'STAR' if 'STAR' in tags else 'SID' if 'SID' in tags else 'ENRT' if any('ENROUTE' in t for t in tags) else 'OTHER'
        fixes.append({
            'name': feature['attributes']['IDENT'].strip(),
            'lat': round(feature['geometry']['y'], 5), 'lon': round(feature['geometry']['x'], 5),
            'kind': kind, 'approach': 'IAP' in tags, 'dist': math.hypot(east, north), 'east': east, 'north': north,
        })

    def nearest(kinds, angle, used):
        gx, gy = math.sin(math.radians(angle)) * GATE_NM, math.cos(math.radians(angle)) * GATE_NM
        candidates = [f for f in fixes if f['kind'] in kinds and 22 <= f['dist'] <= 55 and f['name'] not in used
                      and math.hypot(f['east'] - gx, f['north'] - gy) <= 20]
        return min(candidates, key=lambda f: math.hypot(f['east'] - gx, f['north'] - gy), default=None)

    # Prefer the matching procedure fix, then any enroute fix; over open water there may be none.
    gates, used = {}, set()
    for gate, angle in GATES.items():
        picks = {}
        for role, kind in (('arrival', 'STAR'), ('departure', 'SID')):
            fix = nearest({kind}, angle, used) or nearest({'ENRT'}, angle, used) or nearest({'STAR', 'SID', 'OTHER'}, angle, used)
            if fix:
                used.add(fix['name'])
            picks[role] = fix['name'] if fix else None
        gates[gate] = picks

    kept = []
    for fix in fixes:
        if fix['name'] in used:
            tier = 1
        elif fix['kind'] in ('STAR', 'SID') and fix['dist'] <= FIX_KEEP_NM:
            tier = 2
        elif fix['approach'] and fix['dist'] <= APPROACH_FIX_NM:
            tier = 3
        elif fix['dist'] <= FIX_KEEP_NM and not fix['approach']:
            tier = 4
        else:
            continue
        kind = 'IAP' if tier == 3 else fix['kind']
        kept.append({'name': fix['name'], 'lat': fix['lat'], 'lon': fix['lon'], 'kind': kind, 'tier': tier})

    navaids = []
    for feature in fetch(NAVAID_SERVICE, 'IDENT,NAME_TXT,CLASS_TXT,STATUS', lat0, lon0, NAVAID_NM):
        a, g = feature['attributes'], feature['geometry']
        kind = navaid_type(a.get('CLASS_TXT'))
        east, north = offset_nm(lat0, lon0, g['y'], g['x'])
        if not kind or math.hypot(east, north) > NAVAID_NM or 'DECOM' in (a.get('STATUS') or '').upper():
            continue
        navaids.append({'name': a['IDENT'].strip(), 'title': (a.get('NAME_TXT') or '').title(),
                        'lat': round(g['y'], 5), 'lon': round(g['x'], 5), 'type': kind})

    return {
        'fixes': sorted(kept, key=lambda f: (f['tier'], f['name'])),
        'navaids': sorted(navaids, key=lambda n: n['name']),
        'gates': gates,
    }


def load_existing():
    with open('fixes-data.js') as source:
        return json.loads(source.read().split('=', 1)[1].strip().rstrip(';'))


def main():
    only = set(sys.argv[1:])
    data = load_existing() if only else {}
    data.update({sector: build(*position) for sector, position in SECTORS.items() if not only or sector in only})
    with open('fixes-data.js', 'w') as out:
        out.write('/* Generated by tools/build_fixes.py from FAA Designated Points and NAVAIDs (public domain). Do not edit by hand. */\n')
        out.write(f'window.ATC_FIXES = {json.dumps(data, indent=1)};\n')
    for sector, sector_data in data.items():
        tiers = [sum(1 for f in sector_data['fixes'] if f['tier'] == t) for t in (1, 2, 3, 4)]
        kinds = sorted({n['type'] for n in sector_data['navaids']})
        print(sector, 'fixes by tier', tiers, '| navaids', len(sector_data['navaids']), kinds, '|', sector_data['gates'])


if __name__ == '__main__':
    main()
