'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../core.js');
const feed = require('../feed.js');
const root = path.join(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/events.json'), 'utf8'));
const validated = feed.validateCatalog(catalog);
assert.ok(validated.events.length > 0, 'Reviewed seed catalog should not be accidentally emptied.');
for (const event of validated.events) {
  assert.ok(event.lastChecked <= catalog.updatedAt, `${event.id}: verification date follows catalog edition`);
  assert.ok(!event.id.startsWith('candidate-'), 'Unreviewed collector leads must not be published directly.');
}
const sources = JSON.parse(fs.readFileSync(path.join(root, 'data/sources.json'), 'utf8'));
assert.ok(Array.isArray(sources) && sources.length > 0);
const ids = new Set();
for (const source of sources) {
  assert.ok(source.id && !ids.has(source.id), 'Source IDs must be unique.'); ids.add(source.id);
  assert.ok(typeof source.name === 'string' && source.name.trim());
  assert.ok(core.safeUrl(source.url));
  assert.ok(['local', 'international'].includes(source.scope));
  assert.ok(typeof source.description === 'string' && source.description.trim());
}
console.log(`PASS reviewed catalog (${validated.events.length} events) and source registry (${sources.length} sources).`);
