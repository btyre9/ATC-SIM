const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./weather-control');

const airport = { lat: 33.64, lon: -84.43 };
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

test('clear and partly cloudy skies have no radar echoes', () => {
    assert.equal(W.generateCells('CLEAR', airport, 270).length, 0);
    assert.equal(W.generateCells('PARTLY_CLOUDY', airport, 270).length, 0);
});

test('showers never produce cells severe enough for deviations', () => {
    const cells = W.generateCells('SHOWERS', airport, 270, seeded());
    assert.equal(cells.length, 4);
    assert.ok(cells.every(cell => cell.severity < 3));
});

test('a squall line lies across the wind on the upwind side', () => {
    const cells = W.generateCells('SEVERE', airport, 270, seeded());
    const line = cells.filter(cell => cell.severity === 3);
    assert.equal(line.length, 6);
    // West wind: the line sits west of the field and runs north-south.
    assert.ok(line.every(cell => cell.lon < airport.lon));
    const lats = line.map(cell => cell.lat);
    assert.ok(Math.max(...lats) - Math.min(...lats) > 0.5);
});

test('ATIS line reads like a METAR', () => {
    assert.equal(W.atisText('KATL', 'THUNDERSTORMS', { dir: 268, speed: 12, gust: 22 }), 'KATL 27012G22KT 5SM TSRA BKN040CB OVC100');
    assert.equal(W.atisText('KSAN', 'CLEAR', { dir: 90, speed: 0 }), 'KSAN 00000KT 10SM SKC');
});

test('NWS observations convert to knots and a METAR line', () => {
    const parsed = W.parseObservation({ properties: {
        rawMessage: 'METAR KATL 251752Z 09013G19KT 10SM FEW050 20/08 A3043 RMK AO2',
        windDirection: { value: 90 }, windSpeed: { value: 24.076 }, windGust: { value: 35.188 },
        visibility: { value: 16093 }, cloudLayers: [], presentWeather: []
    } }, 'KATL');
    assert.deepEqual(parsed.wind, { dir: 90, speed: 13, gust: 19 });
    assert.equal(parsed.raw, 'KATL 251752Z 09013G19KT 10SM FEW050 20/08 A3043');
    const synthesized = W.parseObservation({ properties: {
        rawMessage: '', windDirection: { value: null }, windSpeed: { value: 0 }, windGust: { value: null },
        visibility: { value: 4828 }, cloudLayers: [{ amount: 'BKN', base: { value: 1219 } }],
        presentWeather: [{ rawString: 'TSRA' }]
    } }, 'KCLT');
    assert.equal(synthesized.raw, 'KCLT 00000KT 3SM TSRA BKN040');
    assert.equal(synthesized.thunder, true);
});

test('the runway flow faces into the wind', () => {
    const flows = [{ windDir: 270 }, { windDir: 90 }];
    assert.equal(W.flowForWind(flows, 250), 0);
    assert.equal(W.flowForWind(flows, 110), 1);
});

test('radar colors classify by reflectivity band', () => {
    assert.equal(W.classifyRadarPixel(0, 0, 0, 0), 0);
    assert.equal(W.classifyRadarPixel(1, 159, 244, 255), 0);
    assert.equal(W.classifyRadarPixel(2, 197, 1, 255), 1);
    assert.equal(W.classifyRadarPixel(253, 248, 2, 255), 2);
    assert.equal(W.classifyRadarPixel(253, 149, 0, 255), 2);
    assert.equal(W.classifyRadarPixel(212, 0, 0, 255), 3);
    assert.equal(W.classifyRadarPixel(248, 0, 253, 255), 3);
});

test('storm cells are grouped from radar levels, ignoring specks and light rain', () => {
    const size = 40, levels = new Uint8Array(size * size);
    const paint = (row, col, level) => { levels[row * size + col] = level; };
    // A 4x4 heavy block, 10 NM east of the field, plus an isolated speck and a light-rain patch.
    for (let r = 18; r < 22; r++) for (let c = 29; c < 33; c++) paint(r, c, 3);
    paint(2, 2, 3);
    for (let r = 5; r < 10; r++) for (let c = 5; c < 10; c++) paint(r, c, 1);
    const cells = W.extractStormCells(levels, size, 1, airport);
    assert.equal(cells.length, 1);
    assert.equal(cells[0].severity, 3);
    assert.ok(cells[0].lon > airport.lon && Math.abs(cells[0].lat - airport.lat) < 0.03);
    assert.ok(Math.abs(cells[0].radiusNM - Math.sqrt(16 / Math.PI)) < 0.01);
});

test('Schiphol picks the first usable combination of its preference table', () => {
    // True courses of the first end of each runway pair (AIP AD 2.12).
    const headings = { '04': 41.25, '06': 57.92, '09': 86.78, '18C': 183.22, '18L': 183.25, '18R': 183.2 };
    const recip = { '22': '04', '24': '06', '27': '09', '36C': '18C', '36R': '18L', '36L': '18R' };
    const courseOf = runway => headings[runway] ?? (headings[recip[runway]] + 180) % 360;
    const flows = [
        { name: 'NORTH', period: 'DAY', arrRwys: ['06', '36R'], depRwys: ['36L', '36C'], windDir: 20 },
        { name: 'SOUTH', period: 'DAY', arrRwys: ['18R', '18C'], depRwys: ['24', '18L'], windDir: 210 },
        { name: 'NORTHEAST', period: 'DAY', arrRwys: ['06', '36R'], depRwys: ['09', '36L'], windDir: 70 },
        { name: 'WEST', period: 'DAY', arrRwys: ['27', '18R'], depRwys: ['24', '18L'], windDir: 250 },
        { name: 'NIGHT NORTH', period: 'NIGHT', arrRwys: ['06'], depRwys: ['36L'], windDir: 30 },
        { name: 'NIGHT SOUTH', period: 'NIGHT', arrRwys: ['18R'], depRwys: ['24'], windDir: 210 }
    ];
    const pick = (dir, speed, period = 'DAY', gust = 0) => flows[W.preferredFlow(flows, { dir, speed, gust }, courseOf, period)].name;
    assert.equal(pick(30, 10), 'NORTH');
    assert.equal(pick(210, 12), 'SOUTH');
    assert.equal(pick(250, 12), 'SOUTH', 'a light westerly still uses the preferred south flow');
    assert.equal(pick(70, 20), 'NORTHEAST', 'too much crosswind on 36L for it to be the primary departure runway');
    assert.equal(pick(265, 25), 'WEST', 'a strong westerly brings in 27');
    assert.equal(pick(265, 12, 'DAY', 28), 'WEST', 'gusts 10 kt above the wind count');
    assert.equal(pick(120, 4), 'NORTH', 'up to 5 kt of tailwind keeps the preferred runways');
    assert.equal(pick(200, 8, 'NIGHT'), 'NIGHT SOUTH');
    assert.equal(pick(null, 0, 'NIGHT'), 'NIGHT NORTH');
});

test('IEM METAR observations and metric ATIS visibility', () => {
    const observation = W.parseIemObservation({ data: [{ raw: 'COR EHAM 291825Z 24018G31KT 9999 TSRA FEW011CB 11/11 Q1030 RMK X',
        sknt: 18, drct: 240, gust: '31', utc_valid: '2026-10-29T18:25:00Z' }] }, 'EHAM');
    assert.deepEqual(observation.wind, { dir: 240, speed: 18, gust: 31 });
    assert.equal(observation.raw, 'EHAM 291825Z 24018G31KT 9999 TSRA FEW011CB 11/11 Q1030');
    assert.equal(observation.thunder, true);
    assert.equal(W.parseIemObservation({ data: [{ raw: 'EHAM 291855Z VRB02KT CAVOK', sknt: 2, drct: 0 }] }, 'EHAM').wind.dir, null);
    assert.equal(W.atisText('EHAM', 'CLEAR', { dir: 240, speed: 8, gust: 0 }, { metric: true }), 'EHAM 24008KT 9999 SKC');
    assert.equal(W.atisText('EHAM', 'SEVERE', { dir: 240, speed: 20, gust: 35 }, { metric: true }), 'EHAM 24020G35KT 3200 +TSRA OVC025CB');
});

test('RainViewer Universal Blue colors classify like NEXRAD bands', () => {
    assert.equal(W.classifyRadarPixel(0x00, 0x55, 0x88, 255), 0); // 30 dBZ
    assert.equal(W.classifyRadarPixel(0xff, 0xee, 0x00, 255), 2); // 35 dBZ
    assert.equal(W.classifyRadarPixel(0xff, 0xaa, 0x00, 255), 2); // 40 dBZ
    assert.equal(W.classifyRadarPixel(0xff, 0x44, 0x00, 255), 3); // 45 dBZ
    assert.equal(W.classifyRadarPixel(0xff, 0xaa, 0xff, 255), 3); // 55 dBZ
    assert.equal(W.classifyRadarPixel(0x0f, 0x4f, 0xff, 255), 0); // 50 dBZ snow
});
