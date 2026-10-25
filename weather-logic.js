/* Small local-coordinate weather calculations for radar and pilot requests. */
(function (root) {
    'use strict';

    const radians = degrees => degrees * Math.PI / 180;
    const velocity = (heading, knots) => ({
        east: Math.sin(radians(heading)) * knots / 60,
        north: Math.cos(radians(heading)) * knots / 60
    });
    const relativePosition = (plane, storm) => ({
        east: (storm.lon - plane.lon) * 60 * Math.cos(radians(plane.lat)),
        north: (storm.lat - plane.lat) * 60
    });

    function closestApproach(plane, storm, heading = plane.heading, horizonMinutes = 4) {
        const p = relativePosition(plane, storm);
        const aircraft = velocity(heading, plane.speed);
        const drift = velocity(storm.driftBearing || 0, storm.driftSpeedKts || 0);
        const vx = drift.east - aircraft.east;
        const vy = drift.north - aircraft.north;
        const speedSquared = vx * vx + vy * vy;
        const rawTime = speedSquared ? -(p.east * vx + p.north * vy) / speedSquared : 0;
        const timeMinutes = Math.max(0, Math.min(horizonMinutes, rawTime));
        return {
            distanceNM: Math.hypot(p.east + vx * timeMinutes, p.north + vy * timeMinutes),
            timeMinutes,
            currentDistanceNM: Math.hypot(p.east, p.north),
            aheadNM: p.east * Math.sin(radians(plane.heading)) + p.north * Math.cos(radians(plane.heading))
        };
    }

    function pathClearance(plane, storms, direction, horizonMinutes = 4) {
        const sign = direction === 'right' ? 1 : -1;
        const step = 0.25;
        const positions = storms.map(storm => ({
            storm,
            offset: relativePosition(plane, storm),
            drift: velocity(storm.driftBearing || 0, storm.driftSpeedKts || 0)
        }));
        let east = 0, north = 0, lowestClearance = Infinity;
        for (let elapsed = step; elapsed <= horizonMinutes; elapsed += step) {
            const heading = plane.heading + sign * Math.min(45, (elapsed - step / 2) * 90);
            const motion = velocity(heading, plane.speed);
            east += motion.east * step;
            north += motion.north * step;
            for (const { storm, offset, drift } of positions) {
                const stormEast = offset.east + drift.east * elapsed;
                const stormNorth = offset.north + drift.north * elapsed;
                const clearance = Math.hypot(stormEast - east, stormNorth - north) - storm.radiusNM - 3;
                lowestClearance = Math.min(lowestClearance, clearance);
            }
        }
        return lowestClearance;
    }

    function chooseDeviation(plane, storms) {
        const severe = (storms || []).filter(storm => storm.severity >= 3);
        const hazards = severe.map(storm => ({ storm, approach: closestApproach(plane, storm) }))
            .filter(({ storm, approach }) =>
                approach.aheadNM > -storm.radiusNM &&
                approach.distanceNM < storm.radiusNM + 5 &&
                (approach.timeMinutes > 0.1 || approach.currentDistanceNM < storm.radiusNM + 2));
        if (!hazards.length) return null;
        hazards.sort((a, b) => a.approach.timeMinutes - b.approach.timeMinutes);
        const left = pathClearance(plane, severe, 'left');
        const right = pathClearance(plane, severe, 'right');
        let direction = null;
        if (Math.max(left, right) >= 0) {
            if (Math.abs(left - right) < 0.5) {
                const offset = relativePosition(plane, hazards[0].storm);
                const stormOnRight = offset.east * Math.cos(radians(plane.heading)) -
                    offset.north * Math.sin(radians(plane.heading)) > 0;
                direction = stormOnRight ? 'left' : 'right';
            } else direction = left > right ? 'left' : 'right';
        }
        const heading = direction === null ? null :
            (Math.round(plane.heading + (direction === 'right' ? 45 : -45)) + 360) % 360;
        return { direction, heading, leftClearanceNM: left, rightClearanceNM: right };
    }

    root.ATCWeather = { closestApproach, pathClearance, chooseDeviation };
    if (typeof module !== 'undefined') module.exports = root.ATCWeather;
})(typeof window !== 'undefined' ? window : globalThis);
