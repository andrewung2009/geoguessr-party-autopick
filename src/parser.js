'use strict';

const MODE_ALIASES = {
  move: ['move', 'moving', 'mv'],
  nm: ['nm', 'no move', 'nomove', 'no moving'],
  nmpz: ['nmpz', 'no move no pan no zoom', 'no move no pan', 'no pan no zoom']
};

const MODE_LABELS = {
  move: 'Move',
  nm: 'NM',
  nmpz: 'NMPZ'
};

const MODE_FLAGS = {
  move: { forbidMoving: false, forbidZooming: false, forbidRotating: false },
  nm: { forbidMoving: true, forbidZooming: false, forbidRotating: false },
  nmpz: { forbidMoving: true, forbidZooming: true, forbidRotating: true }
};

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeWords(value) {
  const text = normalize(value);
  return text ? text.split(' ') : [];
}

function modeLabel(mode) {
  return MODE_LABELS[mode] || null;
}

function modeFlags(mode) {
  return MODE_FLAGS[mode] ? { ...MODE_FLAGS[mode] } : null;
}

function modeSuffixCandidates() {
  const list = [];
  for (const [mode, aliases] of Object.entries(MODE_ALIASES)) {
    for (const alias of aliases) {
      const words = normalizeWords(alias);
      if (words.length === 0) continue;
      list.push({ mode, alias, words, length: words.length });
    }
  }
  return list.sort((a, b) => b.length - a.length || b.alias.length - a.alias.length);
}

const SUFFIX_CANDIDATES = modeSuffixCandidates();

function parseCommand(raw) {
  const normalized = normalize(raw);
  if (!normalized) {
    return { mapQuery: null, mode: null, normalized, error: 'The message is empty.' };
  }

  const tokens = normalized.split(' ');

  for (const candidate of SUFFIX_CANDIDATES) {
    if (tokens.length < candidate.length) continue;
    const suffix = tokens.slice(tokens.length - candidate.length).join(' ');
    if (suffix !== candidate.words.join(' ')) continue;

    const remaining = tokens.slice(0, tokens.length - candidate.length);
    const mapQuery = remaining.length > 0 ? remaining.join(' ') : null;
    return { mapQuery, mode: candidate.mode, normalized };
  }

  return { mapQuery: normalized, mode: null, normalized };
}

function acronym(value) {
  const words = normalizeWords(value).filter(
    (word) => !['a', 'an', 'the', 'of', 'in', 'and'].includes(word)
  );
  if (words.length < 2) return '';
  return words.map((word) => word[0]).join('');
}

function buildMapIndex(maps) {
  const exact = new Map();
  const candidates = [];
  const conflicts = [];

  function add(map, text, priority, source) {
    const norm = normalize(text);
    if (!norm) return;

    candidates.push({ map, text, norm, priority, source });

    const existing = exact.get(norm);
    if (!existing) {
      exact.set(norm, { map, priority, text, source });
      return;
    }

    const sameTarget =
      existing.map.shorthand === map.shorthand ||
      (existing.map.mapId && existing.map.mapId === map.mapId) ||
      (existing.map.geoguessrName && existing.map.geoguessrName === map.geoguessrName);

    if (!sameTarget) {
      conflicts.push({
        alias: norm,
        kept: existing.map.shorthand,
        ignored: map.shorthand,
        source
      });
    }

    if (priority > existing.priority) {
      exact.set(norm, { map, priority, text, source });
    }
  }

  for (const map of maps) {
    add(map, map.shorthand, 4, 'shorthand');
    if (map.geoguessrName) add(map, map.geoguessrName, 3, 'geoguessrName');
    for (const alias of map.aliases) add(map, alias, 5, 'alias');
  }

  return { exact, candidates, conflicts };
}

function scoreCandidate(candidate, query) {
  const text = candidate.norm;
  if (!text || !query) return 0;
  if (text === query) return 1000;

  if (text.startsWith(`${query} `)) {
    return 900 - Math.min(50, text.length - query.length);
  }
  if (text.startsWith(query)) {
    return 880 - Math.min(50, text.length - query.length);
  }

  const words = text.split(' ');
  if (words.includes(query)) return 800;
  if (words.some((word) => word.startsWith(query))) {
    return 700 - Math.min(50, query.length);
  }
  if (text.includes(query)) return 600 - Math.min(50, query.length);

  return 0;
}

function resolveMap(query, index) {
  const q = normalize(query);
  if (!q) return { map: null, reason: 'empty' };

  const exact = index.exact.get(q);
  if (exact) return { map: exact.map, exact: true };

  const bestByMap = new Map();

  for (const candidate of index.candidates) {
    const score = scoreCandidate(candidate, q);
    if (score <= 0) continue;

    const current = bestByMap.get(candidate.map.shorthand);
    if (!current || score > current.score || (score === current.score && candidate.priority > current.priority)) {
      bestByMap.set(candidate.map.shorthand, {
        map: candidate.map,
        score,
        priority: candidate.priority
      });
    }
  }

  const ranked = [...bestByMap.values()].sort(
    (a, b) =>
      b.score - a.score ||
      b.priority - a.priority ||
      (b.map.weight || 0) - (a.map.weight || 0) ||
      a.map.shorthand.localeCompare(b.map.shorthand)
  );

  if (ranked.length === 0) {
    return { map: null, reason: 'not-found', candidates: [] };
  }

  const top = ranked[0];
  const second = ranked[1];

  if (second && top.score - second.score < 50) {
    return {
      map: null,
      reason: 'ambiguous',
      candidates: ranked.slice(0, 5).map((entry) => entry.map)
    };
  }

  return { map: top.map };
}

function pickSearchResult(query, results) {
  const q = normalize(query);
  const list = (Array.isArray(results) ? results : [])
    .filter((item) => item && item.id && item.name)
    .slice()
    .sort((a, b) => (Number(b.likes) || 0) - (Number(a.likes) || 0));

  if (list.length === 0) return { result: null, candidates: [] };

  const exact = list.find((item) => normalize(item.name) === q);
  if (exact) return { result: exact, exact: true };

  const starts = list.find((item) => normalize(item.name).startsWith(q));
  if (starts) return { result: starts };

  const includes = list.find((item) => normalize(item.name).includes(q));
  if (includes) return { result: includes };

  if (list.length === 1) return { result: list[0] };

  return { result: null, candidates: list.slice(0, 5) };
}

function weightedRandomMap(maps, random = Math.random) {
  const pool = maps.filter((map) => Number(map.weight) > 0);
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, map) => sum + Number(map.weight), 0);
  let roll = random() * total;
  for (const map of pool) {
    roll -= Number(map.weight);
    if (roll < 0) return map;
  }
  return pool[pool.length - 1];
}

module.exports = {
  MODE_ALIASES,
  MODE_LABELS,
  MODE_FLAGS,
  normalize,
  normalizeWords,
  modeLabel,
  modeFlags,
  parseCommand,
  buildMapIndex,
  resolveMap,
  pickSearchResult,
  weightedRandomMap,
  acronym
};
