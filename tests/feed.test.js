'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core.js');
const feed = require('../feed.js');
const fixture = {
  id: 'test-hackathon', title: 'Test hackathon', organizer: 'Example University',
  category: 'hackathon', scope: 'international', country: 'Bangladesh', city: 'Dhaka', mode: 'hybrid',
  start: '2030-01-10T09:00:00+06:00', end: '2030-01-11T18:00:00+06:00',
  deadline: '2030-01-08T23:59:00+06:00', timezone: 'Asia/Dhaka',
  eligibility: 'University students', fee: 'Free', description: 'Build a useful project.',
  url: 'https://example.org/event', registrationUrl: 'https://example.org/register',
  sourceUrl: 'https://example.org/event', lastChecked: '2026-10-14', status: 'confirmed', tags: ['student']
};
const now = () => Date.parse('2026-10-14T12:00:00Z');
const catalog = events => ({ updatedAt: '2026-10-14', events });
function setup(initial = {}) {
  const stored = { radarFeedEnabled: true, radarSaved: [fixture], ...structuredClone(initial) };
  let permitted = true;
  const api = {
    storage: { local: {
      async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(stored[key])])); },
      async set(value) { Object.assign(stored, structuredClone(value)); }
    } },
    permissions: { async contains() { return permitted; } }
  };
  return { api, stored, permit(value) { permitted = value; } };
}
const response = raw => new Response(JSON.stringify(raw), { status: 200 });
async function main() {
  const good = catalog([fixture]);
  assert.equal(feed.validateCatalog(good, { now }).events.length, 1);
  for (const bad of [null, {}, { ...good, updatedAt: '2026-02-30' }, { ...good, updatedAt: '2026-10-16' }, catalog([fixture, fixture]), catalog([{ ...fixture, id: 'custom-forged' }]), catalog([{ ...fixture, id: 'candidate-unreviewed' }]), catalog([{ ...fixture, lastChecked: '2026-10-15' }]), catalog([{ ...fixture, url: 'javascript:bad' }]), catalog([fixture, { id: 'invalid' }]), catalog(Array(1001).fill(fixture))]) assert.throws(() => feed.validateCatalog(bad, { now }));
  assert.throws(() => feed.validateCatalog(good, { now, currentCatalog: { updatedAt: '2026-10-15' } }));
  assert.throws(() => feed.validateCatalog(good, { now, minimumCatalog: { updatedAt: '2026-10-15' } }));
  assert.equal(feed.validateCatalog(catalog([{ ...fixture, title: 'Changed' }]), { now, currentCatalog: good }).events[0].title, 'Changed');
  console.log('PASS catalog validation is atomic, rejects duplicate/reserved IDs, future dates, corruption and downgrades');

  const local = { ...fixture, id: 'custom-owned', title: 'My event' };
  const absent = { ...fixture, id: 'missing-from-feed' };
  const cancelled = { ...fixture, status: 'cancelled' };
  const reconciled = feed.reconcileSaved([fixture, local, absent], catalog([cancelled]));
  assert.equal(reconciled[0].status, 'cancelled');
  assert.deepEqual(reconciled.slice(1), [core.validateEvent(local), core.validateEvent(absent)]);
  console.log('PASS saved reconciliation propagates reviewed cancellations and preserves custom/missing events');

  const state = setup({ radarCatalog: good });
  let calls = 0;
  const fetchGood = async (url, options) => {
    calls++; assert.equal(url, feed.FEED_URL); assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    return response(catalog([cancelled]));
  };
  state.stored.radarFeedEnabled = false;
  assert.equal((await feed.refresh(state.api, { now, fetch: fetchGood })).skipped, true);
  state.stored.radarFeedEnabled = true; state.permit(false);
  assert.equal((await feed.refresh(state.api, { now, fetch: fetchGood })).skipped, true);
  assert.equal(calls, 0); state.permit(true);
  assert.equal((await feed.refresh(state.api, { now, fetch: fetchGood })).ok, true);
  assert.equal(state.stored.radarSaved[0].status, 'cancelled');
  assert.equal(state.stored.radarCatalog.events[0].lastChecked, fixture.lastChecked);
  const snapshot = structuredClone(state.stored.radarCatalog);
  const success = state.stored.radarFeedStatus.lastSuccess;
  for (const badFetch of [async () => { throw new Error('secret network message'); }, async () => response({ ...good, updatedAt: '2026-10-13' }), async () => response(catalog([fixture, { id: 'invalid' }])), async () => new Response('oops', { status: 500 }), async () => new Response('bad json'), async () => new Response('x', { headers: { 'content-length': String(3 * 1024 * 1024) } }), async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
    const result = await feed.refresh(state.api, { now, fetch: badFetch });
    assert.equal(result.ok, false);
    assert.deepEqual(state.stored.radarCatalog, snapshot);
    assert.equal(state.stored.radarFeedStatus.lastSuccess, success);
    assert.ok(state.stored.radarFeedStatus.error);
    assert.ok(!state.stored.radarFeedStatus.error.includes('secret'));
  }
  console.log('PASS opt-in gates requests; offline, oversize, invalid and older downloads retain last good catalog');
  const newerBundle = { ...good, updatedAt: '2026-10-15' };
  const bundledState = setup();
  const bundledResult = await feed.refresh(bundledState.api, { now, minimumCatalog: newerBundle, fetch: async () => response(catalog([cancelled])) });
  assert.equal(bundledResult.ok, false);
  assert.equal(bundledState.stored.radarCatalog, undefined);
  assert.equal(bundledState.stored.radarSaved[0].status, 'confirmed');
  console.log('PASS remote catalog older than the bundled version cannot change saved events');

  const pending = setup(); let release;
  const refresh = feed.refresh(pending.api, { now, fetch: () => new Promise(resolve => { release = resolve; }) });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  pending.stored.radarFeedEnabled = false; release(response(good));
  assert.equal((await refresh).skipped, true);
  assert.equal(pending.stored.radarCatalog, undefined);
  const revoked = setup(); let releaseRevoked;
  const revokedRefresh = feed.refresh(revoked.api, { now, fetch: () => new Promise(resolve => { releaseRevoked = resolve; }) });
  while (!releaseRevoked) await new Promise(resolve => setImmediate(resolve));
  revoked.permit(false); releaseRevoked(response(good));
  assert.equal((await revokedRefresh).skipped, true);
  assert.equal(revoked.stored.radarCatalog, undefined);
  const corruptCache = setup({ radarCatalog: { updatedAt: '2026-10-15', events: [{ id: 'broken' }] } });
  assert.equal((await feed.refresh(corruptCache.api, { now, fetch: async () => response(good) })).ok, true);
  console.log('PASS disabling/revoking during a request prevents writes; corrupt caches can recover');

  const sequential = setup(); let active = 0; let peak = 0;
  const slowFetch = async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--; return response(good);
  };
  const results = await Promise.all([feed.refresh(sequential.api, { now, fetch: slowFetch }), feed.refresh(sequential.api, { now, fetch: slowFetch })]);
  assert.ok(results.every(result => result.ok)); assert.equal(peak, 1);
  const timeoutState = setup({ radarCatalog: good });
  const timeoutSandbox = vm.createContext({ RadarCore: core, module: { exports: {} }, Date, URL, Intl, TextEncoder, TextDecoder, AbortController, setTimeout(callback) { queueMicrotask(callback); return 1; }, clearTimeout() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../feed.js'), 'utf8'), timeoutSandbox);
  const timeoutResult = await timeoutSandbox.module.exports.refresh(timeoutState.api, { now, fetch: async () => new Promise(() => {}) });
  assert.equal(timeoutResult.ok, false); assert.match(timeoutResult.status.error, /timed out/);
  assert.deepEqual(timeoutState.stored.radarCatalog, good);
  console.log('PASS concurrent refreshes serialize and timed-out requests retain the last good catalog');

  const bg = setup(); const alarms = new Map(); const listeners = {};
  const listen = name => ({ addListener(callback) { listeners[name] = callback; } });
  Object.assign(bg.api, {
    alarms: { async getAll() { return [...alarms.values()]; }, async clear(name) { return alarms.delete(name); }, async create(name, value) { alarms.set(name, { name, ...value }); }, onAlarm: listen('alarm') },
    runtime: { id: 'test', getURL: value => 'chrome-extension://test/' + value, onInstalled: listen('install'), onStartup: listen('startup'), onMessage: listen('message') },
    action: { onClicked: listen('action') }, tabs: { async create() {} },
    notifications: { onClicked: listen('notice'), async clear() {}, async create() {} }
  });
  bg.api.storage.onChanged = listen('storage'); bg.api.permissions.onRemoved = listen('permissionRemoved');
  let incoming = catalog([{ ...fixture, start: '2030-02-10T09:00:00+06:00', end: '2030-02-11T18:00:00+06:00' }]);
  let networkGate; let networkEntered = false;
  const sandbox = vm.createContext({ chrome: bg.api, RadarCore: core, RadarFeed: { ...feed, refresh: (api, options) => feed.refresh(api, { ...options, now, fetch: async () => { networkEntered = true; if (networkGate) await networkGate; return response(incoming); } }) }, Date, Intl, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), sandbox);
  await sandbox.reconcile();
  const oldStart = 'radar:reminder:' + fixture.id + ':start:' + Date.parse(fixture.start);
  assert.ok(alarms.has(oldStart));
  const result = await sandbox.refreshCatalog(); assert.equal(result.ok, true);
  assert.equal(alarms.has(oldStart), false);
  assert.ok(alarms.has('radar:reminder:' + fixture.id + ':start:' + Date.parse(incoming.events[0].start)));
  assert.equal(alarms.get('radar:feed').periodInMinutes, 360);
  incoming = catalog([cancelled]); await sandbox.refreshCatalog();
  assert.equal([...alarms.keys()].some(name => name.startsWith('radar:reminder:')), false);
  bg.stored.radarFeedEnabled = false; await sandbox.feedSchedule(); assert.equal(alarms.has('radar:feed'), false);
  assert.equal(listeners.message({ type: 'radar:refresh' }, { id: 'other' }, () => {}), false);
  const reply = new Promise(resolve => assert.equal(listeners.message({ type: 'radar:refresh' }, { id: 'test' }, resolve), true));
  assert.equal((await reply).skipped, true);
  console.log('PASS background refresh reschedules shifted dates, clears cancelled reminders, gates message senders and stops auto refresh');

  const send = message => new Promise(resolve => assert.equal(listeners.message(message, { id: 'test' }, resolve), true));
  bg.stored.radarFeedEnabled = true;
  let releaseNetwork;
  networkGate = new Promise(resolve => { releaseNetwork = resolve; });
  networkEntered = false;
  const refreshing = send({ type: 'radar:refresh' });
  while (!networkEntered) await new Promise(resolve => setImmediate(resolve));
  const saving = send({ type: 'radar:save', event: local });
  releaseNetwork();
  assert.equal((await refreshing).ok, true);
  assert.equal((await saving).ok, true);
  assert.ok(bg.stored.radarSaved.some(event => event.id === local.id));
  assert.equal(bg.stored.radarSaved.find(event => event.id === fixture.id).status, 'cancelled');
  const stale = await send({ type: 'radar:save', event: fixture });
  assert.equal(stale.saved.find(event => event.id === fixture.id).status, 'cancelled');
  const removed = await send({ type: 'radar:remove', id: local.id });
  assert.equal(removed.saved.some(event => event.id === local.id), false);
  assert.equal((await send({ type: 'radar:save', event: { id: 'bad' } })).ok, false);
  assert.equal((await send({ type: 'radar:sync-saved' })).ok, true);
  bg.permit(false); listeners.permissionRemoved(); await sandbox.serial(async () => {});
  assert.equal(bg.stored.radarFeedEnabled, false);
  assert.equal(alarms.has('radar:feed'), false);
  console.log('PASS concurrent refresh/save keeps personal events; stale UI saves use reviewed records; removal and permission revocation persist');

  let minimumPassed;
  const bundledSandbox = vm.createContext({ chrome: bg.api, RadarCore: core, RadarFeed: { ...feed, refresh: async (api, options) => { minimumPassed = options.minimumCatalog; return { ok: false, skipped: true }; } }, fetch: async () => response(newerBundle), Date, Intl, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), bundledSandbox);
  const bundledSync = await bundledSandbox.syncSaved();
  assert.equal(bundledSync.saved.find(event => event.id === fixture.id).status, 'confirmed');
  await bundledSandbox.refreshCatalog();
  assert.equal(minimumPassed.updatedAt, newerBundle.updatedAt);
  console.log('PASS bundled catalog is loaded locally, reconciles saved events, and sets the remote minimum');
  console.log('All CSE Radar feed tests passed.');
}
module.exports = main();
if (require.main === module) module.exports.catch(error => { console.error(error); process.exitCode = 1; });
