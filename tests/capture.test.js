'use strict';
const assert = require('node:assert/strict');
const capture = require('../capture.js');

function test(name, callback) { callback(); console.log('PASS ' + name); }
const options = { pageUrl: 'https://university.example/events/student-hackathon', pageTitle: 'Student opportunities' };
const event = {
  '@context': 'https://schema.org', '@type': 'Event', name: 'Student hackathon',
  organizer: { '@type': 'Organization', name: 'University Computer Club' },
  startDate: '2030-01-20T09:00:00+06:00', endDate: '2030-01-21T18:00:00+06:00',
  url: 'https://university.example/events/student-hackathon', description: 'Create a useful student project.',
  location: { '@type': 'Place', name: 'Engineering building', address: { '@type': 'PostalAddress', addressLocality: 'Dhaka', addressCountry: 'Bangladesh' } }
};

test('JSON-LD extracts organizer and exact offset timestamps', () => {
  const result = capture.parseEventData(event, options);
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.title, event.name);
  assert.equal(candidate.organizer, event.organizer.name);
  assert.equal(candidate.start, event.startDate);
  assert.equal(candidate.end, event.endDate);
  assert.equal(candidate.url, event.url);
  assert.equal(candidate.description, event.description);
});

test('graph and arrays preserve multiple event choices without treating other types as events', () => {
  const second = { ...event, name: 'Student game jam', url: 'https://university.example/game-jam', '@type': ['Thing', 'Event'] };
  const graph = { '@context': 'https://schema.org', '@graph': [{ '@type': 'Organization', name: 'Not an event' }, event, second] };
  assert.equal(capture.parseEventData(graph, options).candidates.length, 2);
  assert.equal(capture.parseEventData([event, second], options).candidates.length, 2);
});

test('date-only values remain date-only and unknown or ambiguous dates are not invented', () => {
  const dated = capture.parseEventData({ ...event, startDate: '2030-01-20', endDate: '2030-01-21' }, options).candidates[0];
  assert.equal(dated.start, '2030-01-20');
  assert.equal(dated.end, '2030-01-21');
  assert.equal(dated.allDay, true);
  for (const value of ['2030-02-30', '2030-01-20T09:00:00', '2030-01-20T25:00:00Z', 'next Friday', null]) {
    assert.equal(capture.validDateValue(value), null, String(value));
  }
  const unknown = capture.parseEventData({ ...event, startDate: 'next Friday', endDate: undefined }, options).candidates[0];
  assert.equal(unknown.start, null);
  assert.equal(unknown.end, null);
});

test('unsafe and credential-bearing hyperlinks never become official links', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,unsafe', 'http://university.example/event', 'https://user:password@university.example/event']) {
    assert.equal(capture.safeURL(value, options.pageUrl), '', value);
    const result = capture.parseEventData({ ...event, url: value }, options);
    assert.ok(result.candidates.every(candidate => candidate.url === '' || candidate.url.startsWith('https://')));
    assert.ok(result.candidates.every(candidate => !candidate.url.includes('user:password')));
  }
  assert.equal(capture.safeURL('/event', options.pageUrl), 'https://university.example/event');
  assert.equal(capture.publicURL('https://user:password@university.example/event'), '');
});

test('candidate text and result counts remain bounded', () => {
  const oversized = { ...event, name: 'x'.repeat(1000), description: 'y'.repeat(10000), organizer: { name: 'z'.repeat(1000) } };
  const candidate = capture.parseEventData(oversized, options).candidates[0];
  assert.ok(candidate.title.length <= 180);
  assert.ok(candidate.organizer.length <= 180);
  assert.ok(candidate.description.length <= 2000);
  const result = capture.parseEventData(Array.from({ length: 40 }, (_, i) => ({ ...event, name: 'Hackathon ' + i })), options);
  assert.ok(result.candidates.length <= 20);
  assert.ok(result.warnings.length <= 12);
});

test('missing fields remain reviewable partial candidates', () => {
  const candidate = capture.parseEventData({ '@type': 'Event', name: 'University tech fest' }, options).candidates[0];
  assert.equal(candidate.title, 'University tech fest');
  assert.equal(candidate.start, null);
  assert.equal(candidate.end, null);
  assert.equal(candidate.deadline, null);
});

test('explicit cancellation and free offers survive capture while unknown fees stay unknown', () => {
  const cancelled = capture.parseEventData({ ...event, eventStatus: 'https://schema.org/EventCancelled', offers: { price: '0', priceCurrency: 'BDT' } }, options).candidates[0];
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.fee, 'Free');
  assert.equal(capture.parseEventData({ ...event, offers: { price: '' } }, options).candidates[0].fee, 'Unknown');
  const reverse = capture.parseEventData({ ...event, endDate: '2030-01-19T18:00:00+06:00' }, options);
  assert.equal(reverse.candidates[0].end, null);
  assert.ok(reverse.warnings.some(message => message.includes('precedes')));
});

test('malformed, oversized and cyclic structured data cannot crash capture', () => {
  assert.equal(capture.parseEventData('{malformed', options).candidates.length, 0);
  const oversized = JSON.stringify({ ...event, description: 'x'.repeat(300000) });
  const result = capture.parseEventData(oversized, options);
  assert.equal(result.candidates.length, 0);
  assert.ok(result.warnings.some(message => message.includes('256 KiB')));
  const cyclic = { ...event }; cyclic.self = cyclic;
  assert.equal(capture.parseEventData(cyclic, options).candidates.length, 1);
});

test('fallback reads only public page metadata and never body or form values', () => {
  const oldDocument = global.document, oldLocation = global.location;
  const metadata = {
    'meta[property="og:title"]': 'Fallback university fest',
    'meta[name="description"]': 'Public fest description'
  };
  const allowed = new Set([...Object.keys(metadata), 'meta[property="og:description"]']);
  global.document = {
    title: 'Page title',
    get body() { throw new Error('Capture must not read page body.'); },
    querySelector(selector) {
      assert.ok(allowed.has(selector), 'Unexpected document scan: ' + selector);
      return metadata[selector] ? { getAttribute: name => { assert.equal(name, 'content'); return metadata[selector]; } } : null;
    },
    querySelectorAll(selector) { assert.equal(selector, 'script[type="application/ld+json"]'); return []; }
  };
  global.location = { href: options.pageUrl };
  try {
    const result = capture.scanPage();
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].title, metadata['meta[property="og:title"]']);
    assert.equal(result.candidates[0].description, metadata['meta[name="description"]']);
    assert.equal(result.candidates[0].start, null);
    assert.ok(result.warnings.some(message => message.includes('No structured event')));
  } finally {
    if (oldDocument === undefined) delete global.document; else global.document = oldDocument;
    if (oldLocation === undefined) delete global.location; else global.location = oldLocation;
  }
});

console.log('PASS capture parser precision, bounds, and privacy checks. Real toolbar and form-input isolation are checked in capture_smoke.py.');
