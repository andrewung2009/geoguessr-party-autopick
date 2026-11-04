'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeMaps } = require('../src/config');

test('normalizeMaps trims and dedupes fields', () => {
  const result = normalizeMaps([
    {
      shorthand: '  comp  ',
      geoguessrName: '  A Competitive World ',
      mapId: ' 668ea3252973190af74233b5 ',
      aliases: [' comp ', 'comp', '', 'competitive'],
      weight: '10',
      note: ' hello '
    }
  ]);

  assert.deepEqual(result, [
    {
      shorthand: 'comp',
      geoguessrName: 'A Competitive World',
      mapId: '668ea3252973190af74233b5',
      defaultMode: '',
      aliases: ['comp', 'competitive'],
      weight: 10,
      note: 'hello'
    }
  ]);
});

test('normalizeMaps accepts valid default modes', () => {
  const result = normalizeMaps([
    { shorthand: 'a', geoguessrName: 'A', mapId: '', defaultMode: 'move', aliases: [], weight: 1 },
    { shorthand: 'b', geoguessrName: 'B', mapId: '', defaultMode: 'NMPZ', aliases: [], weight: 1 },
    { shorthand: 'c', geoguessrName: 'C', mapId: '', defaultMode: 'nonsense', aliases: [], weight: 1 }
  ]);

  assert.equal(result[0].defaultMode, 'move');
  assert.equal(result[1].defaultMode, 'nmpz');
  assert.equal(result[2].defaultMode, '');
});

test('normalizeMaps accepts aliases as a comma string', () => {
  const result = normalizeMaps([
    { shorthand: 'x', geoguessrName: 'X', mapId: '', aliases: 'one, two, one', weight: 0 }
  ]);

  assert.deepEqual(result[0].aliases, ['one', 'two']);
  assert.equal(result[0].weight, 1);
});

test('normalizeMaps rejects duplicate shorthands', () => {
  assert.throws(
    () =>
      normalizeMaps([
        { shorthand: 'comp', geoguessrName: 'A', mapId: '', aliases: [] },
        { shorthand: 'COMP', geoguessrName: 'B', mapId: '', aliases: [] }
      ]),
    /Duplicate shorthand/
  );
});

test('normalizeMaps rejects missing shorthand', () => {
  assert.throws(() => normalizeMaps([{ geoguessrName: 'A' }]), /missing a shorthand/);
});

test('normalizeMaps rejects an empty list', () => {
  assert.throws(() => normalizeMaps([]), /non-empty array/);
});
