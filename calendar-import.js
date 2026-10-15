(function (root) {
  'use strict';
  const core = root.RadarCore || (typeof require === 'function' ? require('./core.js') : null);
  const planning = root.RadarPlanning || (typeof require === 'function' ? require('./planning.js') : null);
  const LIMIT_BYTES = 512 * 1024;
  const recurring = new Set(['RRULE', 'RDATE', 'EXDATE', 'RECURRENCE-ID']);
  function clean(value, limit, multiline = false) {
    const safe = String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
    return (multiline ? safe.replace(/\r\n|\r/g, '\n') : safe.replace(/\s+/g, ' ')).trim().slice(0, limit);
  }
  function decodeText(value) {
    return String(value || '').replace(/\\([\\,;nN])/g, (_, character) => /[nN]/.test(character) ? '\n' : character);
  }
  function splitOutsideQuotes(value, delimiter) {
    const parts = []; let part = '', quoted = false;
    for (const character of value) {
      if (character === '"') quoted = !quoted;
      if (character === delimiter && !quoted) { parts.push(part); part = ''; }
      else part += character;
    }
    if (quoted) throw new Error('An iCalendar parameter has an unmatched quote.');
    parts.push(part); return parts;
  }
  function property(line) {
    let quoted = false, colon = -1;
    for (let index = 0; index < line.length; index++) {
      if (line[index] === '"') quoted = !quoted;
      else if (line[index] === ':' && !quoted) { colon = index; break; }
    }
    if (colon < 1) throw new Error('The calendar contains a malformed property.');
    const header = splitOutsideQuotes(line.slice(0, colon), ';');
    const name = header.shift().toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(name) || header.length > 16) throw new Error('The calendar contains an invalid property or too many parameters.');
    const params = Object.create(null);
    for (const entry of header) {
      const equal = entry.indexOf('=');
      if (equal < 1 || !/^[A-Z0-9-]+$/i.test(entry.slice(0, equal))) throw new Error('The calendar contains a malformed parameter.');
      const key = entry.slice(0, equal).toUpperCase();
      if (Object.hasOwn(params, key)) throw new Error('The calendar contains duplicate property parameters.');
      let value = entry.slice(equal + 1);
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      params[key] = value.replace(/\^([nN^'])/g, (_, character) => /[nN]/.test(character) ? '\n' : character === "'" ? '"' : '^');
    }
    return { name, params, value: line.slice(colon + 1) };
  }
  function validZone(zone) {
    if (typeof zone !== 'string' || !zone || zone.length > 100 || (!zone.includes('/') && zone !== 'UTC' && zone !== 'Etc/UTC')) return false;
    try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch (_) { return false; }
  }
  function dateValue(prop, label, warn) {
    if (!prop) { warn(`${label} is missing; enter it during review.`); return { value: null, allDay: false, timezone: 'UTC' }; }
    const valueType = (prop.params.VALUE || 'DATE-TIME').toUpperCase();
    if (valueType === 'DATE') {
      if (!/^\d{8}$/.test(prop.value)) { warn(`${label} has an invalid calendar date.`); return { value: null, allDay: true, timezone: 'UTC' }; }
      const day = `${prop.value.slice(0, 4)}-${prop.value.slice(4, 6)}-${prop.value.slice(6, 8)}`;
      if (prop.params.TZID) warn(`${label} is date-only; its timezone parameter was ignored.`);
      if (!core.validDate(day, true)) { warn(`${label} has an impossible calendar date.`); return { value: null, allDay: true, timezone: 'UTC' }; }
      return { value: day, allDay: true, timezone: 'UTC' };
    }
    if (valueType !== 'DATE-TIME' || !/^\d{8}T\d{6}Z?$/.test(prop.value)) {
      warn(`${label} has an unsupported or invalid date/time.`); return { value: null, allDay: false, timezone: 'UTC' };
    }
    const local = `${prop.value.slice(0, 4)}-${prop.value.slice(4, 6)}-${prop.value.slice(6, 8)}T${prop.value.slice(9, 11)}:${prop.value.slice(11, 13)}:${prop.value.slice(13, 15)}`;
    if (!core.validDate(local + 'Z')) { warn(`${label} has an impossible date/time.`); return { value: null, allDay: false, timezone: 'UTC' }; }
    if (prop.value.endsWith('Z')) {
      if (prop.params.TZID) warn(`${label} is UTC; its redundant timezone parameter was ignored.`);
      return { value: new Date(local + 'Z').toISOString(), allDay: false, timezone: 'UTC' };
    }
    const zone = prop.params.TZID;
    if (!zone) { warn(`${label} is a floating time without TZID; choose a timezone and enter the time during review.`); return { value: null, allDay: false, timezone: 'UTC' }; }
    if (!validZone(zone)) { warn(`${label} uses an unsupported timezone (${clean(zone, 80)}); custom VTIMEZONE offsets are not imported.`); return { value: null, allDay: false, timezone: 'UTC' }; }
    try { return { value: planning.zonedLocalToISO(local, zone), allDay: false, timezone: zone }; }
    catch (error) { warn(`${label}: ${clean(error.message, 180)}`); return { value: null, allDay: false, timezone: zone }; }
  }
  function parse(input) {
    if (!core || !planning) throw new Error('Calendar import needs CSE Radar core and planning helpers.');
    if (typeof input !== 'string') throw new Error('Choose a text iCalendar (.ics) file.');
    if (input.length > LIMIT_BYTES || new TextEncoder().encode(input).length > LIMIT_BYTES) throw new Error('Calendar files must be 512 KiB or smaller.');
    const physical = input.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
    if (physical.length > 12000) throw new Error('This calendar has too many lines (maximum 12,000).');
    const lines = [];
    for (const line of physical) {
      if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
      else if (line) lines.push(line);
      if (lines.length && lines[lines.length - 1].length > 4096) throw new Error('A calendar property exceeds the 4,096-character import limit.');
    }
    const warnings = [], warn = message => { const safe = clean(message, 240); if (warnings.length < 100 && !warnings.includes(safe)) warnings.push(safe); };
    const events = [], stack = []; let calendarCount = 0, components = 0, current = null, method = '', version = '';
    for (const line of lines) {
      const prop = property(line);
      if (prop.name === 'BEGIN') {
        const name = prop.value.toUpperCase();
        if (!/^[A-Z0-9-]+$/.test(name) || ++components > 1000 || stack.length >= 16) throw new Error('This calendar has invalid or too many nested components.');
        if (name === 'VCALENDAR') {
          if (stack.length || ++calendarCount > 1) throw new Error('Import one VCALENDAR at a time.');
        } else if (!stack.length) throw new Error('The file does not contain a valid VCALENDAR.');
        if (name === 'VEVENT') {
          if (stack.length !== 1 || stack[0] !== 'VCALENDAR') throw new Error('An event is nested in an unsupported calendar component.');
          if (events.length >= 500) throw new Error('This calendar contains more than 500 event components.');
          current = { props: new Map(), count: 0 }; events.push(current);
        }
        if (name === 'VTIMEZONE') warn('Custom VTIMEZONE definitions are ignored. Named IANA timezones use your browser’s timezone rules.');
        if (name === 'VALARM') warn('Embedded calendar alarms were ignored. Choose reminders in CSE Radar after review.');
        stack.push(name); continue;
      }
      if (prop.name === 'END') {
        const name = prop.value.toUpperCase();
        if (!stack.length || stack.pop() !== name) throw new Error('Calendar components are incomplete or mismatched.');
        if (name === 'VEVENT') current = null;
        continue;
      }
      if (!stack.length) throw new Error('The file contains properties outside its calendar.');
      if (stack.length === 1 && stack[0] === 'VCALENDAR') {
        if (prop.name === 'METHOD') method = prop.value.toUpperCase();
        if (prop.name === 'VERSION') version = prop.value;
      }
      if (current && stack[stack.length - 1] === 'VEVENT') {
        if (++current.count > 256) throw new Error('An event has more than 256 properties.');
        const values = current.props.get(prop.name) || []; values.push(prop); current.props.set(prop.name, values);
      }
    }
    if (!calendarCount || stack.length) throw new Error('The file is not a complete iCalendar (.ics) calendar.');
    if (version && version !== '2.0') throw new Error('Only iCalendar VERSION:2.0 is supported.');
    if (!version) warn('The calendar omits VERSION:2.0; review all imported details.');
    const candidates = [], seenUIDs = new Set(), companions = new Map();
    let skipped = 0, recurringCount = 0, companionCount = 0, overflowCount = 0, duplicateCount = 0;
    for (const event of events) {
      if ([...recurring].some(key => event.props.has(key))) { skipped++; recurringCount++; continue; }
      const issues = [], issue = message => { const safe = clean(message, 240); if (issues.length < 16 && !issues.includes(safe)) issues.push(safe); };
      const get = name => {
        const values = event.props.get(name) || [];
        if (values.length > 1) issue(`Multiple ${name} properties were found; the first is shown for review.`);
        return values[0];
      };
      const uidProp = get('UID'), rawUID = uidProp ? decodeText(uidProp.value) : '';
      // UID is an identity value, not a display label. Preserve the complete
      // value (already bounded by the property limit) for reimport matching.
      const uid = rawUID;
      const companion = rawUID.match(/^([A-Za-z0-9][A-Za-z0-9._-]{0,99})-deadline@cseradar\.local$/);
      if (companion) {
        skipped++; companionCount++;
        const startProp = get('DTSTART');
        if (startProp && (event.props.get('DTSTART') || []).length === 1 && /^\d{8}T\d{6}Z$/.test(startProp.value) && !startProp.params.TZID && (!startProp.params.VALUE || startProp.params.VALUE.toUpperCase() === 'DATE-TIME') && get('STATUS')?.value.toUpperCase() !== 'CANCELLED' && method !== 'CANCEL') {
          const parsed = dateValue(startProp, 'Deadline', issue);
          if (parsed.value) {
            const matchingUID = companion[1] + '-event@cseradar.local';
            const dates = companions.get(matchingUID) || new Set(); dates.add(parsed.value); companions.set(matchingUID, dates);
          }
        }
        issues.forEach(warn); continue;
      }
      if (rawUID && seenUIDs.has(rawUID)) { skipped++; duplicateCount++; continue; }
      if (rawUID) seenUIDs.add(rawUID);
      if (candidates.length >= 50) { skipped++; overflowCount++; continue; }
      const startProp = get('DTSTART'), endProp = get('DTEND');
      const start = dateValue(startProp, 'Start', issue);
      let end;
      if (endProp) end = dateValue(endProp, 'End', issue);
      else if (start.allDay && start.value && !event.props.has('DURATION')) end = { value: planning.shiftDay(start.value, 1), allDay: true, timezone: 'UTC' };
      else { issue('End is missing; enter it during review. No duration was guessed.'); end = { value: null, allDay: start.allDay, timezone: start.timezone }; }
      if (event.props.has('DURATION')) issue('DURATION is unsupported; enter the end date/time during review.');
      if (start.allDay !== end.allDay && end.value) { issue('Start and end use different date types; enter the correct end during review.'); end.value = null; }
      if (start.value && end.value && Date.parse(end.value) <= Date.parse(start.value)) { issue('End must follow start; enter the correct end during review.'); end.value = null; }
      const inclusiveEnd = start.allDay && end.value ? planning.shiftDay(end.value, -1) : end.value;
      const summary = get('SUMMARY'), description = get('DESCRIPTION'), organizer = get('ORGANIZER'), urlProp = get('URL');
      const title = clean(summary ? decodeText(summary.value) : '', 180);
      if (!title) issue('The event title is missing; enter it during review.');
      const urlValue = urlProp ? urlProp.value.trim() : '';
      const url = urlValue && urlValue.length <= 4096 && !/[\u0000-\u0020\u007f]/.test(urlValue) ? core.safeUrl(urlValue) || '' : '';
      if (!url) issue('A safe HTTPS official event link is missing; enter it during review.');
      const location = get('LOCATION');
      const descriptionText = [description ? decodeText(description.value) : '', location ? 'Location: ' + decodeText(location.value) : ''].filter(Boolean).join('\n');
      const categoryProp = get('CATEGORIES');
      const category = categoryProp ? categoryProp.value.split(',').map(value => decodeText(value).trim().toLowerCase()).find(value => core.categories.includes(value)) || '' : '';
      const candidate = {
        title, organizer: clean(organizer ? organizer.params.CN || '' : '', 180), description: clean(descriptionText, 2000, true), url,
        start: start.value, end: inclusiveEnd, deadline: null, allDay: start.allDay, timezone: start.timezone,
        mode: '', country: '', city: '', fee: 'Unknown', category, uid, warnings: issues
      };
      if (start.allDay) issue('All-day dates are shown with an inclusive end for review. Choose the event timezone before saving.');
      if (!uid) issue('The calendar event has no UID; check for an existing saved event before adding it.');
      if (get('STATUS')?.value.toUpperCase() === 'CANCELLED' || method === 'CANCEL') candidate.status = 'cancelled';
      candidates.push(candidate);
    }
    let attached = 0;
    for (const candidate of candidates) {
      const dates = companions.get(candidate.uid);
      if (dates && dates.size === 1) { candidate.deadline = [...dates][0]; attached++; }
      else if (dates && dates.size > 1) candidate.warnings.push('Conflicting CSE Radar deadline companions were ignored; enter the deadline during review.');
    }
    if (recurringCount) warn(`${recurringCount} recurring event component(s) were skipped. Recurrence expansion is not supported.`);
    if (companionCount) warn(`${companionCount} CSE Radar deadline companion(s) were skipped as events; ${attached} exact deadline(s) attached to matching events.`);
    if (duplicateCount) warn(`${duplicateCount} duplicate UID event component(s) were skipped. Review the first copy before saving.`);
    if (overflowCount) warn(`${overflowCount} additional event(s) were skipped; import is limited to the first 50 reviewable events.`);
    if (!events.length) warn('No VEVENT entries were found in this calendar.');
    if (candidates.length) warn('Review one event at a time. Attachments, calendar alarms, and external links were not opened.');
    return { candidates, warnings, skipped };
  }
  const api = { parse };
  root.RadarCalendarImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
