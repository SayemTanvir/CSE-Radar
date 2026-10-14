'use strict';
if (typeof importScripts === 'function') importScripts('core.js');
const extensionAPI = typeof browser !== 'undefined' ? browser : chrome;
const DAILY_ALARM = 'radar:reconcile';
const REMINDER_PREFIX = 'radar:reminder:';
let workQueue = Promise.resolve();
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
extensionAPI.runtime.onInstalled.addListener(() => serial(reconcile));
extensionAPI.runtime.onStartup.addListener(() => serial(reconcile));
extensionAPI.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.radarSaved || changes.radarReminderHours)) serial(reconcile);
});
extensionAPI.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === DAILY_ALARM) serial(reconcile);
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
