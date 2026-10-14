(function (root) {
  'use strict';
  const categories = ['hackathon', 'gamejam', 'contest', 'fest', 'workshop', 'conference'];
  const scopes = ['local', 'international'];
  const modes = ['online', 'in-person', 'hybrid'];
  const statuses = ['confirmed', 'awaiting-dates', 'cancelled'];
  function safeUrl(value) {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch (_) { return null; }
  }
  function validDate(value, dateOnly) {
    if (typeof value !== 'string') return false;
    const pattern = dateOnly ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/;
    if (!pattern.test(value)) return false;
    const day = value.slice(0, 10);
    const date = new Date(day + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return false;
    if (value.length > 10) {
      const hour = Number(value.slice(11, 13)), minute = Number(value.slice(14, 16)), second = Number(value.slice(17, 19));
      if (hour > 23 || minute > 59 || second > 59) return false;
      const offset = value.match(/([+-])(\d{2}):(\d{2})$/);
      if (offset && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return false;
    }
    return Number.isFinite(Date.parse(value));
  }
  function validateEvent(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Event must be an object.');
    const event = {};
    function text(key, required = true, limit = 2000) {
      const value = raw[key];
      if (typeof value !== 'string' || value.length > limit || (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('Invalid ' + key + '.');
      event[key] = value.trim();
    }
    ['id', 'title', 'organizer', 'country', 'timezone', 'eligibility', 'fee', 'description'].forEach(key => text(key));
    text('city', false);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(event.id)) throw new Error('Invalid event id.');
    for (const [key, allowed] of [['category', categories], ['scope', scopes], ['mode', modes], ['status', statuses]]) {
      if (!allowed.includes(raw[key])) throw new Error('Invalid ' + key + '.');
      event[key] = raw[key];
    }
    try { new Intl.DateTimeFormat('en', { timeZone: event.timezone }); } catch (_) { throw new Error('Invalid timezone.'); }
    for (const key of ['start', 'end', 'deadline']) {
      if (raw[key] === null) event[key] = null;
      else if (validDate(raw[key]) && raw[key].length > 10) event[key] = raw[key];
      else throw new Error('Invalid ' + key + ' date.');
    }
    if (event.status === 'confirmed' && (!event.start || !event.end)) throw new Error('Confirmed events need start and end dates.');
    if (!!event.start !== !!event.end) throw new Error('Start and end must both be present or both unknown.');
    if (event.start && Date.parse(event.end) <= Date.parse(event.start)) throw new Error('Event end must follow start.');
    if (event.status === 'awaiting-dates' && event.start) throw new Error('Awaiting-dates events must have unknown dates.');
    if (raw.allDay !== undefined && typeof raw.allDay !== 'boolean') throw new Error('Invalid allDay flag.');
    event.allDay = raw.allDay === true;
    if (event.allDay && event.start) {
      if (![event.start, event.end].every(value => /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))) throw new Error('All-day event dates must use midnight with an exclusive end date.');
      if (event.end.slice(0, 10) <= event.start.slice(0, 10)) throw new Error('All-day end date must follow its start date.');
    }
    for (const key of ['url', 'sourceUrl', 'registrationUrl']) {
      if (key === 'registrationUrl' && raw[key] === null) event[key] = null;
      else {
        event[key] = safeUrl(raw[key]);
        if (!event[key]) throw new Error('Invalid ' + key + ': use an HTTPS URL.');
      }
    }
    if (!validDate(raw.lastChecked, true)) throw new Error('Invalid lastChecked date.');
    event.lastChecked = raw.lastChecked;
    if (!Array.isArray(raw.tags) || raw.tags.length > 20 || raw.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 80 || /[\r\n\u0000-\u001f]/.test(tag))) throw new Error('Invalid tags.');
    event.tags = [...new Set(raw.tags.map(tag => tag.trim()))];
    return event;
  }
  function escapeICS(text) {
    return String(text).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  }
  function foldICS(line) {
    const encoder = new TextEncoder();
    let lines = [], part = '', count = 0;
    for (const character of line) {
      const bytes = encoder.encode(character).length;
      if (count + bytes > 75) { lines.push(part); part = ' '; count = 1; }
      part += character; count += bytes;
    }
    lines.push(part);
    return lines.join('\r\n');
  }
  function utcStamp(value) { return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
  function toICS(events, options = {}) {
    const stamp = utcStamp(options.now || new Date());
    const exportKinds = options.deadline ? [true] : options.includeDeadlines ? [false, true] : [false];
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CSE Radar//Event Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    for (const raw of events) {
      const event = validateEvent(raw);
      for (const deadline of exportKinds) {
        const start = deadline ? event.deadline : event.start;
        if (!start || event.status === 'cancelled') continue;
        const end = deadline ? new Date(Date.parse(start) + 15 * 60 * 1000).toISOString() : event.end;
        const title = deadline ? 'Registration deadline: ' + event.title : event.title;
        const description = `${event.description}\nOrganizer: ${event.organizer}\nEligibility: ${event.eligibility}\nFee: ${event.fee}\nOfficial event: ${event.url}\nRegistration: ${event.registrationUrl || event.url}\nSource: ${event.sourceUrl}\nLast checked: ${event.lastChecked}`;
        const allDay = event.allDay && !deadline;
        const startLine = allDay ? `DTSTART;VALUE=DATE:${start.slice(0, 10).replace(/-/g, '')}` : `DTSTART:${utcStamp(start)}`;
        const endLine = allDay ? `DTEND;VALUE=DATE:${end.slice(0, 10).replace(/-/g, '')}` : `DTEND:${utcStamp(end)}`;
        lines.push('BEGIN:VEVENT', `UID:${event.id}-${deadline ? 'deadline' : 'event'}@cseradar.local`, `DTSTAMP:${stamp}`, startLine, endLine, `SUMMARY:${escapeICS(title)}`, `DESCRIPTION:${escapeICS(description)}`, `LOCATION:${escapeICS(event.mode === 'online' ? 'Online' : [event.city, event.country].filter(Boolean).join(', '))}`, `URL:${event.url}`, 'END:VEVENT');
      }
    }
    lines.push('END:VCALENDAR');
    return lines.map(foldICS).join('\r\n') + '\r\n';
  }
  function reminderPlan(events, hours = 24, now = Date.now()) {
    const lead = Number.isFinite(Number(hours)) && Number(hours) >= 0 && Number(hours) <= 720 ? Number(hours) : 24;
    if (lead === 0) return [];
    const plan = [];
    for (const raw of events) {
      let event;
      try { event = validateEvent(raw); } catch (_) { continue; }
      if (event.status === 'cancelled') continue;
      for (const kind of ['start', 'deadline']) {
        const target = event[kind] && Date.parse(event[kind]);
        if (!target || target <= now) continue;
        const key = `${event.id}:${kind}:${target}`;
        plan.push({ key, event, kind, target, when: Math.max(now + 1000, target - lead * 3600000) });
      }
    }
    return plan;
  }
  function overlapsRange(event, from, to) {
    return !!event.start && Date.parse(event.start) < Date.parse(to) && Date.parse(event.end) > Date.parse(from);
  }
  const api = { validateEvent, safeUrl, validDate, toICS, reminderPlan, overlapsRange, categories, modes, scopes, statuses };
  root.RadarCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
