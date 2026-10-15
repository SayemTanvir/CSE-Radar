(function (root) {
  'use strict';
  const MAX_BYTES = 256 * 1024;
  const MAX_CANDIDATES = 20;
  const eventTypes = new Set(['Event', 'BusinessEvent', 'ChildrensEvent', 'ComedyEvent', 'CourseInstance', 'DanceEvent', 'DeliveryEvent', 'EducationEvent', 'ExhibitionEvent', 'Festival', 'FoodEvent', 'Hackathon', 'LiteraryEvent', 'MusicEvent', 'PublicationEvent', 'SaleEvent', 'ScreeningEvent', 'SocialEvent', 'SportsEvent', 'TheaterEvent', 'VisualArtsEvent', 'GameJam']);
  function text(value, limit = 180) {
    return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
  }
  function publicURL(value, base) {
    if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) return '';
    try {
      const url = new URL(value, base || undefined);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
  }
  function safeURL(value, base) {
    const url = publicURL(value, base);
    return url.startsWith('https:') ? url : '';
  }
  function validDateValue(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
    const day = value.slice(0, 10), normalized = new Date(day + 'T00:00:00Z');
    if (!Number.isFinite(normalized.getTime()) || normalized.toISOString().slice(0, 10) !== day) return null;
    if (value.length > 10) {
      if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return null;
      const offset = value.match(/[+-](\d{2}):(\d{2})$/);
      if (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59)) return null;
    }
    return Number.isFinite(Date.parse(value)) ? value : null;
  }
  function named(value, limit = 180) {
    const queue = [value], names = [], seen = new WeakSet();
    let visited = 0;
    while (queue.length && visited++ < 100 && names.length < 20) {
      const item = queue.pop();
      if (item && typeof item === 'object') {
        if (seen.has(item)) continue;
        seen.add(item);
        if (Array.isArray(item)) { for (let index = Math.min(item.length, 100) - 1; index >= 0; index--) queue.push(item[index]); continue; }
      }
      const name = text(item && typeof item === 'object' ? item.name : item, limit);
      if (name) names.push(name);
    }
    return names.join(', ').slice(0, limit);
  }
  function categoryFor(name) {
    if (/\bgame\s*jam\b/i.test(name)) return 'gamejam';
    if (/\bhackathon\b|\bhack\s*fest\b/i.test(name)) return 'hackathon';
    if (/\b(programming|coding|informatics|algorithm|icpc)\b.*\b(contest|competition|challenge|regional)\b|\bicpc\b/i.test(name)) return 'contest';
    if (/\b(tech|technology|cse|computer|computing)\b.*\b(fest|festival)\b/i.test(name)) return 'fest';
    if (/\b(workshop|bootcamp)\b/i.test(name)) return 'workshop';
    if (/\bconference\b/i.test(name)) return 'conference';
    return '';
  }
  function parseEventData(data, options = {}) {
    const warnings = [];
    const warn = message => { if (warnings.length < 12 && !warnings.includes(message)) warnings.push(message); };
    if (typeof data === 'string') {
      if (data.length > MAX_BYTES || new TextEncoder().encode(data).length > MAX_BYTES) return { candidates: [], warnings: ['Structured event data exceeds the 256 KiB capture limit.'] };
      try { data = JSON.parse(data); } catch (_) { return { candidates: [], warnings: ['A structured-data block is malformed and was skipped.'] }; }
    }
    const candidates = [], queue = [data], seenObjects = new WeakSet(), seenEvents = new Set();
    const pageUrl = publicURL(options.pageUrl), pageTitle = text(options.pageTitle);
    let visited = 0;
    while (queue.length && visited < 5000) {
      const item = queue.pop();
      if (!item || typeof item !== 'object' || seenObjects.has(item)) continue;
      seenObjects.add(item); visited++;
      if (Array.isArray(item)) { for (let index = Math.min(item.length, 5000) - 1; index >= 0; index--) queue.push(item[index]); continue; }
      const types = (Array.isArray(item['@type']) ? item['@type'] : [item['@type']]).filter(type => typeof type === 'string').map(type => type.split(/[\/#]/).pop());
      if (types.some(type => eventTypes.has(type))) {
        const title = text(item.name) || pageTitle;
        const providedURL = typeof item.url === 'string' ? item.url : typeof item['@id'] === 'string' ? item['@id'] : '';
        const url = safeURL(providedURL, pageUrl) || safeURL(pageUrl);
        if (providedURL && !safeURL(providedURL, pageUrl)) warn('An unsafe event link was skipped; review the official event URL.');
        const dates = {};
        for (const [key, raw] of [['start', item.startDate], ['end', item.endDate], ['deadline', item.registrationDeadline ?? item.applicationDeadline]]) {
          dates[key] = validDateValue(raw);
          if (raw != null && !dates[key]) warn('Some date fields lack an explicit timezone or a valid date; enter them during review.');
        }
        if (Object.values(dates).some(value => value && value.length === 10)) warn('Date-only fields have no exact time or timezone; confirm the date range and deadline during review.');
        if (dates.start && dates.end && (dates.start.length === 10) !== (dates.end.length === 10)) {
          dates.end = null; warn('Mixed date-only and timed event dates need review.');
        }
        if (dates.start && dates.end && Date.parse(dates.end) < Date.parse(dates.start)) {
          dates.end = null; warn('The event end precedes its start; enter the correct dates during review.');
        }
        let location = Array.isArray(item.location) ? item.location.find(entry => entry && typeof entry === 'object' && !String(entry['@type']).includes('VirtualLocation')) || item.location[0] : item.location;
        const address = location && typeof location === 'object' && location.address && typeof location.address === 'object' ? location.address : {};
        const attendance = typeof item.eventAttendanceMode === 'string' ? item.eventAttendanceMode.split(/[\/#]/).pop() : '';
        let mode = attendance === 'OnlineEventAttendanceMode' ? 'online' : attendance === 'OfflineEventAttendanceMode' ? 'in-person' : attendance === 'MixedEventAttendanceMode' ? 'hybrid' : '';
        if (!mode && location && typeof location === 'object' && String(location['@type']).includes('VirtualLocation')) mode = 'online';
        let offer = Array.isArray(item.offers) ? item.offers.find(entry => entry && entry.price !== undefined) : item.offers;
        let fee = 'Unknown';
        if (offer && typeof offer === 'object' && (typeof offer.price === 'number' || typeof offer.price === 'string') && String(offer.price).trim() && /^\d+(?:\.\d+)?$/.test(String(offer.price))) {
          fee = Number(offer.price) === 0 ? 'Free' : `${text(String(offer.price), 30)}${text(offer.priceCurrency, 12) ? ' ' + text(offer.priceCurrency, 12) : ''}`;
        }
        const candidate = {
          title, organizer: named(item.organizer), description: text(typeof item.description === 'string' ? item.description.replace(/<[^>]*>/g, ' ') : '', 2000), url,
          ...dates, allDay: !!dates.start && dates.start.length === 10, mode,
          country: named(address.addressCountry, 120), city: text(address.addressLocality, 120), fee, category: categoryFor(title)
        };
        if (typeof item.eventStatus === 'string' && /(?:\/|#)?EventCancelled$/.test(item.eventStatus)) candidate.status = 'cancelled';
        const key = [title.toLowerCase(), dates.start || '', url].join('|');
        if (!title) warn('An event without a name was skipped.');
        else if (!seenEvents.has(key)) {
          seenEvents.add(key);
          if (candidates.length < MAX_CANDIDATES) candidates.push(candidate);
          else warn('Only the first 20 events were captured.');
        }
      }
      for (const value of Object.values(item).slice(0, 5000)) if (value && typeof value === 'object') queue.push(value);
    }
    if (queue.length) warn('Deep or unusually large structured data was truncated.');
    return { candidates, warnings };
  }
  function scanPage() {
    const pageUrl = publicURL(root.location && root.location.href);
    const metaValue = selector => { const element = root.document.querySelector(selector); return element ? element.getAttribute('content') : ''; };
    const pageTitle = text(metaValue('meta[property="og:title"]') || root.document.title);
    const capture = { pageUrl, sourcePageUrl: pageUrl, pageTitle, capturedAt: new Date().toISOString(), candidates: [], warnings: [] };
    const warnings = new Set(), keys = new Set();
    let totalBytes = 0, blocks = 0;
    for (const script of root.document.querySelectorAll('script[type="application/ld+json"]')) {
      if (++blocks > 64) { warnings.add('Only the first 64 structured-data blocks were scanned.'); break; }
      const source = script.textContent || '';
      if (source.length > MAX_BYTES || totalBytes + source.length > MAX_BYTES) { warnings.add('Structured event data exceeds the 256 KiB capture limit.'); continue; }
      const bytes = new TextEncoder().encode(source).length;
      if (totalBytes + bytes > MAX_BYTES) { warnings.add('Structured event data exceeds the 256 KiB capture limit.'); continue; }
      totalBytes += bytes;
      const parsed = parseEventData(source, { pageUrl, pageTitle });
      parsed.warnings.forEach(warning => warnings.add(warning));
      for (const candidate of parsed.candidates) {
        const key = [candidate.title.toLowerCase(), candidate.start || '', candidate.url].join('|');
        if (keys.has(key)) continue;
        keys.add(key);
        if (capture.candidates.length < MAX_CANDIDATES) capture.candidates.push(candidate);
        else warnings.add('Only the first 20 events were captured.');
      }
    }
    if (!capture.candidates.length) {
      capture.candidates.push({ title: pageTitle, organizer: '', description: text(metaValue('meta[name="description"]') || metaValue('meta[property="og:description"]'), 2000), url: safeURL(pageUrl), start: null, end: null, deadline: null, allDay: false, mode: '', country: '', city: '', fee: 'Unknown', category: '' });
      warnings.add('No structured event was found. Only the page title, description, and link were captured; add event details during review.');
    }
    warnings.add('Review every field before saving. Dates, eligibility, and registration details may be incomplete.');
    capture.warnings = [...warnings].slice(0, 12).map(warning => text(warning, 220));
    return capture;
  }
  const api = { parseEventData, scanPage, safeURL, publicURL, validDateValue, categoryFor };
  root.RadarCapture = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
