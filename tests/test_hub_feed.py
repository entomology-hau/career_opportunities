"""Hub collection boundaries: publication evidence, provenance and outage behaviour."""
import importlib.util
import json
from datetime import date, datetime, timezone
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('refresh_hub', Path(__file__).parents[1] / 'scripts/refresh_hub.py')
hub = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(hub)
TODAY = date(2026, 10, 16)
NOW = datetime(2026, 10, 16, 12, tzinfo=timezone.utc)
SOURCE = {'id': 'news', 'name': 'Example entomology', 'url': 'https://example.org/feed/',
          'format': 'rss', 'kind': 'news', 'scope': 'entomology'}


def rss(*entries):
    return ('<rss version="2.0"><channel>' + ''.join(entries) + '</channel></rss>').encode()


def entry(title='Aphid parasitoid research', url='https://example.org/article/', published='Fri, 16 Oct 2026 09:30:00 +0000'):
    return f'<item><title>{title}</title><link>{url}</link><pubDate>{published}</pubDate></item>'


def cached_item(**kwargs):
    item = hub.make_item('Aphid parasitoid research', 'https://example.org/article/', TODAY, SOURCE, TODAY)
    item.update(kwargs)
    return item


class HubParseTests(unittest.TestCase):
    def test_rss_is_metadata_only_and_explicitly_automatic(self):
        payload = rss(entry('Aphid &amp; parasitoid behaviour in Britain'))
        items = hub.parse_xml(payload, SOURCE, TODAY)
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertFalse(item['curated'])
        self.assertEqual((item['summary'], item['why']), ('', ''))
        self.assertEqual(item['published'], '2026-10-16')
        self.assertEqual(item['region'], 'uk')
        self.assertIn('Biological control', item['areas'])
        self.assertEqual(item['tagMethod'], 'automatic-keywords')

    def test_atom_uses_published_not_updated_and_alternate_link(self):
        payload = b'''<feed xmlns="http://www.w3.org/2005/Atom">
          <entry><title>Beetle biodiversity</title><link rel="self" href="https://example.org/api/1"/>
          <link rel="alternate" href="https://example.org/article/1"/>
          <published>2026-10-15T12:00:00Z</published><updated>2026-10-16T12:00:00Z</updated></entry>
          <entry><title>No publication date</title><link href="https://example.org/article/2"/>
          <updated>2026-10-16T12:00:00Z</updated></entry></feed>'''
        items = hub.parse_xml(payload, SOURCE, TODAY)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['published'], '2026-10-15')
        self.assertEqual(items[0]['url'], 'https://example.org/article/1')

    def test_invalid_missing_old_and_future_dates_rejected(self):
        payload = rss(entry(published='2026-02-30'), entry(published=''),
                      entry(published='2026-10-17'), entry(published='2026-01-01'))
        self.assertEqual(hub.parse_xml(payload, SOURCE, TODAY), [])
        self.assertIsNone(hub.parse_date('2026-10'))

    def test_url_validation_and_tracking(self):
        for url in ['javascript:alert(1)', 'file:///etc/passwd', 'https://localhost/a',
                    'https://user:secret@example.org/a', 'http://127.0.0.1/a',
                    'https://example.org:bogus/a', 'https://example.org/a\n']:
            self.assertIsNone(hub.canonical_url(url), url)
        self.assertEqual(hub.canonical_url('https://EXAMPLE.org/article/?utm_source=rss&b=2#details'),
                         'https://example.org/article?b=2')

    def test_mixed_sources_require_entomology_content(self):
        source = dict(SOURCE, scope='mixed')
        payload = rss(entry('New wheat fungal disease'), entry('Farmer support for aphid control'))
        items = hub.parse_xml(payload, source, TODAY)
        self.assertEqual(len(items), 1)
        self.assertIn('aphid', items[0]['title'])

    def test_global_default_does_not_infer_source_location(self):
        source = dict(SOURCE, name='British Entomology', region='uk')
        item = hub.parse_xml(rss(entry('Aphid parasitoid research')), source, TODAY)[0]
        self.assertEqual(item['region'], 'global')

    def test_sponsored_title_category_and_body_are_excluded(self):
        normal = entry('Aphid parasitoid research')
        category = normal.replace('</item>', '<category>sponsored post</category></item>')
        description = normal.replace('</item>', '<description>Sponsored article: insect habitats.</description></item>')
        content = normal.replace('</item>', '<content>Paid content about pollinators.</content></item>')
        title = entry('Sponsored content: aphid control')
        self.assertEqual(hub.parse_xml(rss(category, description, content, title), SOURCE, TODAY), [])
        funded = normal.replace('</item>', '<description>Research sponsored by a university.</description></item>')
        self.assertEqual(len(hub.parse_xml(rss(funded), SOURCE, TODAY)), 1)

    def test_atom_sponsored_category_term_is_excluded(self):
        payload = b'''<feed xmlns="http://www.w3.org/2005/Atom"><entry>
        <title>Insect habitats</title><link href="https://example.org/article"/>
        <published>2026-10-15</published><category term="Sponsored post"/>
        </entry></feed>'''
        self.assertEqual(hub.parse_xml(payload, SOURCE, TODAY), [])

    def test_topic_patterns_do_not_match_word_fragments(self):
        source = dict(SOURCE, defaultAreas=[])
        for title in ['A stick describes a frisbee', 'A tempest in a teacup',
                      'Systematic review of data collection methods']:
            self.assertEqual(hub.topic_areas(title, source), [], title)
        self.assertIn('Pollination & beneficial insects', hub.topic_areas('Honey bees and bumblebees', source))
        self.assertIn('Vectors & veterinary entomology', hub.topic_areas('Ticks in England', source))

    def test_html_and_entity_payloads_fail(self):
        for payload in [b'<html><body>Blocked</body></html>',
                        b'<!DOCTYPE rss [<!ENTITY x "boom">]><rss/>']:
            with self.assertRaises(ValueError):
                hub.parse_xml(payload, SOURCE, TODAY)

    def test_crossref_only_dated_articles_and_online_date(self):
        records = [
            {'type': 'journal-article', 'DOI': '10.1234/ABC', 'title': ['Aphid <i>behaviour</i>'],
             'published': {'date-parts': [[2027, 1, 1]]},
             'published-online': {'date-parts': [[2026, 10, 14]]}},
            {'type': 'journal-article', 'DOI': '10.1234/FUTURE', 'title': ['Future insects'],
             'published': {'date-parts': [[2027, 1, 1]]}},
            {'type': 'journal-article', 'DOI': '10.1234/MONTH', 'title': ['No exact date'],
             'published': {'date-parts': [[2026, 10]]}},
            {'type': 'journal-issue', 'DOI': '10.1234/ISSUE', 'title': ['Journal issue'],
             'published': {'date-parts': [[2026, 10, 14]]}},
        ]
        source = dict(SOURCE, format='crossref', kind='research')
        items = hub.parse_crossref(json.dumps({'message': {'items': records}}), source, TODAY)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['doi'], '10.1234/abc')
        self.assertEqual(items[0]['published'], '2026-10-14')
        self.assertEqual(items[0]['title'], 'Aphid behaviour')


class HubAssemblyTests(unittest.TestCase):
    def test_failure_preserves_cache_without_claiming_success(self):
        previous = {'lastSuccessfulUpdate': '2026-10-15T12:00:00Z',
                    'sources': [dict(SOURCE, lastSuccess='2026-10-15T12:00:00Z')],
                    'items': [cached_item()]}
        def fail(_):
            raise TimeoutError('source timed out')
        feed = hub.build_feed([SOURCE], [], previous, NOW, fail)
        self.assertEqual(len(feed['items']), 1)
        self.assertEqual(feed['sources'][0]['status'], 'cached')
        self.assertEqual(feed['lastSuccessfulUpdate'], previous['lastSuccessfulUpdate'])
        self.assertEqual(feed['sources'][0]['lastSuccess'], '2026-10-15T12:00:00Z')
        self.assertIn('TimeoutError', feed['sources'][0]['error'])

    def test_failure_without_cache_is_visible_and_keeps_curated(self):
        def fail(_):
            raise OSError('offline')
        curated = cached_item(id='editorial-1', curated=True, summary='An editorial summary.')
        feed = hub.build_feed([SOURCE], [curated], now=NOW, fetcher=fail)
        self.assertEqual(feed['sources'][0]['status'], 'error')
        self.assertIsNone(feed['lastSuccessfulUpdate'])
        self.assertEqual(feed['items'], [curated])

    def test_success_updates_status_and_replaces_source_cache(self):
        previous = {'items': [cached_item(url='https://example.org/old')]}
        feed = hub.build_feed([SOURCE], [], previous, NOW, lambda _: rss(entry()))
        self.assertEqual(len(feed['items']), 1)
        self.assertEqual(feed['items'][0]['url'], 'https://example.org/article')
        self.assertEqual(feed['sources'][0]['status'], 'ok')
        self.assertEqual(feed['lastSuccessfulUpdate'], '2026-10-16T12:00:00Z')

    def test_curated_wins_doi_duplicate_and_url_duplicates_collapse(self):
        source = dict(SOURCE, kind='research', format='crossref')
        curated = cached_item(id='curated', kind='research', doi='10.1234/ABC',
                              url='https://publisher.example/article/abc', curated=True)
        data = {'message': {'items': [{'type': 'journal-article', 'DOI': '10.1234/abc',
                    'title': ['Same aphid paper'], 'published': {'date-parts': [[2026, 10, 16]]}}]}}
        feed = hub.build_feed([source], [curated], now=NOW, fetcher=lambda _: json.dumps(data))
        self.assertEqual([i['id'] for i in feed['items']], ['curated'])
        feed = hub.build_feed([SOURCE], [], now=NOW, fetcher=lambda _: rss(
            entry(url='https://example.org/article/?utm_source=feed'),
            entry(url='http://example.org/article#details')))
        self.assertEqual(len(feed['items']), 1)

    def test_old_curated_is_retained_but_expired_cache_removed(self):
        previous = {'items': [cached_item(published='2026-01-01')]}
        curated = cached_item(id='archived-editorial', published='2026-01-01', curated=True)
        def fail(_):
            raise TimeoutError('offline')
        feed = hub.build_feed([SOURCE], [curated], previous, NOW, fail)
        self.assertEqual(feed['items'], [curated])
        self.assertEqual(feed['sources'][0]['status'], 'error')

    def test_cache_from_before_sponsored_checks_is_not_republished(self):
        item = cached_item()
        del item['contentChecksVersion']
        def fail(_):
            raise TimeoutError('offline')
        feed = hub.build_feed([SOURCE], [], {'items': [item]}, NOW, fail)
        self.assertEqual(feed['items'], [])

    def test_cap_keeps_all_curated(self):
        curated = [cached_item(id='curated', url='https://example.org/curated', curated=True)]
        payload = rss(*(entry(url=f'https://example.org/{i}') for i in range(150)))
        feed = hub.build_feed([SOURCE], curated, now=NOW, fetcher=lambda _: payload)
        self.assertEqual(len(feed['items']), 121)
        self.assertEqual(sum(i['curated'] for i in feed['items']), 1)


if __name__ == '__main__':
    unittest.main()
