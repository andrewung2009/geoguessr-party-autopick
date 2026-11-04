'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ROOT = path.join(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const MAPS_PATH = path.join(ROOT, 'config', 'maps.json');
const CACHE_PATH = path.join(ROOT, 'config', 'map-cache.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${file}: ${error.message}`);
  }
}

function normalizeDefaultMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ['move', 'nm', 'nmpz'].includes(mode) ? mode : '';
}

function loadMaps() {
  const data = readJson(MAPS_PATH, null);
  if (!data || !Array.isArray(data.maps)) {
    throw new Error('config/maps.json is missing a "maps" array.');
  }
  return data.maps.map((map, index) => ({
    shorthand: String(map.shorthand || `map-${index}`).trim(),
    geoguessrName: String(map.geoguessrName || '').trim(),
    mapId: String(map.mapId || '').trim(),
    defaultMode: normalizeDefaultMode(map.defaultMode),
    aliases: Array.isArray(map.aliases) ? map.aliases.map(String) : [],
    weight: Number(map.weight) > 0 ? Number(map.weight) : 1,
    note: map.note || ''
  }));
}

function loadCache() {
  const cache = readJson(CACHE_PATH, {});
  return cache && typeof cache === 'object' ? cache : {};
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function mapsWithCache(maps, cache) {
  return maps.map((map) => ({
    ...map,
    configuredMapId: map.mapId || '',
    cachedMapId: cache[map.shorthand] || '',
    mapId: map.mapId || cache[map.shorthand] || ''
  }));
}

function normalizeMaps(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('maps must be a non-empty array.');
  }

  const seen = new Set();

  return input.map((entry, index) => {
    const shorthand = String(entry?.shorthand || '').trim();
    if (!shorthand) throw new Error(`Map ${index + 1} is missing a shorthand.`);

    const key = shorthand.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate shorthand "${shorthand}".`);
    seen.add(key);

    const rawAliases = Array.isArray(entry.aliases)
      ? entry.aliases
      : String(entry.aliases || '').split(',');
    const aliases = [
      ...new Set(rawAliases.map((alias) => String(alias).trim()).filter(Boolean))
    ];

    const weightNumber = Number(entry.weight);
    const weight = Number.isFinite(weightNumber) && weightNumber > 0 ? weightNumber : 1;

    const normalized = {
      shorthand,
      geoguessrName: String(entry.geoguessrName || '').trim(),
      mapId: String(entry.mapId || '').trim(),
      defaultMode: normalizeDefaultMode(entry.defaultMode),
      aliases,
      weight
    };

    const note = String(entry.note || '').trim();
    if (note) normalized.note = note;

    return normalized;
  });
}

function saveMaps(maps) {
  const existing = readJson(MAPS_PATH, { maps: [] });
  const data = { ...existing, maps };
  fs.writeFileSync(MAPS_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return data;
}

function parseAllowedIds(value) {
  return String(value || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function loadConfig() {
  const maps = loadMaps();
  const cache = loadCache();

  return {
    root: ROOT,
    mapsPath: MAPS_PATH,
    cachePath: CACHE_PATH,
    maps: mapsWithCache(maps, cache),
    rawMaps: maps,
    cache,
    discordToken: String(process.env.DISCORD_TOKEN || '').trim(),
    allowedUserIds: parseAllowedIds(process.env.ALLOWED_DISCORD_USER_IDS),
    bridgeSecret: String(process.env.BRIDGE_SECRET || '').trim(),
    bridgePort: Number(process.env.BRIDGE_PORT || 8787)
  };
}

function mapsNeedingNames(maps) {
  return maps.filter((map) => !map.mapId && !map.geoguessrName);
}

function assertSetup(config, { requireDiscord = false } = {}) {
  const problems = [];
  if (!config.bridgeSecret || config.bridgeSecret.includes('paste_')) {
    problems.push('BRIDGE_SECRET is missing. Run: npm run setup');
  }
  if (requireDiscord && (!config.discordToken || config.discordToken.includes('paste_'))) {
    problems.push('DISCORD_TOKEN is missing. Run: npm run setup');
  }
  if (requireDiscord && config.allowedUserIds.length === 0) {
    problems.push('ALLOWED_DISCORD_USER_IDS is empty. Run: npm run setup');
  }
  if (!Number.isInteger(config.bridgePort) || config.bridgePort < 1 || config.bridgePort > 65535) {
    problems.push(`BRIDGE_PORT is not a valid port: ${config.bridgePort}`);
  }
  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
}

module.exports = {
  ROOT,
  MAPS_PATH,
  CACHE_PATH,
  loadConfig,
  loadMaps,
  loadCache,
  saveCache,
  mapsWithCache,
  normalizeMaps,
  saveMaps,
  mapsNeedingNames,
  assertSetup
};
