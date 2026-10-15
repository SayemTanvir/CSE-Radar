'use strict';
if (typeof importScripts === 'function') importScripts('core.js', 'feed.js');
const extensionAPI = typeof browser !== 'undefined' ? browser : chrome;
const DAILY_ALARM = 'radar:reconcile';
const FEED_ALARM = 'radar:feed';
const REMINDER_PREFIX = 'radar:reminder:';
// Chromium permits 500 active alarms. Keep room for maintenance and draft
// expiry; the next pending reminders enter this queue after each delivery.
const MAX_REMINDER_ALARMS = 490;
const DRAFT_ALARM = 'radar:drafts';
const DRAFT_TTL = 24 * 60 * 60 * 1000;
const DRAFT_ERROR = 'This captured event draft is unavailable or expired. Capture the page again.';
let workQueue = Promise.resolve();
let bundledCatalogPromise;
function serial(task) {
  workQueue = workQueue.then(task).catch(error => console.error('CSE Radar:', error));
  return workQueue;
}
function validSaved(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => { try { return [RadarCore.validateEvent(item)]; } catch (_) { return []; } });
}
async function reconcile() {
  const stored = await extensionAPI.storage.local.get(['radarSaved', 'radarReminderHours', 'radarDelivered']);
  const events = validSaved(stored.radarSaved);
  const now = Date.now();
  const plan = RadarCore.reminderPlan(events, stored.radarReminderHours ?? 24, now);
  const delivered = stored.radarDelivered && typeof stored.radarDelivered === 'object' ? stored.radarDelivered : {};
  const pending = plan.filter(entry => !delivered[entry.key])
    .sort((left, right) => left.when - right.when || left.target - right.target || left.key.localeCompare(right.key))
    .slice(0, MAX_REMINDER_ALARMS);
  const wanted = new Map(pending.map(entry => [REMINDER_PREFIX + entry.key, entry]));
  const existing = await extensionAPI.alarms.getAll();
  const existingByName = new Map(existing.map(alarm => [alarm.name, alarm]));
  for (const alarm of existing) {
    if (alarm.name.startsWith(REMINDER_PREFIX) && !wanted.has(alarm.name)) await extensionAPI.alarms.clear(alarm.name);
  }
  for (const [name, entry] of wanted) {
    const alarm = existingByName.get(name);
    // Recreating a catch-up alarm on every delivery would continually postpone
    // other overdue reminders. Keep an existing earlier catch-up time, while
    // still honoring preference changes that move a reminder into the future.
    if (alarm && (alarm.scheduledTime === entry.when ||
      (entry.when === now + 1000 && Number.isFinite(alarm.scheduledTime) && alarm.scheduledTime <= entry.when))) continue;
    await extensionAPI.alarms.create(name, { when: entry.when });
  }
  if (existingByName.get(DAILY_ALARM)?.periodInMinutes !== 1440) await extensionAPI.alarms.create(DAILY_ALARM, { periodInMinutes: 1440 });
  // Keep only delivery markers for targets still represented in the saved list.
  const currentKeys = new Set(RadarCore.reminderPlan(events, 24, now).map(entry => entry.key));
  const retained = Object.fromEntries(Object.entries(delivered).filter(([key]) => currentKeys.has(key)));
  if (JSON.stringify(retained) !== JSON.stringify(delivered)) await extensionAPI.storage.local.set({ radarDelivered: retained });
}
async function deliver(alarm) {
  const stored = await extensionAPI.storage.local.get(['radarSaved', 'radarReminderHours', 'radarDelivered']);
  const key = alarm.name.slice(REMINDER_PREFIX.length);
  const delivered = stored.radarDelivered && typeof stored.radarDelivered === 'object' ? stored.radarDelivered : {};
  if (delivered[key]) return;
  const entry = RadarCore.reminderPlan(validSaved(stored.radarSaved), stored.radarReminderHours ?? 24).find(item => item.key === key);
  if (!entry) return;
  const allDay = entry.kind === 'start' && entry.event.allDay;
  const time = allDay ? entry.event.start.slice(0, 10) : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: entry.event.timezone }).format(entry.target);
  await extensionAPI.notifications.create(REMINDER_PREFIX + key, {
    type: 'basic', iconUrl: extensionAPI.runtime.getURL('icons/radar-128.png'),
    title: entry.kind === 'deadline' ? 'Registration deadline approaching' : 'Your event is coming up',
    message: `${entry.event.title}\n${time}${allDay ? '\nDate-only event; check organizer for exact times.' : ' (' + entry.event.timezone + ')'}\nClick to open the official event page.`
  });
  delivered[key] = Date.now();
  await extensionAPI.storage.local.set({ radarDelivered: delivered });
  await reconcile();
}
extensionAPI.action.onClicked.addListener(() => extensionAPI.tabs.create({ url: extensionAPI.runtime.getURL('dashboard.html') }));
function bundledCatalog() {
  if (!bundledCatalogPromise) bundledCatalogPromise = (async () => {
    if (typeof fetch !== 'function') return null;
    try {
      const response = await fetch(extensionAPI.runtime.getURL('data/events.json'));
      if (!response.ok) return null;
      return RadarFeed.validateCatalog(await response.json());
    } catch (_) { return null; }
  })();
  return bundledCatalogPromise;
}
async function effectiveCatalog() {
  const bundle = await bundledCatalog();
  const { radarCatalog } = await extensionAPI.storage.local.get('radarCatalog');
  let cached;
  try { cached = RadarFeed.validateCatalog(radarCatalog); } catch (_) { cached = null; }
  return cached && (!bundle || cached.updatedAt >= bundle.updatedAt) ? cached : bundle;
}
async function syncSaved() {
  const catalog = await effectiveCatalog();
  const { radarSaved } = await extensionAPI.storage.local.get('radarSaved');
  const saved = RadarFeed.reconcileSaved(radarSaved, catalog);
  if (JSON.stringify(saved) !== JSON.stringify(radarSaved || [])) await extensionAPI.storage.local.set({ radarSaved: saved });
  await reconcile();
  return { ok: true, saved };
}
async function mutateSaved(message) {
  const catalog = await effectiveCatalog();
  const { radarSaved } = await extensionAPI.storage.local.get('radarSaved');
  let saved = RadarFeed.reconcileSaved(radarSaved, catalog);
  if (message.type === 'radar:save') {
    let event = RadarCore.validateEvent(message.event);
    if (event.id.startsWith('custom-') && event.deadline && event.end && Date.parse(event.deadline) > Date.parse(event.end)) throw new Error('Registration deadline must not follow event end.');
    if (!event.id.startsWith('custom-') && catalog) event = catalog.events.find(item => item.id === event.id) || event;
    saved = saved.filter(item => item.id !== event.id).concat(event);
  } else {
    if (typeof message.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(message.id)) throw new Error('Invalid event id.');
    saved = saved.filter(item => item.id !== message.id);
  }
  await extensionAPI.storage.local.set({ radarSaved: saved });
  await reconcile();
  return { ok: true, saved };
}
function draftRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid captured event.');
  const prototype = Object.getPrototypeOf(value);
  if (prototype && Object.getPrototypeOf(prototype) !== null) throw new Error('Invalid captured event.');
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (descriptor.get || descriptor.set) throw new Error('Invalid captured event.');
  return value;
}
function draftField(value, key) { return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined; }
function draftText(value, limit) {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('Invalid captured text.');
  return value.trim();
}
function draftPageURL(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid captured source.');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid captured source.');
  return url.href;
}
function draftCandidate(raw) {
  raw = draftRecord(raw);
  const candidate = {};
  for (const [key, limit] of [['title', 180], ['organizer', 180], ['description', 2000], ['country', 120], ['city', 120], ['fee', 180]]) candidate[key] = draftText(draftField(raw, key) ?? '', limit);
  const url = draftField(raw, 'url');
  if (url === null || url === '' || url === undefined) candidate.url = url === '' ? '' : null;
  else {
    if (typeof url !== 'string' || url.length > 2048 || !RadarCore.safeUrl(url)) throw new Error('Invalid captured link.');
    candidate.url = RadarCore.safeUrl(url);
  }
  for (const key of ['start', 'end', 'deadline']) {
    const date = draftField(raw, key);
    if (date === null || date === undefined) candidate[key] = null;
    else if (RadarCore.validDate(date)) candidate[key] = date;
    else throw new Error('Invalid captured date.');
  }
  const allDay = draftField(raw, 'allDay');
  if (allDay !== undefined && typeof allDay !== 'boolean') throw new Error('Invalid captured date.');
  candidate.allDay = allDay === true;
  for (const [key, allowed] of [['mode', RadarCore.modes], ['category', RadarCore.categories]]) {
    const value = draftField(raw, key) ?? '';
    if (value !== '' && !allowed.includes(value)) throw new Error('Invalid captured event.');
    candidate[key] = value;
  }
  const status = draftField(raw, 'status');
  if (status !== undefined) {
    if (status !== 'cancelled') throw new Error('Invalid captured status.');
    candidate.status = status;
  }
  return candidate;
}
function draftCapture(raw, candidateIndex) {
  raw = draftRecord(raw);
  const candidates = draftField(raw, 'candidates');
  const warnings = draftField(raw, 'warnings');
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 20 || !Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex >= candidates.length || !Array.isArray(warnings) || warnings.length > 12) throw new Error('Invalid captured event.');
  // Validate the full envelope atomically even though only the chosen candidate is stored.
  const validated = Array.from(candidates, draftCandidate);
  const capturedAt = draftField(raw, 'capturedAt');
  if (!RadarCore.validDate(capturedAt) || capturedAt.length <= 10) throw new Error('Invalid captured timestamp.');
  const sourcePageUrl = draftField(raw, 'sourcePageUrl');
  if (sourcePageUrl !== undefined && sourcePageUrl !== '') draftPageURL(sourcePageUrl);
  return { pageUrl: draftPageURL(draftField(raw, 'pageUrl')), pageTitle: draftText(draftField(raw, 'pageTitle'), 180), capturedAt, candidate: validated[candidateIndex], warnings: Array.from(warnings, value => draftText(value, 220)) };
}
async function pruneDrafts() {
  const { radarDrafts } = await extensionAPI.storage.local.get('radarDrafts');
  const now = Date.now();
  const drafts = (Array.isArray(radarDrafts) ? radarDrafts : []).flatMap(raw => {
    try {
      raw = draftRecord(raw);
      if (typeof draftField(raw, 'id') !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(raw.id) || !Number.isFinite(draftField(raw, 'createdAt')) || raw.createdAt > now || now - raw.createdAt >= DRAFT_TTL) return [];
      const capture = draftCapture({ pageUrl: draftField(raw, 'pageUrl'), pageTitle: draftField(raw, 'pageTitle'), capturedAt: draftField(raw, 'capturedAt'), candidates: [draftField(raw, 'candidate')], warnings: draftField(raw, 'warnings') }, 0);
      return [{ id: raw.id, createdAt: raw.createdAt, ...capture }];
    } catch (_) { return []; }
  }).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
  if (JSON.stringify(drafts) !== JSON.stringify(radarDrafts || [])) await extensionAPI.storage.local.set({ radarDrafts: drafts });
  await scheduleDraftExpiry(drafts);
  return drafts;
}
async function scheduleDraftExpiry(drafts) {
  if (drafts.length) await extensionAPI.alarms.create(DRAFT_ALARM, { when: Math.min(...drafts.map(draft => draft.createdAt)) + DRAFT_TTL });
  else await extensionAPI.alarms.clear(DRAFT_ALARM);
}
async function draftMessage(message) {
  let drafts = await pruneDrafts();
  if (message.type === 'radar:draft:create') {
    const capture = draftCapture(message.capture, message.candidateIndex);
    const id = crypto.randomUUID();
    const draft = { id, createdAt: Date.now(), ...capture };
    drafts = [draft, ...drafts].slice(0, 10);
    await extensionAPI.storage.local.set({ radarDrafts: drafts });
    await scheduleDraftExpiry(drafts);
    return { ok: true, id, url: extensionAPI.runtime.getURL('dashboard.html') + '?draft=' + id };
  }
  if (typeof message.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(message.id)) throw new Error(DRAFT_ERROR);
  if (message.type === 'radar:draft:delete') {
    const retained = drafts.filter(draft => draft.id !== message.id);
    await extensionAPI.storage.local.set({ radarDrafts: retained });
    await scheduleDraftExpiry(retained);
    return { ok: true };
  }
  const draft = drafts.find(item => item.id === message.id);
  if (!draft) throw new Error(DRAFT_ERROR);
  const { createdAt, ...publicDraft } = draft;
  return { ok: true, draft: publicDraft };
}
async function feedSchedule() {
  if (await RadarFeed.allowed(extensionAPI)) await extensionAPI.alarms.create(FEED_ALARM, { periodInMinutes: 360 });
  else await extensionAPI.alarms.clear(FEED_ALARM);
}
async function refreshCatalog() {
  await feedSchedule();
  const result = await RadarFeed.refresh(extensionAPI, { minimumCatalog: await bundledCatalog() });
  // Call directly inside this queue: enqueueing and awaiting reconcile would deadlock.
  await syncSaved();
  return result;
}
extensionAPI.runtime.onInstalled.addListener(() => serial(async () => { await pruneDrafts(); await refreshCatalog(); }));
extensionAPI.runtime.onStartup.addListener(() => serial(async () => { await pruneDrafts(); await refreshCatalog(); }));
extensionAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !['radar:refresh', 'radar:save', 'radar:remove', 'radar:sync-saved', 'radar:draft:create', 'radar:draft:get', 'radar:draft:delete'].includes(message.type) || !sender || sender.id !== extensionAPI.runtime.id) return false;
  serial(async () => {
    try { sendResponse(await (message.type.startsWith('radar:draft:') ? draftMessage(message) : message.type === 'radar:refresh' ? refreshCatalog() : message.type === 'radar:sync-saved' ? syncSaved() : mutateSaved(message))); }
    catch (_) { sendResponse({ ok: false, status: { error: message.type.startsWith('radar:draft:') ? (message.type === 'radar:draft:create' ? 'Could not capture this event. Check the page and try again.' : DRAFT_ERROR) : 'Could not update CSE Radar. Try again.' } }); }
  });
  return true;
});
extensionAPI.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.radarSaved || changes.radarReminderHours)) serial(reconcile);
  if (area === 'local' && changes.radarFeedEnabled) serial(feedSchedule);
});
if (extensionAPI.permissions && extensionAPI.permissions.onRemoved) extensionAPI.permissions.onRemoved.addListener(() => serial(async () => {
  if (!await extensionAPI.permissions.contains({ origins: [RadarFeed.FEED_ORIGIN] })) await extensionAPI.storage.local.set({ radarFeedEnabled: false });
  await feedSchedule();
}));
extensionAPI.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === DRAFT_ALARM) serial(pruneDrafts);
  else if (alarm.name === DAILY_ALARM || alarm.name === FEED_ALARM) serial(refreshCatalog);
  else if (alarm.name.startsWith(REMINDER_PREFIX)) serial(() => deliver(alarm));
});
extensionAPI.notifications.onClicked.addListener(id => serial(async () => {
  if (id === 'radar:test') {
    await extensionAPI.tabs.create({ url: extensionAPI.runtime.getURL('dashboard.html') });
    await extensionAPI.notifications.clear(id);
    return;
  }
  if (!id.startsWith(REMINDER_PREFIX)) return;
  const key = id.slice(REMINDER_PREFIX.length);
  const { radarSaved } = await extensionAPI.storage.local.get('radarSaved');
  const eventId = key.split(':')[0];
  const event = validSaved(radarSaved).find(item => item.id === eventId);
  if (event && event.status !== 'cancelled') await extensionAPI.tabs.create({ url: event.url });
  await extensionAPI.notifications.clear(id);
}));
