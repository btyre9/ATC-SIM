const test = require('node:test');
const assert = require('node:assert/strict');
const { distanceNM, separationFor, predictLoss, findConflicts, entryIsClear, performanceFor, verticalRateFpm } = require('./traffic-logic');

const airport = { lat: 33, lon: -84, elevation: 1000 };
const standard = { lateralNM: 3, verticalFt: 1000 };
const at = (eastNM, northNM, fields = {}) => ({
    lat: airport.lat + northNM / 60,
    lon: airport.lon + eastNM / (60 * Math.cos(airport.lat * Math.PI / 180)),
    heading: 0, speed: 250, altitude: 10000, targetAltitude: 10000, isArrival: true,
    ...fields
});

test('distance uses nautical miles', () => {
    assert.ok(Math.abs(distanceNM(at(0, 0), at(3, 4)) - 5) < 0.01);
});

test('head-on traffic at the same altitude is predicted before separation is lost', () => {
    const north = at(0, 10, { heading: 180 });
    const south = at(0, -10, { heading: 0 });
    const loss = predictLoss(north, south, standard, 3);
    assert.ok(loss);
    // 17 NM to close at a combined 500 knots is just over two minutes.
    assert.ok(loss.timeMinutes > 1.9 && loss.timeMinutes < 2.2);
});

test('1000 feet of vertical separation prevents a conflict', () => {
    const north = at(0, 10, { heading: 180, altitude: 11000, targetAltitude: 11000 });
    const south = at(0, -10, { heading: 0 });
    assert.equal(predictLoss(north, south, standard, 3), null);
});

test('a descent through another aircraft altitude is a predicted conflict', () => {
    const descending = at(0, 2, { heading: 90, altitude: 12000, targetAltitude: 8000 });
    const level = at(0, 0, { heading: 90 });
    const loss = predictLoss(descending, level, standard, 2);
    assert.ok(loss && loss.timeMinutes > 0.4 && loss.timeMinutes < 1.5);
});

test('parallel localizers and ground traffic are exempt; same final uses 2.5 NM', () => {
    const left = at(0, -8, { ilsCaptured: true, clearedRunway: '26L' });
    const right = at(1, -8, { ilsCaptured: true, clearedRunway: '27R' });
    assert.equal(separationFor(left, right, standard, airport), null);
    assert.equal(separationFor(left, at(0, 0, { onGround: true }), standard, airport), null);
    const trailing = at(0, -10.6, { ilsCaptured: true, clearedRunway: '26L' });
    assert.equal(separationFor(left, trailing, standard, airport).lateralNM, 2.5);
});

test('departures near the field are not radar conflicts with arrivals on another runway', () => {
    const departure = at(1, 0, { isArrival: false, departureRunway: '26L', altitude: 2500, targetAltitude: 5000 });
    const arrival = at(-2, 0, { ilsCaptured: true, clearedRunway: '26R', altitude: 2000 });
    assert.equal(separationFor(departure, arrival, standard, airport), null);
});

test('findConflicts separates current losses from predicted ones', () => {
    const losing = [at(0, 0), at(1, 0)];
    const converging = [at(20, 8, { heading: 180 }), at(20, -8)];
    const result = findConflicts([...losing, ...converging], standard, airport);
    assert.equal(result.losses.length, 1);
    assert.equal(result.predicted.length, 1);
});

test('new arrivals need 8 NM of space and no short-term conflict', () => {
    const traffic = [at(0, 30, { heading: 180 })];
    assert.equal(entryIsClear(at(7, 30, { heading: 180 }), traffic), false);
    // Converging inside 5 NM within three minutes is refused even 2000 ft apart.
    assert.equal(entryIsClear(at(9, 30, { heading: 230, altitude: 12000, targetAltitude: 12000 }), traffic), false);
    // Converging from the opposite side at the same altitude is refused...
    assert.equal(entryIsClear(at(0, -10, { heading: 0 }), traffic), false);
    // ...but the same entry 1000 ft higher is accepted.
    assert.equal(entryIsClear(at(0, -10, { heading: 0, altitude: 11000, targetAltitude: 11000 }), traffic), true);
});

test('localizer offset measures distance out on final and off the centerline', () => {
    const { localizerOffset } = require('./traffic-logic');
    // Runway 27 (landing west): the final is east of the threshold; north is to the pilot's right.
    const threshold = { lat: 33, lon: -84, heading: 270 };
    const onFinal = localizerOffset(at(10, 0), threshold);
    assert.ok(Math.abs(onFinal.along - 10) < 0.05 && Math.abs(onFinal.cross) < 0.05);
    const rightOfCourse = localizerOffset(at(10, 1), threshold);
    assert.ok(Math.abs(rightOfCourse.cross - 1) < 0.05);
    assert.ok(localizerOffset(at(-1, 0), threshold).along < 0, 'past the threshold');
    // Runway 18 (landing south): the final is north of the threshold.
    assert.ok(Math.abs(localizerOffset(at(0, 8), { ...threshold, heading: 180 }).along - 8) < 0.05);
});

test('climb rates depend on the type and fall off with altitude', () => {
    const narrow = { performance: performanceFor('B738'), altitude: 2000, targetAltitude: 10000, speed: 250, targetSpeed: 250 };
    const heavy = { ...narrow, performance: performanceFor('B77W') };
    assert.ok(verticalRateFpm(narrow) > verticalRateFpm(heavy));
    assert.ok(verticalRateFpm({ ...narrow, altitude: 12000, targetAltitude: 16000 }) < verticalRateFpm(narrow));
    assert.ok(verticalRateFpm({ ...narrow, targetSpeed: 290 }) < verticalRateFpm(narrow));
});

test('slowing down flattens a descent, less so with speedbrakes', () => {
    const descending = { performance: performanceFor('A320'), altitude: 11000, targetAltitude: 5000, speed: 250, targetSpeed: 250 };
    const normal = verticalRateFpm(descending);
    assert.ok(normal > 1500 && normal < 2000);
    assert.equal(verticalRateFpm({ ...descending, targetSpeed: 210 }), normal * 0.5);
    assert.ok(verticalRateFpm({ ...descending, expediteVertical: true }) > 2500);
    assert.equal(verticalRateFpm({ ...descending, targetSpeed: 210, ilsCaptured: true }), normal);
});

test('an emergency descent is much faster than a normal one', () => {
    const plane = { altitude: 30000, targetAltitude: 10000, speed: 280, targetSpeed: 280, emergency: { descendTo: 10000 } };
    assert.ok(verticalRateFpm(plane) >= 4000);
});
