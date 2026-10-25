const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseDeviation } = require('./weather-logic');

const plane = { lat: 33, lon: -84, heading: 0, speed: 250 };
const stormAt = (eastNM, northNM, severity = 3) => ({
    lat: plane.lat + northNM / 60,
    lon: plane.lon + eastNM / (60 * Math.cos(plane.lat * Math.PI / 180)),
    radiusNM: 8,
    severity,
    driftBearing: 90,
    driftSpeedKts: 25
});

test('aircraft requests the side with more storm clearance', () => {
    assert.equal(chooseDeviation(plane, [stormAt(5, 15)]).direction, 'left');
    assert.equal(chooseDeviation(plane, [stormAt(-5, 15)]).direction, 'right');
});

test('weather behind the aircraft or below alert severity does not trigger a request', () => {
    assert.equal(chooseDeviation(plane, [stormAt(5, -15)]), null);
    assert.equal(chooseDeviation(plane, [stormAt(5, 15, 2)]), null);
});

test('blocked routes produce a vectors request instead of a misleading side', () => {
    assert.equal(chooseDeviation(plane, [stormAt(5, 15), stormAt(-5, 15)]).direction, null);
});
