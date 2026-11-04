// ==UserScript==
// @name         GeoGuessr Party Autopick
// @namespace    https://geoguessr-party-autopick.local
// @version      1.0.0
// @description  Applies GeoGuessr party map + movement settings from the local bridge.
// @match        https://www.geoguessr.com/party*
// @match        https://geoguessr.com/party*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787';
  const ACTIVE_PARTY_URL = '/api/v4/parties/v2/active';
  const GAME_SETTINGS_URL = '/api/v4/parties/v2/game-settings';
  const SEARCH_URL = '/api/v3/search/map';
  const SEARCH_V4_URL = '/api/v4/map-search';

  const MODE_FLAGS = {
    move: { forbidMoving: false, forbidZooming: false, forbidRotating: false },
    nm: { forbidMoving: true, forbidZooming: false, forbidRotating: false },
    nmpz: { forbidMoving: true, forbidZooming: true, forbidRotating: true }
  };

  let bridgeUrl = getValue('bridgeUrl', DEFAULT_BRIDGE_URL);
  let bridgeSecret = getValue('bridgeSecret', '');
  let mapCache = readJsonValue('mapIdCache', {});
  let polling = false;
  let connected = false;
  let lastMessage = '';
  let lastMessageOk = null;
  let remoteMaps = [];
  let panelOpen = false;

  function getValue(key, fallback) {
    try {
      return typeof GM_getValue === 'function' ? GM_getValue(key, fallback) : fallback;
    } catch {
      return fallback;
    }
  }

  function setValue(key, value) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(key, value);
    } catch {
      /* ignore */
    }
  }

  function deleteValue(key) {
    try {
      if (typeof GM_deleteValue === 'function') GM_deleteValue(key);
    } catch {
      /* ignore */
    }
  }

  function readJsonValue(key, fallback) {
    const raw = getValue(key, '');
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function saveMapCache() {
    setValue('mapIdCache', JSON.stringify(mapCache));
  }

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

  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest is not available. Reinstall the userscript in Tampermonkey.'));
        return;
      }

      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url: options.url,
        headers: {
          'X-Bridge-Secret': bridgeSecret,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.headers || {})
        },
        data: options.body ? JSON.stringify(options.body) : undefined,
        timeout: options.timeout || 30000,
        onload: (response) => resolve(response),
        onerror: () => reject(new Error('Bridge unreachable. Is "npm start" running?')),
        ontimeout: () => reject(new Error('Bridge timed out.'))
      });
    });
  }

  async function bridgeGet(path, timeout) {
    return gmRequest({ method: 'GET', url: `${bridgeUrl}${path}`, timeout });
  }

  async function bridgePost(path, body, timeout) {
    return gmRequest({ method: 'POST', url: `${bridgeUrl}${path}`, body, timeout });
  }

  async function apiFetch(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    return response;
  }

  async function getActiveParty() {
    const response = await apiFetch(ACTIVE_PARTY_URL);
    if (response.status === 204) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Could not read the party (${response.status}). ${text.slice(0, 160)}`);
    }
    return response.json();
  }

  async function searchMaps(query) {
    const encoded = encodeURIComponent(query);
    const response = await apiFetch(`${SEARCH_URL}?q=${encoded}&page=0&count=20`);

    if (response.status === 401) {
      throw new Error('GeoGuessr says you are not logged in. Log in and try again.');
    }

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.items)) return data.items;
    }

    const fallback = await apiFetch(SEARCH_V4_URL, {
      method: 'POST',
      body: JSON.stringify({ page: 1, pageSize: 20, query })
    });

    if (!fallback.ok) {
      throw new Error(`Map search failed (${fallback.status}).`);
    }

    const data = await fallback.json();
    return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  }

  function pickSearchResult(query, results) {
    const q = normalize(query);
    const list = (Array.isArray(results) ? results : [])
      .filter((item) => item && item.id && item.name)
      .slice()
      .sort((a, b) => (Number(b.likes) || 0) - (Number(a.likes) || 0));

    if (list.length === 0) return { result: null, candidates: [] };

    const exact = list.find((item) => normalize(item.name) === q);
    if (exact) return { result: exact };

    const starts = list.find((item) => normalize(item.name).startsWith(q));
    if (starts) return { result: starts };

    const includes = list.find((item) => normalize(item.name).includes(q));
    if (includes) return { result: includes };

    if (list.length === 1) return { result: list[0] };

    return { result: null, candidates: list.slice(0, 5) };
  }

  async function resolveMapId(map) {
    if (map.mapId) return { id: map.mapId, name: map.name };

    if (mapCache[map.key]) return { id: mapCache[map.key], name: map.name };

    const query = map.name || map.shorthand;
    const results = await searchMaps(query);
    const picked = pickSearchResult(query, results);

    if (!picked.result) {
      const names = (picked.candidates || []).map((item) => item.name).join(', ');
      throw new Error(
        `Could not find "${query}" on GeoGuessr.${names ? ` Closest results: ${names}` : ''}`
      );
    }

    mapCache[map.key] = picked.result.id;
    saveMapCache();
    return { id: picked.result.id, name: picked.result.name };
  }

  async function applyJob(job) {
    if (!window.location.pathname.startsWith('/party/lobby')) {
      return {
        ok: false,
        message: 'Open a GeoGuessr party lobby first (the page must be /party/lobby/...).'
      };
    }

    if (!job || (!job.map && !job.mode)) {
      return { ok: false, message: 'Nothing to apply.' };
    }

    const party = await getActiveParty();
    if (!party) {
      return { ok: false, message: 'No active party found. Create or rejoin a party first.' };
    }

    const settings = party.gameSettings;
    if (!settings || typeof settings !== 'object') {
      return { ok: false, message: 'Could not read the current party game settings.' };
    }

    const next = { ...settings };
    let appliedMapId = null;
    let appliedMapName = job.map ? job.map.name : null;

    if (job.map) {
      const resolved = await resolveMapId(job.map);
      appliedMapId = resolved.id;
      appliedMapName = resolved.name || job.map.name;
      next.mapSlug = appliedMapId;
    }

    if (job.mode && MODE_FLAGS[job.mode]) {
      Object.assign(next, MODE_FLAGS[job.mode]);
    }

    const response = await apiFetch(GAME_SETTINGS_URL, {
      method: 'PUT',
      body: JSON.stringify(next)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let message = `GeoGuessr rejected the change (${response.status}).`;
      if (response.status === 403) message = 'You are not the party host, so you cannot change the map.';
      if (text) message += ` ${text.slice(0, 220)}`;
      return { ok: false, message };
    }

    const parts = [];
    if (job.map) parts.push(`Map: ${appliedMapName}`);
    else parts.push('Map: unchanged');
    if (job.mode) parts.push(`Mode: ${job.modeLabel || job.mode}`);
    else parts.push('Mode: unchanged');

    return {
      ok: true,
      message: `${parts.join(' | ')}. Other party settings were left unchanged.`,
      mapKey: job.map ? job.map.key : null,
      mapId: appliedMapId,
      mapName: appliedMapName,
      mode: job.mode || null
    };
  }

  async function postResult(payload) {
    try {
      await bridgePost('/result', payload, 8000);
    } catch {
      /* the local cache still works even if the bridge is gone */
    }
  }

  async function handleJob(job) {
    if (!job || !job.id) return;

    if (job.type === 'search') {
      try {
        const results = await searchMaps(job.query);
        const trimmed = results.slice(0, 20).map((result) => ({
          id: result.id,
          name: result.name,
          slug: result.slug || null,
          likes: result.likes ?? null,
          type: result.type ?? null,
          creatorName: result.creatorName ?? null
        }));
        await postResult({
          id: job.id,
          type: 'search',
          ok: true,
          results: trimmed
        });
      } catch (error) {
        await postResult({
          id: job.id,
          type: 'search',
          ok: false,
          message: error.message
        });
      }
      return;
    }

    let result;
    try {
      result = await applyJob(job);
    } catch (error) {
      result = { ok: false, message: error.message };
    }

    setLog(result.message || (result.ok ? 'Applied.' : 'Failed.'), result.ok);

    await postResult({
      id: job.id,
      ok: result.ok,
      message: result.message,
      mapKey: result.mapKey || (job.map ? job.map.key : null),
      mapId: result.mapId || null,
      mapName: result.mapName || (job.map ? job.map.name : null),
      mode: result.mode || job.mode || null
    });
  }

  async function submitManual() {
    const input = document.getElementById('ggap-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    setLog('Sending...', null);

    try {
      const response = await bridgePost('/command', { text, deliver: false }, 8000);
      const data = JSON.parse(response.responseText || '{}');
      if (!data.ok || !data.job) {
        setLog(data.message || 'Could not parse that command.', false);
        return;
      }
      input.value = '';
      await handleJob(data.job);
    } catch (error) {
      setLog(error.message, false);
    }
  }

  async function loadRemoteConfig() {
    if (!bridgeSecret) return null;
    try {
      const response = await bridgeGet('/config', 8000);
      if (response.status !== 200) return null;
      const data = JSON.parse(response.responseText || '{}');
      remoteMaps = Array.isArray(data.maps) ? data.maps : [];
      for (const map of remoteMaps) {
        if (map.mapId) mapCache[map.shorthand] = map.mapId;
      }
      saveMapCache();
      return data;
    } catch {
      return null;
    }
  }

  async function resolveAllMaps() {
    const log = document.getElementById('ggap-modal-log');
    const setModalLog = (text) => {
      if (log) log.textContent = text;
    };

    if (!bridgeSecret) {
      setModalLog('Set the bridge secret first.');
      return;
    }

    setModalLog('Loading map list...');
    const data = await loadRemoteConfig();
    if (!data || !Array.isArray(data.maps)) {
      setModalLog('Could not load /config from the bridge. Is npm start running?');
      return;
    }

    const todo = data.maps.filter((map) => !map.mapId && map.geoguessrName);
    if (todo.length === 0) {
      setModalLog('Every map with a geoguessrName already has an ID.');
      return;
    }

    let resolved = 0;
    const failed = [];

    for (let index = 0; index < todo.length; index += 1) {
      const map = todo[index];
      setModalLog(`Resolving ${index + 1}/${todo.length}: ${map.shorthand}`);
      try {
        const results = await searchMaps(map.geoguessrName);
        const picked = pickSearchResult(map.geoguessrName, results);
        if (!picked.result) {
          failed.push(`${map.shorthand} (no match)`);
        } else {
          mapCache[map.shorthand] = picked.result.id;
          saveMapCache();
          resolved += 1;
          await postResult({
            id: `resolve-all-${map.shorthand}`,
            ok: true,
            message: 'cached',
            mapKey: map.shorthand,
            mapId: picked.result.id,
            mapName: picked.result.name
          });
        }
      } catch (error) {
        failed.push(`${map.shorthand} (${error.message})`);
      }
      await sleep(350);
    }

    setModalLog(
      `Resolved ${resolved}/${todo.length}.` +
        (failed.length ? `\nFailed:\n${failed.join('\n')}` : '')
    );
  }

  async function testBridge() {
    const log = document.getElementById('ggap-modal-log');
    const setModalLog = (text) => {
      if (log) log.textContent = text;
    };

    try {
      const health = await gmRequest({
        method: 'GET',
        url: `${bridgeUrl}/health`,
        timeout: 8000
      });
      if (health.status !== 200) {
        setModalLog(`Bridge answered with HTTP ${health.status}.`);
        return;
      }
      const data = JSON.parse(health.responseText || '{}');
      setModalLog(
        `Bridge OK.\nGeoGuessr tab connected: ${data.clientConnected ? 'yes' : 'no'}\nMaps loaded: ${data.maps}\nStill missing names: ${(data.mapsNeedingNames || []).join(', ') || 'none'}`
      );
    } catch (error) {
      setModalLog(`${error.message}\n\nIf Chrome blocked localhost, open the site settings for geoguessr.com and allow "Local network access".`);
    }
  }

  async function reloadBridgeConfig() {
    const log = document.getElementById('ggap-modal-log');
    try {
      const response = await bridgePost('/reload', {}, 8000);
      const data = JSON.parse(response.responseText || '{}');
      if (log) log.textContent = data.ok ? `Reloaded ${data.maps} maps.` : data.message || 'Reload failed.';
      await loadRemoteConfig();
    } catch (error) {
      if (log) log.textContent = error.message;
    }
  }

  function setLog(text, ok) {
    lastMessage = text;
    lastMessageOk = ok;
    const log = document.getElementById('ggap-log');
    if (log) {
      log.textContent = text;
      log.className = `ggap-log ${ok === true ? 'ggap-ok' : ok === false ? 'ggap-bad' : ''}`;
    }
  }

  function setConnected(value) {
    connected = value;
    const dot = document.getElementById('ggap-dot');
    const status = document.getElementById('ggap-status');
    if (dot) dot.className = `ggap-dot ${value ? 'ggap-dot-on' : 'ggap-dot-off'}`;
    if (status) {
      status.textContent = value
        ? 'Connected to bridge'
        : bridgeSecret
          ? 'Bridge offline'
          : 'Set up the bridge secret';
    }
  }

  function buildUi() {
    if (document.getElementById('ggap-root')) return;

    const root = document.createElement('div');
    root.id = 'ggap-root';
    root.innerHTML = `
      <button id="ggap-toggle" type="button">
        <span id="ggap-dot" class="ggap-dot ggap-dot-off"></span>
        <span>GG Autopick</span>
      </button>
      <div id="ggap-panel" class="ggap-panel">
        <div class="ggap-head">
          <span id="ggap-status">Set up the bridge secret</span>
          <span class="ggap-head-actions">
            <button id="ggap-editor" type="button" title="Map Editor">Maps</button>
            <button id="ggap-settings" type="button" title="Settings">Settings</button>
          </span>
        </div>
        <div class="ggap-row">
          <input id="ggap-input" type="text" placeholder="comp NM" autocomplete="off" />
          <button id="ggap-apply" type="button">Apply</button>
        </div>
        <div id="ggap-log" class="ggap-log"></div>
      </div>
    `;
    document.body.appendChild(root);

    const modal = document.createElement('div');
    modal.id = 'ggap-modal';
    modal.className = 'ggap-modal';
    modal.innerHTML = `
      <div class="ggap-modal-card">
        <div class="ggap-modal-head">
          <strong>GeoGuessr Party Autopick</strong>
          <button id="ggap-modal-close" type="button">Close</button>
        </div>
        <p class="ggap-help">Paste the same secret that is in your <code>.env</code> file. You can find it by running <code>npm run setup</code> again.</p>
        <label class="ggap-label">Bridge URL</label>
        <input id="ggap-bridge-url" type="text" spellcheck="false" />
        <label class="ggap-label">Bridge secret</label>
        <input id="ggap-bridge-secret" type="password" spellcheck="false" />
        <div class="ggap-actions">
          <button id="ggap-save" type="button">Save</button>
          <button id="ggap-open-editor" type="button">Open Map Editor</button>
          <button id="ggap-test" type="button">Test connection</button>
          <button id="ggap-resolve" type="button">Resolve all maps</button>
          <button id="ggap-clear" type="button">Clear cached IDs</button>
          <button id="ggap-reload" type="button">Reload bridge config</button>
        </div>
        <pre id="ggap-modal-log" class="ggap-modal-log"></pre>
        <p class="ggap-help">Discord flow: right-click your friend's message &rarr; Apps &rarr; Apply to GeoGuessr.</p>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('ggap-toggle').addEventListener('click', () => {
      panelOpen = !panelOpen;
      document.getElementById('ggap-panel').classList.toggle('ggap-open', panelOpen);
    });

    document.getElementById('ggap-apply').addEventListener('click', submitManual);
    document.getElementById('ggap-input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submitManual();
    });
    document.getElementById('ggap-editor').addEventListener('click', openMapEditor);
    document.getElementById('ggap-settings').addEventListener('click', openSettings);
    document.getElementById('ggap-open-editor').addEventListener('click', openMapEditor);
    document.getElementById('ggap-modal-close').addEventListener('click', closeSettings);
    document.getElementById('ggap-save').addEventListener('click', saveSettings);
    document.getElementById('ggap-test').addEventListener('click', testBridge);
    document.getElementById('ggap-resolve').addEventListener('click', resolveAllMaps);
    document.getElementById('ggap-reload').addEventListener('click', reloadBridgeConfig);

    document.getElementById('ggap-clear').addEventListener('click', async () => {
      mapCache = {};
      saveMapCache();
      deleteValue('mapIdCache');
      try {
        await bridgePost('/clearcache', {}, 8000);
      } catch {
        /* ignore */
      }
      const log = document.getElementById('ggap-modal-log');
      if (log) log.textContent = 'Cleared cached map IDs locally and on the bridge.';
    });

    setConnected(false);
    if (bridgeSecret) setLog('Ready. Right-click a Discord message and choose Apply to GeoGuessr.', null);
  }

  function openMapEditor() {
    if (!bridgeSecret) {
      setLog('Set the bridge secret first, then open the Map Editor.', false);
      openSettings();
      return;
    }
    const url = `${bridgeUrl}/editor#secret=${encodeURIComponent(bridgeSecret)}`;
    window.open(url, '_blank', 'noopener');
  }

  function openSettings() {
    const modal = document.getElementById('ggap-modal');
    if (!modal) return;
    document.getElementById('ggap-bridge-url').value = bridgeUrl;
    document.getElementById('ggap-bridge-secret').value = bridgeSecret;
    modal.classList.add('ggap-open');
  }

  function closeSettings() {
    const modal = document.getElementById('ggap-modal');
    if (modal) modal.classList.remove('ggap-open');
  }

  function saveSettings() {
    const url = document.getElementById('ggap-bridge-url').value.trim() || DEFAULT_BRIDGE_URL;
    const secret = document.getElementById('ggap-bridge-secret').value.trim();
    bridgeUrl = url.replace(/\/+$/, '');
    bridgeSecret = secret;
    setValue('bridgeUrl', bridgeUrl);
    setValue('bridgeSecret', bridgeSecret);
    setLog('Saved. Connecting...', null);
    closeSettings();
    connected = false;
    loadRemoteConfig();
    if (!polling) pollLoop();
  }

  async function pollLoop() {
    if (polling) return;
    if (!bridgeSecret) {
      setConnected(false);
      setTimeout(pollLoop, 3000);
      return;
    }

    polling = true;
    try {
      const response = await bridgeGet('/next', 32000);

      if (response.status === 401) {
        setConnected(false);
        setLog('Bridge secret is wrong. Open Settings and paste the secret from .env.', false);
        await sleep(5000);
      } else if (response.status >= 500) {
        setConnected(false);
        setLog(`Bridge error ${response.status}. Check the terminal running npm start.`, false);
        await sleep(3000);
      } else {
        setConnected(true);
        if (response.status === 200) {
          const job = JSON.parse(response.responseText || '{}');
          await handleJob(job);
        }
      }
    } catch (error) {
      if (connected) setLog(error.message, false);
      setConnected(false);
      await sleep(3000);
    } finally {
      polling = false;
    }

    setTimeout(pollLoop, 250);
  }

  function addStyle() {
    const css = `
      #ggap-root {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483000;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #fff;
        font-size: 12px;
      }
      #ggap-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
        padding: 9px 12px;
        border: 0;
        border-radius: 999px;
        background: #111827;
        color: #fff;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(0,0,0,.35);
      }
      #ggap-panel {
        display: none;
        width: 320px;
        margin-top: 8px;
        padding: 12px;
        border: 1px solid #374151;
        border-radius: 12px;
        background: #111827;
        box-shadow: 0 16px 48px rgba(0,0,0,.45);
      }
      #ggap-panel.ggap-open { display: block; }
      .ggap-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
      .ggap-head-actions { display: flex; gap: 6px; }
      #ggap-status { color: #d1d5db; font-weight: 600; }
      #ggap-settings, #ggap-apply, .ggap-actions button, #ggap-modal-close {
        border: 0;
        border-radius: 8px;
        background: #374151;
        color: #fff;
        padding: 7px 10px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      #ggap-settings:hover, #ggap-apply:hover, .ggap-actions button:hover, #ggap-modal-close:hover { background: #4b5563; }
      .ggap-row { display: flex; gap: 8px; }
      #ggap-input, #ggap-bridge-url, #ggap-bridge-secret {
        flex: 1;
        min-width: 0;
        box-sizing: border-box;
        border: 1px solid #4b5563;
        border-radius: 8px;
        background: #030712;
        color: #fff;
        padding: 9px 10px;
        font: inherit;
        outline: none;
      }
      #ggap-input:focus, #ggap-bridge-url:focus, #ggap-bridge-secret:focus { border-color: #60a5fa; }
      #ggap-log { min-height: 18px; margin-top: 9px; color: #9ca3af; line-height: 1.35; white-space: pre-wrap; }
      #ggap-log.ggap-ok { color: #86efac; }
      #ggap-log.ggap-bad { color: #fca5a5; }
      .ggap-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
      .ggap-dot-on { background: #22c55e; box-shadow: 0 0 8px #22c55e; }
      .ggap-dot-off { background: #ef4444; }
      .ggap-modal {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 2147483001;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,.65);
        backdrop-filter: blur(4px);
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .ggap-modal.ggap-open { display: flex; }
      .ggap-modal-card {
        width: 620px;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 32px);
        overflow: auto;
        box-sizing: border-box;
        padding: 20px;
        border: 1px solid #374151;
        border-radius: 14px;
        background: #111827;
        color: #fff;
        font-size: 13px;
      }
      .ggap-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
      .ggap-label { display: block; margin: 10px 0 5px; color: #d1d5db; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
      .ggap-help { color: #9ca3af; line-height: 1.45; margin: 0 0 10px; }
      .ggap-help code { background: #1f2937; padding: 1px 4px; border-radius: 4px; }
      .ggap-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
      .ggap-actions button { background: #2563eb; }
      .ggap-actions button:hover { background: #1d4ed8; }
      #ggap-clear { background: #b91c1c !important; }
      #ggap-clear:hover { background: #991b1b !important; }
      .ggap-modal-log {
        min-height: 70px;
        max-height: 220px;
        overflow: auto;
        margin: 14px 0 0;
        padding: 10px;
        border-radius: 8px;
        background: #030712;
        color: #d1d5db;
        font-size: 12px;
        white-space: pre-wrap;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      }
    `;
    if (typeof GM_addStyle === 'function') GM_addStyle(css);
    else {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  function boot() {
    addStyle();
    buildUi();
    setConnected(false);
    if (bridgeSecret) {
      setLog('Ready. Right-click a Discord message and choose Apply to GeoGuessr.', null);
      loadRemoteConfig();
    } else {
      setLog('Open Settings and paste the bridge secret from .env.', null);
      setTimeout(openSettings, 500);
    }
    pollLoop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
