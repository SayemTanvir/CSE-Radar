'use strict';
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const api = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome : null);
  const preview = !api;
  const categoryNames = { hackathon: 'Hackathon', gamejam: 'Game jam', contest: 'Contest', fest: 'Tech fest', workshop: 'Workshop', conference: 'Conference' };
  const modeNames = { online: 'Online', 'in-person': 'In person', hybrid: 'Hybrid' };
  const routeNames = { discover: 'Discover', saved: 'My calendar', deadlines: 'Deadlines', sources: 'Event sources' };
  const state = { events: [], sources: [], saved: [], zone: 'Asia/Dhaka', reminderHours: 24, route: 'discover', category: 'all', scope: 'all', mode: 'all', freeOnly: false, deadlineFilter: 'all', query: '', view: 'list', month: '', day: null, detailId: null, updatedAt: null, loadError: false, feedEnabled: false, feedStatus: {}, feedBusy: false, catalogOrigin: 'bundled', cachedCatalog: null };
  let formContext = { editId: null, draftId: null, sourceUrl: null, tags: [] };
  let toastTimeout;
  let saving = false;
  let catalog;
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function action(text, className, handler) {
    const button = node('button', className, text);
    button.type = 'button';
    button.addEventListener('click', () => run(handler));
    return button;
  }
  function link(text, url, className) {
    const a = node('a', className, text);
    a.href = RadarCore.safeUrl(url) || '#';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }
  function toast(text) {
    $('#toast').textContent = text;
    $('#toast').hidden = false;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { $('#toast').hidden = true; }, 5000);
  }
  async function run(handler) {
    try { await handler(); } catch (error) { console.error(error); toast(error.message || 'Something went wrong. Please try again.'); }
  }
  async function readStorage() {
    if (api) return api.storage.local.get(['radarSaved', 'radarTimezone', 'radarReminderHours', 'radarCatalog', 'radarFeedEnabled', 'radarFeedStatus']);
    return JSON.parse(localStorage.getItem('cse-radar-preview') || '{}');
  }
  async function writeStorage(values) {
    if (api) await api.storage.local.set(values);
    else localStorage.setItem('cse-radar-preview', JSON.stringify({ ...await readStorage(), ...values }));
  }
  function hydrate(stored) {
    state.feedEnabled = stored.radarFeedEnabled === true;
    state.feedStatus = stored.radarFeedStatus && typeof stored.radarFeedStatus === 'object' ? stored.radarFeedStatus : {};
    try { state.cachedCatalog = stored.radarCatalog ? RadarFeed.validateCatalog(stored.radarCatalog) : null; } catch { state.cachedCatalog = null; }
    selectCatalog();
    state.saved = (Array.isArray(stored.radarSaved) ? stored.radarSaved : []).flatMap(raw => {
      try { return [RadarCore.validateEvent(raw)]; } catch { return []; }
    });
    state.saved = [...new Map(state.saved.map(event => [event.id, event])).values()];
    try {
      if (stored.radarTimezone) { new Intl.DateTimeFormat('en', { timeZone: stored.radarTimezone }); state.zone = stored.radarTimezone; }
    } catch { state.zone = 'Asia/Dhaka'; }
    const hours = Number(stored.radarReminderHours ?? 24);
    state.reminderHours = [0, 1, 24, 72, 168].includes(hours) ? hours : 24;
  }
  function dayKey(value, zone = state.zone) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
    const get = type => parts.find(p => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function todayKey() { return dayKey(Date.now()); }
  function dateLabel(value, options = {}) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: state.zone, day: 'numeric', month: 'short', ...options }).format(new Date(value));
  }
  function allDayLabel(value, options = {}) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', ...options }).format(new Date(value.slice(0, 10) + 'T12:00:00Z'));
  }
  function lastDate(event) {
    return new Date(Date.parse(event.end.slice(0, 10) + 'T00:00:00Z') - 86400000).toISOString();
  }
  function eventDates(event, full = false) {
    if (!event.start) return 'Dates awaiting confirmation';
    const opts = full ? { year: 'numeric' } : {};
    const start = event.allDay ? allDayLabel(event.start, opts) : dateLabel(event.start, opts);
    const end = event.allDay ? allDayLabel(lastDate(event), opts) : dateLabel(event.end, opts);
    return start === end ? start : `${start} – ${end}`;
  }
  function dateTimeLabel(value) { return dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) + ` (${state.zone})`; }
  function isUpcoming(event) {
    if (event.status === 'cancelled') return false;
    if (!event.end) return true;
    return event.allDay ? event.end.slice(0, 10) > todayKey() : Date.parse(event.end) > Date.now();
  }
  function isSaved(id) { return state.saved.some(event => event.id === id); }
  function allEvents() {
    const merged = new Map(state.saved.map(event => [event.id, event]));
    state.events.forEach(event => merged.set(event.id, event));
    return [...merged.values()];
  }
  function getEvent(id) { return allEvents().find(event => event.id === id); }
  function visibleEvents() {
    let events = allEvents();
    if (state.route === 'saved') events = events.filter(event => isSaved(event.id));
    else if (state.route === 'deadlines') events = events.filter(event => event.status !== 'cancelled' && event.deadline && Date.parse(event.deadline) > Date.now());
    else events = events.filter(isUpcoming);
    return events.filter(event =>
      (state.category === 'all' || event.category === state.category) &&
      (state.scope === 'all' || event.scope === state.scope) &&
      (state.mode === 'all' || event.mode === state.mode) &&
      (!state.freeOnly || RadarPlanning.isExplicitlyFree(event.fee)) &&
      RadarPlanning.matchesDeadline(event, state.deadlineFilter) &&
      (!state.query || [event.title, event.organizer, event.description, event.country, event.city, ...event.tags].join(' ').toLowerCase().includes(state.query))
    ).sort((a, b) => {
      const key = state.route === 'deadlines' ? 'deadline' : 'start';
      return (a[key] ? Date.parse(a[key]) : Infinity) - (b[key] ? Date.parse(b[key]) : Infinity) || a.title.localeCompare(b.title);
    });
  }
  function badge(event) { return node('span', `badge ${event.category}`, categoryNames[event.category]); }
  function deadlineText(event) {
    if (event.status === 'cancelled') return 'Cancelled — check organizer';
    if (event.status === 'awaiting-dates') return 'Schedule needs confirmation';
    if (!event.deadline) return 'Registration cutoff not published';
    if (Date.parse(event.deadline) < Date.now()) return `Registration closed ${dateLabel(event.deadline)}`;
    return `Register by ${dateLabel(event.deadline, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
  }
  function eventCard(event) {
    const card = node('article', 'event-card');
    const top = node('div', 'card-top');
    const badges = node('div');
    badges.append(badge(event), node('span', 'card-format', modeNames[event.mode]));
    const saved = isSaved(event.id);
    const save = action(saved ? '✓' : '+', `save-button${saved ? ' saved' : ''}`, () => toggleSave(event));
    save.setAttribute('aria-label', `${saved ? 'Remove' : 'Save'} ${event.title}${saved ? ' from' : ' to'} my calendar`);
    save.setAttribute('aria-pressed', String(saved));
    top.append(badges, save);
    const heading = node('h3');
    heading.append(action(event.title, 'event-title-button', () => openDetail(event.id)));
    const meta = node('div', 'card-meta');
    const dates = node('span'); dates.append(node('span', 'meta-symbol', '▦'), document.createTextNode(eventDates(event)));
    const place = node('span'); place.append(node('span', 'meta-symbol', '⌾'), document.createTextNode(event.mode === 'online' ? 'Join from anywhere' : [event.city, event.country].filter(Boolean).join(', ')));
    meta.append(dates, place);
    const bottom = node('div', 'card-bottom');
    const deadline = node('span', `deadline${!event.deadline ? ' none' : Date.parse(event.deadline) - Date.now() < 7 * 86400000 ? ' urgent' : ''}`, deadlineText(event));
    bottom.append(deadline, action('View details ↗', 'text-button', () => openDetail(event.id)));
    card.append(top, heading, node('p', 'organizer', event.organizer), meta, bottom);
    return card;
  }
  function render() {
    const upcoming = allEvents().filter(isUpcoming);
    $('#discover-count').textContent = upcoming.length;
    $('#saved-count').textContent = state.saved.length;
    $('#stat-upcoming').textContent = upcoming.filter(e => e.start).length;
    $('#stat-online').textContent = upcoming.filter(e => e.mode === 'online').length;
    $('#stat-local').textContent = upcoming.filter(e => e.scope === 'local').length;
    $('#stat-deadlines').textContent = upcoming.filter(e => e.deadline && Date.parse(e.deadline) > Date.now() && Date.parse(e.deadline) <= Date.now() + 7 * 86400000).length;
    $('#timezone-label').textContent = state.zone;
    $('#calendar-zone').textContent = state.zone;
    $('#route-label').textContent = routeNames[state.route];
    $$('[data-route]').forEach(b => { b.classList.toggle('active', b.dataset.route === state.route); if (b.dataset.route === state.route) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('#hero').hidden = state.route !== 'discover';
    $('#events-section').hidden = state.route === 'sources';
    $('#sources-section').hidden = state.route !== 'sources';
    $('#section-title').firstChild.textContent = ({ discover: 'Explore opportunities ', saved: 'Your saved opportunities ', deadlines: 'Registration deadlines ' })[state.route] || 'Explore opportunities ';
    const events = visibleEvents();
    $('#result-count').textContent = events.length;
    const custom = state.saved.filter(e => e.id.startsWith('custom-')).length;
    $('#results-note').textContent = state.route === 'saved' ? `${events.length} saved ${events.length === 1 ? 'opportunity' : 'opportunities'} · reminders ${state.reminderHours === 0 ? 'off' : preview ? 'available in the installed extension' : `${state.reminderHours}h before dates`}` : state.route === 'deadlines' ? 'Only explicitly published registration cutoffs appear here.' : 'Upcoming + awaiting dates · sorted by start date';
    if (state.freeOnly) $('#results-note').textContent += ' · Explicitly listed free entry';
    if (state.deadlineFilter === 'exclude-closed') $('#results-note').textContent += ' · Unknown cutoffs remain visible';
    const list = $('#event-list');
    list.replaceChildren(...events.map(eventCard));
    $('#empty-state').hidden = events.length > 0;
    $('#empty-copy').textContent = state.route === 'saved' ? 'Save an event with the + button, or add one you found yourself.' : state.route === 'deadlines' ? 'No verified future registration cutoffs match. You can add a known deadline to your own event.' : state.loadError ? 'The bundled catalog could not load. Add an event yourself or try reopening CSE Radar.' : 'Try another filter or browse the official event sources.';
    $('#catalog-status').textContent = `${preview ? 'Browser preview · notifications require installation. ' : ''}${state.updatedAt ? `Catalog edition ${state.updatedAt} · ${state.catalogOrigin === 'cached' ? 'downloaded' : 'bundled'} · reviewed events` : 'Catalog unavailable'}${custom ? ` · ${custom} personal ${custom === 1 ? 'event' : 'events'}` : ''}`;
    renderFeedStatus();
    $('#content-grid').classList.toggle('calendar-expanded', state.view === 'calendar');
    for (const view of ['list', 'calendar']) { const b = $(`#${view}-view`); b.classList.toggle('selected', state.view === view); b.setAttribute('aria-pressed', String(state.view === view)); }
    renderCalendar(events);
  }
  function calendarEntries(events, key) {
    const entries = [];
    for (const event of events) {
      if (event.status === 'cancelled') continue;
      if (event.start && state.route !== 'deadlines') {
        const first = event.allDay ? event.start.slice(0, 10) : dayKey(event.start);
        const last = event.allDay ? lastDate(event).slice(0, 10) : dayKey(Date.parse(event.end) - 1);
        if (key >= first && key <= last) entries.push({ event, kind: 'event' });
      }
      if (event.deadline && dayKey(event.deadline) === key) entries.push({ event, kind: 'deadline' });
    }
    return entries;
  }
  function renderCalendar(events) {
    const monthStart = new Date(state.month + '-01T12:00:00Z');
    $('#month-label').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(monthStart);
    const offset = (monthStart.getUTCDay() + 6) % 7;
    const grid = $('#calendar-grid'); grid.replaceChildren();
    const start = new Date(monthStart); start.setUTCDate(1 - offset);
    const lastOfMonth = new Date(monthStart); lastOfMonth.setUTCMonth(lastOfMonth.getUTCMonth() + 1, 0);
    const cellCount = Math.ceil((offset + lastOfMonth.getUTCDate()) / 7) * 7;
    for (let index = 0; index < cellCount; index++) {
      const date = new Date(start); date.setUTCDate(start.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      const entries = calendarEntries(events, key);
      const day = action('', `calendar-day${key.slice(0, 7) !== state.month ? ' outside' : ''}${key === todayKey() ? ' today' : ''}${key === state.day ? ' selected' : ''}`, () => { state.day = key; renderCalendar(visibleEvents()); });
      day.append(node('span', '', String(date.getUTCDate())));
      const markers = node('span', 'calendar-markers');
      if (entries.some(e => e.kind === 'event')) markers.append(node('i', 'event-dot'));
      if (entries.some(e => e.kind === 'deadline')) markers.append(node('i', 'deadline-dot'));
      day.append(markers);
      day.setAttribute('aria-label', `${allDayLabel(key, { weekday: 'long', year: 'numeric' })}, ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`);
      day.setAttribute('aria-pressed', String(key === state.day));
      if (key === todayKey()) day.setAttribute('aria-current', 'date');
      grid.append(day);
    }
    const dayPanel = $('#day-events'); dayPanel.replaceChildren();
    if (state.day) {
      dayPanel.append(node('h4', '', allDayLabel(state.day, { weekday: 'short', year: 'numeric' })));
      const entries = calendarEntries(events, state.day);
      if (!entries.length) dayPanel.append(node('p', '', 'No matching events on this date. Browse another month or adjust your filters.'));
      for (const entry of entries) {
        const button = action('', 'day-event', () => openDetail(entry.event.id));
        button.append(node('i', entry.kind === 'deadline' ? 'deadline-dot' : 'event-dot'), node('span', '', `${entry.kind === 'deadline' ? 'Registration: ' : ''}${entry.event.title}`));
        dayPanel.append(button);
      }
    }
  }
  async function toggleSave(event) {
    if (saving) return;
    saving = true;
    try {
      const remove = isSaved(event.id);
      await mutateSaved(remove ? 'remove' : 'save', event);
      render();
      if ($('#detail-dialog').open) renderDetail(event.id);
      toast(remove ? 'Removed from your calendar.' : preview ? 'Saved in this preview. Install the extension for reminders.' : state.reminderHours === 0 ? 'Saved to your calendar. Reminders are off.' : 'Saved to your calendar. Reminders scheduled for known future dates.');
    } finally { saving = false; }
  }
  async function mutateSaved(kind, event) {
    if (api) {
      const result = await api.runtime.sendMessage(kind === 'remove' ? { type: 'radar:remove', id: event.id } : { type: 'radar:save', event: RadarCore.validateEvent(event) });
      if (!result?.ok || !Array.isArray(result.saved)) throw new Error(result?.status?.error || 'Could not save your changes. Please try again.');
      state.saved = result.saved.map(item => RadarCore.validateEvent(item));
    } else {
      const stored = await readStorage();
      const latest = Array.isArray(stored.radarSaved) ? stored.radarSaved.flatMap(raw => { try { return [RadarCore.validateEvent(raw)]; } catch { return []; } }) : [];
      const next = latest.filter(item => item.id !== event.id);
      if (kind === 'save') next.push(RadarCore.validateEvent(event));
      await writeStorage({ radarSaved: next }); state.saved = next;
    }
  }
  function renderDetail(id) {
    const event = getEvent(id);
    if (!event) { $('#detail-dialog').close(); return; }
    const content = $('#detail-content'); content.replaceChildren();
    content.append(badge(event), node('h2', 'detail-title', event.title), node('p', 'detail-organizer', event.organizer), node('p', 'detail-description', event.description));
    const facts = node('dl', 'detail-facts');
    const fact = (label, value) => { const item = node('div'); item.append(node('dt', '', label), node('dd', '', value)); facts.append(item); };
    fact('When', eventDates(event, true));
    fact('Where', `${modeNames[event.mode]} · ${event.mode === 'online' ? 'Worldwide' : [event.city, event.country].filter(Boolean).join(', ')}`);
    if (event.start) fact('Schedule', event.allDay ? 'Dates only; exact times not published. Check the organizer.' : `${dateTimeLabel(event.start)} → ${dateTimeLabel(event.end)}`);
    fact('Registration deadline', event.deadline ? dateTimeLabel(event.deadline) : 'Not verified; check the official page.');
    fact('Who can join', event.eligibility);
    fact('Entry fee', event.fee);
    fact('Status', { confirmed: 'Published dates', 'awaiting-dates': 'Awaiting confirmed dates', cancelled: 'Cancelled' }[event.status]);
    content.append(facts);
    const actions = node('div', 'detail-actions');
    actions.append(link('Official event ↗', event.url, 'button button-dark'));
    if (event.registrationUrl && event.status !== 'cancelled') actions.append(link('Registration page ↗', event.registrationUrl, 'button button-light'));
    actions.append(action(isSaved(id) ? '✓ Saved · remove' : '+ Save event', 'button button-light', () => toggleSave(event)));
    if (isSaved(id) && id.startsWith('custom-')) {
      const edit = action('Edit personal event', 'button button-light', () => openEventForm(event));
      edit.id = 'edit-personal-event'; actions.append(edit);
    }
    if (event.start && event.status !== 'cancelled') actions.append(action('Export calendar .ics', 'button button-light', () => downloadCalendar([event])));
    if (event.deadline && event.status !== 'cancelled') actions.append(action('Export deadline .ics', 'button button-light', () => downloadCalendar([event], true)));
    content.append(actions);
    const footnote = node('p', 'source-footnote');
    footnote.append(link('View source', event.sourceUrl), document.createTextNode(` · Last checked ${event.lastChecked}. ${event.id.startsWith('custom-') ? 'Personal entry; details supplied by you.' : 'Curated entry; details can change.'}`));
    if (event.allDay) footnote.append(document.createTextNode(' Browser reminders use the start of the published date in the source timezone; attendance times must be checked separately.'));
    content.append(footnote);
  }
  function openDetail(id) { state.detailId = id; renderDetail(id); if (!$('#detail-dialog').open) $('#detail-dialog').showModal(); }
  function downloadCalendar(events, deadline = false) {
    const exportable = events.filter(event => event.status !== 'cancelled' && (deadline ? event.deadline : event.start || event.deadline));
    if (!exportable.length) { toast('No confirmed dates to export. Save an event with published dates first.'); return; }
    const text = RadarCore.toICS(exportable, { deadline, includeDeadlines: !deadline });
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    const a = node('a'); a.href = url; a.download = deadline ? 'cse-radar-deadlines.ics' : 'cse-radar-events.ics';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(deadline ? 'Registration deadlines exported. Import the .ics file into your calendar app.' : 'Event dates and known registration deadlines exported. Import the .ics file into your calendar app.');
  }
  function renderSources() {
    $('#source-list').replaceChildren(...state.sources.map(source => {
      const card = node('article', 'source-card');
      card.append(node('span', 'badge', source.scope === 'local' ? 'Bangladesh' : 'International'), node('h3', '', source.name), node('p', '', source.description), link('Browse official source ↗', source.url, 'text-button'));
      return card;
    }));
  }
  function route(value) {
    state.route = Object.hasOwn(routeNames, value) ? value : 'discover';
    render();
  }
  function resetFilters() {
    state.category = state.scope = state.mode = 'all'; state.query = '';
    state.freeOnly = false; state.deadlineFilter = 'all';
    $('#free-filter').checked = false; $('#deadline-filter').value = 'all';
    $('#search').value = ''; $('#scope-filter').value = $('#mode-filter').value = 'all';
    $$('[data-category]').forEach(b => b.classList.toggle('selected', b.dataset.category === 'all'));
    render();
  }
  async function addEvent(form) {
    const data = new FormData(form);
    const value = key => String(data.get(key) || '').trim();
    const parseDate = key => {
      if (!value(key)) return null;
      return RadarPlanning.zonedLocalToISO(value(key), value('timezone'));
    };
    const allDay = form.elements.namedItem('allDay').checked;
    const start = allDay ? RadarPlanning.dateOnlyToISO(value('start'), value('timezone')) : parseDate('start');
    const end = allDay ? RadarPlanning.dateOnlyToISO(RadarPlanning.shiftDay(value('end'), 1), value('timezone')) : parseDate('end');
    const editId = formContext.editId;
    const draftId = formContext.draftId;
    const event = RadarCore.validateEvent({
      id: editId || 'custom-' + crypto.randomUUID(), title: value('title'), organizer: value('organizer'),
      category: value('category'), scope: value('country').toLowerCase() === 'bangladesh' ? 'local' : 'international',
      country: value('country'), city: value('city'), mode: value('mode'), start, end, allDay,
      deadline: parseDate('deadline'), timezone: value('timezone'),
      eligibility: value('eligibility') || 'Check the organizer’s rules', fee: value('fee') || 'Check the official event page',
      description: value('description') || 'Personal event added by you. Check the official organizer for complete details.',
      url: value('url'), registrationUrl: value('registrationUrl') || null, sourceUrl: formContext.sourceUrl || value('url'), lastChecked: dayKey(Date.now(), 'Asia/Dhaka'), status: value('status'), tags: formContext.tags
    });
    if (!editId && Date.parse(event.end) <= Date.now()) throw new Error('Please add an event that has not ended yet.');
    if (event.deadline && Date.parse(event.deadline) > Date.parse(event.end)) throw new Error('The registration deadline cannot be after the event ends.');
    await mutateSaved('save', event);
    if (api && draftId) {
      try { await api.runtime.sendMessage({ type: 'radar:draft:delete', id: draftId }); } catch (error) { console.error('Draft cleanup will retry on expiry:', error); }
      const url = new URL(location.href); url.searchParams.delete('draft'); history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    form.reset(); formContext = { editId: null, draftId: null, sourceUrl: null, tags: [] }; $('#add-dialog').close(); resetFilters();
    const day = event.allDay ? event.start.slice(0, 10) : dayKey(event.start);
    state.month = day.slice(0, 7); state.day = day;
    location.hash = 'saved'; route('saved');
    toast(editId ? 'Personal event updated. Reminders follow its new schedule.' : preview ? 'Event saved. Browser notifications are available after installation.' : 'Event saved to your calendar.');
  }
  function updateInputZone() {
    const zone = $('#add-form').elements.namedItem('timezone').value.trim() || 'your selected timezone';
    $('#input-zone').textContent = `Enter event times and exact registration cutoffs in ${zone}. For dates-only events, the last day is inclusive and reminders use the beginning of the listed date.`;
  }
  function setDateMode(allDay) {
    const form = $('#add-form');
    for (const key of ['start', 'end']) {
      const input = form.elements.namedItem(key);
      const previous = input.value;
      input.type = allDay ? 'date' : 'datetime-local';
      input.step = '1';
      input.value = allDay ? previous.slice(0, 10) : previous.includes('T') ? previous : '';
    }
    form.elements.namedItem('allDay').checked = allDay;
    $('#start-label-text').textContent = allDay ? 'First day' : 'Starts';
    $('#end-label-text').textContent = allDay ? 'Last day (inclusive)' : 'Ends';
    updateInputZone();
  }
  function openEventForm(event = null) {
    if (event && (!event.id.startsWith('custom-') || !isSaved(event.id))) throw new Error('Only your personal saved events can be edited.');
    const form = $('#add-form'); form.reset();
    formContext = { editId: event?.id || null, draftId: null, sourceUrl: event?.sourceUrl || null, tags: event?.tags || [] };
    $('#capture-review-notice').hidden = true; $('#capture-warnings').replaceChildren(); $('#form-error').textContent = '';
    $('#add-heading').textContent = event ? 'Edit personal event' : 'Add an event';
    $('#add-intro').textContent = event ? 'Changes stay on this device. Dates and reminders update together.' : 'Save an opportunity you found. It stays in your browser.';
    $('#event-submit').textContent = event ? 'Save changes' : 'Save to my calendar';
    form.elements.namedItem('timezone').value = event?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    form.elements.namedItem('category').value = event?.category || 'hackathon';
    setDateMode(event?.allDay === true);
    if (event) {
      for (const key of ['title', 'organizer', 'category', 'url', 'registrationUrl', 'country', 'city', 'mode', 'fee', 'eligibility', 'description', 'status']) form.elements.namedItem(key).value = event[key] || '';
      form.elements.namedItem('start').value = !event.start ? '' : event.allDay ? event.start.slice(0, 10) : RadarPlanning.localParts(event.start, event.timezone);
      form.elements.namedItem('end').value = !event.end ? '' : event.allDay ? RadarPlanning.shiftDay(event.end.slice(0, 10), -1) : RadarPlanning.localParts(event.end, event.timezone);
      form.elements.namedItem('deadline').value = event.deadline ? RadarPlanning.localParts(event.deadline, event.timezone) : '';
    }
    updateInputZone();
    if ($('#detail-dialog').open) $('#detail-dialog').close();
    $('#add-dialog').showModal();
  }
  async function openCapturedDraft() {
    const id = new URL(location.href).searchParams.get('draft');
    if (!id || !api) return;
    const result = await api.runtime.sendMessage({ type: 'radar:draft:get', id });
    if (!result?.ok || !result.draft) { toast(result?.status?.error || 'This capture draft has expired. Capture the page again.'); return; }
    const draft = result.draft; const candidate = draft.candidate;
    openEventForm();
    const form = $('#add-form');
    formContext.draftId = id;
    formContext.tags = ['page capture'];
    const pageSource = RadarCore.safeUrl(draft.pageUrl || draft.sourcePageUrl);
    formContext.sourceUrl = pageSource || RadarCore.safeUrl(candidate.url);
    $('#add-heading').textContent = 'Review captured event';
    $('#add-intro').textContent = 'Confirm or correct these details before adding the event to your calendar.';
    $('#capture-review-notice').hidden = false;
    $('#capture-source').replaceChildren();
    const source = pageSource || RadarCore.safeUrl(candidate.url);
    if (source) $('#capture-source').append(link(pageSource ? 'Open source page ↗' : 'Open provided event link ↗', source, 'text-button'));
    const warnings = (draft.warnings || []).slice();
    for (const key of ['title', 'organizer', 'url', 'country', 'city', 'fee', 'description']) form.elements.namedItem(key).value = candidate[key] || '';
    form.elements.namedItem('category').value = RadarCore.categories.includes(candidate.category) ? candidate.category : '';
    form.elements.namedItem('mode').value = RadarCore.modes.includes(candidate.mode) ? candidate.mode : '';
    form.elements.namedItem('status').value = candidate.status === 'cancelled' ? 'cancelled' : 'confirmed';
    const allDay = candidate.allDay === true || (candidate.start && candidate.start.length === 10);
    setDateMode(!!allDay);
    const zone = form.elements.namedItem('timezone').value;
    for (const key of ['start', 'end']) {
      const value = candidate[key];
      if (!value) continue;
      if (allDay) form.elements.namedItem(key).value = value.slice(0, 10);
      else if (Number.isFinite(Date.parse(value)) && value.length > 10) form.elements.namedItem(key).value = RadarPlanning.localParts(value, zone);
    }
    if (candidate.deadline && candidate.deadline.length > 10 && Number.isFinite(Date.parse(candidate.deadline))) form.elements.namedItem('deadline').value = RadarPlanning.localParts(candidate.deadline, zone);
    else if (candidate.deadline) warnings.push(`The source lists a registration date (${candidate.deadline}) without an exact cutoff time. The reminder deadline stays blank until you confirm a time.`);
    if (!candidate.mode) warnings.push('Choose the event format; the source did not specify one.');
    if (!candidate.category) warnings.push('Choose the event category.');
    $('#capture-warnings').replaceChildren(...warnings.map(text => node('li', '', text)));
    updateInputZone();
  }
  function openSettings() {
    $('#timezone-select').value = state.zone;
    $('#reminder-select').value = String(state.reminderHours);
    $('#settings-dialog').showModal();
  }
  function selectCatalog() {
    const cached = state.cachedCatalog;
    const selected = cached && (!catalog || cached.updatedAt >= catalog.updatedAt) ? cached : catalog;
    if (!selected) return;
    state.events = selected.events;
    state.updatedAt = selected.updatedAt;
    state.catalogOrigin = selected === cached ? 'cached' : 'bundled';
    state.loadError = false;
  }
  function renderFeedStatus() {
    $('#feed-enable').disabled = preview || state.feedBusy;
    $('#feed-enable').textContent = state.feedEnabled ? 'Turn off event updates' : 'Enable event updates';
    $('#feed-refresh').disabled = preview || !state.feedEnabled || state.feedBusy;
    $('#feed-refresh').textContent = state.feedBusy ? 'Refreshing…' : 'Refresh events';
    let summary = state.feedEnabled ? 'Event updates are on.' : 'A catalog you can take offline.';
    let message = preview ? 'Install the extension to enable catalog updates and browser reminders.' : state.feedEnabled ? 'Checks for reviewed catalog updates every six hours.' : 'Enable updates to receive reviewed event listings without reinstalling.';
    if (state.feedStatus.lastSuccess && Number.isFinite(Date.parse(state.feedStatus.lastSuccess))) message += ` Last downloaded ${dateTimeLabel(state.feedStatus.lastSuccess)}.`;
    if (state.feedStatus.error && typeof state.feedStatus.error === 'string') {
      summary = 'Keeping your last available catalog.';
      message = state.feedStatus.error.slice(0, 240) + ' Your saved events are safe. Retry when connected.';
    }
    if (state.feedBusy) { summary = 'Checking the radar…'; message = 'Downloading and checking the reviewed event catalog.'; }
    if (state.updatedAt && (Date.now() - Date.parse(state.updatedAt + 'T00:00:00Z')) > 14 * 86400000) message += ' This catalog edition is over two weeks old; check organizer sources for changes.';
    $('#feed-summary').textContent = summary;
    $('#feed-status').textContent = message;
    $('#feed-settings-status').textContent = state.feedEnabled ? 'Updates enabled. Event verification dates are shown in each event’s details.' : 'Updates off. No catalog requests are made.';
  }
  async function refreshFeed() {
    if (!api || !state.feedEnabled || state.feedBusy) return;
    state.feedBusy = true; renderFeedStatus();
    try {
      const result = await api.runtime.sendMessage({ type: 'radar:refresh' });
      hydrate(await readStorage()); render();
      if (!result?.ok) toast(result?.status?.error || 'Catalog could not refresh. Keeping your last available events.');
      else toast('Catalog refreshed. Saved event schedules are up to date with this edition.');
    } finally { state.feedBusy = false; renderFeedStatus(); }
  }
  async function toggleFeed() {
    if (!api || state.feedBusy) return;
    if (state.feedEnabled) {
      await writeStorage({ radarFeedEnabled: false }); state.feedEnabled = false;
      await api.permissions.remove({ origins: [RadarFeed.FEED_ORIGIN] });
      hydrate(await readStorage()); render(); toast('Event updates turned off. Downloaded events remain available.');
      return;
    }
    // Request immediately in the click handler, before any storage await, so
    // Firefox and Chromium both see the required user gesture.
    const granted = await api.permissions.request({ origins: [RadarFeed.FEED_ORIGIN] });
    if (!granted) { toast('Permission was not granted. Your offline catalog still works.'); return; }
    await writeStorage({ radarFeedEnabled: true }); state.feedEnabled = true;
    await refreshFeed();
  }
  async function init() {
    const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!['Asia/Dhaka', 'UTC'].includes(localZone)) $('#timezone-select').append(new Option(`Device (${localZone})`, localZone));
    updateInputZone();
    try { hydrate(await readStorage()); } catch (error) { toast('Saved events could not be read. Check browser storage settings.'); console.error(error); }
    if (![...$('#timezone-select').options].some(option => option.value === state.zone)) $('#timezone-select').append(new Option(state.zone, state.zone));
    state.month = todayKey().slice(0, 7); state.day = todayKey();
    const results = await Promise.allSettled([fetch('data/events.json').then(r => { if (!r.ok) throw new Error('Catalog unavailable'); return r.json(); }), fetch('data/sources.json').then(r => { if (!r.ok) throw new Error('Sources unavailable'); return r.json(); })]);
    if (results[0].status === 'fulfilled') {
      try { catalog = RadarFeed.validateCatalog(results[0].value); selectCatalog(); }
      catch (error) { state.loadError = !state.cachedCatalog; toast('The bundled catalog is invalid. Using downloaded or saved events if available.'); console.error(error); }
      // Refresh saved organizer entries so reminders use the current published schedule.
      const refreshed = state.updatedAt ? RadarFeed.reconcileSaved(state.saved, { updatedAt: state.updatedAt, events: state.events }) : state.saved;
      if (state.saved.length) {
        try {
          if (api) {
            const result = await api.runtime.sendMessage({ type: 'radar:sync-saved' });
            if (!result?.ok || !Array.isArray(result.saved)) throw new Error('Saved schedules could not be refreshed.');
            state.saved = result.saved.map(event => RadarCore.validateEvent(event));
          } else if (JSON.stringify(refreshed) !== JSON.stringify(state.saved)) { await writeStorage({ radarSaved: refreshed }); state.saved = refreshed; }
        } catch (error) { toast('Saved schedules could not be refreshed.'); console.error(error); }
      }
    } else { state.loadError = !state.cachedCatalog; toast('Could not load the bundled catalog. Downloaded and saved events remain available.'); }
    if (results[1].status === 'fulfilled') state.sources = (Array.isArray(results[1].value) ? results[1].value : []).filter(source => typeof source.name === 'string' && typeof source.description === 'string' && RadarCore.safeUrl(source.url));
    else $('#source-list').append(node('p', 'load-error', 'The source directory could not load. Please reopen CSE Radar.'));
    if (state.sources.length) renderSources();
    route(location.hash.slice(1));
    $$('[data-route]').forEach(button => button.addEventListener('click', () => { location.hash = button.dataset.route; route(button.dataset.route); }));
    window.addEventListener('hashchange', () => route(location.hash.slice(1)));
    $$('[data-category]').forEach(button => button.addEventListener('click', () => {
      state.category = button.dataset.category;
      $$('[data-category]').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
      render();
    }));
    $('#search').addEventListener('input', event => { state.query = event.target.value.trim().toLowerCase(); render(); });
    $('#scope-filter').addEventListener('change', event => { state.scope = event.target.value; render(); });
    $('#mode-filter').addEventListener('change', event => { state.mode = event.target.value; render(); });
    $('#free-filter').addEventListener('change', event => { state.freeOnly = event.target.checked; render(); });
    $('#deadline-filter').addEventListener('change', event => { state.deadlineFilter = event.target.value; render(); });
    $('#clear-filters').addEventListener('click', resetFilters);
    $('#reset-filter-button').addEventListener('click', resetFilters);
    for (const view of ['list', 'calendar']) $(`#${view}-view`).addEventListener('click', () => { state.view = view; render(); });
    for (const [id, delta] of [['previous-month', -1], ['next-month', 1]]) $(`#${id}`).addEventListener('click', () => {
      const date = new Date(state.month + '-01T12:00:00Z'); date.setUTCMonth(date.getUTCMonth() + delta); state.month = date.toISOString().slice(0, 7); state.day = state.month + '-01'; render();
    });
    $('#calendar-today').addEventListener('click', () => { state.month = todayKey().slice(0, 7); state.day = todayKey(); render(); });
    $('#export-saved').addEventListener('click', () => run(() => downloadCalendar(state.saved.map(e => getEvent(e.id) || e))));
    $('#add-open').addEventListener('click', () => run(() => openEventForm()));
    $('#all-day-toggle').addEventListener('change', event => setDateMode(event.target.checked));
    $('#add-form').elements.namedItem('timezone').addEventListener('input', updateInputZone);
    $('#settings-open').addEventListener('click', openSettings);
    $('#feed-manage').addEventListener('click', openSettings);
    $('#feed-enable').addEventListener('click', () => run(toggleFeed));
    $('#feed-refresh').addEventListener('click', () => run(refreshFeed));
    // Preferences remain reachable on narrow screens where the sidebar footer is hidden.
    $('#timezone-label').tabIndex = 0; $('#timezone-label').setAttribute('role', 'button'); $('#timezone-label').setAttribute('aria-label', 'Open timezone and reminder preferences');
    $('#timezone-label').addEventListener('click', openSettings);
    $('#timezone-label').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSettings(); } });
    const mobileSettings = action('Preferences', 'text-button', openSettings); $('.page-footer').append(mobileSettings);
    $$('[data-close]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
    $$('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
    $('#add-form').addEventListener('submit', async event => {
      event.preventDefault(); $('#form-error').textContent = '';
      const button = $('[type="submit"]', event.target); button.disabled = true;
      try { await addEvent(event.target); } catch (error) { $('#form-error').textContent = error.message || 'Could not save the event.'; } finally { button.disabled = false; }
    });
    $('#settings-form').addEventListener('submit', event => run(async () => {
      event.preventDefault();
      const zone = $('#timezone-select').value; const hours = Number($('#reminder-select').value);
      await writeStorage({ radarTimezone: zone, radarReminderHours: hours }); state.zone = zone; state.reminderHours = hours;
      $('#settings-dialog').close(); render(); toast('Preferences saved.');
    }));
    if (api) api.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.radarSaved || changes.radarTimezone || changes.radarReminderHours || changes.radarCatalog || changes.radarFeedEnabled || changes.radarFeedStatus)) run(async () => { hydrate(await readStorage()); render(); if ($('#detail-dialog').open) renderDetail(state.detailId); });
    });
    else window.addEventListener('storage', event => { if (event.key === 'cse-radar-preview') run(async () => { hydrate(await readStorage()); render(); }); });
    setInterval(() => { if (!document.hidden) render(); }, 60000);
    await openCapturedDraft();
  }
  init().catch(error => { console.error(error); toast('CSE Radar could not start. Please reload the page.'); });
})();
