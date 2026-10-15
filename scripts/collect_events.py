"""Collect public event leads for human review; never modifies the reviewed catalog.

Usage: python scripts/collect_events.py [--config data/collection-sources.json]
The JSON files written to artifacts/ are NOT an extension feed. A maintainer must
review source details and add approved events to data/events.json separately.
"""
import argparse
from datetime import date, datetime, timedelta, timezone
import hashlib
from html.parser import HTMLParser
import ipaddress
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener
import xml.etree.ElementTree as ET

MAX_BYTES = 1_048_576
TIMEOUT = 15
MAX_REDIRECTS = 3
USER_AGENT = 'CSE-Radar/0.2 (+https://github.com/SayemTanvir/CSE-Radar)'


def public_https_url(value):
    """Syntactic public HTTPS check. Host allowlisting applies separately to fetches."""
    if not isinstance(value, str) or len(value) > 2048 or any(ord(c) < 33 for c in value):
        raise ValueError('Invalid URL')
    parts = urlsplit(value)
    host = parts.hostname
    if parts.scheme != 'https' or not host or parts.username or parts.password or parts.port not in (None, 443):
        raise ValueError('Only public HTTPS URLs without credentials or custom ports are allowed')
    if host == 'localhost' or host.endswith(('.localhost', '.local', '.internal')) or '.' not in host:
        raise ValueError('Local host is not allowed')
    try:
        if not ipaddress.ip_address(host).is_global:
            raise ValueError('Private address is not allowed')
    except ValueError as error:
        if 'address is not allowed' in str(error):
            raise
    return urlunsplit(('https', parts.netloc.lower(), parts.path or '/', parts.query, ''))


def allowed_url(value, hosts):
    value = public_https_url(value)
    if urlsplit(value).hostname not in hosts:
        raise ValueError('Source host is not allowlisted')
    return value


class SafeRedirect(HTTPRedirectHandler):
    def __init__(self, hosts):
        self.hosts = hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = allowed_url(urljoin(req.full_url, newurl), self.hosts)
        count = getattr(req, 'radar_redirects', 0) + 1
        if count > MAX_REDIRECTS:
            raise ValueError('Too many redirects')
        redirected = super().redirect_request(req, fp, code, msg, headers, target)
        if redirected is not None:
            redirected.radar_redirects = count
        return redirected


def read_response(response):
    length = response.headers.get('Content-Length')
    if length and int(length) > MAX_BYTES:
        raise ValueError('Response exceeds 1 MiB limit')
    if response.headers.get('Content-Encoding', 'identity').lower() not in ('', 'identity'):
        raise ValueError('Compressed responses are not accepted')
    body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError('Response exceeds 1 MiB limit')
    return body.decode('utf-8-sig', errors='replace')


def fetch(url, hosts):
    url = allowed_url(url, hosts)
    request = Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json, text/html, application/atom+xml, application/rss+xml, application/xml', 'Accept-Encoding': 'identity'})
    with build_opener(SafeRedirect(hosts)).open(request, timeout=TIMEOUT) as response:
        final_url = allowed_url(response.geturl(), hosts)
        return read_response(response), final_url


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.scripts, self.links, self.meta = [], [], {}
        self.script = None
        self.anchor = None
        self.heading = None
        self.last_heading = ''
        self.first_heading = ''

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script':
            self.script = [attrs, []]
        elif tag == 'meta':
            self.meta[attrs.get('property', attrs.get('name', ''))] = attrs.get('content', '')
        elif tag == 'a':
            self.anchor = [attrs.get('href', ''), [], self.last_heading]
        elif tag in ('h1', 'h2', 'h3'):
            self.heading = []

    def handle_data(self, data):
        if self.script is not None:
            self.script[1].append(data)
        elif self.anchor is not None:
            self.anchor[1].append(data)
        if self.heading is not None:
            self.heading.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self.script is not None:
            self.scripts.append((self.script[0], ''.join(self.script[1])))
            self.script = None
        elif tag == 'a' and self.anchor is not None:
            href, text, heading = self.anchor
            self.links.append((href, clean(''.join(text)), heading))
            self.anchor = None
        elif tag in ('h1', 'h2', 'h3') and self.heading is not None:
            self.last_heading = clean(''.join(self.heading))
            self.first_heading = self.first_heading or self.last_heading
            self.heading = None


def clean(value, limit=2000):
    return ' '.join(str(value or '').split())[:limit]


def event_date(value):
    """Retain exact date precision and explicit timezone offsets; never guess one."""
    if not isinstance(value, str):
        return None
    try:
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            date.fromisoformat(value)
            return value
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})', value):
            datetime.fromisoformat(value.replace('Z', '+00:00'))
            return value
    except ValueError:
        pass
    return None


def nodes(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from nodes(child)
    elif isinstance(value, list):
        for child in value:
            yield from nodes(child)


def make_candidate(fields, source, source_url, observed_at):
    try:
        url = public_https_url(urljoin(source_url, fields.get('url') or source_url))
    except (ValueError, TypeError):
        return None
    title = clean(fields.get('title'), 250)
    if not title:
        return None
    start = event_date(fields.get('start'))
    end = event_date(fields.get('end'))
    return {
        'id': 'candidate-' + hashlib.sha256((url + '|' + title + '|' + str(start)).encode()).hexdigest()[:16],
        'reviewStatus': 'unreviewed', 'sourceId': source['id'],
        'sourceUrl': source_url, 'observedAt': observed_at,
        'title': title, 'url': url, 'category': fields.get('category') or source.get('category'),
        'organizer': clean(fields.get('organizer'), 250) or None,
        'start': start, 'end': end, 'deadline': event_date(fields.get('deadline')),
        'description': clean(fields.get('description')) or None,
        'country': fields.get('country') or source.get('country'),
        'mode': fields.get('mode'),
        'notes': ['Machine-discovered lead; dates, eligibility, relevance and registration must be reviewed.',
                  'Missing fields are unknown. Publication dates are not event dates.'] + fields.get('notes', []),
    }


def parse_html(text, source, source_url, observed_at):
    page = PageParser()
    page.feed(text)
    found, warnings = [], []
    for attrs, raw in page.scripts:
        script_type = attrs.get('type', '').lower().split(';')[0]
        if script_type not in ('application/ld+json', 'application/json'):
            continue
        try:
            document = json.loads(raw)
        except (ValueError, RecursionError):
            warnings.append('Malformed structured JSON skipped')
            continue
        if script_type == 'application/ld+json':
            for node in nodes(document):
                types = node.get('@type', [])
                types = [types] if isinstance(types, str) else types
                if not isinstance(types, list) or not any(str(t).rsplit('/', 1)[-1].endswith('Event') for t in types):
                    continue
                organizer = node.get('organizer')
                found.append({'title': node.get('name'), 'url': node.get('url'),
                              'start': node.get('startDate'), 'end': node.get('endDate'),
                              'description': node.get('description'),
                              'organizer': organizer.get('name') if isinstance(organizer, dict) else organizer})
        elif source.get('adapter') == 'mlh' and attrs.get('data-page') == 'app':
            events = document.get('props', {}).get('upcomingEvents', []) if isinstance(document, dict) else []
            for item in events if isinstance(events, list) else []:
                if not isinstance(item, dict):
                    continue
                address = item.get('venueAddress') or {}
                found.append({'title': item.get('name'), 'url': item.get('websiteUrl') or item.get('url'),
                              'start': item.get('startsAt'), 'end': item.get('endsAt'),
                              'country': address.get('country') if isinstance(address, dict) else None,
                              'mode': {'physical': 'in-person', 'digital': 'online', 'hybrid': 'hybrid'}.get(item.get('formatType')),
                              'notes': ['Listed by MLH; event organizer and eligibility still require review.']})
    if source.get('adapter') == 'itch' and re.fullmatch(r'/jam/[^/]+/?', urlsplit(source_url).path):
        description = page.meta.get('description', '')
        match = re.search(r'A game jam from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2}) hosted by ([^.]+)', description)
        found.append({'title': page.meta.get('og:title') or page.first_heading,
                      'url': source_url, 'description': description,
                      'start': match[1] if match else None, 'end': match[2] if match else None,
                      'organizer': match[3] if match else None,
                      'notes': ['itch.io summary dates can include voting; end is not a verified submission or registration cutoff.']})
    if source.get('adapter') == 'university' and re.search(source.get('linkPattern', r'(?!)'), urlsplit(source_url).path):
        found.append({'title': page.meta.get('og:title') or source.get('_linkTitle') or page.first_heading,
                      'description': page.meta.get('description'), 'url': source_url})
    candidates = [make_candidate(item, source, source_url, observed_at) for item in found]
    return [item for item in candidates if item], page.links, warnings


def parse_feed(text, source, source_url, observed_at):
    if re.search(r'<!\s*(DOCTYPE|ENTITY)', text, re.IGNORECASE):
        raise ValueError('XML declarations/entities are not accepted')
    root = ET.fromstring(text)
    found, links = [], []
    for entry in root.iter():
        if entry.tag.rsplit('}', 1)[-1] not in ('item', 'entry'):
            continue
        fields = {}
        for child in entry:
            name = child.tag.rsplit('}', 1)[-1]
            if name == 'title':
                fields['title'] = ''.join(child.itertext())
            elif name == 'link' and child.get('rel', 'alternate') == 'alternate':
                fields['url'] = child.get('href') or child.text
            elif name in ('description', 'summary'):
                fields['description'] = ''.join(child.itertext())
        candidate = make_candidate(fields, source, source_url, observed_at)
        if candidate:
            found.append(candidate)
            links.append((candidate['url'], candidate['title'], candidate['title']))
    return found, links, []


TECH_TERMS = re.compile(
    r'\b(?:cse|ict|ai|iot|ctf|icpc|iupc|ncpc|ieee|stem)\b|\bit fest\b|information technology|'
    r'computer|computing|software|coding|programming|hackathon|game.?jam|'
    r'robot|technology|tech.?fest|techtron|datathon|cyber|data science|'
    r'machine learning|open.source|devfest|dev days|devin|compute|github', re.IGNORECASE)
UNRELATED_TERMS = re.compile(r'\b(?:business case|chess|rubik|esports|poster design|3 minute thesis|media.{0,5}communication)\b', re.IGNORECASE)


def eventify_category(item):
    """Keep technology leads while excluding business/general campus activities."""
    kind = clean(item.get('event_type'), 100).casefold()
    direct = {'hackathon': 'hackathon', 'ctf': 'contest', 'datathon': 'contest',
              'cp': 'contest', 'contest': 'contest', 'competitive programming': 'contest',
              'icpc': 'contest', 'iupc': 'contest', 'ncpc': 'contest'}
    if kind in ('business case', 'business-case', 'business'):
        return None, 'business'
    if kind in direct:
        return direct[kind], None
    title = clean(item.get('event_title'))
    description = clean(item.get('event_description') or item.get('description'))
    text = title + ' ' + description
    if UNRELATED_TERMS.search(title) or not TECH_TERMS.search(text):
        return None, 'unrelated'
    # A technology festival may also offer esports or poster competitions.
    # Ancillary activities do not make the whole technology event unrelated.
    if UNRELATED_TERMS.search(description) and not TECH_TERMS.search(title):
        return None, 'unrelated'
    if kind in ('fest', 'festival', 'tech fest'):
        return 'fest', None
    for pattern, category in [(r'game.?jam', 'gamejam'), (r'hackathon', 'hackathon'),
                              (r'contest|competition|olympiad|championship', 'contest'),
                              (r'conference|symposium', 'conference'),
                              (r'fest|carnival', 'fest'),
                              (r'workshop|bootcamp|masterclass|training|meetup|dev days|devin day', 'workshop')]:
        if re.search(pattern, text, re.IGNORECASE):
            return category, None
    return None, None  # Relevant lead, precise category requires human review.


def parse_eventify(text, source, source_url, observed_at):
    """Read the anonymous JSON listing used by EventifyBD's public calendar.

    No scraping of private submissions, no mock data, pagination guesses or
    provided organizer-link fetches. This is an aggregator, not verification.
    """
    document = json.loads(text)
    if not isinstance(document, dict) or not isinstance(document.get('events'), list):
        raise ValueError('EventifyBD listing must contain an events array')
    listing_url = allowed_url(source['listingUrl'], source['allowedHosts'])
    bangladesh_zone = timezone(timedelta(hours=6))
    today = datetime.fromisoformat(observed_at.replace('Z', '+00:00')).astimezone(bangladesh_zone).date()
    counts = {'total': len(document['events']), 'business': 0, 'unrelated': 0, 'past': 0, 'invalid': 0, 'retained': 0}
    found = []
    warnings = []
    for item in document['events']:
        if not isinstance(item, dict):
            counts['invalid'] += 1
            continue
        category, exclusion = eventify_category(item)
        if exclusion:
            counts[exclusion] += 1
            continue
        last_known_date = event_date(item.get('event_end_date')) or event_date(item.get('event_start_date'))
        if last_known_date:
            last_day = date.fromisoformat(last_known_date) if len(last_known_date) == 10 else datetime.fromisoformat(last_known_date.replace('Z', '+00:00')).astimezone(bangladesh_zone).date()
            if last_day < today:
                counts['past'] += 1
                continue
        source_id = clean(item.get('id'), 100)
        detail_url = urljoin(listing_url, 'event.html?' + urlencode({'id': source_id})) if source_id else listing_url
        provided_url = None
        if item.get('event_link'):
            try:
                provided_url = public_https_url(item['event_link'])
            except (ValueError, TypeError):
                warnings.append('Unsafe/non-HTTPS provided event link omitted; EventifyBD listing retained for review.')
        candidate = make_candidate({
            'title': item.get('event_title'), 'url': provided_url or detail_url,
            'category': category, 'organizer': item.get('event_organizer'),
            'start': item.get('event_start_date'), 'end': item.get('event_end_date'),
            'deadline': item.get('registration_deadline'),
            'description': item.get('event_description') or item.get('description'),
            'notes': [
                'EventifyBD aggregator lead; provided links and reported dates are not organizer-verified.',
                'Public frontend endpoint, not a documented supported API; may change without notice.',
                'Reported date-only deadlines have no verified cutoff time or timezone.',
            ],
        }, source, source_url, observed_at)
        if candidate is None:
            counts['invalid'] += 1
            continue
        candidate.update({'sourceKind': 'aggregator', 'sourceListingUrl': detail_url,
                          'sourceEventId': source_id or None,
                          'sourceCategory': clean(item.get('event_type'), 100) or None,
                          'providedEventUrl': provided_url,
                          'location': clean(item.get('event_location'), 500) or None})
        found.append(candidate)
        counts['retained'] += 1
    warnings.insert(0, 'EventifyBD entry counts (before deduplication/limit): ' + json.dumps(counts, sort_keys=True))
    warnings.append('Single public listing response only. Entries before the observed Bangladesh calendar day are excluded using supplied end date, or start when end is absent. Missing-date leads remain partial. Coverage and organizer accuracy require review.')
    return found, [], warnings


class DIUCardParser(HTMLParser):
    """Read only the visible club-card records on DIU Student Hub's events page."""
    VOID_TAGS = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.records, self.targets = [], [], []
        self.card = None
        self.card_depth = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = set(attrs.get('class', '').split())
        if tag in self.VOID_TAGS:
            return
        self.stack.append(tag)
        depth = len(self.stack)
        if tag == 'div' and 'club-card' in classes and self.card is None:
            self.card, self.card_depth = {}, depth
        if self.card is None:
            return
        field = None
        if 'event-date-badge' in classes:
            field = 'date'
        elif tag == 'h3':
            field = 'title'
        elif tag == 'p' and 'description' not in self.card:
            field = 'description'
        elif 'club-rating' in classes:
            field = 'time'
        elif 'event-status' in classes:
            field = 'status'
        elif 'club-type-badge' in classes and 'location' not in self.card:
            field = 'location'
        if field:
            self.card.setdefault(field, [])
            self.targets.append((depth, tag, field))
        if tag == 'a' and 'btn-details' in classes:
            self.card['url'] = attrs.get('href', '')

    def handle_data(self, text):
        if self.card is not None:
            for _, _, field in self.targets:
                self.card[field].append(text)

    def handle_endtag(self, tag):
        if tag not in self.stack:
            return
        depth = len(self.stack) - self.stack[::-1].index(tag)
        self.targets = [target for target in self.targets if target[0] < depth]
        if self.card is not None and depth == self.card_depth and tag == 'div':
            self.records.append({key: clean(''.join(value)) if isinstance(value, list) else value
                                 for key, value in self.card.items()})
            self.card, self.card_depth = None, None
            self.targets = []
        self.stack = self.stack[:depth - 1]


def diu_card_date(value):
    """Parse the source's English event badge date; preserve date-only precision."""
    match = re.fullmatch(r'([A-Za-z]{3}) (\d{1,2}), (\d{4})', clean(value))
    if not match:
        return None
    months = {name: index + 1 for index, name in enumerate(
        ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])}
    month = months.get(match[1])
    if month is None:
        return None
    return event_date(f'{int(match[3]):04d}-{month:02d}-{int(match[2]):02d}')


def parse_diu_events(text, source, source_url, observed_at):
    page = DIUCardParser()
    page.feed(text)
    today = datetime.fromisoformat(observed_at.replace('Z', '+00:00')).astimezone(timezone(timedelta(hours=6))).date().isoformat()
    found = []
    counts = {'total': len(page.records), 'unrelated': 0, 'past': 0, 'invalid': 0, 'retained': 0}
    for record in page.records:
        title, description = record.get('title', ''), record.get('description', '')
        technology = TECH_TERMS.search(title + ' ' + description) or re.search(r'bug bounty|ethical hacker|embedded systems|malware', title + ' ' + description, re.IGNORECASE)
        if not technology or UNRELATED_TERMS.search(title):
            counts['unrelated'] += 1
            continue
        start = diu_card_date(record.get('date', ''))
        if record.get('status', '').casefold() in ('completed', 'cancelled', 'canceled') or (start and start < today):
            counts['past'] += 1
            continue
        try:
            url = allowed_url(urljoin(source_url, record.get('url', '')), source['allowedHosts'])
            if not re.fullmatch(r'/event/[0-9]+/home', urlsplit(url).path):
                raise ValueError('Not a public DIU event detail link')
        except ValueError:
            counts['invalid'] += 1
            continue
        category, _ = eventify_category({'event_type': 'Others', 'event_title': title, 'description': description})
        notes = ['Official university event listing lead; participation rules and dates still require human review.',
                 'Only the first public listing page is read; summary may be truncated. No account or registration page is accessed.',
                 'Event badge is date-only. Displayed clock time has no verified timezone and is retained as source text only.']
        title_years = re.findall(r'\b(?:19|20)\d{2}\b', title)
        if start and title_years and start[:4] not in title_years:
            notes.append('SOURCE CONFLICT: title year differs from event date badge year; confirm with organizer before publishing.')
        candidate = make_candidate({'title': title, 'url': url, 'start': start,
                                    'description': description, 'category': category,
                                    'organizer': 'Daffodil International University (listing host; individual organizer requires review)',
                                    'notes': notes}, source, source_url, observed_at)
        if candidate:
            candidate.update({'sourceKind': 'university-listing', 'sourceListingUrl': source_url,
                              'sourceReportedDate': record.get('date') or None,
                              'sourceReportedTime': record.get('time') or None,
                              'sourceListingStatus': record.get('status') or None,
                              'location': record.get('location') or None})
            found.append(candidate)
            counts['retained'] += 1
        else:
            counts['invalid'] += 1
    warnings = ['DIU Student Hub card counts (before deduplication/limit): ' + json.dumps(counts, sort_keys=True)]
    if not page.records:
        warnings.append('No recognizable event cards; listing markup may have changed.')
    return found, [], warnings


def collect(config, fetcher=fetch, observed_at=None):
    observed_at = observed_at or datetime.now(timezone.utc).isoformat(timespec='seconds')
    candidates, reports = {}, []
    sources = config.get('sources', [])
    if not isinstance(sources, list) or len(sources) > 10:
        raise ValueError('Config must contain at most 10 sources')
    for source in sources:
        report = {'id': source['id'], 'sourceUrl': source['url'], 'observedAt': observed_at,
                  'fetchedPages': 0, 'candidateCount': 0, 'errors': [], 'warnings': []}
        reports.append(report)
        if source.get('enabled', True) is False:
            report['status'] = 'disabled'
            continue
        hosts = source.get('allowedHosts', [])
        page_limit = min(max(int(source.get('maxLinkedPages', 0)), 0), 10)
        candidate_limit = min(max(int(source.get('maxCandidates', 100)), 1), 200)
        queue, visited = [(source['url'], None)], set()
        pattern = re.compile(source.get('linkPattern', r'(?!)'))
        title_pattern = re.compile(source.get('linkTitlePattern', r'.*'))
        while queue and len(visited) <= page_limit:
            url, link_title = queue.pop(0)
            if url in visited:
                continue
            visited.add(url)
            try:
                allowed_url(url, hosts)
                if len(visited) > 1 and fetcher is fetch:
                    time.sleep(1)  # Sequential, modest public-source fetch rate; no retries.
                text, final_url = fetcher(url, hosts)
                allowed_url(final_url, hosts)
                if len(text.encode('utf-8')) > MAX_BYTES:
                    raise ValueError('Response exceeds 1 MiB limit')
                report['fetchedPages'] += 1
                parser = {'eventifybd': parse_eventify, 'diu-events': parse_diu_events}.get(source.get('adapter'))
                if parser is None:
                    parser = parse_feed if source.get('format') in ('rss', 'atom') and url == source['url'] else parse_html
                items, links, warnings = parser(text, {**source, '_linkTitle': link_title}, final_url, observed_at)
                report['warnings'].extend(warnings)
                for item in items:
                    key = (item['url'].rstrip('/'), item['title'].casefold(), item['start'])
                    if key not in candidates and report['candidateCount'] < candidate_limit:
                        candidates[key] = item
                        report['candidateCount'] += 1
                if len(visited) == 1:
                    for href, title, heading in links:
                        try:
                            target = allowed_url(urljoin(final_url, href), hosts)
                        except ValueError:
                            continue
                        link_title = heading if title.lower().startswith('learn more') else title
                        if pattern.search(urlsplit(target).path) and title_pattern.search(link_title) and target not in visited and target not in [q[0] for q in queue]:
                            queue.append((target, link_title))
                            if len(queue) >= page_limit:
                                break
            except Exception as error:
                report['errors'].append({'url': url, 'error': f'{type(error).__name__}: {str(error)[:250]}'})
                if isinstance(error, HTTPError) and error.code in (403, 429):
                    report['warnings'].append('Source refused/rate-limited access; remaining requests stopped without retries.')
                    break
        report['status'] = 'partial' if report['errors'] and report['fetchedPages'] else 'error' if report['errors'] else 'ok'
        if not report['candidateCount']:
            report['warnings'].append('No new event leads extracted; this does not mean no events exist.')
    return {'schemaVersion': 1, 'generatedAt': observed_at, 'reviewStatus': 'unreviewed',
            'candidates': list(candidates.values())}, {'generatedAt': observed_at, 'sources': reports}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path('data/collection-sources.json'))
    parser.add_argument('--output-dir', type=Path, default=Path('artifacts'))
    args = parser.parse_args()
    candidates, report = collect(json.loads(args.config.read_text(encoding='utf-8')))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, value in [('candidates.json', candidates), ('collection-report.json', report)]:
        (args.output_dir / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f"Collected {len(candidates['candidates'])} unreviewed leads. Report: {args.output_dir / 'collection-report.json'}")
    for source in report['sources']:
        print(f"{source['id']}: {source['status']}; {source['candidateCount']} leads; {len(source['errors'])} errors")
    return 1 if report['sources'] and all(item['status'] == 'error' for item in report['sources']) else 0


if __name__ == '__main__':
    raise SystemExit(main())
