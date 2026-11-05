'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

process.env.BRIDGE_SECRET = 'test-secret';
process.env.BRIDGE_PORT = '0';

const { Bridge } = require('../src/bridge');
const { loadConfig } = require('../src/config');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(port, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers: {
      'X-Bridge-Secret': 'test-secret',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const TEST_MAPS = [
  {
    shorthand: 'comp',
    geoguessrName: 'A Competitive World',
    mapId: 'comp-id',
    defaultMode: '',
    aliases: ['comp'],
    weight: 10
  },
  {
    shorthand: 'ASW',
    geoguessrName: 'A Skewed World',
    mapId: 'asw-id',
    defaultMode: 'nmpz',
    aliases: ['skewed'],
    weight: 1
  },
  {
    shorthand: 'AMW',
    geoguessrName: 'A Moving World',
    mapId: 'amw-id',
    defaultMode: 'move',
    aliases: ['amw'],
    weight: 10
  }
];

function makeTestBridge(cache = {}) {
  return new Bridge({
    maps: TEST_MAPS,
    cache,
    bridgeSecret: 'test-secret',
    bridgePort: 8787
  });
}

test('bridge delivers a command and receives the result', async () => {
  const bridge = new Bridge(loadConfig());
  const server = bridge.start();
  if (!server.listening) await once(server, 'listening');

  const port = server.address().port;

  try {
    const health = await request(port, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);

    const nextPromise = request(port, '/next');
    await sleep(120);

    const commandPromise = request(port, '/command', {
      method: 'POST',
      body: JSON.stringify({ text: 'comp NM', wait: true, timeoutMs: 5000 })
    });

    const next = await nextPromise;
    assert.equal(next.status, 200);
    assert.equal(next.body.mode, 'nm');
    assert.equal(next.body.map.name, 'A Competitive World');

    const result = await request(port, '/result', {
      method: 'POST',
      body: JSON.stringify({
        id: next.body.id,
        ok: true,
        message: 'Applied.',
        mapKey: next.body.map.key,
        mapName: next.body.map.name,
        mode: next.body.mode
      })
    });
    assert.equal(result.status, 200);

    const command = await commandPromise;
    assert.equal(command.status, 200);
    assert.equal(command.body.ok, true);
    assert.equal(command.body.mapName, 'A Competitive World');
    assert.equal(command.body.modeLabel, 'NM');
  } finally {
    bridge.stop();
  }
});

test('bridge exposes maps and previews a command', async () => {
  const bridge = new Bridge(loadConfig());
  const server = bridge.start();
  if (!server.listening) await once(server, 'listening');

  const port = server.address().port;

  try {
    const maps = await request(port, '/maps');
    assert.equal(maps.status, 200);
    assert.equal(maps.body.ok, true);
    assert.equal(maps.body.maps.length, loadConfig().maps.length);
    assert.equal(Array.isArray(maps.body.conflicts), true);

    const preview = await request(port, '/maps/preview', {
      method: 'POST',
      body: JSON.stringify({ text: 'comp NM' })
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.ok, true);
    assert.equal(preview.body.map.name, 'A Competitive World');
    assert.equal(preview.body.mode, 'nm');
    assert.equal(preview.body.modeLabel, 'NM');

    const customPreview = await request(port, '/maps/preview', {
      method: 'POST',
      body: JSON.stringify({
        text: 'tm nmpz',
        maps: [
          {
            shorthand: 'testmap',
            geoguessrName: 'Test Map',
            mapId: 'abc',
            aliases: ['tm'],
            weight: 1
          }
        ]
      })
    });
    assert.equal(customPreview.status, 200);
    assert.equal(customPreview.body.ok, true);
    assert.equal(customPreview.body.map.key, 'testmap');
    assert.equal(customPreview.body.mode, 'nmpz');
  } finally {
    bridge.stop();
  }
});

test('bridge forwards a search to the userscript and returns results', async () => {
  const bridge = new Bridge(loadConfig());
  const server = bridge.start();
  if (!server.listening) await once(server, 'listening');

  const port = server.address().port;

  try {
    const nextPromise = request(port, '/next');
    await sleep(120);

    const searchPromise = request(port, '/search', {
      method: 'POST',
      body: JSON.stringify({ query: 'A Competitive World', timeoutMs: 5000 })
    });

    const next = await nextPromise;
    assert.equal(next.status, 200);
    assert.equal(next.body.type, 'search');
    assert.equal(next.body.query, 'A Competitive World');

    const ack = await request(port, '/result', {
      method: 'POST',
      body: JSON.stringify({
        id: next.body.id,
        type: 'search',
        ok: true,
        results: [
          { id: '668ea3252973190af74233b5', name: 'A Competitive World', likes: 5000 }
        ]
      })
    });
    assert.equal(ack.status, 200);

    const search = await searchPromise;
    assert.equal(search.status, 200);
    assert.equal(search.body.ok, true);
    assert.equal(search.body.results.length, 1);
    assert.equal(search.body.results[0].name, 'A Competitive World');
  } finally {
    bridge.stop();
  }
});

test('bridge explains that map search needs the userscript', async () => {
  const bridge = new Bridge(loadConfig());
  const server = bridge.start();
  if (!server.listening) await once(server, 'listening');

  const port = server.address().port;

  try {
    const search = await request(port, '/search', {
      method: 'POST',
      body: JSON.stringify({ query: 'World' })
    });
    assert.equal(search.status, 422);
    assert.equal(search.body.ok, false);
    assert.match(search.body.message, /not connected/);
  } finally {
    bridge.stop();
  }
});

test('bridge creates a search-backed job for an unknown map', async () => {
  const bridge = new Bridge(loadConfig());
  const server = bridge.start();
  if (!server.listening) await once(server, 'listening');

  const port = server.address().port;

  try {
    const command = await request(port, '/command', {
      method: 'POST',
      body: JSON.stringify({ text: 'not a real map xyz', deliver: false })
    });

    assert.equal(command.status, 200);
    assert.equal(command.body.ok, true);
    assert.equal(command.body.job.map.dynamic, true);
    assert.equal(command.body.job.map.key, '@search:not a real map xyz');
  } finally {
    bridge.stop();
  }
});

test('testKeywords accepts the shipped config', () => {
  const bridge = new Bridge(loadConfig());
  const result = bridge.testKeywords();
  assert.equal(result.ok, true);
  assert.equal(result.summary.maps, loadConfig().maps.length);
  assert.equal(result.summary.issues, 0);
});

test('testKeywords finds a keyword conflict', () => {
  const bridge = new Bridge(loadConfig());
  const result = bridge.testKeywords([
    { shorthand: 'alpha', geoguessrName: 'Alpha Map', mapId: '1', aliases: ['same'], weight: 1 },
    { shorthand: 'beta', geoguessrName: 'Beta Map', mapId: '2', aliases: ['same'], weight: 1 }
  ]);
  assert.equal(result.ok, true);
  assert.ok(result.summary.issues > 0);
});

test('map-only commands use the map default mode', () => {
  const bridge = new Bridge(loadConfig());
  const cases = [
    ['AMW', 'move'],
    ['AMMW', 'move'],
    ['ASW', 'nmpz'],
    ['ARPZW', 'nmpz'],
    ['50/50', 'nmpz'],
    ['comp', null]
  ];

  for (const [text, expected] of cases) {
    const created = bridge.createJob(text);
    assert.equal(created.ok, true, text);
    assert.equal(created.job.mode, expected, text);
  }
});

test('an explicit mode overrides the map default mode', () => {
  const bridge = new Bridge(loadConfig());
  const created = bridge.createJob('AMW NM');
  assert.equal(created.ok, true);
  assert.equal(created.job.mode, 'nm');
  assert.equal(created.job.modeLabel, 'NM');
});

test('Random NM is mode-only and remembers NM', () => {
  const bridge = makeTestBridge();
  const result = bridge.createJob('Random NM');

  assert.equal(result.ok, true);
  assert.equal(result.job.map, null);
  assert.equal(result.job.mode, 'nm');
  assert.equal(result.job.modeSource, 'explicit');
  assert.equal(result.job.ignoredRandom, true);
  assert.equal(bridge.lastMode, 'nm');
});

test('Random Move and Random NMPZ only change the mode', () => {
  const bridge = makeTestBridge();

  for (const [text, mode] of [
    ['Random Move', 'move'],
    ['Random NMPZ', 'nmpz']
  ]) {
    const result = bridge.createJob(text);
    assert.equal(result.ok, true);
    assert.equal(result.job.map, null);
    assert.equal(result.job.mode, mode);
    assert.equal(result.job.ignoredRandom, true);
  }
});

test('a country message reuses the remembered mode', () => {
  const bridge = makeTestBridge();
  bridge.createJob('Random NMPZ');

  const result = bridge.createJob('Portugal');

  assert.equal(result.ok, true);
  assert.equal(result.job.map.key, '@search:portugal');
  assert.equal(result.job.map.name, 'portugal');
  assert.equal(result.job.map.mapId, '');
  assert.equal(result.job.map.dynamic, true);
  assert.equal(result.job.mode, 'nmpz');
  assert.equal(result.job.modeSource, 'remembered');
});

test('a cached country ID is reused', () => {
  const bridge = makeTestBridge({ '@search:portugal': 'portugal-id' });
  const result = bridge.createJob('Portugal');

  assert.equal(result.ok, true);
  assert.equal(result.job.map.key, '@search:portugal');
  assert.equal(result.job.map.mapId, 'portugal-id');
});

test('map default mode wins over the remembered mode', () => {
  const bridge = makeTestBridge();
  bridge.createJob('Random NM');

  const result = bridge.createJob('ASW');

  assert.equal(result.job.mode, 'nmpz');
  assert.equal(result.job.modeSource, 'default');
});

test('an explicit mode in the country message wins', () => {
  const bridge = makeTestBridge();
  bridge.createJob('Random NM');

  const result = bridge.createJob('Portugal move');

  assert.equal(result.job.map.key, '@search:portugal');
  assert.equal(result.job.mode, 'move');
  assert.equal(result.job.modeSource, 'explicit');
});

test('config map-only messages reuse the remembered mode', () => {
  const bridge = makeTestBridge();
  bridge.createJob('comp NM');

  const result = bridge.createJob('comp');

  assert.equal(result.job.map.key, 'comp');
  assert.equal(result.job.mode, 'nm');
  assert.equal(result.job.modeSource, 'remembered');
});

test('an unknown map with no remembered mode stays map-only', () => {
  const bridge = makeTestBridge();
  const result = bridge.createJob('Portugal');

  assert.equal(result.ok, true);
  assert.equal(result.job.map.dynamic, true);
  assert.equal(result.job.mode, null);
  assert.equal(result.job.modeSource, null);
});

test('bare random still picks a configured weighted random map', () => {
  const bridge = makeTestBridge();
  const result = bridge.createJob('random');

  assert.equal(result.ok, true);
  assert.ok(result.job.map);
  assert.ok(TEST_MAPS.some((map) => map.shorthand === result.job.map.key));
});
