/* Top-down aircraft silhouettes drawn from each type's real dimensions and engine layout. */
(function (root) {
    'use strict';

    // Dimensions in metres. engines: 'wing2', 'wing4', 'tail2' (rear fuselage) or 'tri' (two wing, one in the fin).
    const SPECS = {
        CRJ7: { length: 32.5, span: 23.2, sweep: 26, body: 2.7, engines: 'tail2', tTail: true, nacelle: 1.4 },
        CRJ9: { length: 36.4, span: 24.9, sweep: 26, body: 2.7, engines: 'tail2', tTail: true, nacelle: 1.4 },
        B717: { length: 37.8, span: 28.4, sweep: 24.5, body: 3.3, engines: 'tail2', tTail: true, nacelle: 1.7 },
        E75L: { length: 31.7, span: 28.7, sweep: 23, body: 3.0, engines: 'wing2', nacelle: 1.6 },
        E190: { length: 36.2, span: 28.7, sweep: 23, body: 3.0, engines: 'wing2', nacelle: 1.7 },
        E295: { length: 41.5, span: 35.1, sweep: 23, body: 3.0, engines: 'wing2', nacelle: 2.0 },
        A319: { length: 33.8, span: 35.8, sweep: 25, body: 3.95, engines: 'wing2', nacelle: 2.0 },
        A320: { length: 37.6, span: 35.8, sweep: 25, body: 3.95, engines: 'wing2', nacelle: 2.0 },
        A321: { length: 44.5, span: 35.8, sweep: 25, body: 3.95, engines: 'wing2', nacelle: 2.0 },
        A20N: { length: 37.6, span: 35.8, sweep: 25, body: 3.95, engines: 'wing2', nacelle: 2.4 },
        A21N: { length: 44.5, span: 35.8, sweep: 25, body: 3.95, engines: 'wing2', nacelle: 2.4 },
        B737: { length: 33.6, span: 35.8, sweep: 25, body: 3.76, engines: 'wing2', nacelle: 1.9 },
        B738: { length: 39.5, span: 35.8, sweep: 25, body: 3.76, engines: 'wing2', nacelle: 1.9 },
        B739: { length: 42.1, span: 35.8, sweep: 25, body: 3.76, engines: 'wing2', nacelle: 1.9 },
        B38M: { length: 39.5, span: 35.9, sweep: 25, body: 3.76, engines: 'wing2', nacelle: 2.1 },
        B39M: { length: 42.2, span: 35.9, sweep: 25, body: 3.76, engines: 'wing2', nacelle: 2.1 },
        B752: { length: 47.3, span: 38.1, sweep: 25, body: 3.76, engines: 'wing2', nacelle: 2.3 },
        A300: { length: 54.1, span: 44.8, sweep: 28, body: 5.64, engines: 'wing2', nacelle: 2.7 },
        B763: { length: 54.9, span: 47.6, sweep: 31.5, body: 5.03, engines: 'wing2', nacelle: 2.8 },
        B764: { length: 61.4, span: 51.9, sweep: 31.5, body: 5.03, engines: 'wing2', nacelle: 2.8 },
        A332: { length: 58.8, span: 60.3, sweep: 30, body: 5.64, engines: 'wing2', nacelle: 3.0 },
        A333: { length: 63.7, span: 60.3, sweep: 30, body: 5.64, engines: 'wing2', nacelle: 3.0 },
        A339: { length: 63.7, span: 64.0, sweep: 30, body: 5.64, engines: 'wing2', nacelle: 3.4 },
        A359: { length: 66.8, span: 64.8, sweep: 31.9, body: 5.96, engines: 'wing2', nacelle: 3.3 },
        B772: { length: 63.7, span: 60.9, sweep: 31.6, body: 6.19, engines: 'wing2', nacelle: 3.6 },
        B77L: { length: 63.7, span: 64.8, sweep: 31.6, body: 6.19, engines: 'wing2', nacelle: 3.9 },
        B77W: { length: 73.9, span: 64.8, sweep: 31.6, body: 6.19, engines: 'wing2', nacelle: 3.9 },
        B789: { length: 62.8, span: 60.1, sweep: 32.2, body: 5.77, engines: 'wing2', nacelle: 3.3 },
        B78X: { length: 68.3, span: 60.1, sweep: 32.2, body: 5.77, engines: 'wing2', nacelle: 3.3 },
        MD11: { length: 61.6, span: 51.7, sweep: 35, body: 6.02, engines: 'tri', nacelle: 2.9 },
        A343: { length: 63.6, span: 60.3, sweep: 30, body: 5.64, engines: 'wing4', nacelle: 2.3 },
        B744: { length: 70.7, span: 64.4, sweep: 37.5, body: 6.5, engines: 'wing4', nacelle: 2.6 },
        B748: { length: 76.3, span: 68.4, sweep: 37.5, body: 6.5, engines: 'wing4', nacelle: 3.0 },
        A388: { length: 72.7, span: 79.8, sweep: 33.5, body: 7.14, engines: 'wing4', nacelle: 3.0 }
    };
    const FALLBACK = 'A320';
    const BOX = 64;

    function specFor(type) {
        return SPECS[type] || SPECS[FALLBACK];
    }

    // Shapes are built around the aircraft's centre; points are written offset into the box.
    const point = (x, y) => `${(x + BOX / 2).toFixed(2)} ${(y + BOX / 2).toFixed(2)}`;
    const polygon = points => `M${points.map(([x, y]) => point(x, y)).join(' L')} Z`;
    const ellipse = (cx, cy, rx, ry) =>
        `M${point(cx - rx, cy)} A${rx.toFixed(2)} ${ry.toFixed(2)} 0 1 0 ${point(cx + rx, cy)} A${rx.toFixed(2)} ${ry.toFixed(2)} 0 1 0 ${point(cx - rx, cy)} Z`;
    const mirrored = points => [points, points.map(([x, y]) => [-x, y])];

    /* SVG path, nose up, centred in a 64-unit box. */
    function pathFor(type) {
        const s = specFor(type);
        const scale = (BOX - 4) / Math.max(s.length, s.span);
        const L = s.length * scale, half = s.span * scale / 2, w = s.body * scale / 2;
        const nose = -L / 2, tail = L / 2;
        const tan = Math.tan(s.sweep * Math.PI / 180);
        const shapes = [];

        // Fuselage: rounded nose, straight cabin, tapering tail cone.
        const noseLength = Math.min(L * 0.12, w * 3.2);
        const taperStart = tail - L * 0.22;
        shapes.push([`M${point(0, nose)}`,
            `Q${point(w, nose)} ${point(w, nose + noseLength)}`,
            `L${point(w, taperStart)} L${point(w * 0.3, tail)} L${point(-w * 0.3, tail)} L${point(-w, taperStart)}`,
            `L${point(-w, nose + noseLength)} Q${point(-w, nose)} ${point(0, nose)} Z`].join(' '));

        // Main wing: rear-engined jets carry the wing further aft.
        const rootLE = nose + L * (s.engines === 'tail2' ? 0.47 : 0.38);
        const rootChord = L * 0.17;
        const tipLE = rootLE + (half - w) * tan;
        const tipChord = rootChord * 0.28;
        const wingLE = x => rootLE + (Math.abs(x) - w) * tan;
        mirrored([[w, rootLE], [half, tipLE], [half, tipLE + tipChord], [w, rootLE + rootChord]])
            .forEach(points => shapes.push(polygon(points)));

        // Horizontal stabiliser; a T-tail sits at the top of the fin, aft of the fuselage end.
        const stabHalf = half * (s.tTail ? 0.4 : 0.34);
        const stabRoot = tail - L * (s.tTail ? 0.1 : 0.15);
        const stabChord = L * 0.09;
        const stabTan = Math.tan((s.sweep + 6) * Math.PI / 180);
        mirrored([[w * 0.4, stabRoot], [stabHalf, stabRoot + stabHalf * stabTan * 0.9], [stabHalf, stabRoot + stabHalf * stabTan * 0.9 + stabChord * 0.45], [w * 0.4, stabRoot + stabChord]])
            .forEach(points => shapes.push(polygon(points)));

        // Engines.
        const podLength = s.nacelle * scale * 2.1, podRadius = s.nacelle * scale / 2;
        const wingPod = fraction => {
            const x = w + (half - w) * fraction;
            const cy = wingLE(x) - podLength * 0.2;
            shapes.push(ellipse(x, cy, podRadius, podLength / 2), ellipse(-x, cy, podRadius, podLength / 2));
        };
        if (s.engines === 'wing2' || s.engines === 'tri') wingPod(0.32);
        if (s.engines === 'wing4') { wingPod(0.27); wingPod(0.6); }
        if (s.engines === 'tail2') {
            const cy = stabRoot - podLength * 0.55;
            shapes.push(ellipse(w + podRadius * 1.1, cy, podRadius, podLength / 2), ellipse(-w - podRadius * 1.1, cy, podRadius, podLength / 2));
        }
        if (s.engines === 'tri') shapes.push(ellipse(0, stabRoot - podLength * 0.1, podRadius * 1.05, podLength * 0.55));

        return shapes.join(' ');
    }

    /* On-screen size in pixels, proportional to the real aircraft but kept readable. */
    function screenSize(type) {
        const s = specFor(type);
        return Math.round(Math.min(38, Math.max(18, Math.max(s.length, s.span) * 0.42 + 5)));
    }

    function engineCount(type) {
        return { wing2: 2, tail2: 2, tri: 3, wing4: 4 }[specFor(type).engines];
    }

    root.ATCAircraftIcons = { SPECS, specFor, pathFor, screenSize, engineCount };
    if (typeof module !== 'undefined') module.exports = root.ATCAircraftIcons;
})(typeof window !== 'undefined' ? window : globalThis);
