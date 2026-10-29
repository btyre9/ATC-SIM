/* Weather presets, live observation parsing (NWS, or METARs from the Iowa Environmental Mesonet), preferential runway
   choice, and storm cells extracted from NEXRAD or RainViewer radar pixels. */
(function (root) {
    'use strict';

    const radians = degrees => degrees * Math.PI / 180;
    const degrees = rad => rad * 180 / Math.PI;

    // Severity 1 is light rain (display only), 2 moderate, 3 heavy enough that pilots ask to deviate.
    const PRESETS = {
        CLEAR: {
            label: 'Clear skies', short: 'CLR', wind: [3, 8], gust: 0,
            visibility: '10SM', weather: '', clouds: 'SKC', groups: []
        },
        PARTLY_CLOUDY: {
            label: 'Partly cloudy', short: 'SCT', wind: [6, 12], gust: 0,
            visibility: '10SM', weather: '', clouds: 'SCT045 BKN120', groups: []
        },
        SHOWERS: {
            label: 'Rain showers', short: 'SHRA', wind: [8, 14], gust: 0,
            visibility: '6SM', weather: '-SHRA', clouds: 'BKN035 OVC080',
            groups: [{ count: 4, severities: [1, 1, 2], radius: [5, 9] }]
        },
        THUNDERSTORMS: {
            label: 'Thunderstorms', short: 'TSTM', wind: [8, 16], gust: 22,
            visibility: '5SM', weather: 'TSRA', clouds: 'BKN040CB OVC100',
            groups: [{ count: 1, severities: [3], radius: [8, 12] }, { count: 2, severities: [2, 3], radius: [8, 12] }]
        },
        SEVERE: {
            label: 'Severe squall line', short: 'SVR', wind: [15, 22], gust: 35,
            visibility: '2SM', weather: '+TSRA', clouds: 'OVC025CB',
            line: { count: 6, severity: 3, radius: [6, 9] },
            groups: [{ count: 2, severities: [2], radius: [7, 10] }]
        }
    };

    function movePoint(origin, bearing, distNM) {
        const R = 3440.065, d = distNM / R, b = radians(bearing);
        const lat1 = radians(origin.lat), lon1 = radians(origin.lon);
        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
        const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
        return { lat: degrees(lat2), lon: degrees(lon2) };
    }

    const between = ([low, high], random) => low + random() * (high - low);
    const pick = (items, random) => items[Math.floor(random() * items.length)];

    function generateCells(presetKey, airport, windDir, random = Math.random) {
        const preset = PRESETS[presetKey];
        if (!preset) return [];
        const cells = [];
        preset.groups.forEach(group => {
            for (let i = 0; i < group.count; i++) {
                const pos = movePoint(airport, random() * 360, 16 + random() * 9);
                cells.push({ ...pos, radiusNM: between(group.radius, random), severity: pick(group.severities, random) });
            }
        });
        if (preset.line) {
            // A line of cells across the wind, upwind of the field, that drifts over it.
            const center = movePoint(airport, windDir, 22);
            const { count, radius } = preset.line;
            const spacing = radius[1] * 1.6;
            for (let i = 0; i < count; i++) {
                const along = (i - (count - 1) / 2) * spacing;
                const offset = movePoint(center, (windDir + 90) % 360, along);
                const jittered = movePoint(offset, windDir, (random() - 0.5) * 4);
                cells.push({ ...jittered, radiusNM: between(radius, random), severity: preset.line.severity });
            }
        }
        return cells;
    }

    /* One new cell entering upwind, used when a drifting cell leaves the scope. */
    function replacementCell(presetKey, airport, windDir, distanceNM, random = Math.random) {
        const preset = PRESETS[presetKey];
        if (!preset) return null;
        const options = [...preset.groups, ...(preset.line ? [{ severities: [preset.line.severity], radius: preset.line.radius }] : [])];
        if (!options.length) return null;
        const group = pick(options, random);
        const pos = movePoint(airport, windDir + (random() * 100 - 50), distanceNM);
        return { ...pos, radiusNM: between(group.radius, random), severity: pick(group.severities, random) };
    }

    function windCode(wind) {
        if (!wind || wind.speed < 1) return '00000KT';
        const dir = wind.dir === null ? 'VRB' : String(Math.round(wind.dir / 10) * 10 % 360 || 360).padStart(3, '0');
        return `${dir}${String(Math.round(wind.speed)).padStart(2, '0')}${wind.gust ? `G${Math.round(wind.gust)}` : ''}KT`;
    }

    // US METARs give visibility in statute miles; ICAO ones in metres, 9999 for 10 km or more.
    function metricVisibility(statuteMiles) {
        const metres = parseFloat(statuteMiles) * 1609.34;
        return metres >= 10000 ? '9999' : String(Math.floor(metres / 100) * 100).padStart(4, '0');
    }

    function atisText(airportId, presetKey, wind, options = {}) {
        const preset = PRESETS[presetKey];
        const visibility = options.metric ? metricVisibility(preset.visibility) : preset.visibility;
        return [airportId, windCode(wind), visibility, preset.weather, preset.clouds].filter(Boolean).join(' ');
    }

    const KMH_TO_KT = 0.539957;

    /* Reads api.weather.gov's latest observation into wind and a METAR-style line. */
    function parseObservation(observation, airportId) {
        const p = observation && observation.properties;
        if (!p) throw new Error('No observation was returned.');
        const knots = value => (value === null || value === undefined ? null : value * KMH_TO_KT);
        const speed = knots(p.windSpeed && p.windSpeed.value) ?? 0;
        const gust = knots(p.windGust && p.windGust.value);
        const dir = p.windDirection && p.windDirection.value !== null ? p.windDirection.value : null;
        const wind = { dir, speed: Math.round(speed), gust: gust ? Math.round(gust) : 0 };
        const raw = String(p.rawMessage || '').replace(/^(METAR|SPECI)\s+/, '').replace(/\s+RMK\s.*$/, '').trim();
        const weather = (p.presentWeather || []).map(item => item.rawString).filter(Boolean).join(' ');
        const clouds = (p.cloudLayers || []).map(layer => {
            const base = layer.base && layer.base.value !== null ? String(Math.round(layer.base.value * 3.28084 / 100)).padStart(3, '0') : '';
            return layer.amount === 'CLR' || layer.amount === 'SKC' ? layer.amount : `${layer.amount}${base}`;
        }).join(' ');
        const metersToMiles = p.visibility && p.visibility.value !== null ? p.visibility.value / 1609.34 : null;
        const visibility = metersToMiles === null ? '' : metersToMiles >= 10 ? '10SM' : `${Math.round(metersToMiles)}SM`;
        const summary = raw || [airportId, windCode(wind), visibility, weather, clouds].filter(Boolean).join(' ');
        return { wind, raw: summary, description: p.textDescription || '', time: p.timestamp || null, thunder: /TS/.test(summary) };
    }

    /* Reads the Iowa Environmental Mesonet's current observation (a decoded METAR) into wind and the METAR line. */
    function parseIemObservation(json, airportId) {
        const row = json && json.data && json.data[0];
        if (!row) throw new Error('No observation was returned.');
        let raw = String(row.raw || '').replace(/\s+RMK\s.*$/, '').trim();
        if (raw.includes(airportId)) raw = raw.slice(raw.indexOf(airportId));
        const number = value => (value === null || value === undefined || value === '' ? null : Number(value));
        const variable = /\bVRB\d/.test(raw);
        const speed = number(row.sknt) ?? 0;
        const gust = number(row.gust);
        const wind = { dir: variable ? null : number(row.drct), speed: Math.round(speed), gust: gust ? Math.round(gust) : 0 };
        return { wind, raw: raw || [airportId, windCode(wind)].join(' '), description: '', time: row.utc_valid || null, thunder: /TS/.test(raw) };
    }

    /* Preferential runway use (Schiphol): the first combination, in preference order, whose runways all have at most
       5 kt of tailwind (ICAO PANS-ATM 7.2.2, the limit for noise-preferential runways), at most 15 kt of crosswind on
       the primary landing and departure runway (listed first) and 20 kt on the secondary ones (Schiphol's runway-use
       rules). Gusts count once they are 10 kt above the mean wind (AIP AD 2.20 4.3.3). courseOf gives a runway's true
       course. When none fits, the combination landing most into the wind. */
    function preferredFlow(flows, wind, courseOf, period = null) {
        const candidates = flows.map((flow, index) => ({ flow, index })).filter(({ flow }) => !period || !flow.period || flow.period === period);
        if (!candidates.length) return 0;
        if (wind.dir === null || wind.dir === undefined) return candidates[0].index;
        const speed = wind.gust && wind.gust - wind.speed >= 10 ? wind.gust : wind.speed;
        const fits = (runway, maxCrosswind) => {
            const off = radians(wind.dir - courseOf(runway));
            return speed * Math.cos(off) >= -5 && Math.abs(speed * Math.sin(off)) <= maxCrosswind;
        };
        const usable = ({ flow }) => [flow.arrRwys, flow.depRwys].every(runways =>
            runways.every((runway, i) => fits(runway, i === 0 ? 15 : 20)));
        const choice = candidates.find(usable);
        if (choice) return choice.index;
        return candidates[flowForWind(candidates.map(({ flow }) => flow), wind.dir)].index;
    }

    /* The flow whose landing direction faces most into the wind. */
    function flowForWind(flows, windDir) {
        let best = 0, bestDiff = Infinity;
        flows.forEach((flow, index) => {
            let diff = Math.abs(flow.windDir - windDir) % 360;
            if (diff > 180) diff = 360 - diff;
            if (diff < bestDiff) { bestDiff = diff; best = index; }
        });
        return best;
    }

    /* NEXRAD reflectivity colors: 0 none/very light, 1 green, 2 yellow-orange, 3 red/magenta. RainViewer's "Universal
       Blue" works too: blues for light rain and all snow, yellow and orange from 35 dBZ, red from 45, pink from 55. */
    function classifyRadarPixel(r, g, b, a) {
        if (a < 40) return 0;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (max > 200 && min > 200) return 3; // White core, extreme reflectivity.
        if (r > 120 && b > 120 && g < r * 0.7) return 3; // Magenta, purple and pink.
        if (b >= r && b >= g) return 0; // Blues and cyans: drizzle and clutter.
        if (g > r * 1.15 && g >= b) return 1; // Greens.
        if (r > 120 && b < r * 0.5) return g >= r * 0.5 ? 2 : 3; // Yellow and orange, or red.
        return 0;
    }

    /* Groups moderate-or-worse radar cells into storm cells. The grid is north-up and centred on the airport. */
    function extractStormCells(levels, size, cellNM, center, options = {}) {
        const { minCells = 3, maxStorms = 15 } = options;
        const seen = new Uint8Array(size * size);
        const storms = [];
        for (let start = 0; start < levels.length; start++) {
            if (seen[start] || levels[start] < 2) continue;
            const stack = [start];
            seen[start] = 1;
            let count = 0, heavy = 0, sumCol = 0, sumRow = 0;
            while (stack.length) {
                const index = stack.pop();
                const row = Math.floor(index / size), col = index % size;
                count++; sumCol += col; sumRow += row;
                if (levels[index] >= 3) heavy++;
                for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                    const r = row + dr, c = col + dc;
                    if (r < 0 || c < 0 || r >= size || c >= size) continue;
                    const next = r * size + c;
                    if (!seen[next] && levels[next] >= 2) { seen[next] = 1; stack.push(next); }
                }
            }
            if (count < minCells) continue;
            const half = size * cellNM / 2;
            const east = (sumCol / count + 0.5) * cellNM - half;
            const north = half - (sumRow / count + 0.5) * cellNM;
            const bearing = (degrees(Math.atan2(east, north)) + 360) % 360;
            storms.push({
                ...movePoint(center, bearing, Math.hypot(east, north)),
                radiusNM: Math.max(2, Math.sqrt(count * cellNM * cellNM / Math.PI)),
                severity: heavy >= 2 ? 3 : 2,
                areaNM2: count * cellNM * cellNM
            });
        }
        return storms.sort((a, b) => b.areaNM2 - a.areaNM2).slice(0, maxStorms);
    }

    root.ATCWeatherControl = {
        PRESETS, generateCells, replacementCell, windCode, atisText,
        parseObservation, parseIemObservation, flowForWind, preferredFlow, classifyRadarPixel, extractStormCells
    };
    if (typeof module !== 'undefined') module.exports = root.ATCWeatherControl;
})(typeof window !== 'undefined' ? window : globalThis);
