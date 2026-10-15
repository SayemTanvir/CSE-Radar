(function (root) {
  'use strict';
  const core = root.RadarCore || (typeof require === 'function' ? require('./core.js') : null);
  function isExplicitlyFree(fee) {
    if (typeof fee !== 'string') return false;
    const text = fee.trim();
    return /^(?:free|free (?:participation|registration|entry|admission|attendance)(?: and (?:participation|registration|entry|admission|attendance))?)\.?$/i.test(text)
      || /^(?:0(?:\.0+)?\s*(?:USD|BDT|EUR|GBP|INR)?|৳\s*0|বিনামূল্যে)$/i.test(text);
  }
  function matchesDeadline(event, filter, now = Date.now()) {
    if (filter === 'all') return true;
    const deadline = event.deadline && Date.parse(event.deadline);
    if (filter === 'exclude-closed') return !deadline || deadline > now;
    if (!deadline || deadline <= now || event.status === 'cancelled') return false;
    if (filter === 'future') return true;
    const days = Number(filter);
    return [7, 30].includes(days) && deadline <= now + days * 86400000;
  }
  function localParts(value, zone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(value));
    const get = type => parts.find(part => part.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
  }
  function zonedLocalToISO(value, zone) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error('Enter a complete date and time.');
    const normalized = value.length === 16 ? value + ':00' : value;
    if (!core.validDate(normalized + 'Z')) throw new Error('Enter a valid date and time.');
    try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch (_) { throw new Error('Enter a valid event timezone, such as Asia/Dhaka or UTC.'); }
    const wallClock = Date.parse(normalized + 'Z');
    const offsets = new Set();
    // Sampling both sides of a transition detects ambiguous and missing local
    // times rather than silently changing them during a daylight-saving change.
    for (let hours = -36; hours <= 36; hours += 6) {
      const sample = wallClock + hours * 3600000;
      offsets.add(Date.parse(localParts(sample, zone) + 'Z') - sample);
    }
    const candidates = [...offsets].map(offset => wallClock - offset).filter(time => localParts(time, zone) === normalized);
    if (!candidates.length) throw new Error('This time does not exist in that timezone because the clocks change. Choose another time.');
    if (candidates.length > 1) throw new Error('This time occurs twice when the clocks change. Use UTC and enter the exact UTC time.');
    return new Date(candidates[0]).toISOString();
  }
  function dateOnlyToISO(day, zone) {
    if (!core.validDate(day, true)) throw new Error('Enter a valid event date.');
    // Preserve the date in the ISO prefix for all-day exports. The offset comes
    // from the chosen timezone at that date's midnight, never a guessed time.
    const instant = zonedLocalToISO(day + 'T00:00', zone);
    const minutes = (Date.parse(day + 'T00:00:00Z') - Date.parse(instant)) / 60000;
    const sign = minutes >= 0 ? '+' : '-';
    const absolute = Math.abs(minutes);
    return `${day}T00:00:00${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  }
  function shiftDay(day, days) {
    if (!core.validDate(day, true)) throw new Error('Enter a valid event date.');
    return new Date(Date.parse(day + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  }
  const api = { isExplicitlyFree, matchesDeadline, zonedLocalToISO, dateOnlyToISO, shiftDay, localParts };
  root.RadarPlanning = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
