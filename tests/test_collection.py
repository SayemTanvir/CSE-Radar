"""Network-free fixtures for source discovery and its trust boundaries."""
import io
import json
from pathlib import Path
import sys
import unittest
from urllib.error import HTTPError
from urllib.request import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import collect_events as collector

OBSERVED = '2026-10-14T12:00:00+00:00'
SOURCE = {'id': 'test', 'url': 'https://events.example.org/list',
          'allowedHosts': ['events.example.org'], 'linkPattern': '^/events/[^/]+$',
          'maxLinkedPages': 2}
EVENTIFY_SOURCE = {'id': 'eventifybd', 'url': 'https://api.eventifybd.com/events',
                  'listingUrl': 'https://eventifybd.com/', 'adapter': 'eventifybd',
                  'allowedHosts': ['api.eventifybd.com', 'eventifybd.com']}


class CollectionTests(unittest.TestCase):
    def test_discovers_linked_jsonld_graph_and_preserves_offsets(self):
        pages = {
            SOURCE['url']: '<a href="/events/new">New hackathon</a><a href="https://evil.example/events/x">Bad</a>',
            'https://events.example.org/events/new': '''<script type="application/ld+json">{
              "@context":"https://schema.org", "@graph":[{"@type":"Event",
              "name":"New hackathon", "url":"/events/new", "startDate":"2026-11-01T09:00:00+06:00",
              "endDate":"2026-11-02", "organizer":{"name":"Example University"}}]}</script>''',
        }
        calls = []
        def fetch(url, hosts):
            calls.append(url)
            return pages[url], url
        result, report = collector.collect({'sources': [SOURCE]}, fetch, OBSERVED)
        self.assertEqual(len(result['candidates']), 1)
        event = result['candidates'][0]
        self.assertEqual(event['start'], '2026-11-01T09:00:00+06:00')
        self.assertEqual(event['end'], '2026-11-02')
        self.assertIsNone(event['deadline'])
        self.assertEqual(event['sourceUrl'], calls[1])
        self.assertEqual(event['observedAt'], OBSERVED)
        self.assertEqual(event['reviewStatus'], 'unreviewed')
        self.assertEqual(report['sources'][0]['fetchedPages'], 2)
        self.assertEqual(len(calls), 2)

    def test_mlh_embedded_json_discovers_events_without_catalog(self):
        page = '<script type="application/json" data-page="app">' + json.dumps({
            'props': {'upcomingEvents': [{'name': 'A new event', 'websiteUrl': 'https://organizer.example.org/',
                         'startsAt': '2027-01-01T12:00:00Z', 'endsAt': '2027-01-02T12:00:00Z',
                         'formatType': 'physical', 'venueAddress': {'country': 'BD'}}]}}) + '</script>'
        source = {**SOURCE, 'adapter': 'mlh'}
        result, _, _ = collector.parse_html(page, source, source['url'], OBSERVED)
        self.assertEqual(result[0]['title'], 'A new event')
        self.assertEqual(result[0]['country'], 'BD')
        self.assertEqual(result[0]['mode'], 'in-person')

    def test_itch_meta_dates_remain_date_only_and_no_deadline_invented(self):
        source = {**SOURCE, 'adapter': 'itch'}
        page = '''<meta property="og:title" content="Test Jam"><meta name="description"
          content="A game jam from 2026-11-01 to 2026-11-10 hosted by Example. Details.">'''
        result, _, _ = collector.parse_html(page, source, 'https://events.example.org/jam/new', OBSERVED)
        self.assertEqual(result[0]['start'], '2026-11-01')
        self.assertEqual(result[0]['end'], '2026-11-10')
        self.assertIsNone(result[0]['deadline'])
        self.assertIn('voting', result[0]['notes'][-1])

    def test_atom_and_rss_publication_dates_are_not_event_dates(self):
        for feed in ['''<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Conference</title>
               <link href="/events/new"/><published>2026-10-14</published></entry></feed>''',
              '''<rss><channel><item><title>Conference</title><link>/events/new</link>
               <pubDate>Wed, 14 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>''']:
            found, links, _ = collector.parse_feed(feed, SOURCE, SOURCE['url'], OBSERVED)
            self.assertEqual(found[0]['url'], 'https://events.example.org/events/new')
            self.assertIsNone(found[0]['start'])
            self.assertEqual(len(links), 1)

    def test_unsafe_feed_links_skipped_and_xml_entities_rejected(self):
        found, _, _ = collector.parse_feed('<rss><item><title>Bad</title><link>javascript:alert(1)</link></item></rss>', SOURCE, SOURCE['url'], OBSERVED)
        self.assertEqual(found, [])
        with self.assertRaises(ValueError):
            collector.parse_feed('<!DOCTYPE a [<!ENTITY b "x">]><rss/>', SOURCE, SOURCE['url'], OBSERVED)

    def test_fetch_bound_and_redirect_targets(self):
        handler = collector.SafeRedirect(SOURCE['allowedHosts'])
        for url in ['http://events.example.org/x', 'file:///secret', 'https://evil.example/x', 'https://127.0.0.1/x']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                handler.redirect_request(Request(SOURCE['url']), None, 302, 'Found', {}, url)
        request = Request(SOURCE['url'])
        request.radar_redirects = collector.MAX_REDIRECTS
        with self.assertRaises(ValueError):
            handler.redirect_request(request, None, 302, 'Found', {}, 'https://events.example.org/loop')
        for headers, content in [({'Content-Length': str(collector.MAX_BYTES + 1)}, b''),
                                 ({}, b'x' * (collector.MAX_BYTES + 1)),
                                 ({'Content-Encoding': 'gzip'}, b'data')]:
            response = io.BytesIO(content)
            response.headers = headers
            with self.assertRaises(ValueError):
                collector.read_response(response)

    def test_unallowlisted_start_never_fetched_and_errors_reported(self):
        def forbidden(url, hosts):
            self.fail('Unallowlisted URL was fetched')
        result, report = collector.collect({'sources': [{**SOURCE, 'url': 'https://evil.example/x'}]}, forbidden, OBSERVED)
        self.assertEqual(result['candidates'], [])
        self.assertEqual(report['sources'][0]['status'], 'error')
        self.assertIn('allowlisted', report['sources'][0]['errors'][0]['error'])

    def test_duplicate_leads_deduplicate_and_link_budget_is_bounded(self):
        calls = []
        def fetch(url, hosts):
            calls.append(url)
            if url == SOURCE['url']:
                return ''.join(f'<a href="/events/{i}">Event {i}</a>' for i in range(30)), url
            return '<script type="application/ld+json">' + json.dumps([
                {'@type': 'Event', 'name': 'Same', 'url': '/canonical', 'startDate': '2026-11-01'},
                {'@type': 'Event', 'name': 'Same', 'url': '/canonical', 'startDate': '2026-11-01'}]) + '</script>', url
        result, _ = collector.collect({'sources': [SOURCE]}, fetch, OBSERVED)
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(result['candidates']), 1)

    def test_invalid_and_naive_dates_are_unknown(self):
        for value in ['2026-02-30', '2026-11-01T09:00:00', 'tomorrow', None]:
            self.assertIsNone(collector.event_date(value))
        self.assertEqual(collector.event_date('2026-11-01'), '2026-11-01')

    def test_partial_failure_keeps_other_sources_and_fields(self):
        second = {**SOURCE, 'id': 'second', 'url': 'https://events.example.org/second', 'adapter': 'university', 'linkPattern': '/second'}
        def fetch(url, hosts):
            if url == SOURCE['url']:
                raise OSError('Fixture source unavailable')
            return '<h1>University festival</h1>', url
        result, report = collector.collect({'sources': [SOURCE, second]}, fetch, OBSERVED)
        self.assertEqual(len(result['candidates']), 1)
        self.assertIsNone(result['candidates'][0]['start'])
        self.assertEqual([s['status'] for s in report['sources']], ['error', 'ok'])

    def test_university_title_filter_and_rate_limit_stop(self):
        calls = []
        source = {**SOURCE, 'linkTitlePattern': '(?i)fest|contest'}
        def fetch(url, hosts):
            calls.append(url)
            if url == SOURCE['url']:
                return '<h3>Admission</h3><a href="/events/1">Learn more</a><h3>CSE Fest</h3><a href="/events/2">Learn more</a><h3>Contest</h3><a href="/events/3">Learn more</a>', url
            raise HTTPError(url, 429, 'Too Many Requests', {}, None)
        _, report = collector.collect({'sources': [source]}, fetch, OBSERVED)
        self.assertEqual(calls, [SOURCE['url'], 'https://events.example.org/events/2'])
        self.assertEqual(report['sources'][0]['status'], 'partial')
        self.assertIn('stopped', report['sources'][0]['warnings'][0])

    def test_eventify_category_mapping_excludes_business_and_general_activities(self):
        for source_type, expected in [('Hackathon', 'hackathon'), ('CTF', 'contest'),
                                      ('Datathon', 'contest'), ('CP', 'contest')]:
            self.assertEqual(collector.eventify_category({'event_type': source_type})[0], expected)
        for item in [{'event_type': 'Business Case', 'event_title': 'AI business case'},
                     {'event_type': 'Fest', 'event_title': 'Youth Climate Summit'},
                     {'event_type': 'Others', 'event_title': 'Chess Competition - CSE Carnival'},
                     {'event_type': 'Others', 'event_title': 'Music festival', 'tags': ['AI']}]:
            self.assertIsNotNone(collector.eventify_category(item)[1])
        self.assertEqual(collector.eventify_category({'event_type': 'Others', 'event_title': 'Python Workshop', 'description': 'Learn software programming'})[0], 'workshop')
        self.assertEqual(collector.eventify_category({'event_type': 'Fest', 'event_title': 'Techtron 2.0'})[0], 'fest')
        self.assertEqual(collector.eventify_category({'event_type': 'Fest', 'event_title': 'CSE Fest', 'description': 'Hackathon, esports, and poster design'})[0], 'fest')
        self.assertEqual(collector.eventify_category({'event_type': 'Others', 'event_title': 'Sports Day', 'description': 'Esports championship'})[1], 'unrelated')

    def test_eventify_date_only_deadline_and_source_provenance_preserved(self):
        row = {'id': 'abc123', 'event_type': 'Hackathon', 'event_title': 'New Hackathon',
               'event_start_date': '2026-11-01', 'event_end_date': '2026-11-02',
               'registration_deadline': '2026-10-31', 'event_link': 'https://organizer.example.org/apply',
               'created_at': '2026-01-01', 'event_organizer': 'University Club'}
        found, _, _ = collector.parse_eventify(json.dumps({'events': [row]}), EVENTIFY_SOURCE, EVENTIFY_SOURCE['url'], OBSERVED)
        event = found[0]
        self.assertEqual(event['start'], '2026-11-01')
        self.assertEqual(event['end'], '2026-11-02')
        self.assertEqual(event['deadline'], '2026-10-31')
        self.assertEqual(event['sourceUrl'], 'https://api.eventifybd.com/events')
        self.assertEqual(event['sourceListingUrl'], 'https://eventifybd.com/event.html?id=abc123')
        self.assertEqual(event['providedEventUrl'], event['url'])
        self.assertEqual(event['sourceKind'], 'aggregator')
        self.assertEqual(event['reviewStatus'], 'unreviewed')
        self.assertIn('not organizer-verified', event['notes'][2])

    def test_eventify_unsafe_links_use_listing_without_guessing_missing_fields(self):
        rows = [{'id': str(index), 'event_type': 'CP', 'event_title': 'Programming Contest',
                 'event_link': url, 'registration_deadline': '2026-11-01T09:00:00'}
                for index, url in enumerate(['javascript:alert(1)', 'http://unsafe.example.org/',
                                             'https://user:password@organizer.example.org/', 'https://127.0.0.1/'])]
        found, _, warnings = collector.parse_eventify(json.dumps({'events': rows}), EVENTIFY_SOURCE, EVENTIFY_SOURCE['url'], OBSERVED)
        self.assertEqual(len(found), 4)
        for event in found:
            self.assertIsNone(event['providedEventUrl'])
            self.assertEqual(event['url'], event['sourceListingUrl'])
            self.assertIsNone(event['deadline'])
            self.assertIsNone(event['start'])
            self.assertIsNone(event['end'])
        self.assertTrue(any('Unsafe' in warning for warning in warnings))

    def test_eventify_filters_past_using_bangladesh_calendar_and_retains_partial(self):
        # UTC Oct14 20:00 is Oct15 in Bangladesh; keep events ending Oct15.
        rows = [{'event_type': 'Hackathon', 'event_title': title,
                 'event_start_date': start, 'event_end_date': end}
                for title, start, end in [('past', '2026-10-13', '2026-10-14'),
                                         ('ongoing', '2026-10-13', '2026-10-15'),
                                         ('upcoming', '2026-10-16', None),
                                         ('past-single-date', '2026-10-14', None),
                                         ('partial', None, None)]]
        found, _, warnings = collector.parse_eventify(json.dumps({'events': rows}), EVENTIFY_SOURCE, EVENTIFY_SOURCE['url'], '2026-10-14T20:00:00Z')
        self.assertEqual([row['title'] for row in found], ['ongoing', 'upcoming', 'partial'])
        self.assertIn('"past": 2', warnings[0])

    def test_eventify_collection_deduplicates_without_following_provided_urls(self):
        calls = []
        row = {'event_type': 'Hackathon', 'event_title': 'Same event', 'event_start_date': '2026-11-01',
               'event_link': 'https://organizer.example.org/event'}
        def fetch(url, hosts):
            calls.append(url)
            return json.dumps({'events': [row, row]}), url
        result, report = collector.collect({'sources': [EVENTIFY_SOURCE]}, fetch, OBSERVED)
        self.assertEqual(calls, ['https://api.eventifybd.com/events'])
        self.assertEqual(len(result['candidates']), 1)
        self.assertEqual(report['sources'][0]['candidateCount'], 1)

    def test_eventify_malformed_payload_is_reported(self):
        result, report = collector.collect({'sources': [EVENTIFY_SOURCE]}, lambda url, hosts: ('{"events": null}', url), OBSERVED)
        self.assertEqual(result['candidates'], [])
        self.assertIn('events array', report['sources'][0]['errors'][0]['error'])


if __name__ == '__main__':
    unittest.main()
