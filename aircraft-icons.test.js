const test = require('node:test');
const assert = require('node:assert/strict');
const icons = require('./aircraft-icons');

const coordinates = path => [...path.matchAll(/[MLQ]\s*([\d.-]+) ([\d.-]+)(?:\s+([\d.-]+) ([\d.-]+))?/g)]
    .flatMap(m => [[+m[1], +m[2]], ...(m[3] ? [[+m[3], +m[4]]] : [])]);

test('every simulator type has real dimensions and a silhouette inside the icon box', () => {
    const simTypes = ['B717', 'E190', 'CRJ7', 'CRJ9', 'B737', 'B738', 'B739', 'B38M', 'A319', 'A320', 'A321', 'B752',
        'B763', 'B764', 'B772', 'B77W', 'B77L', 'B789', 'A333', 'A343', 'A359', 'MD11', 'A300', 'B748', 'A388'];
    for (const type of simTypes) {
        assert.ok(icons.SPECS[type], type);
        const points = coordinates(icons.pathFor(type));
        assert.ok(points.length > 20, type);
        assert.ok(points.every(([x, y]) => x >= 0 && x <= 64 && y >= 0 && y <= 64), `${type} stays in the box`);
    }
});

test('engine layouts match the real aircraft', () => {
    assert.equal(icons.engineCount('B748'), 4);
    assert.equal(icons.engineCount('A388'), 4);
    assert.equal(icons.engineCount('A343'), 4);
    assert.equal(icons.engineCount('MD11'), 3);
    assert.equal(icons.specFor('B717').engines, 'tail2');
    assert.equal(icons.specFor('CRJ9').tTail, true);
    assert.equal(icons.engineCount('B738'), 2);
});

test('bigger aircraft draw bigger, within readable limits', () => {
    assert.ok(icons.screenSize('A388') > icons.screenSize('B772'));
    assert.ok(icons.screenSize('B772') > icons.screenSize('A320'));
    assert.ok(icons.screenSize('A320') > icons.screenSize('CRJ7'));
    assert.ok(icons.screenSize('CRJ7') >= 18 && icons.screenSize('A388') <= 38);
});

test('unknown types fall back to an A320 shape', () => {
    assert.equal(icons.pathFor('ZZZZ'), icons.pathFor('A320'));
});
