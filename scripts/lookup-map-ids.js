'use strict';

const { loadConfig, saveMaps } = require('../src/config');
const { normalize } = require('../src/parser');

const DIRECTORY_URL = 'https://miraclewhips.dev/geoguessr-map-directory/main.js';

function extractData(text) {
  const marker = 'const DATA = ';
  const start = text.indexOf(marker);
  if (start < 0) throw new Error('Could not find DATA in the directory script.');

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start + marker.length; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(text.slice(start + marker.length, i + 1));
      }
    }
  }

  throw new Error('Could not find the end of the DATA object.');
}

async function main() {
  const config = loadConfig();
  const response = await fetch(DIRECTORY_URL);
  if (!response.ok) throw new Error(`Directory download failed: HTTP ${response.status}`);
  const text = await response.text();
  const data = extractData(text);
  const directory = data.maps || [];

  const exact = new Map();
  for (const entry of directory) {
    const key = normalize(entry.map_name);
    if (!exact.has(key)) exact.set(key, []);
    exact.get(key).push(entry);
  }

  const found = {};

  for (const map of config.maps) {
    const name = map.geoguessrName || map.shorthand;
    const key = normalize(name);
    const matches = exact.get(key) || [];

    if (matches.length === 0) {
      const near = directory
        .filter((entry) => {
          const n = normalize(entry.map_name);
          return n.includes(key) || key.includes(n);
        })
        .slice(0, 5);
      console.log(`MISSING  ${map.shorthand}  ->  "${name}"`);
      if (near.length > 0) {
        for (const entry of near) {
          console.log(`         near: ${entry.map_name} (${entry.map_id})`);
        }
      }
      continue;
    }

    console.log(`OK       ${map.shorthand}  ->  "${matches[0].map_name}"  ${matches[0].map_id}  [${matches[0].user_name || ''}]`);
    if (matches.length > 1) {
      for (const entry of matches.slice(1)) {
        console.log(`         other: ${entry.map_name} (${entry.map_id}) by ${entry.user_name || ''} count=${entry.count}`);
      }
    }

    found[map.shorthand] = matches[0].map_id;
  }

  console.log('');
  console.log(JSON.stringify(found, null, 2));

  if (process.argv.includes('--write')) {
    let written = 0;
    const maps = config.rawMaps.map((map) => {
      if (!map.mapId && found[map.shorthand]) {
        written += 1;
        return { ...map, mapId: found[map.shorthand] };
      }
      return map;
    });

    saveMaps(maps);
    console.log('');
    console.log(`Wrote ${written} map IDs to config/maps.json.`);
  } else {
    console.log('');
    console.log('Run with --write to fill the missing IDs into config/maps.json.');
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
