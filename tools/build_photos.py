"""Builds photos-data.js: freely licensed aircraft photos with photographer credit, and real tail numbers.

- liveries: for each airline and type in the schedules, a photo from the Wikimedia Commons fleet
  category "<Type> of <Airline>" (or its per-aircraft subcategories), so it shows that airline's livery.
- types: the lead image of each type's Wikipedia article, used when no livery photo is found.
- fleets: real registrations for each airline and type, taken from the Commons per-aircraft categories
  and kept only when Planespotters.net has a photo of that aircraft in that airline and type. The sim
  fetches the Planespotters photo live when the aircraft is selected.

Run from the project folder:  python3 tools/build_photos.py
"""
import html
import json
import random
import re
import time
import urllib.parse
import urllib.request

ARTICLES = {
    'CRJ7': 'Bombardier CRJ700 series', 'CRJ9': 'Bombardier CRJ700 series',
    'B717': 'Boeing 717', 'E190': 'Embraer E-Jet family',
    'A319': 'Airbus A319', 'A320': 'Airbus A320 family', 'A321': 'Airbus A321',
    'B737': 'Boeing 737 Next Generation', 'B738': 'Boeing 737 Next Generation', 'B739': 'Boeing 737 Next Generation',
    'B38M': 'Boeing 737 MAX', 'B752': 'Boeing 757', 'A300': 'Airbus A300',
    'B763': 'Boeing 767', 'B764': 'Boeing 767', 'A333': 'Airbus A330', 'A359': 'Airbus A350',
    'B772': 'Boeing 777', 'B77L': 'Boeing 777', 'B77W': 'Boeing 777', 'B789': 'Boeing 787 Dreamliner',
    'MD11': 'McDonnell Douglas MD-11', 'A343': 'Airbus A340', 'B748': 'Boeing 747-8', 'A388': 'Airbus A380',
}
# How Commons names each type in its "<Type> of <Airline>" fleet categories, most likely first.
COMMONS_TYPES = {
    'CRJ7': ['Bombardier CRJ700', 'Mitsubishi CRJ700', 'Bombardier CRJ-700'],
    'CRJ9': ['Bombardier CRJ900', 'Mitsubishi CRJ900', 'Bombardier CRJ-900'],
    'B717': ['Boeing 717-200', 'Boeing 717'], 'E190': ['Embraer 190', 'Embraer ERJ-190', 'Embraer E190'],
    'A319': ['Airbus A319', 'Airbus A319-100'], 'A320': ['Airbus A320', 'Airbus A320-200'],
    'A321': ['Airbus A321', 'Airbus A321-200', 'Airbus A321neo'],
    'B737': ['Boeing 737-700'], 'B738': ['Boeing 737-800'], 'B739': ['Boeing 737-900ER', 'Boeing 737-900'],
    'B38M': ['Boeing 737 MAX 8', 'Boeing 737-8 MAX', 'Boeing 737-8'], 'B752': ['Boeing 757-200'], 'A300': ['Airbus A300', 'Airbus A300-600'],
    'B763': ['Boeing 767-300ER', 'Boeing 767-300', 'Boeing 767-300F'], 'B764': ['Boeing 767-400ER'],
    'A333': ['Airbus A330-300'], 'A359': ['Airbus A350-900'],
    'B772': ['Boeing 777-200ER', 'Boeing 777-200'], 'B77L': ['Boeing 777F', 'Boeing 777-200LR'],
    'B77W': ['Boeing 777-300ER'], 'B789': ['Boeing 787-9'],
    'MD11': ['McDonnell Douglas MD-11F', 'McDonnell Douglas MD-11'], 'A343': ['Airbus A340-300'],
    'B748': ['Boeing 747-8F', 'Boeing 747-8I', 'Boeing 747-8'], 'A388': ['Airbus A380-800', 'Airbus A380'],
}
AIRLINES = {
    'DAL': ['Delta Air Lines'], 'SWA': ['Southwest Airlines'], 'AAL': ['American Airlines'],
    'UAL': ['United Airlines'], 'ASA': ['Alaska Airlines'], 'FDX': ['FedEx Express', 'FedEx'],
    'UPS': ['UPS Airlines'], 'JBU': ['JetBlue'], 'FFT': ['Frontier Airlines'], 'NKS': ['Spirit Airlines'],
    'BAW': ['British Airways'], 'AFR': ['Air France'], 'DLH': ['Lufthansa'], 'KAL': ['Korean Air'],
}
# Skip close-ups and interiors; prefer whole-aircraft shots in the air.
SKIP = re.compile(r'cabin|interior|cockpit|flight.?deck|seat|galley|lavator|engine|winglet|tail|wing\b|logo|nose|gear|panel|window|'
                  r'livery.detail|tug|crash|accident|deliver|rollout|roll.out|ceremony|factory|assembly|paint|hangar|'
                  r'maintenance|mock.?up|model|reveal|unveil|news|press|event|christen|economy|business class|'
                  r'first class|premium|view of|views? from', re.I)
# Spotter photos name the registration (N915US, G-XWBA, D-AIXA, HL7630); those are reliably whole-aircraft shots.
REGISTRATION = re.compile(r'\b(N\d{1,5}[A-Z]{0,2}|[A-Z]-[A-Z]{4}|[A-Z]{2}-[A-Z]{3}|HL\d{4})\b')
PREFER = re.compile(r'landing|approach|depart|take.?off|airborne|climb|final|in.flight|arriv', re.I)
# File categories reveal what file names hide: interiors, window views and detail shots.
SKIP_CATEGORY = re.compile(r'interior|cabin|cockpit|flight deck|seat|galley|lavator|engine|views? (from|out)|window|'
                           r'wing|tail|nose|landing gear|detail|instrument|cargo hold|logo|in.flight entertainment|meal', re.I)
PREFER_CATEGORY = re.compile(r'in flight|landing|take.?off|taking off|approach|departing|climb|quality images|valued images', re.I)
# Picks checked by eye and rejected (tiny aircraft against the sky, cluttered ramps).
EXCLUDE_FILES = {
    'File:Delta Airlines Airbus A320 night arrive SFO L1130442 (1).jpg',
    'File:Delta A321 taking off from Runway 9 in Boston.jpg',
    'File:Aeroporto de Brasília (4823875117).jpg',
    'File:20150722Mechtildshausen4.jpg',
    'File:Reagan National Airport, Washington, D.C. (20100325-DSC01328).jpg',
    'File:Delta A321 at Airbus Mobile.jpg',
    'File:Aircraft on ramp at Exuma International Airport.jpg',
    'File:FEMA - 15566 - Photograph by George Armstrong taken on 09-04-2005 in Georgia.jpg',
}
API = 'https://commons.wikimedia.org/w/api.php'
PLANESPOTTERS = 'https://api.planespotters.net/pub/photos/reg/'
# Per-aircraft Commons categories are named like "N8538V (aircraft)" or "N1776R (Boeing 737-8 MAX)".
REGISTRATION_CATEGORY = re.compile(r'^Category:(N\d{1,5}[A-Z]{0,2}) \(')
# Planespotters photo pages are named like "n915us-american-airlines-airbus-a321-231".
AIRLINE_SLUGS = {'DAL': 'delta', 'SWA': 'southwest', 'AAL': 'american', 'UAL': 'united',
                 'ASA': 'alaska', 'FDX': 'fedex', 'UPS': 'ups'}
TYPE_SLUGS = {
    'B737': r'737-7\w\w', 'B738': r'737-8\w\w', 'B739': r'737-9\w\w', 'B38M': r'737-8-max|737-max-8',
    'B717': r'717', 'B752': r'757-2', 'B763': r'767-3', 'B764': r'767-4', 'B772': r'777-2',
    'B77L': r'777-f|777f|777-2\w\wlr', 'B77W': r'777-3', 'B789': r'787-9',
    'A319': r'a319', 'A320': r'a320', 'A321': r'a321', 'A333': r'a330-3', 'A359': r'a350-9', 'A343': r'a340-3',
    'E190': r'erj-190|e190|embraer-190', 'CRJ7': r'crj-?7|cl-600-2c10', 'CRJ9': r'crj-?9|cl-600-2d24',
    'MD11': r'md-11', 'B748': r'747-8', 'A388': r'a380',
}
FLEET_SIZE = 6        # Registrations kept per airline and type.
FLEET_CHECKS = 14     # Planespotters lookups tried per airline and type.
HEADERS = {'User-Agent': 'OpenATC-simulator/1.0 (https://github.com/btyre9/ATC-SIM)'}


def get_json(url):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def commons(**params):
    time.sleep(0.05)
    return get_json(f"{API}?{urllib.parse.urlencode({**params, 'format': 'json'})}")


def plain(text):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', text or ''))).strip()


def credit(info):
    meta = info.get('extmetadata', {})
    licence = plain(meta.get('LicenseShortName', {}).get('value'))
    if not licence or 'fair use' in licence.lower() or 'non-free' in licence.lower():
        return None
    return {
        'url': info['thumburl'],
        'artist': plain(meta.get('Artist', {}).get('value')) or 'Unknown photographer',
        'license': licence,
        'source': info['descriptionurl'],
    }


def type_photo(article):
    summary = get_json('https://en.wikipedia.org/api/rest_v1/page/summary/' + urllib.parse.quote(article.replace(' ', '_')))
    original = (summary.get('originalimage') or {}).get('source')
    if not original:
        return None
    # Large originals come back as ".../thumb/<file>/3840px-<file>"; the file name is then the folder.
    segments = urllib.parse.urlsplit(original).path.split('/')
    filename = urllib.parse.unquote(segments[-2] if 'thumb' in segments else segments[-1])
    pages = commons(action='query', titles=f'File:{filename}', prop='imageinfo',
                    iiprop='url|extmetadata', iiurlwidth=500)['query']['pages']
    page = next(iter(pages.values()))
    photo = 'imageinfo' in page and credit(page['imageinfo'][0])
    return photo and {**photo, 'article': summary.get('title', article)}


def category_files(category):
    """Image files in a category and, one level down, its per-aircraft subcategories."""
    data = commons(action='query', generator='categorymembers', gcmtitle=f'Category:{category}',
                   gcmtype='file|subcat', gcmlimit=50, prop='imageinfo', iiprop='url|size|mime|extmetadata', iiurlwidth=500)
    pages = list(data.get('query', {}).get('pages', {}).values())
    files = [p for p in pages if p['ns'] == 6]
    for sub in [p for p in pages if p['ns'] == 14][:6]:
        if len(files) >= 40:
            break
        files += [p for p in category_files_flat(sub['title'])]
    return files


def category_files_flat(title):
    data = commons(action='query', generator='categorymembers', gcmtitle=title, gcmtype='file', gcmlimit=20,
                   prop='imageinfo', iiprop='url|size|mime|extmetadata', iiurlwidth=500)
    return list(data.get('query', {}).get('pages', {}).values())


def file_categories(titles):
    """Visible categories of up to 20 files, by title."""
    data = commons(action='query', titles='|'.join(titles), prop='categories', clshow='!hidden', cllimit='max')
    return {page['title']: [c['title'] for c in page.get('categories', [])] for page in data['query']['pages'].values()}


def best_file(files):
    def score(page):
        info = page.get('imageinfo', [{}])[0]
        title = page['title']
        if info.get('mime') != 'image/jpeg' or SKIP.search(title) or title in EXCLUDE_FILES:
            return None
        width, height = info.get('width', 0), info.get('height', 1)
        if width < 1200 or not 1.25 <= width / height <= 2.3:
            return None
        artist = info.get('extmetadata', {}).get('Artist', {}).get('value', '')
        if SKIP.search(artist):
            return None
        return (4 if REGISTRATION.search(title) else 0) + (2 if PREFER.search(title) else 0) + (1 if width >= 2400 else 0)
    candidates = sorted(((s, page) for page in files if (s := score(page)) is not None), key=lambda item: -item[0])[:20]
    if not candidates:
        return None
    categories = file_categories([page['title'] for _, page in candidates])
    ranked = []
    for s, page in candidates:
        cats = ' | '.join(categories.get(page['title'], []))
        if SKIP_CATEGORY.search(cats):
            continue
        # Require evidence of a whole-aircraft shot: a registration or in-flight wording in the title,
        # or an in-flight, takeoff or landing category. Otherwise the type photo is the better fallback.
        bonus = 3 if PREFER_CATEGORY.search(cats) else 0
        if s < 2 and not bonus:
            continue
        ranked.append((s + bonus, page))
    for _, page in sorted(ranked, key=lambda item: -item[0]):
        photo = credit(page['imageinfo'][0])
        if photo:
            return {**photo, 'file': page['title']}
    return None


def livery_photo(airline, icao):
    for airline_name in AIRLINES[airline]:
        for type_name in COMMONS_TYPES.get(icao, []):
            for prefix in ('', 'Current '):
                category = f'{prefix}{type_name} of {airline_name}'
                pages = commons(action='query', prop='categoryinfo', titles=f'Category:{category}')['query']['pages']
                info = next(iter(pages.values()))
                if 'categoryinfo' not in info or not info['categoryinfo'].get('size'):
                    continue
                photo = best_file(category_files(category))
                if photo:
                    return {**photo, 'category': category}
    return None


def fleet_candidates(airline, icao):
    """Registrations from the per-aircraft subcategories of an airline's fleet categories."""
    found = []
    for airline_name in AIRLINES[airline]:
        for type_name in COMMONS_TYPES.get(icao, []):
            for prefix in ('', 'Current '):
                data = commons(action='query', list='categorymembers', cmtype='subcat', cmlimit=200,
                               cmtitle=f'Category:{prefix}{type_name} of {airline_name}')
                for member in data.get('query', {}).get('categorymembers', []):
                    match = REGISTRATION_CATEGORY.match(member['title'])
                    if match and match.group(1) not in found:
                        found.append(match.group(1))
    return found


def planespotters_matches(registration, airline, icao):
    """True when Planespotters has a photo of this registration in this airline and type."""
    time.sleep(0.6)
    try:
        photos = get_json(PLANESPOTTERS + registration).get('photos') or []
    except Exception:
        return False
    if not photos:
        return False
    slug = photos[0]['link'].split('?')[0].rsplit('/', 1)[-1]
    return AIRLINE_SLUGS.get(airline, '~') in slug and re.search(TYPE_SLUGS.get(icao, '~'), slug) is not None


def fleet_registrations(airline, icao):
    candidates = fleet_candidates(airline, icao)
    random.Random(f'{airline}{icao}').shuffle(candidates)
    fleet = []
    for registration in candidates[:FLEET_CHECKS]:
        if planespotters_matches(registration, airline, icao):
            fleet.append(registration)
            if len(fleet) >= FLEET_SIZE:
                break
    return sorted(fleet)


def scheduled_combinations():
    """Airline and type pairs that fly in the simulator's schedules."""
    source = open('index.html').read()
    pairs = set()
    for block in re.split(r'\{ airline: "', source)[1:]:
        airline = block[:3]
        routes = block.split(']},')[0]
        for types in re.findall(r'types: \[([^\]]*)\]', routes):
            pairs.update((airline, t) for t in re.findall(r'"(\w+)"', types))
    return sorted(pairs)


def main():
    types = {}
    cache = {}
    for icao, article in ARTICLES.items():
        if article not in cache:
            cache[article] = type_photo(article)
        if cache[article]:
            types[icao] = cache[article]
    liveries, fleets = {}, {}
    for airline, icao in scheduled_combinations():
        if airline not in AIRLINES:
            continue
        photo = livery_photo(airline, icao)
        if photo:
            liveries[f'{airline}|{icao}'] = photo
        fleet = fleet_registrations(airline, icao)
        if fleet:
            fleets[f'{airline}|{icao}'] = fleet
        print(f'{airline} {icao}:', f"{photo['category']} ({photo['license']})" if photo else 'type photo fallback',
              f'| {len(fleet)} registrations {fleet}')
    with open('photos-data.js', 'w') as out:
        out.write('/* Generated by tools/build_photos.py from Wikimedia Commons and Planespotters.net checks. Do not edit by hand. */\n')
        out.write(f'window.ATC_PHOTOS = {json.dumps({"liveries": liveries, "types": types, "fleets": fleets}, indent=1)};\n')
    print(f'{len(liveries)} livery photos, {len(types)} type photos, {sum(map(len, fleets.values()))} registrations')


if __name__ == '__main__':
    main()
