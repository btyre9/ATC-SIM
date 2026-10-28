const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./emergency-logic.js');

const base = { enabled: true, playSeconds: 20000, lastEmergencyAt: null, shiftSeconds: 3600, active: false };

test('never more than one emergency in three hours of play', () => {
    assert.equal(E.mayDeclare(base), true, 'first one ever can happen');
    assert.equal(E.mayDeclare({ ...base, lastEmergencyAt: 20000 - 3 * 3600 + 1 }), false);
    assert.equal(E.mayDeclare({ ...base, lastEmergencyAt: 20000 - 3 * 3600 }), true);
    assert.equal(E.mayDeclare({ ...base, active: true }), false, 'not while one is in progress');
    assert.equal(E.mayDeclare({ ...base, shiftSeconds: 599 }), false, 'not in the first ten minutes of a shift');
    assert.equal(E.mayDeclare({ ...base, enabled: false }), false);
});

test('once allowed, the wait averages about two hours', () => {
    const meanChecks = 1 / E.CHANCE_PER_CHECK;
    assert.ok(Math.abs(meanChecks * E.CHECK_EVERY_SEC - 2 * 3600) < 120);
});

test('emergency kinds fit the aircraft and phase of flight', () => {
    const departure = { id: 'DAL228', type: 'A321', isArrival: false, altitude: 4000 };
    const arrival = { id: 'DAL229', type: 'A321', isArrival: true, altitude: 12000 };
    assert.ok(E.typesFor(departure).includes('BIRDS'));
    assert.ok(!E.typesFor(departure).includes('PRESSURE'), 'pressurization only up high');
    assert.ok(!E.typesFor({ ...departure, altitude: 8000 }).includes('BIRDS'), 'bird strikes only down low');
    assert.ok(E.typesFor(arrival).includes('PRESSURE'));
    assert.ok(!E.typesFor(arrival).includes('BIRDS'));
    const cargo = { id: 'FDX101', type: 'B763', isArrival: true, altitude: 9000 };
    for (let i = 0; i < 50; i++) assert.notEqual(E.choose([cargo]).key, 'MEDICAL', 'no passengers on a freighter');
    assert.ok(E.soulsOnBoard(cargo) <= 4);
    assert.equal(E.choose([]), null);
});

test('the declaration gives the problem, intentions, souls and fuel', () => {
    const text = E.declaration({ key: 'ENGINE', facility: 'Atlanta Departure', callsign: 'Delta 228', runway: 'two six right',
        souls: 162, fuel: 150, returning: true });
    assert.equal(text, 'Mayday, mayday, mayday, Atlanta Departure, Delta 228, engine failure, request immediate return, runway two six right. 162 souls on board, fuel remaining two hours thirty minutes.');
    assert.match(E.declaration({ key: 'MEDICAL', facility: 'Detroit Approach', callsign: 'Delta 1', runway: 'two one left', souls: 150, fuel: 45 }), /^Pan-pan, pan-pan, pan-pan, .*forty five minutes\.$/);
    assert.equal(E.spokenDuration(60), 'one hour');
    assert.equal(E.spokenDuration(25), 'twenty five minutes');
});
