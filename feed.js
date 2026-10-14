(function (root) {
  'use strict';
  const core = root.RadarCore || (typeof require === 'function' ? require('./core.js') : null);
  const FEED_URL = 'https://raw.githubusercontent.com/SayemTanvir/CSE-Radar/main/data/events.json';
  const FEED_ORIGIN = 'https://raw.githubusercontent.com/*';
  const MAX_BYTES = 2 * 1024 * 1024;
  let queue = Promise.resolve();
  function timestamp(now) { return new Date(typeof now === 'function' ? now() : now ?? Date.now()).getTime(); }
  function validateCatalog(raw, options = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !core.validDate(raw.updatedAt, true) || !Array.isArray(raw.events) || raw.events.length > 1000) throw new Error('Invalid catalog schema.');
    const tomorrow = new Date(timestamp(options.now) + 86400000).toISOString().slice(0, 10);
    if (raw.updatedAt > tomorrow) throw new Error('Catalog date is in the future.');
    if (options.currentCatalog && core.validDate(options.currentCatalog.updatedAt, true) && raw.updatedAt < options.currentCatalog.updatedAt) throw new Error('Catalog is older than the saved version.');
    if (options.minimumCatalog && core.validDate(options.minimumCatalog.updatedAt, true) && raw.updatedAt < options.minimumCatalog.updatedAt) throw new Error('Catalog is older than the bundled version.');
    const ids = new Set();
    const events = raw.events.map(item => {
      const event = core.validateEvent(item);
      if (/^(custom|candidate)-/.test(event.id) || ids.has(event.id)) throw new Error('Duplicate or reserved event id.');
      if (event.lastChecked > raw.updatedAt) throw new Error('Invalid catalog verification date.');
      ids.add(event.id);
      return event;
    });
    return { updatedAt: raw.updatedAt, events };
  }
  function reconcileSaved(saved, catalog) {
    const reviewed = new Map((catalog && Array.isArray(catalog.events) ? catalog.events : []).map(event => [event.id, event]));
    if (!Array.isArray(saved)) return [];
    return saved.flatMap(raw => {
      try {
        const event = core.validateEvent(raw);
        return [event.id.startsWith('custom-') ? event : reviewed.get(event.id) || event];
      } catch (_) { return []; }
    });
  }
  async function allowed(api) {
    const stored = await api.storage.local.get('radarFeedEnabled');
    return stored.radarFeedEnabled === true && await api.permissions.contains({ origins: [FEED_ORIGIN] });
  }
  async function responseText(response) {
    const length = response.headers && response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new Error('size');
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const chunks = []; let bytes = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) throw new Error('size');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const data = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
      return new TextDecoder('utf-8', { fatal: true }).decode(data);
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('size');
    return text;
  }
  async function performRefresh(api, options) {
    if (!await allowed(api)) return { ok: false, skipped: true, reason: 'disabled' };
    const now = timestamp(options.now);
    const previous = await api.storage.local.get(['radarCatalog', 'radarFeedStatus']);
    let currentCatalog;
    try { currentCatalog = validateCatalog(previous.radarCatalog, { now }); } catch (_) { /* Replace corrupt cache rather than treating its timestamp as authoritative. */ }
    const lastSuccess = previous.radarFeedStatus && previous.radarFeedStatus.lastSuccess || null;
    const status = { lastAttempt: new Date(now).toISOString(), lastSuccess, error: null };
    const controller = new AbortController();
    let timeout;
    try {
      // The timeout covers reading the entire response, not just its headers.
      const task = (async () => {
        const response = await (options.fetch || root.fetch)(FEED_URL, { method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-cache', signal: controller.signal });
        if (!response.ok) throw new Error('http');
        if (response.url && response.url !== FEED_URL) throw new Error('http');
        const text = await responseText(response);
        return validateCatalog(JSON.parse(text), { now, currentCatalog, minimumCatalog: options.minimumCatalog });
      })();
      const catalog = await Promise.race([task, new Promise((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 12000);
      })]);
      // A user may disable updates or revoke permission while a request is running.
      if (!await allowed(api)) return { ok: false, skipped: true, reason: 'disabled' };
      const { radarSaved } = await api.storage.local.get('radarSaved');
      const saved = reconcileSaved(radarSaved, catalog);
      status.lastSuccess = status.lastAttempt;
      const write = { radarCatalog: catalog, radarFeedStatus: status };
      if (JSON.stringify(saved) !== JSON.stringify(radarSaved || [])) write.radarSaved = saved;
      await api.storage.local.set(write);
      return { ok: true, catalog, status };
    } catch (error) {
      if (!await allowed(api)) return { ok: false, skipped: true, reason: 'disabled' };
      status.error = error.message === 'timeout' ? 'Update timed out. Your saved catalog is available.' : error.message === 'size' ? 'The catalog exceeded the download limit. Your saved catalog is available.' : error.message === 'http' ? 'The catalog server is unavailable. Your saved catalog is available.' : error instanceof SyntaxError || /catalog|event|Invalid|Duplicate|reserved/i.test(error.message) ? 'The catalog failed validation. Your saved catalog is available.' : 'Could not download updates. Your saved catalog is available.';
      await api.storage.local.set({ radarFeedStatus: status });
      return { ok: false, status };
    } finally { clearTimeout(timeout); }
  }
  function refresh(api, options = {}) {
    const result = queue.then(() => performRefresh(api, options));
    queue = result.catch(() => {});
    return result;
  }
  const api = { FEED_URL, FEED_ORIGIN, validateCatalog, reconcileSaved, refresh, allowed };
  root.RadarFeed = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
