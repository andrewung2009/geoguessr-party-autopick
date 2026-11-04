'use strict';

const http = require('http');
const fs = require('fs');
const nodePath = require('path');
const { randomUUID } = require('crypto');
const {
  loadConfig,
  saveCache,
  saveMaps,
  normalizeMaps,
  mapsNeedingNames,
  assertSetup
} = require('./config');
const {
  parseCommand,
  buildMapIndex,
  resolveMap,
  weightedRandomMap,
  modeLabel,
  normalize
} = require('./parser');

const POLL_TIMEOUT_MS = 25000;
const CLIENT_STALE_MS = 30000;
const EDITOR_PATH = nodePath.join(__dirname, '..', 'editor', 'editor.html');

class Bridge {
  constructor(config) {
    this.config = config;
    this.index = buildMapIndex(config.maps);
    this.queue = [];
    this.waiting = null;
    this.pending = new Map();
    this.lastClientPoll = 0;
    this.lastDeliveredAt = 0;
    this.server = null;
    this.startedAt = Date.now();
  }

  reload() {
    this.config = loadConfig();
    this.index = buildMapIndex(this.config.maps);
    return this.config;
  }

  hasRecentClient() {
    return Boolean(this.waiting) || Date.now() - this.lastClientPoll < CLIENT_STALE_MS;
  }

  createJob(text) {
    const parsed = parseCommand(text);
    if (parsed.error) return { ok: false, message: parsed.error };

    let map = null;
    let mode = parsed.mode;

    if (parsed.mapQuery) {
      const isRandom = ['random', 'random map', 'spin'].includes(parsed.mapQuery);
      let found = null;

      if (isRandom) {
        const pool = this.config.maps.filter(
          (entry) => entry.geoguessrName || entry.mapId || this.config.cache[entry.shorthand]
        );
        found = weightedRandomMap(pool);
        if (!found) {
          return { ok: false, message: 'No maps are available for the random command.' };
        }
      } else {
        const resolved = resolveMap(parsed.mapQuery, this.index);
        if (resolved.reason === 'ambiguous') {
          const names = (resolved.candidates || []).map((entry) => entry.shorthand).join(', ');
          return {
            ok: false,
            message: `"${parsed.mapQuery}" is ambiguous. Try one of: ${names}`
          };
        }
        if (!resolved.map) {
          return {
            ok: false,
            message: `Unknown map "${parsed.mapQuery}". Add it to config/maps.json.`
          };
        }
        found = resolved.map;
      }

      const mapId = found.mapId || this.config.cache[found.shorthand] || '';
      if (!mapId && !found.geoguessrName) {
        return {
          ok: false,
          message: `Map "${found.shorthand}" needs a geoguessrName or mapId in config/maps.json.`
        };
      }

      map = {
        key: found.shorthand,
        shorthand: found.shorthand,
        name: found.geoguessrName || found.shorthand,
        mapId
      };

      if (!mode && found.defaultMode) mode = found.defaultMode;
    }

    if (!map && !mode) {
      return {
        ok: false,
        message: `Could not understand "${text}". Try something like "comp NM".`
      };
    }

    return {
      ok: true,
      job: {
        id: randomUUID(),
        text,
        map,
        mode,
        modeLabel: modeLabel(mode),
        createdAt: Date.now()
      }
    };
  }

  enqueueJob(job) {
    this.queue.push(job);
    this.flushWaiting();
  }

  flushWaiting() {
    if (!this.waiting || this.queue.length === 0) return;

    const { res, timer } = this.waiting;
    clearTimeout(timer);
    this.waiting = null;

    const job = this.queue.shift();
    this.lastDeliveredAt = Date.now();
    this.sendJson(res, 200, job);
  }

  waitForResult(job, timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(job.id);
        resolve({
          ok: false,
          message: `No response from the GeoGuessr tab within ${Math.round(timeoutMs / 1000)} seconds.`,
          timedOut: true
        });
      }, timeoutMs);

      this.pending.set(job.id, { resolve, timer, job });
    });
  }

  async runCommand(text, { deliver = true, wait = true, timeoutMs = 15000 } = {}) {
    const created = this.createJob(text);
    if (!created.ok) return created;

    const job = created.job;

    if (!deliver) return { ok: true, job };

    if (!this.hasRecentClient()) {
      return {
        ok: false,
        message:
          'GeoGuessr tab is not connected. Open the party lobby and make sure the Tampermonkey script is running.'
      };
    }

    if (!wait) {
      this.enqueueJob(job);
      return { ok: true, job };
    }

    const resultPromise = this.waitForResult(job, timeoutMs);
    this.enqueueJob(job);
    return resultPromise;
  }

  preparePreviewMaps(mapsInput) {
    const inputMaps =
      Array.isArray(mapsInput) && mapsInput.length > 0
        ? normalizeMaps(
            mapsInput.map((map) => ({
              ...map,
              mapId: map.mapId || map.cachedMapId || ''
            }))
          )
        : this.config.maps.map((map) => ({
            shorthand: map.shorthand,
            geoguessrName: map.geoguessrName,
            mapId: map.mapId || '',
            aliases: map.aliases,
            weight: map.weight,
            note: map.note
          }));

    return inputMaps.map((map) => ({
      ...map,
      configuredMapId: map.mapId || '',
      cachedMapId: '',
      mapId: map.mapId || ''
    }));
  }

  resolvePreview(text, maps, index) {
    const parsed = parseCommand(text);

    if (parsed.error) return { ok: false, message: parsed.error };

    let map = null;
    let mode = parsed.mode;

    if (parsed.mapQuery) {
      const isRandom = ['random', 'random map', 'spin'].includes(parsed.mapQuery);
      let found = null;

      if (isRandom) {
        const pool = maps.filter((entry) => entry.geoguessrName || entry.mapId);
        found = weightedRandomMap(pool);
        if (!found) return { ok: false, message: 'No maps are available for the random command.' };
      } else {
        const resolved = resolveMap(parsed.mapQuery, index);
        if (resolved.reason === 'ambiguous') {
          const names = (resolved.candidates || []).map((entry) => entry.shorthand).join(', ');
          return {
            ok: false,
            message: `"${parsed.mapQuery}" is ambiguous. Try one of: ${names}`
          };
        }
        if (!resolved.map) {
          return {
            ok: false,
            message: `Unknown map "${parsed.mapQuery}". Add it to config/maps.json.`
          };
        }
        found = resolved.map;
      }

      map = {
        key: found.shorthand,
        shorthand: found.shorthand,
        name: found.geoguessrName || found.shorthand,
        mapId: found.mapId || ''
      };

      if (!mode && found.defaultMode) mode = found.defaultMode;
    }

    if (!map && !mode) {
      return {
        ok: false,
        message: `Could not understand "${text}". Try something like "comp NM".`
      };
    }

    return {
      ok: true,
      map,
      mode,
      modeLabel: modeLabel(mode)
    };
  }

  previewCommand(text, mapsInput) {
    const maps = this.preparePreviewMaps(mapsInput);
    const index = buildMapIndex(maps);
    return this.resolvePreview(text, maps, index);
  }

  testKeywords(mapsInput) {
    const maps = this.preparePreviewMaps(mapsInput);
    const index = buildMapIndex(maps);
    const results = {};
    const problems = [];

    const sameTarget = (a, b) =>
      a.key === b.shorthand ||
      (a.mapId && b.mapId && a.mapId === b.mapId) ||
      (a.name && b.geoguessrName && normalize(a.name) === normalize(b.geoguessrName));

    for (const map of maps) {
      const candidates = [
        ...new Set([map.shorthand, map.geoguessrName, ...(map.aliases || [])].filter(Boolean))
      ];
      const bad = [];

      for (const keyword of candidates) {
        const preview = this.resolvePreview(`${keyword} NM`, maps, index);
        if (!preview.ok) {
          bad.push({ keyword, message: preview.message });
          continue;
        }
        if (!preview.map) {
          bad.push({ keyword, message: 'did not resolve to a map' });
          continue;
        }
        if (!sameTarget(preview.map, map)) {
          bad.push({
            keyword,
            resolved: preview.map.key,
            message: `resolves to "${preview.map.key}"`
          });
        }
      }

      results[map.shorthand] = { ok: bad.length === 0, bad };
      if (bad.length > 0) problems.push({ map: map.shorthand, bad });
    }

    return {
      ok: true,
      results,
      problems,
      summary: {
        maps: maps.length,
        mapsWithIssues: problems.length,
        issues: problems.reduce((total, problem) => total + problem.bad.length, 0)
      }
    };
  }

  async runSearch(query, { timeoutMs = 20000 } = {}) {
    const text = String(query || '').trim();
    if (!text) return { ok: false, message: 'Search query is empty.' };

    if (!this.hasRecentClient()) {
      return {
        ok: false,
        message:
          'GeoGuessr tab is not connected. Open the party page and make sure the Tampermonkey script is running.'
      };
    }

    const job = {
      type: 'search',
      id: randomUUID(),
      query: text,
      createdAt: Date.now()
    };

    const promise = this.waitForResult(job, timeoutMs);
    this.enqueueJob(job);
    return promise;
  }

  handleResult(payload) {
    if (!payload || typeof payload.id !== 'string') {
      return { ok: false, message: 'Result is missing an id.' };
    }

    const pendingEntry = this.pending.get(payload.id);
    if (pendingEntry && pendingEntry.job && pendingEntry.job.type === 'search') {
      clearTimeout(pendingEntry.timer);
      this.pending.delete(payload.id);
      pendingEntry.resolve({
        ok: Boolean(payload.ok),
        results: Array.isArray(payload.results) ? payload.results : [],
        message: String(payload.message || '')
      });
      return { ok: true };
    }

    if (payload.mapId && payload.mapKey) {
      this.config.cache[payload.mapKey] = payload.mapId;
      const map = this.config.maps.find((entry) => entry.shorthand === payload.mapKey);
      if (map) map.mapId = payload.mapId;
      try {
        saveCache(this.config.cache);
      } catch (error) {
        console.error('[bridge] Could not save config/map-cache.json:', error.message);
      }
    }

    const result = {
      ok: Boolean(payload.ok),
      message: String(payload.message || (payload.ok ? 'Applied.' : 'Failed.')),
      mapName: payload.mapName || null,
      mapId: payload.mapId || null,
      mode: payload.mode || null,
      modeLabel: payload.mode ? modeLabel(payload.mode) : null
    };

    const entry = this.pending.get(payload.id);
    if (entry) {
      clearTimeout(entry.timer);
      this.pending.delete(payload.id);
      entry.resolve(result);
    }

    return { ok: true };
  }

  health() {
    const needingNames = mapsNeedingNames(this.config.maps);
    return {
      ok: true,
      startedAt: this.startedAt,
      clientConnected: this.hasRecentClient(),
      lastClientPoll: this.lastClientPoll || null,
      lastDeliveredAt: this.lastDeliveredAt || null,
      queueLength: this.queue.length,
      pendingResults: this.pending.size,
      maps: this.config.maps.length,
      mapsNeedingNames: needingNames.map((map) => map.shorthand),
      port: this.config.bridgePort
    };
  }

  getConfigPayload() {
    return {
      version: 1,
      maps: this.config.maps.map((map) => ({
        shorthand: map.shorthand,
        geoguessrName: map.geoguessrName,
        mapId: map.mapId || this.config.cache[map.shorthand] || '',
        defaultMode: map.defaultMode || '',
        aliases: map.aliases,
        weight: map.weight,
        note: map.note
      }))
    };
  }

  getMapsPayload() {
    return {
      ok: true,
      maps: this.config.maps.map((map) => ({
        shorthand: map.shorthand,
        geoguessrName: map.geoguessrName,
        mapId: map.configuredMapId || '',
        cachedMapId: map.cachedMapId || '',
        effectiveMapId: map.mapId || '',
        defaultMode: map.defaultMode || '',
        aliases: map.aliases,
        weight: map.weight,
        note: map.note
      })),
      conflicts: this.index.conflicts,
      mapsNeedingNames: mapsNeedingNames(this.config.maps).map((map) => map.shorthand)
    };
  }

  async verifyIds(maps) {
    const results = {};

    for (const map of maps) {
      const id = String(map.mapId || map.effectiveMapId || map.cachedMapId || '').trim();
      if (!id) {
        results[map.shorthand] = { ok: false, error: 'No mapId configured.' };
        continue;
      }

      try {
        const response = await fetch(
          `https://www.geoguessr.com/api/maps/${encodeURIComponent(id)}`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        results[map.shorthand] = {
          ok: true,
          actualName: data.name,
          actualId: data.id,
          actualSlug: data.slug
        };
      } catch (error) {
        results[map.shorthand] = { ok: false, error: error.message };
      }

      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    return results;
  }

  sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store'
    });
    res.end(body);
  }

  sendEmpty(res, status = 204) {
    res.writeHead(status, { 'Cache-Control': 'no-store' });
    res.end();
  }

  authorized(req) {
    const header = req.headers['x-bridge-secret'];
    const url = new URL(req.url, 'http://127.0.0.1');
    const query = url.searchParams.get('secret');
    return header === this.config.bridgeSecret || query === this.config.bridgeSecret;
  }

  readBody(req, limit = 1024 * 1024) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          reject(new Error('Request body is too large.'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (chunks.length === 0) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(new Error(`Invalid JSON: ${error.message}`));
        }
      });
      req.on('error', reject);
    });
  }

  handleNext(req, res) {
    this.lastClientPoll = Date.now();

    if (this.queue.length > 0) {
      const job = this.queue.shift();
      this.lastDeliveredAt = Date.now();
      this.sendJson(res, 200, job);
      return;
    }

    if (this.waiting) {
      const previous = this.waiting;
      clearTimeout(previous.timer);
      this.waiting = null;
      this.sendEmpty(previous.res);
    }

    const timer = setTimeout(() => {
      if (this.waiting && this.waiting.res === res) {
        this.waiting = null;
      }
      if (!res.writableEnded) this.sendEmpty(res);
    }, POLL_TIMEOUT_MS);

    this.waiting = { res, timer };

    const cleanup = () => {
      if (this.waiting && this.waiting.res === res) {
        clearTimeout(timer);
        this.waiting = null;
      }
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  }

  async handleRequest(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname;

    if (req.method === 'GET' && path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>GeoGuessr Party Autopick</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.5}code{background:#eee;padding:2px 5px;border-radius:4px}</style>
</head><body>
<h1>GeoGuessr Party Autopick</h1>
<p>Bridge is running on <code>127.0.0.1:${this.config.bridgePort}</code>.</p>
<p>Status: <a href="/health">/health</a></p>
<p><a href="/editor">Open the Map Editor</a></p>
<p>Keep this terminal open, open the GeoGuessr party lobby, and use the Tampermonkey overlay.</p>
</body></html>`);
      return;
    }

    if (req.method === 'GET' && path === '/health') {
      this.sendJson(res, 200, this.health());
      return;
    }

    if (req.method === 'GET' && (path === '/editor' || path === '/editor/')) {
      try {
        const html = fs.readFileSync(EDITOR_PATH, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(html);
      } catch (error) {
        this.sendJson(res, 500, {
          ok: false,
          message: `Could not read editor/editor.html: ${error.message}`
        });
      }
      return;
    }

    if (!this.authorized(req)) {
      this.sendJson(res, 401, { ok: false, message: 'Bad or missing bridge secret.' });
      return;
    }

    if (req.method === 'GET' && path === '/config') {
      this.sendJson(res, 200, this.getConfigPayload());
      return;
    }

    if (req.method === 'GET' && path === '/maps') {
      this.sendJson(res, 200, this.getMapsPayload());
      return;
    }

    if (req.method === 'POST' && path === '/maps/preview') {
      try {
        const body = await this.readBody(req);
        const result = this.previewCommand(String(body.text || '').trim(), body.maps);
        this.sendJson(res, result.ok ? 200 : 422, result);
      } catch (error) {
        this.sendJson(res, 400, { ok: false, message: error.message });
      }
      return;
    }

    if (req.method === 'POST' && path === '/maps/save') {
      try {
        const body = await this.readBody(req);
        const maps = normalizeMaps(body.maps);
        const oldMaps = this.config.maps;
        const newKeys = new Set(maps.map((map) => map.shorthand));

        for (const key of Object.keys(this.config.cache)) {
          if (!newKeys.has(key)) delete this.config.cache[key];
        }

        for (const map of maps) {
          const old = oldMaps.find((entry) => entry.shorthand === map.shorthand);
          if (old && old.geoguessrName !== map.geoguessrName && !map.mapId) {
            delete this.config.cache[map.shorthand];
          }
          if (map.mapId) this.config.cache[map.shorthand] = map.mapId;
        }

        saveMaps(maps);
        saveCache(this.config.cache);
        this.reload();
        this.sendJson(res, 200, this.getMapsPayload());
      } catch (error) {
        this.sendJson(res, 400, { ok: false, message: error.message });
      }
      return;
    }

    if (req.method === 'POST' && path === '/maps/verify-ids') {
      try {
        const body = await this.readBody(req);
        const maps = Array.isArray(body.maps) ? body.maps : this.config.maps;
        const results = await this.verifyIds(maps);
        this.sendJson(res, 200, { ok: true, results });
      } catch (error) {
        this.sendJson(res, 500, { ok: false, message: error.message });
      }
      return;
    }

    if (req.method === 'POST' && path === '/maps/test-keywords') {
      try {
        const body = await this.readBody(req);
        const result = this.testKeywords(body.maps);
        this.sendJson(res, 200, result);
      } catch (error) {
        this.sendJson(res, 400, { ok: false, message: error.message });
      }
      return;
    }

    if (req.method === 'POST' && path === '/search') {
      try {
        const body = await this.readBody(req);
        const result = await this.runSearch(body.query, {
          timeoutMs: Number(body.timeoutMs) > 0 ? Number(body.timeoutMs) : 20000
        });
        this.sendJson(res, result.ok ? 200 : 422, result);
      } catch (error) {
        this.sendJson(res, 400, { ok: false, message: error.message });
      }
      return;
    }

    if (req.method === 'GET' && path === '/next') {
      this.handleNext(req, res);
      return;
    }

    if (req.method === 'POST' && path === '/result') {
      try {
        const body = await this.readBody(req);
        const result = this.handleResult(body);
        this.sendJson(res, result.ok ? 200 : 400, result);
      } catch (error) {
        this.sendJson(res, 400, { ok: false, message: error.message });
      }
      return;
    }

    if (req.method === 'POST' && path === '/command') {
      try {
        const body = await this.readBody(req);
        const text = String(body.text || '').trim();
        if (!text) {
          this.sendJson(res, 400, { ok: false, message: 'Missing "text".' });
          return;
        }
        const result = await this.runCommand(text, {
          deliver: body.deliver !== false,
          wait: body.wait === true,
          timeoutMs: Number(body.timeoutMs) > 0 ? Number(body.timeoutMs) : 15000
        });
        this.sendJson(res, result.ok ? 200 : 422, result);
      } catch (error) {
        this.sendJson(res, 400, { ok: false, message: error.message });
      }
      return;
    }

    if (req.method === 'POST' && path === '/reload') {
      try {
        this.reload();
        this.sendJson(res, 200, { ok: true, maps: this.config.maps.length });
      } catch (error) {
        this.sendJson(res, 500, { ok: false, message: error.message });
      }
      return;
    }

    if (req.method === 'POST' && path === '/clearcache') {
      try {
        saveCache({});
        this.reload();
        this.sendJson(res, 200, { ok: true });
      } catch (error) {
        this.sendJson(res, 500, { ok: false, message: error.message });
      }
      return;
    }

    this.sendJson(res, 404, { ok: false, message: 'Not found.' });
  }

  start() {
    if (this.server) return this.server;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        console.error('[bridge] Request failed:', error);
        if (!res.writableEnded) {
          this.sendJson(res, 500, { ok: false, message: error.message });
        }
      });
    });

    this.server.listen(this.config.bridgePort, '127.0.0.1', () => {
      console.log(`[bridge] Listening on http://127.0.0.1:${this.config.bridgePort}`);
      console.log(`[bridge] Loaded ${this.config.maps.length} maps.`);
      const needingNames = mapsNeedingNames(this.config.maps);
      if (needingNames.length > 0) {
        console.log('[bridge] Maps that still need a geoguessrName or mapId:');
        for (const map of needingNames) console.log(`  - ${map.shorthand}`);
      }
      if (this.index.conflicts.length > 0) {
        const seen = new Set();
        for (const conflict of this.index.conflicts) {
          const key = `${conflict.alias}:${conflict.kept}:${conflict.ignored}`;
          if (seen.has(key)) continue;
          seen.add(key);
          console.log(
            `[bridge] Alias "${conflict.alias}" maps to both "${conflict.kept}" and "${conflict.ignored}"; using "${conflict.kept}".`
          );
        }
      }
    });

    return this.server;
  }

  stop() {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, message: 'Bridge stopped.', stopped: true });
      this.pending.delete(id);
    }
    if (this.waiting) {
      clearTimeout(this.waiting.timer);
      this.sendEmpty(this.waiting.res);
      this.waiting = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

function startBridge(options = {}) {
  const config = options.config || loadConfig();
  assertSetup(config, { requireDiscord: false });
  const bridge = new Bridge(config);
  bridge.start();
  return bridge;
}

if (require.main === module) {
  const bridge = startBridge();
  const shutdown = () => {
    console.log('\n[bridge] Shutting down...');
    bridge.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { Bridge, startBridge };
