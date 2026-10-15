'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core.js');
const fixture = {
  id: 'test-hackathon', title: 'Test hackathon', organizer: 'Example University',
  category: 'hackathon', scope: 'international', country: 'Bangladesh', city: 'Dhaka', mode: 'hybrid',
  start: '2030-01-10T09:00:00+06:00', end: '2030-01-11T18:00:00+06:00',
  deadline: '2030-01-08T23:59:00+06:00', timezone: 'Asia/Dhaka',
  eligibility: 'University students', fee: 'Free', description: 'Build a useful project.',
  url: 'https://example.org/event', registrationUrl: 'https://example.org/register',
  sourceUrl: 'https://example.org/event', lastChecked: '2026-10-14', status: 'confirmed', tags: ['student']
};
function test(name, callback) { callback(); console.log('PASS ' + name); }
function invalid(change) { assert.throws(() => core.validateEvent({ ...fixture, ...change })); }
async function main() {
  test('validation accepts a complete event and removes untrusted extra fields', () => {
    const event = core.validateEvent({ ...fixture, tags: ['student', 'student'], injected: 'ignored' });
    assert.equal(event.injected, undefined);
    assert.deepEqual(event.tags, ['student']);
  });
  test('validation rejects unsafe links and malformed event data', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'http://example.org', 'https://user:pass@example.org', 'not a URL']) invalid({ url });
    invalid({ title: '' }); invalid({ status: 'unknown' }); invalid({ id: 'has:colon' });
    invalid({ category: 'other' }); invalid({ timezone: 'Mars/Olympus' }); invalid({ tags: ['line\nbreak'] });
    invalid({ registrationUrl: 'javascript:alert(1)' });
  });
  test('validation rejects impossible dates, ambiguous times, and non-increasing ranges', () => {
    invalid({ start: '2030-02-30T09:00:00Z' }); invalid({ start: '2030-01-10T25:00:00Z' });
    invalid({ start: '2030-01-10T09:00:00' }); invalid({ start: '2030-01-10' }); invalid({ lastChecked: '2026-02-29' });
    invalid({ end: fixture.start }); invalid({ end: '2030-01-09T00:00:00Z' });
    invalid({ start: null }); invalid({ deadline: undefined });
  });
  test('awaiting-dates events are accepted without invented dates', () => {
    const event = core.validateEvent({ ...fixture, start: null, end: null, deadline: null, status: 'awaiting-dates' });
    assert.equal(event.start, null);
    invalid({ start: null, end: null });
    invalid({ status: 'awaiting-dates' });
  });
  test('ICS uses UTC, CRLF, escaping, official hyperlinks, and unique deadline UIDs', () => {
    const event = { ...fixture, title: 'Build, test; launch\\now\nNext', description: 'বাংলাদেশ '.repeat(40) };
    const ics = core.toICS([event], { now: '2026-10-14T00:00:00Z' });
    assert.ok(ics.includes('DTSTART:20300110T030000Z\r\n'));
    assert.ok(ics.includes('SUMMARY:Build\\, test\\; launch\\\\now\\nNext\r\n'));
    assert.ok(ics.includes('URL:https://example.org/event\r\n'));
    assert.equal(ics.replace(/\r\n/g, '').includes('\n'), false);
    for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
    assert.ok(core.toICS([fixture], { deadline: true }).includes('UID:test-hackathon-deadline@cseradar.local'));
    assert.ok(core.toICS([fixture], { deadline: true }).includes('DTSTART:20300108T175900Z'));
    assert.equal(core.toICS([{ ...fixture, status: 'cancelled' }]).includes('BEGIN:VEVENT'), false);
    assert.equal(core.toICS([{ ...fixture, start: null, end: null, deadline: null, status: 'awaiting-dates' }]).includes('BEGIN:VEVENT'), false);
  });
  test('reminder plan excludes past/cancelled/invalid records and catches an overdue lead time', () => {
    const now = Date.parse('2030-01-10T02:00:00Z');
    const plan = core.reminderPlan([fixture, { ...fixture, status: 'cancelled' }, { id: 'broken' }], 24, now);
    assert.equal(plan.length, 1); assert.equal(plan[0].kind, 'start'); assert.equal(plan[0].when, now + 1000);
    const early = core.reminderPlan([fixture], 24, Date.parse('2029-12-01T00:00:00Z'));
    assert.equal(early.length, 2); assert.equal(early[0].when, Date.parse(fixture.start) - 86400000);
    assert.equal(core.reminderPlan([fixture], 24, Date.parse(fixture.end)).length, 0);
    assert.equal(core.reminderPlan([fixture], 0, now).length, 0);
  });
  test('all-day events preserve calendar dates and exclusive end while deadlines remain timed', () => {
    const event = { ...fixture, allDay: true, start: '2030-01-10T00:00:00+06:00', end: '2030-01-12T00:00:00+06:00' };
    assert.equal(core.validateEvent(event).allDay, true);
    const ics = core.toICS([event]);
    assert.ok(ics.includes('DTSTART;VALUE=DATE:20300110\r\n'));
    assert.ok(ics.includes('DTEND;VALUE=DATE:20300112\r\n'));
    assert.ok(core.toICS([event], { deadline: true }).includes('DTSTART:20300108T175900Z'));
    assert.equal(core.reminderPlan([event], 24, Date.parse('2029-12-01T00:00:00Z'))[0].target, Date.parse(event.start));
    invalid({ allDay: 'true' }); invalid({ allDay: true });
  });
  test('combined calendar export includes event and known deadline with distinct UIDs', () => {
    const ics = core.toICS([fixture], { includeDeadlines: true });
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
    assert.ok(ics.includes('UID:test-hackathon-event@cseradar.local'));
    assert.ok(ics.includes('UID:test-hackathon-deadline@cseradar.local'));
    const awaiting = { ...fixture, start: null, end: null, status: 'awaiting-dates' };
    const unknownDates = core.toICS([awaiting], { includeDeadlines: true });
    assert.equal((unknownDates.match(/BEGIN:VEVENT/g) || []).length, 1);
    assert.ok(unknownDates.includes('UID:test-hackathon-deadline@cseradar.local'));
    assert.equal((core.toICS([fixture], { deadline: true, includeDeadlines: true }).match(/BEGIN:VEVENT/g) || []).length, 1);
  });
  test('range overlap includes events spanning multiple days', () => {
    assert.equal(core.overlapsRange(fixture, '2030-01-11', '2030-01-12'), true);
    assert.equal(core.overlapsRange(fixture, '2030-01-12', '2030-01-13'), false);
  });
  const stored = { radarSaved: [fixture, { id: 'invalid' }], radarReminderHours: 24 };
  const alarms = new Map([['radar:reminder:obsolete', { name: 'radar:reminder:obsolete' }]]);
  const notices = [], clearedNotices = [], tabs = [], listeners = {}, alarmCreates = [];
  let now = Date.parse('2030-01-10T02:00:00Z');
  class FixedDate extends Date { static now() { return now; } }
  const listen = name => ({ addListener(callback) { listeners[name] = callback; } });
  const api = {
    storage: { local: {
      async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, stored[key]])); },
      async set(value) { Object.assign(stored, value); }
    }, onChanged: listen('storage') },
    alarms: {
      async getAll() { return [...alarms.values()]; }, async clear(name) { return alarms.delete(name); },
      async create(name, info) { alarmCreates.push(name); alarms.set(name, { name, ...info, scheduledTime: info.when ?? now + info.periodInMinutes * 60000 }); }, onAlarm: listen('alarm')
    },
    notifications: { async create(id, data) { notices.push({ id, data }); }, async clear(id) { clearedNotices.push(id); }, onClicked: listen('click') },
    tabs: { async create(options) { tabs.push(options); } }, action: { onClicked: listen('action') },
    permissions: { async contains() { return false; }, onRemoved: listen('permissionsRemoved') },
    runtime: { getURL(value) { return 'chrome-extension://test/' + value; }, onInstalled: listen('install'), onStartup: listen('startup'), onMessage: listen('message') }
  };
  const sandbox = vm.createContext({ chrome: api, RadarCore: core, RadarFeed: require('../feed.js'), Date: FixedDate, Intl, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), sandbox);
  await sandbox.reconcile();
  assert.equal(alarms.has('radar:reminder:obsolete'), false);
  assert.equal(alarms.has('radar:reconcile'), true);
  const reminder = [...alarms.values()].find(alarm => alarm.name.startsWith('radar:reminder:'));
  assert.ok(reminder); assert.equal(reminder.when, now + 1000);
  alarmCreates.length = 0;
  await sandbox.reconcile();
  assert.deepEqual(alarmCreates, [], 'Unchanged alarms, including maintenance, must not be recreated.');
  const originalDue = alarms.get(reminder.name).scheduledTime;
  now += 500;
  await sandbox.reconcile();
  assert.equal(alarms.get(reminder.name).scheduledTime, originalDue, 'An already due lead time must not push its existing alarm forward.');
  stored.radarReminderHours = 0.5;
  await sandbox.reconcile();
  assert.equal(alarms.get(reminder.name).scheduledTime, Date.parse(fixture.start) - 30 * 60000, 'A changed lead time must still move a reminder to its requested future time.');
  stored.radarReminderHours = 24;
  await sandbox.reconcile();
  await sandbox.deliver(reminder); await sandbox.deliver(reminder);
  assert.equal(notices.length, 1);
  await sandbox.reconcile(); assert.equal(alarms.has(reminder.name), false);
  stored.radarReminderHours = 0;
  await sandbox.reconcile();
  assert.ok(stored.radarDelivered[reminder.name.slice('radar:reminder:'.length)]);
  stored.radarReminderHours = 24;
  await sandbox.reconcile();
  assert.equal(alarms.has(reminder.name), false);
  listeners.click(notices[0].id); await sandbox.serial(async () => {});
  assert.equal(tabs[0].url, fixture.url);
  listeners.click('radar:test'); await sandbox.serial(async () => {});
  assert.equal(tabs[1].url, 'chrome-extension://test/dashboard.html');
  assert.ok(clearedNotices.includes('radar:test'));
  stored.radarSaved = [{ ...fixture, status: 'cancelled' }];
  await sandbox.reconcile();
  assert.equal([...alarms.keys()].some(name => name.startsWith('radar:reminder:')), false);
  console.log('PASS background reconciles alarms, skips invalid data, delivers once, opens safe links, and handles cancellation');
  stored.radarSaved = Array.from({ length: 550 }, (_, index) => ({
    ...fixture, id: 'custom-capacity-' + index,
    start: new Date(now + (index + 2) * 86400000).toISOString(),
    end: new Date(now + (index + 3) * 86400000).toISOString(),
    deadline: new Date(now + (index + 1) * 86400000).toISOString()
  }));
  stored.radarDelivered = {};
  api.alarms.create = async (name, info) => {
    if (!alarms.has(name) && alarms.size >= 500) throw new Error('An extension cannot have more than 500 active alarms.');
    alarmCreates.push(name);
    alarms.set(name, { name, ...info, scheduledTime: info.when ?? now + info.periodInMinutes * 60000 });
  };
  const capacitySave = await sandbox.mutateSaved({ type: 'radar:save', event: stored.radarSaved[549] });
  assert.equal(capacitySave.ok, true, 'Saving many events must not fail after their data has already been committed.');
  assert.equal(stored.radarSaved.length, 550);
  const scheduled = new Set([...alarms.keys()].filter(name => name.startsWith('radar:reminder:')));
  assert.equal(scheduled.size, 490);
  assert.ok(alarms.size < 500);
  assert.ok([...scheduled].some(name => name.includes('custom-capacity-0:deadline:')));
  const fired = [...alarms.values()].filter(alarm => scheduled.has(alarm.name)).sort((a, b) => a.when - b.when)[0];
  alarms.delete(fired.name); // A real one-shot alarm is removed before its handler runs.
  await sandbox.deliver(fired);
  const refilled = [...alarms.keys()].filter(name => name.startsWith('radar:reminder:'));
  assert.equal(refilled.length, 490);
  assert.equal(alarms.has(fired.name), false);
  assert.ok(refilled.some(name => !scheduled.has(name)), 'Delivery must schedule the next pending event instead of dropping it.');
  stored.radarSaved = Array.from({ length: 3 }, (_, index) => ({
    ...fixture, id: 'custom-overdue-' + index,
    start: new Date(now + 3600000).toISOString(), end: new Date(now + 7200000).toISOString(),
    deadline: new Date(now + 1800000).toISOString()
  }));
  stored.radarDelivered = {};
  await sandbox.reconcile();
  const dueAlarms = [...alarms.values()].filter(alarm => alarm.name.startsWith('radar:reminder:'));
  const originalTimes = new Map(dueAlarms.map(alarm => [alarm.name, alarm.scheduledTime]));
  const dueAlarm = dueAlarms[0]; alarms.delete(dueAlarm.name);
  now += 300;
  alarmCreates.length = 0;
  await sandbox.deliver(dueAlarm);
  assert.deepEqual(alarmCreates, [], 'Delivery must not recreate the other five overdue reminders.');
  for (const alarm of alarms.values()) if (alarm.name.startsWith('radar:reminder:')) assert.equal(alarm.scheduledTime, originalTimes.get(alarm.name));
  console.log('PASS more than 500 reminders retain saved data and use a rolling queue that refills after delivery');
  console.log('PASS unchanged alarms are reused and overdue reminders are not postponed during delivery');
  console.log('All CSE Radar core tests passed.');
}
module.exports = main();
if (require.main === module) module.exports.catch(error => { console.error(error); process.exitCode = 1; });
