'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCommand,
  buildMapIndex,
  resolveMap,
  pickSearchResult,
  weightedRandomMap,
  modeFlags,
  normalize
} = require('../src/parser');
const { loadMaps } = require('../src/config');

const maps = loadMaps();
const index = buildMapIndex(maps);

test('normalize strips punctuation and lowercases', () => {
  assert.equal(normalize('  A  Competitive & World! '), 'a competitive and world');
});

test('parses map + mode', () => {
  const result = parseCommand('comp NM');
  assert.equal(result.mapQuery, 'comp');
  assert.equal(result.mode, 'nm');
});

test('parses map only', () => {
  const result = parseCommand('comp');
  assert.equal(result.mapQuery, 'comp');
  assert.equal(result.mode, null);
});

test('parses mode only', () => {
  const result = parseCommand('NM');
  assert.equal(result.mapQuery, null);
  assert.equal(result.mode, 'nm');
});

test('parses multi-word map and mode', () => {
  const result = parseCommand('A Competitive World NMPZ');
  assert.equal(result.mapQuery, 'a competitive world');
  assert.equal(result.mode, 'nmpz');
});

test('parses no move as one mode', () => {
  const result = parseCommand('comp no move');
  assert.equal(result.mapQuery, 'comp');
  assert.equal(result.mode, 'nm');
});

test('does not treat a normal word as a mode', () => {
  const result = parseCommand('comp random');
  assert.equal(result.mapQuery, 'comp random');
  assert.equal(result.mode, null);
});

test('rejects empty input', () => {
  assert.equal(parseCommand('   ').error, 'The message is empty.');
});

test('resolves common aliases', () => {
  assert.equal(resolveMap('comp', index).map.geoguessrName, 'A Competitive World');
  assert.equal(resolveMap('acw', index).map.geoguessrName, 'A Community World');
  assert.equal(resolveMap('aarw', index).map.geoguessrName, 'An Arbitrary Rural World');
  assert.equal(resolveMap('world', index).map.geoguessrName, 'World');
  assert.equal(resolveMap('usa', index).map.geoguessrName, 'USA');
  assert.equal(resolveMap('amw', index).map.geoguessrName, 'A Moving World');
});

test('resolves a word from the full name', () => {
  const result = resolveMap('moving', index);
  assert.equal(result.map.geoguessrName, 'A Moving World');
});

test('reports unknown maps', () => {
  const result = resolveMap('this map does not exist xyz', index);
  assert.equal(result.map, null);
  assert.equal(result.reason, 'not-found');
});

test('reports ambiguous short queries', () => {
  const result = resolveMap('a', index);
  assert.equal(result.map, null);
  assert.equal(result.reason, 'ambiguous');
});

test('picks exact search results first', () => {
  const picked = pickSearchResult('A Competitive World', [
    { id: '1', name: 'A Competitive World 2', likes: 100 },
    { id: '2', name: 'A Competitive World', likes: 5 }
  ]);
  assert.equal(picked.result.id, '2');
});

test('picks the only result when nothing matches', () => {
  const picked = pickSearchResult('something else', [{ id: '9', name: 'Different Map' }]);
  assert.equal(picked.result.id, '9');
});

test('returns candidates for multiple weak matches', () => {
  const picked = pickSearchResult('something', [
    { id: '1', name: 'Alpha' },
    { id: '2', name: 'Beta' }
  ]);
  assert.equal(picked.result, null);
  assert.equal(picked.candidates.length, 2);
});

test('mode flags match GeoGuessr settings', () => {
  assert.deepEqual(modeFlags('move'), {
    forbidMoving: false,
    forbidZooming: false,
    forbidRotating: false
  });
  assert.deepEqual(modeFlags('nm'), {
    forbidMoving: true,
    forbidZooming: false,
    forbidRotating: false
  });
  assert.deepEqual(modeFlags('nmpz'), {
    forbidMoving: true,
    forbidZooming: true,
    forbidRotating: true
  });
});

test('weighted random is deterministic with a fixed roll', () => {
  const pool = [
    { shorthand: 'first', weight: 1 },
    { shorthand: 'second', weight: 9 }
  ];
  assert.equal(weightedRandomMap(pool, () => 0).shorthand, 'first');
  assert.equal(weightedRandomMap(pool, () => 0.999).shorthand, 'second');
});
