/* Separation checks and short-term conflict prediction in local nautical-mile coordinates. */
(function (root) {
    'use strict';

    const radians = degrees => degrees * Math.PI / 180;
    /* Airliner performance. climbFpm is the climb rate near sea level, falling off 2.5% per 1,000 ft;
       rotateKt is liftoff; initialClimbKt (about V2 + 15) is flown to 1,000 ft above the field;
       takeoffAccel is knots per second on the takeoff roll. */
    const PERFORMANCE = {
        regional: { climbFpm: 3000, rotateKt: 135, initialClimbKt: 160, takeoffAccel: 4.2 },
        narrowbody: { climbFpm: 3000, rotateKt: 145, initialClimbKt: 165, takeoffAccel: 4.0 },
        b757: { climbFpm: 3800, rotateKt: 140, initialClimbKt: 160, takeoffAccel: 4.5 },
        widebody: { climbFpm: 2500, rotateKt: 155, initialClimbKt: 175, takeoffAccel: 3.4 },
        jumbo: { climbFpm: 2200, rotateKt: 165, initialClimbKt: 180, takeoffAccel: 3.0 }
    };
    const TYPE_CLASS = {
        B717: 'regional', E170: 'regional', E175: 'regional', E190: 'regional', CRJ7: 'regional', CRJ9: 'regional',
        B752: 'b757', B753: 'b757',
        A300: 'widebody', A333: 'widebody', A343: 'widebody', A359: 'widebody', B763: 'widebody', B764: 'widebody',
        B772: 'widebody', B77L: 'widebody', B77W: 'widebody', B789: 'widebody', MD11: 'widebody',
        B748: 'jumbo', A388: 'jumbo'
    };
    const EMERGENCY_DESCENT_FPM = 5000;

    function performanceFor(type) {
        return PERFORMANCE[TYPE_CLASS[type] || 'narrowbody'];
    }

    /* Climb or descent rate right now. Idle descents run about 1,400 ft/min near the ground and 1,700 at
       10,000 ft (roughly the 3-to-1 path at 250 kt). Expediting adds 25% to a climb and 60% to a descent
       (speedbrakes). Changing speed takes energy: accelerating flattens a climb, slowing flattens a descent. */
    function verticalRateFpm(plane) {
        const perf = plane.performance || PERFORMANCE.narrowbody;
        const climbing = (plane.targetAltitude ?? plane.altitude) > plane.altitude;
        const thousands = Math.max(0, plane.altitude) / 1000;
        const emergency = plane.emergency || {};
        if (!climbing && emergency.descendTo) return EMERGENCY_DESCENT_FPM;
        let rate = climbing ? perf.climbFpm * (1 - 0.025 * thousands) : 1400 + 30 * thousands;
        if (climbing && emergency.climbFactor) rate *= emergency.climbFactor;
        if (plane.expediteVertical) rate *= climbing ? 1.25 : 1.6;
        const speedChange = (plane.targetSpeed ?? plane.speed) - plane.speed;
        if (climbing && speedChange > 5) rate *= 0.6;
        if (!climbing && speedChange < -5 && !plane.ilsCaptured) rate *= plane.expediteVertical ? 0.75 : 0.5;
        return rate;
    }
    const PARALLEL_FINAL_NM = 2.5; // FAA in-trail minimum for aircraft established on the same final.

    const velocity = (heading, knots) => ({
        east: Math.sin(radians(heading)) * knots / 60,
        north: Math.cos(radians(heading)) * knots / 60
    });

    function offsetNM(from, to) {
        return {
            east: (to.lon - from.lon) * 60 * Math.cos(radians((from.lat + to.lat) / 2)),
            north: (to.lat - from.lat) * 60
        };
    }

    function distanceNM(a, b) {
        const offset = offsetNM(a, b);
        return Math.hypot(offset.east, offset.north);
    }

    /* Position against a runway threshold and its landing course (threshold.heading): along is NM out on
       the final (negative once past the threshold); cross is NM right of the centerline, looking down the runway. */
    function localizerOffset(position, threshold) {
        const { east, north } = offsetNM(threshold, position);
        const course = radians(threshold.heading);
        return {
            along: -(east * Math.sin(course) + north * Math.cos(course)),
            cross: east * Math.cos(course) - north * Math.sin(course)
        };
    }

    function altitudeAfter(plane, minutes, climbFpm = verticalRateFpm(plane)) {
        const target = plane.targetAltitude ?? plane.altitude;
        const change = Math.min(Math.abs(target - plane.altitude), climbFpm * minutes);
        return plane.altitude + Math.sign(target - plane.altitude) * change;
    }

    function runwayOf(plane) {
        if (plane.ilsCaptured) return plane.clearedRunway;
        return plane.isArrival ? null : plane.departureRunway || null;
    }

    function inTrafficArea(plane, airport) {
        return distanceNM(plane, airport) < 6 && plane.altitude - airport.elevation < 3000;
    }

    /* Returns the minimum that applies to a pair, or null when radar separation does not apply. */
    function separationFor(a, b, standard, airport) {
        if (a.onGround || b.onGround) return null;
        if (a.ilsCaptured && b.ilsCaptured) {
            // Simultaneous parallel approaches are separated by the localizers themselves.
            if (a.clearedRunway !== b.clearedRunway) return null;
            return { lateralNM: Math.min(standard.lateralNM, PARALLEL_FINAL_NM), verticalFt: standard.verticalFt };
        }
        // Near the field, tower runway rules separate departures from approaches.
        if (airport && runwayOf(a) && runwayOf(b) && inTrafficArea(a, airport) && inTrafficArea(b, airport)) return null;
        return standard;
    }

    /* First time within the horizon that the pair is inside the minimum, flying straight. */
    function predictLoss(a, b, minimum, horizonMinutes = 2, stepMinutes = 1 / 12) {
        const start = offsetNM(a, b);
        const va = velocity(a.heading, a.onGround ? 0 : a.speed);
        const vb = velocity(b.heading, b.onGround ? 0 : b.speed);
        for (let t = 0; t <= horizonMinutes + 1e-9; t += stepMinutes) {
            const lateralNM = Math.hypot(start.east + (vb.east - va.east) * t, start.north + (vb.north - va.north) * t);
            const verticalFt = Math.abs(altitudeAfter(b, t) - altitudeAfter(a, t));
            if (lateralNM < minimum.lateralNM && verticalFt < minimum.verticalFt) {
                return { timeMinutes: t, lateralNM, verticalFt };
            }
        }
        return null;
    }

    function findConflicts(aircraft, standard, airport, horizonMinutes = 2) {
        const losses = [], predicted = [];
        for (let i = 0; i < aircraft.length; i++) {
            for (let j = i + 1; j < aircraft.length; j++) {
                const a = aircraft[i], b = aircraft[j];
                const minimum = separationFor(a, b, standard, airport);
                if (!minimum) continue;
                const loss = predictLoss(a, b, minimum, horizonMinutes);
                if (!loss) continue;
                (loss.timeMinutes === 0 ? losses : predicted).push({ a, b, ...loss });
            }
        }
        return { losses, predicted };
    }

    /* A new arrival must start well clear of everyone and not be on a short collision course:
       no closer than predictLateralNM at any altitude for the first few minutes, and not inside
       that distance within verticalFt for the full horizon. */
    function entryIsClear(candidate, aircraft, options = {}) {
        const { minLateralNM = 8, predictLateralNM = 5, verticalFt = 1000, closeMinutes = 3, horizonMinutes = 5 } = options;
        return aircraft.every(other => {
            if (other.onGround) return true;
            if (distanceNM(candidate, other) < minLateralNM) return false;
            if (predictLoss(candidate, other, { lateralNM: predictLateralNM, verticalFt: Infinity }, closeMinutes, 0.25)) return false;
            return !predictLoss(candidate, other, { lateralNM: predictLateralNM, verticalFt }, horizonMinutes, 0.25);
        });
    }

    root.ATCTraffic = { offsetNM, distanceNM, localizerOffset, performanceFor, verticalRateFpm, altitudeAfter, separationFor, predictLoss, findConflicts, entryIsClear };
    if (typeof module !== 'undefined') module.exports = root.ATCTraffic;
})(typeof window !== 'undefined' ? window : globalThis);
