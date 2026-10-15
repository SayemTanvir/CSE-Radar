'use strict';
const assert = require('node:assert/strict');
const importer = require('../calendar-import.js');

function calendar(events) { return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR', ''].join('\r\n'); }
function event(lines) { return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n'); }
function test(name, callback) { callback(); console.log('PASS ' + name); }
const base = ['UID:student-hackathon@example.org', 'SUMMARY:Student hackathon', 'URL:https://example.org/student-hackathon'];

test('UTC timestamps retain precise instants and public links', () => {
  const candidate = importer.parse(calendar([event([...base, 'DTSTART:20300120T030000Z', 'DTEND:20300121T120000Z'])])).candidates[0];
  assert.equal(Date.parse(candidate.start), Date.parse('2030-01-20T03:00:00Z'));
  assert.equal(Date.parse(candidate.end), Date.parse('2030-01-21T12:00:00Z'));
  assert.equal(candidate.timezone, 'UTC');
  assert.equal(candidate.uid, 'student-hackathon@example.org');
  assert.equal(candidate.url, 'https://example.org/student-hackathon');
  assert.equal(candidate.allDay, false);
});

test('IANA TZID conversion handles offsets without inventing floating times', () => {
  const candidate = importer.parse(calendar([event([...base, 'DTSTART;TZID=Asia/Dhaka:20300120T090000', 'DTEND;TZID=Asia/Dhaka:20300121T180000'])])).candidates[0];
  assert.equal(Date.parse(candidate.start), Date.parse('2030-01-20T03:00:00Z'));
  assert.equal(candidate.timezone, 'Asia/Dhaka');
  const floating = importer.parse(calendar([event([...base, 'DTSTART:20300120T090000', 'DTEND:20300121T180000'])]));
  assert.equal(floating.candidates[0].start, null);
  assert.equal(floating.candidates[0].end, null);
  assert.ok(floating.warnings.length || floating.candidates[0].warnings.length);
});

test('nonexistent and ambiguous DST times remain unresolved for review', () => {
  for (const start of ['20260308T023000', '20261101T013000']) {
    const parsed = importer.parse(calendar([event([...base, 'DTSTART;TZID=America/New_York:' + start, 'DTEND;TZID=America/New_York:20261102T120000'])]));
    assert.equal(parsed.candidates[0].start, null, start);
    assert.ok(parsed.warnings.length || parsed.candidates[0].warnings.length, start);
  }
});

test('DATE exclusive ends become inclusive review dates and absent ends default to one day', () => {
  const parsed = importer.parse(calendar([event([...base, 'DTSTART;VALUE=DATE:20300320', 'DTEND;VALUE=DATE:20300322'])])).candidates[0];
  assert.equal(parsed.start, '2030-03-20');
  assert.equal(parsed.end, '2030-03-21');
  assert.equal(parsed.allDay, true);
  const single = importer.parse(calendar([event([...base, 'DTSTART;VALUE=DATE:20280229'])])).candidates[0];
  assert.equal(single.start, '2028-02-29');
  assert.equal(single.end, '2028-02-29');
  const duration = importer.parse(calendar([event([...base, 'DTSTART;VALUE=DATE:20300320', 'DURATION:P2D'])])).candidates[0];
  assert.equal(duration.end, null);
});

test('Unicode line unfolding and escaped punctuation remain readable', () => {
  const parsed = importer.parse(calendar([event([...base.filter(line => !line.startsWith('SUMMARY:')), 'DTSTART:20300120T030000Z', 'DTEND:20300121T120000Z',
    'SUMMARY:University বাংলা', '  game jam', 'DESCRIPTION:First\\nSecond\\; topic\\, next\\\\end'])])).candidates[0];
  assert.equal(parsed.title, 'University বাংলা game jam');
  assert.ok(parsed.description.includes('First') && parsed.description.includes('Second; topic, next\\end'), parsed.description);
  assert.ok(!parsed.description.includes('\\n') && !parsed.description.includes('\\;') && !parsed.description.includes('\\,'), parsed.description);
});

test('nested VALARM properties cannot replace the outer event fields', () => {
  const parsed = importer.parse(calendar([event([...base, 'DTSTART:20300120T030000Z', 'DTEND:20300121T120000Z',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'SUMMARY:Alarm is not the event', 'DESCRIPTION:Private alarm note',
    'TRIGGER:-P1D', 'DTSTART:20400101T000000Z', 'URL:javascript:alert(1)', 'END:VALARM'])])).candidates[0];
  assert.equal(parsed.title, 'Student hackathon');
  assert.equal(Date.parse(parsed.start), Date.parse('2030-01-20T03:00:00Z'));
  assert.equal(parsed.url, 'https://example.org/student-hackathon');
  assert.ok(!parsed.description.includes('Private alarm note'));
});

test('recurrences are skipped instead of expanded or silently flattened', () => {
  const parsed = importer.parse(calendar([
    event([...base, 'DTSTART:20300120T030000Z', 'DTEND:20300121T120000Z', 'RRULE:FREQ=DAILY;COUNT=100']),
    event([...base, 'UID:exception@example.org', 'DTSTART:20300121T030000Z', 'DTEND:20300122T120000Z', 'RECURRENCE-ID:20300121T030000Z'])
  ]));
  assert.equal(parsed.candidates.length, 0);
  assert.equal(parsed.skipped, 2);
  assert.ok(parsed.warnings.length);
});

test('unsafe hyperlinks are excluded and remote attachments never fetch', () => {
  const oldFetch = global.fetch;
  let fetched = false;
  global.fetch = () => { fetched = true; throw new Error('Import must not use the network.'); };
  try {
    for (const link of ['javascript:alert(1)', 'http://example.org/event', 'https://user:password@example.org/event']) {
      const parsed = importer.parse(calendar([event(['UID:unsafe@example.org', 'SUMMARY:Unsafe link event', 'URL:' + link,
        'DTSTART:20300120T030000Z', 'DTEND:20300121T120000Z', 'ATTACH:https://example.org/private-file'])])).candidates[0];
      assert.equal(parsed.url, '', link);
    }
    assert.equal(fetched, false);
  } finally { global.fetch = oldFetch; }
});

test('CSE Radar deadline companions attach to their event rather than import separately', () => {
  const parsed = importer.parse(calendar([
    event(['UID:custom-fixture-event@cseradar.local', 'SUMMARY:Student hackathon', 'URL:https://example.org/event', 'DTSTART:20300120T030000Z', 'DTEND:20300121T120000Z']),
    event(['UID:custom-fixture-deadline@cseradar.local', 'SUMMARY:Registration deadline: Student hackathon', 'URL:https://example.org/event', 'DTSTART:20300115T030000Z', 'DTEND:20300115T031500Z'])
  ]));
  assert.equal(parsed.candidates.length, 1);
  assert.equal(Date.parse(parsed.candidates[0].deadline), Date.parse('2030-01-15T03:00:00Z'));
});

test('long UIDs sharing a prefix retain distinct identities for duplicate checks', () => {
  const prefix = 'shared-'.repeat(30);
  const uids = [prefix + 'first@example.org', prefix + 'second@example.org'];
  const parsed = importer.parse(calendar(uids.map(uid => event(['UID:' + uid, 'SUMMARY:Long UID event',
    'URL:https://example.org/event', 'DTSTART:20300120T030000Z', 'DTEND:20300121T120000Z']))));
  assert.equal(parsed.candidates.length, 2);
  assert.deepEqual(parsed.candidates.map(candidate => candidate.uid), uids);
  assert.notEqual(parsed.candidates[0].uid, parsed.candidates[1].uid);
});

test('duplicate UIDs and result limits leave an explicit skipped count', () => {
  const duplicate = importer.parse(calendar([event([...base, 'DTSTART:20300120T030000Z', 'DTEND:20300121T120000Z']),
    event([...base, 'DTSTART:20300220T030000Z', 'DTEND:20300221T120000Z'])]));
  assert.equal(duplicate.candidates.length, 1);
  assert.equal(duplicate.skipped, 1);
  const many = importer.parse(calendar(Array.from({ length: 51 }, (_, i) => event(['UID:event-' + i + '@example.org',
    'SUMMARY:Hackathon ' + i, 'DTSTART:20300120T030000Z', 'DTEND:20300121T120000Z', 'URL:https://example.org/event']))));
  assert.equal(many.candidates.length, 50);
  assert.equal(many.skipped, 1);
  assert.ok(many.warnings.some(message => message.includes('50')));
});

test('malformed and oversized files are rejected before import', () => {
  for (const text of ['', 'not a calendar', 'BEGIN:VEVENT\r\nSUMMARY:No calendar wrapper\r\nEND:VEVENT']) assert.throws(() => importer.parse(text));
  assert.throws(() => importer.parse(calendar([event([...base, 'DESCRIPTION:' + 'x'.repeat(600000)])])));
  assert.throws(() => importer.parse(calendar([event([...base, 'DESCRIPTION:' + 'x'.repeat(4200)])])));
  assert.throws(() => importer.parse('BEGIN:VCALENDAR\r\n' + 'X-TEST:value\r\n'.repeat(12001) + 'END:VCALENDAR'));
  assert.throws(() => importer.parse('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nEND:VCALENDAR'));
  const multibyte = calendar(Array.from({ length: 400 }, () => 'X-UTF8:' + 'ব'.repeat(600)));
  assert.ok(multibyte.length < 512 * 1024);
  assert.throws(() => importer.parse(multibyte), /512 KiB/);
});

console.log('PASS local calendar import precision, uncertainty, privacy, and resource limits.');
