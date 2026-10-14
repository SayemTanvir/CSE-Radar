'use strict';
if (typeof importScripts === 'function') importScripts('core.js', 'feed.js');
const extensionAPI = typeof browser !== 'undefined' ? browser : chrome;
const DAILY_ALARM = 'radar:reconcile';
const FEED_ALARM = 'radar:feed';
const REMINDER_PREFIX = 'radar:reminder:';
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
  const wanted = new Map(plan.filter(entry => !delivered[entry.key]).map(entry => [REMINDER_PREFIX + entry.key, entry]));
  const existing = await extensionAPI.alarms.getAll();
  for (const alarm of existing) {
    if (alarm.name.startsWith(REMINDER_PREFIX) && !wanted.has(alarm.name)) await extensionAPI.alarms.clear(alarm.name);
  }
  for (const [name, entry] of wanted) await extensionAPI.alarms.create(name, { when: entry.when });
  await extensionAPI.alarms.create(DAILY_ALARM, { periodInMinutes: 1440 });
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
extensionAPI.runtime.onInstalled.addListener(() => serial(refreshCatalog));
extensionAPI.runtime.onStartup.addListener(() => serial(refreshCatalog));
extensionAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !['radar:refresh', 'radar:save', 'radar:remove', 'radar:sync-saved'].includes(message.type) || !sender || sender.id !== extensionAPI.runtime.id) return false;
  serial(async () => {
    try { sendResponse(await (message.type === 'radar:refresh' ? refreshCatalog() : message.type === 'radar:sync-saved' ? syncSaved() : mutateSaved(message))); }
    catch (_) { sendResponse({ ok: false, status: { error: 'Could not update CSE Radar. Try again.' } }); }
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
  if (alarm.name === DAILY_ALARM || alarm.name === FEED_ALARM) serial(refreshCatalog);
  else if (alarm.name.startsWith(REMINDER_PREFIX)) serial(() => deliver(alarm));
});
extensionAPI.notifications.onClicked.addListener(id => serial(async () => {
  if (!id.startsWith(REMINDER_PREFIX)) return;
  const key = id.slice(REMINDER_PREFIX.length);
  const { radarSaved } = await extensionAPI.storage.local.get('radarSaved');
  const eventId = key.split(':')[0];
  const event = validSaved(radarSaved).find(item => item.id === eventId);
  if (event && event.status !== 'cancelled') await extensionAPI.tabs.create({ url: event.url });
  await extensionAPI.notifications.clear(id);
}));
