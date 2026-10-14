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
  const notices = [], tabs = [], listeners = {};
  const now = Date.parse('2030-01-10T02:00:00Z');
  class FixedDate extends Date { static now() { return now; } }
  const listen = name => ({ addListener(callback) { listeners[name] = callback; } });
  const api = {
    storage: { local: {
      async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, stored[key]])); },
      async set(value) { Object.assign(stored, value); }
    }, onChanged: listen('storage') },
    alarms: {
      async getAll() { return [...alarms.values()]; }, async clear(name) { return alarms.delete(name); },
      async create(name, info) { alarms.set(name, { name, ...info }); }, onAlarm: listen('alarm')
    },
    notifications: { async create(id, data) { notices.push({ id, data }); }, async clear() {}, onClicked: listen('click') },
    tabs: { async create(options) { tabs.push(options); } }, action: { onClicked: listen('action') },
    runtime: { getURL(value) { return 'chrome-extension://test/' + value; }, onInstalled: listen('install'), onStartup: listen('startup') }
  };
  const sandbox = vm.createContext({ chrome: api, RadarCore: core, Date: FixedDate, Intl, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), sandbox);
  await sandbox.reconcile();
  assert.equal(alarms.has('radar:reminder:obsolete'), false);
  assert.equal(alarms.has('radar:reconcile'), true);
  const reminder = [...alarms.values()].find(alarm => alarm.name.startsWith('radar:reminder:'));
  assert.ok(reminder); assert.equal(reminder.when, now + 1000);
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
  stored.radarSaved = [{ ...fixture, status: 'cancelled' }];
  await sandbox.reconcile();
  assert.equal([...alarms.keys()].some(name => name.startsWith('radar:reminder:')), false);
  console.log('PASS background reconciles alarms, skips invalid data, delivers once, opens safe links, and handles cancellation');
  console.log('All CSE Radar core tests passed.');
}
module.exports = main();
if (require.main === module) module.exports.catch(error => { console.error(error); process.exitCode = 1; });
