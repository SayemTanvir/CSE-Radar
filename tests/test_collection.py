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


if __name__ == '__main__':
    unittest.main()
