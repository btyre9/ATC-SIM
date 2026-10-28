/* In-flight emergencies: when one may happen, which kinds fit an aircraft, and what the pilot says. */
(function (root) {
    'use strict';

    const MIN_GAP_SEC = 3 * 3600;        // Never more than one in three hours of play.
    const SHIFT_SETTLE_SEC = 10 * 60;    // Not in the first ten minutes of a shift.
    const MEAN_WAIT_SEC = 2 * 3600;      // Once allowed, about two more hours on average.
    const CHECK_EVERY_SEC = 60;

    /* Each kind: who it can happen to, what the pilot reports and asks for, and how the aircraft changes.
       climbFactor slows climbs (engine out); maxSpeed caps speed; finalSpeed is a faster final approach;
       descendTo is an emergency descent; closesRunwaySec leaves the aircraft disabled on the runway. */
    const TYPES = {
        ENGINE: { tag: 'ENG', label: 'Engine failure', mayday: true, phases: ['departure', 'arrival'],
            problem: 'engine failure', climbFactor: 0.45, maxSpeed: 210 },
        BIRDS: { tag: 'BIRD', label: 'Bird strike', mayday: true, phases: ['departure'], maxAltitude: 5000,
            problem: 'bird strike, lost the left engine', climbFactor: 0.45, maxSpeed: 210 },
        SMOKE: { tag: 'SMOKE', label: 'Smoke in the cabin', mayday: true, phases: ['departure', 'arrival'],
            problem: 'smoke in the cabin', request: 'immediate landing' },
        HYDRAULIC: { tag: 'HYD', label: 'Hydraulic failure', mayday: true, phases: ['arrival'],
            problem: 'hydraulic failure, no nosewheel steering, we will stop on the runway', finalSpeed: 165, closesRunwaySec: 8 * 60 },
        FUEL: { tag: 'FUEL', label: 'Emergency fuel', mayday: true, phases: ['arrival'], fuelMinutes: [18, 26],
            problem: 'emergency fuel', request: 'direct to the field, the shortest approach available' },
        PRESSURE: { tag: 'PRESS', label: 'Loss of pressurization', mayday: true, phases: ['departure', 'arrival'], minAltitude: 11000,
            problem: 'loss of cabin pressure, emergency descent to one zero thousand', descendTo: 10000 },
        MEDICAL: { tag: 'MED', label: 'Medical emergency', mayday: false, phases: ['arrival'],
            problem: 'medical emergency on board, passenger with chest pains', request: 'priority handling, medical crew to meet the aircraft' }
    };

    // Typical seats filled for each type; cargo jets carry a crew of two to four.
    const SEATS = { B717: 110, E190: 97, A319: 126, A320: 150, A321: 190, B737: 143, B738: 166, B739: 178, B38M: 172,
        B752: 192, B763: 211, B764: 238, A300: 220, A333: 282, A359: 306, B772: 273, B77W: 340, B789: 285, MD11: 260, A343: 270 };
    const CARGO = new Set(['FDX', 'UPS']);

    function mayDeclare({ enabled, playSeconds, lastEmergencyAt, shiftSeconds, active }) {
        if (!enabled || active || shiftSeconds < SHIFT_SETTLE_SEC) return false;
        return lastEmergencyAt === null || playSeconds - lastEmergencyAt >= MIN_GAP_SEC;
    }

    // Chance per check that makes the wait after the three-hour gap average MEAN_WAIT_SEC.
    const CHANCE_PER_CHECK = 1 - Math.exp(-CHECK_EVERY_SEC / MEAN_WAIT_SEC);

    function phaseOf(plane) {
        return plane.isArrival ? 'arrival' : 'departure';
    }

    function typesFor(plane) {
        return Object.entries(TYPES).filter(([, type]) => type.phases.includes(phaseOf(plane)) &&
            (type.minAltitude === undefined || plane.altitude >= type.minAltitude) &&
            (type.maxAltitude === undefined || plane.altitude <= type.maxAltitude))
            .map(([key]) => key);
    }

    function pick(list, random) {
        return list[Math.floor(random() * list.length)];
    }

    // An aircraft on your frequency and in your airspace, not about to land or already gone.
    function choose(candidates, random = Math.random) {
        const options = candidates.flatMap(plane => typesFor(plane)
            .filter(key => !(key === 'MEDICAL' && CARGO.has(plane.id.slice(0, 3))))
            .map(key => ({ plane, key })));
        return options.length ? pick(options, random) : null;
    }

    function soulsOnBoard(plane, random = Math.random) {
        if (CARGO.has(plane.id.slice(0, 3))) return 2 + Math.floor(random() * 3);
        const seats = SEATS[plane.type] || 150;
        return Math.round(seats * (0.78 + random() * 0.2));
    }

    function fuelMinutes(plane, key, random = Math.random) {
        const range = TYPES[key].fuelMinutes || (plane.isArrival ? [50, 95] : [150, 330]);
        return Math.round((range[0] + random() * (range[1] - range[0])) / 5) * 5;
    }

    const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
        'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];
    function numberWords(n) {
        if (n < 20) return WORDS[n];
        return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${WORDS[n % 10]}` : '');
    }

    // "One hour thirty minutes", "two hours", "twenty five minutes".
    function spokenDuration(minutes) {
        const hours = Math.floor(minutes / 60), rest = minutes % 60;
        const parts = [];
        if (hours) parts.push(`${numberWords(hours)} hour${hours > 1 ? 's' : ''}`);
        if (rest || !hours) parts.push(`${numberWords(rest)} minutes`);
        return parts.join(' ');
    }

    /* The declaration, in the order pilots give it: who, the problem, intentions, souls and fuel. */
    function declaration({ key, facility, callsign, runway, souls, fuel, returning }) {
        const type = TYPES[key];
        const opening = type.mayday ? 'Mayday, mayday, mayday' : 'Pan-pan, pan-pan, pan-pan';
        const request = type.request ? `request ${type.request}` :
            returning ? `request immediate return, runway ${runway}` : `request the approach to runway ${runway}`;
        return `${opening}, ${facility}, ${callsign}, ${type.problem}, ${request}. ${souls} souls on board, fuel remaining ${spokenDuration(fuel)}.`;
    }

    const api = { TYPES, MIN_GAP_SEC, SHIFT_SETTLE_SEC, MEAN_WAIT_SEC, CHECK_EVERY_SEC, CHANCE_PER_CHECK,
        mayDeclare, typesFor, choose, soulsOnBoard, fuelMinutes, spokenDuration, declaration };
    root.ATCEmergency = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
