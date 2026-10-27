const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, choose, resolveCallsign, chooseCallsign } = require('./voice-commands.js');

const airlines = [
    { id: 'DAL', name: 'Delta' },
    { id: 'AAL', name: 'American' },
    { id: 'SWA', name: 'Southwest' },
    { id: 'BAW', name: 'Speedbird' }
];
const aircraft = [
    { id: 'DAL228', altitude: 10000 },
    { id: 'AAL101', altitude: 10000 },
    { id: 'SWA2532', altitude: 10000 },
    { id: 'BAW391', altitude: 35000 }
];
const hear = text => parse(text, aircraft, airlines, 1026);

test('spoken callsigns and feet altitudes address exactly one aircraft', () => {
    assert.deepEqual(hear('Delta two twenty eight, descend and maintain three thousand feet'), {
        ok: true, command: 'DAL228 A 3000'
    });
    assert.deepEqual(hear('American one zero one fly heading two four zero'), {
        ok: true, command: 'AAL101 H 240'
    });
    assert.deepEqual(hear('American one zero one climb and maintain one two thousand five hundred feet'), {
        ok: true, command: 'AAL101 A 12500'
    });
});

test('airline names and spoken codes map to their ICAO callsigns', () => {
    assert.equal(hear('Delta descend and maintain three thousand feet').command, 'DAL228 A 3000');
    assert.equal(hear('American Airlines one zero one fly heading two four zero').command, 'AAL101 H 240');
    assert.equal(hear('Southwest 2532 descend and maintain 5000 feet').command, 'SWA2532 A 5000');
    assert.equal(hear('South West twenty five thirty two descend and maintain 5000 feet').command, 'SWA2532 A 5000');
    assert.equal(hear('S W A 2532 descend and maintain 5000 feet').command, 'SWA2532 A 5000');
    const twoDeltas = [...aircraft, { id: 'DAL229', altitude: 10000 }];
    assert.equal(parse('Delta descend and maintain 3000 feet', twoDeltas, airlines, 1026).ok, false);
});

test('recognition alternatives recover a known callsign without guessing between clearances', () => {
    assert.deepEqual(choose([
        'Delto 228 descend and maintain 3000 feet',
        'Delta 228 descend and maintain 3000 feet'
    ], aircraft, airlines, 1026), {
        ok: true,
        transcript: 'Delta 228 descend and maintain 3000 feet',
        command: 'DAL228 A 3000'
    });
    assert.equal(choose([
        'Delta 228 descend and maintain 3000 feet',
        'American 101 descend and maintain 3000 feet'
    ], aircraft, airlines, 1026).ok, false);
});

test('common callsign transcription slips still select the exact active flight number', () => {
    assert.equal(hear('Delto 2 to 8 descend and maintain 3000 feet').command, 'DAL228 A 3000');
    assert.equal(hear('America flight number 101 fly heading 240').command, 'AAL101 H 240');
    assert.equal(hear('D E L T A 228 descend and maintain 3000 feet').command, 'DAL228 A 3000');
    assert.equal(hear('Delta 228 to send to maintain four thousand feet').command, 'DAL228 A 4000');
});

test('a missing callsign reports the aircraft available for that airline', () => {
    const result = hear('Delta 999 descend and maintain 3000 feet');
    assert.equal(result.ok, false);
    assert.match(result.error, /I heard "DELTA 999"/);
    assert.match(result.error, /Delta callsigns: DAL228/);
    assert.doesNotMatch(result.error, /AAL101/);
});

test('Delta 428 selects DAL428 and a later clearance uses that selected aircraft', () => {
    const active = [...aircraft, { id: 'DAL428', altitude: 10000 }, { id: 'DAL2194', altitude: 10000 }];
    assert.deepEqual(resolveCallsign('Delta 428', active, airlines), { ok: true, id: 'DAL428' });
    assert.equal(chooseCallsign(['Delta 428'], active, airlines).id, 'DAL428');
    assert.equal(parse('Delta 428 descend and maintain three thousand feet', active, airlines, 1026).command,
        'DAL428 A 3000');
    assert.equal(choose(['descend and maintain three thousand feet'], active, airlines, 1026, 'DAL428').command,
        'DAL428 A 3000');
    assert.match(parse('descend and maintain three thousand feet', active, airlines, 1026).error,
        /No callsign was heard/);
});

test('selected aircraft accepts short altitude and turn phrases with common speech variations', () => {
    const selected = text => choose([text], aircraft, airlines, 1026, 'DAL228');
    assert.equal(selected('descend and maintain at three thousand feet').command, 'DAL228 A 3000');
    assert.equal(selected('okay please descent and maintained 3,000 feet').command, 'DAL228 A 3000');
    assert.equal(selected('turn right heading two seven zero degrees').command, 'DAL228 TR 270');
    assert.equal(selected('please turn left heading two four zero').command, 'DAL228 TL 240');
    assert.equal(selected('fly heading one eight zero').command, 'DAL228 H 180');
    assert.equal(selected('honey two seven zero').command, 'DAL228 H 270');
    assert.equal(selected('turn right honey two seven zero').command, 'DAL228 TR 270');
    assert.equal(selected('client and maintain flight level twelve thousand').command, 'DAL228 A 12000');
    assert.match(selected('client to flight level 1,000').error, /I heard 1,000 feet/);
    assert.equal(hear('Delta 228 turn right honey two seven zero').command, 'DAL228 TR 270');
    assert.equal(hear('Delta 228 client and maintain flight level 12000').command, 'DAL228 A 12000');
    assert.equal(selected('Delta 229 descend and maintain 3000 feet').ok, false);
});

test('full altitude flight level phrases and standard three-digit levels are distinct', () => {
    assert.deepEqual(hear('Speedbird three niner one descend and maintain flight level three zero zero'), {
        ok: true, command: 'BAW391 A 30000'
    });
    assert.deepEqual(hear('Delta 228 descend and maintain flight level 3000'), {
        ok: true, command: 'DAL228 A 3000'
    });
    assert.deepEqual(hear('Delta 228 descend and maintain flight level three thousand'), {
        ok: true, command: 'DAL228 A 3000'
    });
    assert.deepEqual(hear('Delta 228 climb and maintain flight level 12000'), {
        ok: true, command: 'DAL228 A 12000'
    });
    assert.deepEqual(hear('Delta 228 climb and maintain flight level twelve thousand'), {
        ok: true, command: 'DAL228 A 12000'
    });
    assert.deepEqual(hear('Speedbird 391 cleared ILS runway two six right'), {
        ok: true, command: 'BAW391 L 26R'
    });
});

test('ambiguous or conflicting instructions do not produce a command', () => {
    for (const text of [
        'Delta 229 descend and maintain 3000',
        'Delta 228 descend and maintain flight level 300',
        'Delta 228 descend and maintain three thousand turn left heading two bananas'
    ]) assert.equal(hear(text).ok, false, text);
});

test('one transmission can carry several instructions', () => {
    assert.equal(hear('Delta 228 descend and maintain three thousand turn left heading two four zero').command, 'DAL228 A 3000 TL 240');
    assert.equal(hear('American 101 turn right heading two seven zero, then reduce speed to two one zero').command, 'AAL101 TR 270 S 210');
    assert.equal(hear('Delta 228 cleared for takeoff runway two six left climb and maintain one zero thousand').command, 'DAL228 CTO A 10000');
});

test('recognition tense slips still parse', () => {
    assert.equal(hear('American 101 clear for takeoff climbed to 10,000').command, 'AAL101 CTO A 10000');
    assert.equal(hear('Delta 228 clear ILS runway two six right').command, 'DAL228 L 26R');
    assert.equal(hear('Delta 228 descending and maintain four thousand').command, 'DAL228 A 4000');
});

test('speed, turns, and go around map to existing commands', () => {
    assert.equal(hear('American 101 maintain speed two hundred knots').command, 'AAL101 S 200');
    assert.equal(hear('Delta 228 turn right heading two seven zero').command, 'DAL228 TR 270');
    assert.equal(hear('Delta 228 go around').command, 'DAL228 GA');
});

test('takeoff clearances work with the runway before, after, or omitted', () => {
    assert.equal(hear('Delta 228 cleared for takeoff').command, 'DAL228 CTO');
    assert.equal(hear('Delta 228 runway two six left cleared for take off').command, 'DAL228 CTO');
    assert.equal(hear('Delta 228 cleared for takeoff runway two six left').command, 'DAL228 CTO');
    assert.equal(choose(['cleared for takeoff'], aircraft, airlines, 1026, 'AAL101').command, 'AAL101 CTO');
});

test('handoff phrases map to the handoff command', () => {
    assert.equal(hear('Delta 228 contact tower').command, 'DAL228 HO');
    assert.equal(hear('Delta 228 contact Atlanta Center one three two point four seven').command, 'DAL228 HO');
    assert.equal(choose(['monitor tower one one niner point one'], aircraft, airlines, 1026, 'AAL101').command, 'AAL101 HO');
});

test('heading misheard as hitting or heating still parses', () => {
    assert.equal(hear('Delta 228 turn left hitting two four zero').command, 'DAL228 TL 240');
    assert.equal(hear('Delta 228 fly hitting two seven zero').command, 'DAL228 H 270');
    assert.equal(hear('Delta 228 turn right heating one eight zero').command, 'DAL228 TR 180');
    assert.equal(choose(['hitting three six zero'], aircraft, airlines, 1026, 'AAL101').command, 'AAL101 H 360');
});

test('climb misheard as cline still parses, but the CLINE fix stays a fix', () => {
    assert.equal(hear('Delta 228 cline and maintain one two thousand').command, 'DAL228 A 12000');
    assert.equal(hear('Delta 228 kline to one one thousand').command, 'DAL228 A 11000');
    assert.equal(choose(['cline and maintain one four thousand'], aircraft, airlines, 1026, 'DAL228').command, 'DAL228 A 14000');
    assert.equal(hear('Delta 228 proceed direct cline').command, 'DAL228 C CLINE');
    assert.equal(hear('Delta 228 direct to cline').command, 'DAL228 C CLINE');
});

test('a bare "flight level" altitude is an instruction, but "flight" in a callsign is not', () => {
    assert.equal(hear('Southwest 2532 flight level 10000').command, 'SWA2532 A 10000');
    assert.equal(hear('Delta 228 flight level one two thousand').command, 'DAL228 A 12000');
    assert.equal(hear('Delta 228 turn left heading two four zero flight level five thousand').command, 'DAL228 TL 240 A 5000');
    assert.equal(choose(['flight level five thousand'], aircraft, airlines, 1026, 'DAL228').command, 'DAL228 A 5000');
    assert.equal(hear('Delta flight 228 descend and maintain 3000').command, 'DAL228 A 3000');
});

test('an unrecognized instruction names the callsign that was heard', () => {
    assert.match(hear('Southwest 2532 banana split').error, /I heard SWA2532, but couldn't find an instruction in "banana split"/);
    assert.equal(hear('Southwest 2532').error, 'No instruction was recognized.');
});

test('direct-to accepts names split into words, navaid words and phonetic spelling', () => {
    assert.equal(hear('Delta 228 proceed direct boy kin').command, 'DAL228 C BOYKIN');
    assert.equal(hear('Delta 228 direct to Rome VOR').command, 'DAL228 C ROME');
    assert.equal(hear('Delta 228 direct bravo oscar yankee kilo november').command, 'DAL228 C BOYKN');
    assert.equal(hear('Delta 228 proceed direct chopper descend and maintain four thousand').command, 'DAL228 C CHOPPER A 4000');
});

test('spoken fix names match identifiers, sound-alikes and navaid place names', () => {
    const { matchFix, soundKey } = require('./voice-commands.js');
    const at = (name, lat, lon, title) => ({ name, lat, lon, ...(title ? { title, navaid: true } : {}) });
    const fixes = [at('BOYKN', 33.7, -84.2), at('CHPPR', 34.1, -84.9), at('SHAKK', 33.6, -85.0), at('PHIIL', 33.8, -83.9),
        at('HOBTT', 33.2, -84.8), at('RMG', 34.16, -85.12, 'Rome'), at('AHN', 33.95, -83.33, 'Athens'), at('LGC', 33.05, -85.21, 'Lagrange')];
    assert.equal(soundKey('Boykin'), soundKey('BOYKN'));
    for (const [heard, expected] of [['BOYKIN', 'BOYKN'], ['CHOPPER', 'CHPPR'], ['SHACK', 'SHAKK'], ['PHIL', 'PHIIL'],
        ['HOBBIT', 'HOBTT'], ['ROME', 'RMG'], ['ATHENS', 'AHN'], ['LA GRANGE', 'LGC'], ['rmg', 'RMG']]) {
        assert.equal(matchFix(heard, fixes)?.name, expected, heard);
    }
    assert.equal(matchFix('BANANA', fixes), null);
    // Two sound-alikes: the one nearer the aircraft wins.
    const twins = [at('BOYKN', 33.7, -84.2), at('BAKAN', 35.0, -81.0)];
    assert.equal(matchFix('boykin', twins, { lat: 34.9, lon: -81.1 }).name, 'BAKAN');
});

test('expect runway phrases give the runway to plan for', () => {
    assert.equal(hear('Delta 228 expect runway two six right').command, 'DAL228 EXP 26R');
    assert.equal(hear('Delta 228 expect the ILS runway two seven left approach').command, 'DAL228 EXP 27L');
    assert.equal(hear('Delta 228 expect ILS runway 28').command, 'DAL228 EXP 28');
    assert.equal(hear('Delta 228 expect runway one niner right descend and maintain four thousand').command, 'DAL228 EXP 19R A 4000');
    assert.equal(hear('Delta 228 cleared ILS runway zero one center').command, 'DAL228 L 01C');
    assert.equal(hear('Delta 228 expect runway bananas').ok, false);
});

test('climb misheard as climate still parses', () => {
    assert.equal(hear('Delta 228 climate and maintain one two thousand').command, 'DAL228 A 12000');
    assert.equal(choose(['climate to one four thousand'], aircraft, airlines, 1026, 'DAL228').command, 'DAL228 A 14000');
    assert.equal(hear('Delta 228 climbin and maintain one one thousand').command, 'DAL228 A 11000');
});

test('expedite or immediately marks a transmission to be carried out at once', () => {
    assert.equal(hear('Delta 228 expedite descend and maintain four thousand').command, 'DAL228 XP A 4000');
    assert.equal(hear('Delta 228 descend and maintain four thousand expedite').command, 'DAL228 XP A 4000');
    assert.equal(hear('Delta 228 turn left immediately heading two four zero').command, 'DAL228 XP TL 240');
    assert.equal(hear('Delta 228 expedite your descent').command, 'DAL228 XP');
    assert.equal(choose(['expedite climb'], aircraft, airlines, 1026, 'AAL101').command, 'AAL101 XP');
    assert.equal(choose(['expedite your descent'], aircraft, airlines, 1026, 'AAL101').command, 'AAL101 XP');
    assert.equal(choose(['expedite climb and maintain one one thousand'], aircraft, airlines, 1026, 'AAL101').command, 'AAL101 XP A 11000');
    assert.equal(hear('Delta 228 descend and maintain four thousand').command, 'DAL228 A 4000');
});

test('line up and wait phrases', () => {
    assert.equal(hear('Delta 228 runway two seven line up and wait').command, 'DAL228 LUAW');
    assert.equal(hear('Delta 228 line up and wait runway two seven').command, 'DAL228 LUAW');
    assert.equal(hear('Delta 228 position and hold').command, 'DAL228 LUAW');
    assert.equal(choose(['lineup and wait'], aircraft, airlines, 1026, 'AAL101').command, 'AAL101 LUAW');
});

test('Detroit runway names', () => {
    assert.equal(hear('Delta 228 cleared ILS runway two two right').command, 'DAL228 L 22R');
    assert.equal(hear('Delta 228 cleared ILS runway two one left').command, 'DAL228 L 21L');
    assert.equal(hear('Delta 228 expect runway zero three right').command, 'DAL228 EXP 03R');
    assert.equal(hear('Delta 228 cleared ILS runway four left').command, 'DAL228 L 04L');
});

test('holding instructions', () => {
    assert.equal(hear('Delta 228 hold at chopper').command, 'DAL228 HOLD CHOPPER');
    assert.equal(hear('Delta 228 hold northeast of chopper left turns').command, 'DAL228 HOLD CHOPPER NE LT');
    assert.equal(hear('Delta 228 hold north east of chopper as published').command, 'DAL228 HOLD CHOPPER NE');
    assert.equal(hear('Delta 228 hold over Rome VOR right turns').command, 'DAL228 HOLD ROME');
    assert.equal(hear('Delta 228 descend and maintain eight thousand hold at chopper').command, 'DAL228 A 8000 HOLD CHOPPER');
    assert.equal(hear('Delta 228 runway two seven position and hold').command, 'DAL228 LUAW');
});
