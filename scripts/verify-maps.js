'use strict';

const { loadConfig } = require('../src/config');
const { buildMapIndex, resolveMap, parseCommand, modeLabel } = require('../src/parser');

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPublicMap(mapId) {
  const response = await fetch(`https://www.geoguessr.com/api/maps/${encodeURIComponent(mapId)}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function previewCommand(text, config, index) {
  const parsed = parseCommand(text);

  console.log(`Command: ${text}`);
  console.log(`Map part: ${parsed.mapQuery || '(none)'}`);
  console.log('');

  if (!parsed.mapQuery) {
    console.log(`Mode: ${parsed.mode ? modeLabel(parsed.mode) : '(unchanged)'}`);
    console.log('This command only changes movement.');
    return;
  }

  const resolved = resolveMap(parsed.mapQuery, index);

  if (resolved.reason === 'ambiguous') {
    console.log('Ambiguous map. It could be:');
    for (const map of resolved.candidates || []) {
      console.log(`  - ${map.shorthand} (${map.geoguessrName || 'no name configured'})`);
    }
    return;
  }

  if (!resolved.map) {
    console.log('No map matched. Add an alias or map name to config/maps.json.');
    return;
  }

  const map = resolved.map;
  const effectiveMode = parsed.mode || map.defaultMode || null;
  console.log(`Matched shorthand: ${map.shorthand}`);
  console.log(`GeoGuessr name:    ${map.geoguessrName || '(not set)'}`);
  console.log(`Mode:              ${effectiveMode ? modeLabel(effectiveMode) : '(unchanged)'}`);
  console.log(`Default mode:      ${map.defaultMode ? modeLabel(map.defaultMode) : '(none)'}`);
  console.log(`Configured ID:     ${map.mapId || '(none, will search by name)'}`);
  console.log(`Cached ID:         ${config.cache[map.shorthand] || '(none)'}`);

  const id = map.mapId || config.cache[map.shorthand];
  if (!id) {
    console.log('');
    console.log('Status: OK, but the ID is not known yet. The userscript will search for it once.');
    return;
  }

  try {
    const actual = await fetchPublicMap(id);
    console.log(`GeoGuessr says:    ${actual.name}`);
    const ok = normalize(actual.name) === normalize(map.geoguessrName || map.shorthand);
    console.log(`Status:            ${ok ? 'OK' : 'NAME MISMATCH'}`);
  } catch (error) {
    console.log(`Status:            COULD NOT VERIFY (${error.message})`);
  }
}

async function verifyAll(config, index) {
  const rows = [];

  for (const map of config.maps) {
    const resolved = resolveMap(map.shorthand, index);
    const aliasSelf =
      resolved.map && resolved.map.shorthand === map.shorthand
        ? 'ok'
        : resolved.reason || 'wrong map';

    const id = map.mapId || config.cache[map.shorthand] || '';
    let status = 'OK';
    let actualName = '';
    let detail = '';

    if (!id) {
      if (map.geoguessrName) {
        status = 'WILL SEARCH';
        detail = 'no ID yet; first use searches by name';
      } else {
        status = 'MISSING';
        detail = 'add geoguessrName or mapId';
      }
    } else {
      try {
        const actual = await fetchPublicMap(id);
        actualName = actual.name;
        const expected = map.geoguessrName || map.shorthand;
        if (normalize(actual.name) !== normalize(expected)) {
          status = 'NAME MISMATCH';
          detail = `configured "${expected}"`;
        }
      } catch (error) {
        status = 'FETCH ERROR';
        detail = error.message;
      }
      await sleep(120);
    }

    if (aliasSelf !== 'ok' && status === 'OK') {
      status = 'ALIAS ISSUE';
      detail = `shorthand resolves to "${resolved.map ? resolved.map.shorthand : aliasSelf}"`;
    }

    rows.push({
      shorthand: map.shorthand,
      name: map.geoguessrName || '(none)',
      mode: map.defaultMode ? modeLabel(map.defaultMode) : '-',
      id: id || '(none)',
      actual: actualName || '-',
      status,
      detail
    });
  }

  const widths = {
    shorthand: Math.max(9, ...rows.map((row) => row.shorthand.length)),
    name: Math.max(14, ...rows.map((row) => row.name.length)),
    mode: Math.max(6, ...rows.map((row) => row.mode.length)),
    id: Math.max(24, ...rows.map((row) => row.id.length)),
    actual: Math.max(14, ...rows.map((row) => row.actual.length)),
    status: Math.max(12, ...rows.map((row) => row.status.length))
  };

  const line = (row) =>
    [
      row.shorthand.padEnd(widths.shorthand),
      row.name.padEnd(widths.name),
      row.mode.padEnd(widths.mode),
      row.id.padEnd(widths.id),
      row.actual.padEnd(widths.actual),
      row.status.padEnd(widths.status),
      row.detail
    ]
      .join('  ')
      .trimEnd();

  console.log(
    line({
      shorthand: 'SHORTHAND',
      name: 'GEOGUESSR NAME',
      mode: 'DEFAULT',
      id: 'MAP ID',
      actual: 'ACTUAL NAME',
      status: 'STATUS',
      detail: 'DETAIL'
    })
  );
  console.log('-'.repeat(120));
  for (const row of rows) console.log(line(row));

  const counts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  console.log('');
  console.log('Summary:');
  for (const [status, count] of Object.entries(counts)) {
    console.log(`  ${status}: ${count}`);
  }
  if (counts.MISSING) {
    console.log('');
    console.log('MISSING maps need a geoguessrName or mapId in config/maps.json.');
  }
  if (counts['WILL SEARCH']) {
    console.log('');
    console.log('WILL SEARCH maps are fine. Use "Resolve all maps" in the overlay to fill their IDs now.');
  }
}

async function main() {
  const config = loadConfig();
  const index = buildMapIndex(config.maps);
  const command = process.argv.slice(2).join(' ').trim();

  console.log('');
  console.log('GeoGuessr Party Autopick - map verification');
  console.log(`Config: ${config.mapsPath}`);
  console.log(`Maps:   ${config.maps.length}`);
  console.log('');

  if (command) {
    await previewCommand(command, config, index);
  } else {
    await verifyAll(config, index);
  }

  console.log('');
}

main().catch((error) => {
  console.error('Verification failed:', error.message);
  process.exit(1);
});
