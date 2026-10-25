/* Separation checks and short-term conflict prediction in local nautical-mile coordinates. */
(function (root) {
    'use strict';

    const radians = degrees => degrees * Math.PI / 180;
    const CLIMB_FPM = 2100; // Matches the simulator's 35 ft per second climb and descent rate.
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

    function altitudeAfter(plane, minutes, climbFpm = CLIMB_FPM) {
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

    root.ATCTraffic = { offsetNM, distanceNM, altitudeAfter, separationFor, predictLoss, findConflicts, entryIsClear };
    if (typeof module !== 'undefined') module.exports = root.ATCTraffic;
})(typeof window !== 'undefined' ? window : globalThis);
