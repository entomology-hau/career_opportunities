import copy
import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from xml.sax.saxutils import escape

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from refresh import (HASH_METHOD, PoliteClient, canonical, collect_entries,
                     content_signature, discover, refresh, rss_entries, screen)
from validate import cutoff

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / 'site/data/sources.json').read_text())
NOW = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)


def source(identifier='feed', mode='rss', **kwargs):
    return dict(id=identifier, name=identifier, url=f'https://{identifier}.test/jobs',
                enabled=True, mode=mode, **kwargs)


def rss(*items):
    """Short synthetic metadata, never copied source pages."""
    return '<rss version="2.0"><channel>' + ''.join(
        f'<item><title>{escape(title)}</title><link>{escape(url)}</link>'
        f'<description>{escape(description)}</description></item>'
        for title, url, description in items) + '</channel></rss>'


class FakeClient:
    def __init__(self, responses):
        self.responses, self.calls = responses, []

    def get(self, url):
        self.calls.append(url)
        value = self.responses[url]
        if isinstance(value, Exception):
            raise value
        return value


def public_item(**changes):
    return dict({'id': 'public', 'title': 'Insect technician',
                 'url': 'https://employer.test/public', 'lastChecked': '2026-09-29',
                 'status': 'open-no-deadline', 'deadlineAt': None}, **changes)


class RefreshTests(unittest.TestCase):
    def test_word_boundaries(self):
        for title in ['Ticket support assistant', 'We have been hiring', 'PESTLE analysis software bugs']:
            self.assertEqual(screen(title, CONFIG['screening']), [], title)
        for title in ['Insect technician', 'Integrated pest management studentship', 'Bumblebee surveyor',
                      'Biological recording officer', 'Biodiversity data assistant', 'Botanical survey technician']:
            self.assertTrue(screen(title, CONFIG['screening']), title)

    def test_res_malformed_anchor_and_container_deadline(self):
        html = '<div class="opportunity"><a href="https://employer.test/1"><h3>Insect <em>technician</em></a></h3><p>Closing date: 16 October 2026</p></div>'
        found = discover(html, source('res', 'res-headings', curatedIndex=True), CONFIG['screening'])
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]['title'], 'Insect technician')
        self.assertEqual(found[0]['deadlineSuggestion'], '2026-10-16')
        self.assertIn('Closing date: 16 October 2026', found[0]['deadlineEvidence'])
        self.assertEqual(found[0]['reviewStatus'], 'pending')
        self.assertNotIn('_screenText', found[0])

    def test_same_domain_adverts_retained_navigation_headings_omitted(self):
        html = '<nav><h3><a href="/careers">Careers</a></h3><a href="/about">About</a></nav><div class="opportunity"><h3><a href="/jobs/insect-technician">Insect technician</a></h3></div>'
        found = discover(html, source('res', 'res-headings', curatedIndex=True), CONFIG['screening'])
        self.assertEqual([x['url'] for x in found], ['https://res.test/jobs/insect-technician'])

    def test_rss_and_atom_parse_links_html_and_namespace(self):
        feed = rss(('Insect & ecology technician', '/jobs/1?from_rss=1', '<p>Identify <b>insects</b>.</p>'))
        parsed = rss_entries(feed, 'https://feed.test/rss')
        self.assertEqual(parsed[0]['title'], 'Insect & ecology technician')
        self.assertEqual(parsed[0]['url'], 'https://feed.test/jobs/1')
        self.assertIn('Identify insects', parsed[0]['evidenceSnippet'])
        self.assertNotIn('<b>', parsed[0]['evidenceSnippet'])
        atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Research technician</title><link rel="self" href="/api/1"/><link rel="alternate" href="/jobs/2"/><summary type="html">&lt;p&gt;Survey insects.&lt;/p&gt;</summary></entry></feed>'
        parsed = rss_entries(atom, 'https://feed.test/atom')
        self.assertEqual(parsed[0]['url'], 'https://feed.test/jobs/2')
        self.assertEqual(parsed[0]['evidenceSnippet'], 'Survey insects.')

    def test_empty_rss_is_a_successful_collection(self):
        feed = source()
        self.assertEqual(collect_entries(rss(), feed), [])
        queue, health = refresh({'opportunities': []}, {'sources': [feed], 'screening': CONFIG['screening']},
                                {'candidates': [], 'excluded': []}, {}, FakeClient({feed['url']: rss()}), NOW)
        self.assertEqual(health['discoveryStatus'], 'ok')
        self.assertEqual(health['sources'][0]['entriesFound'], 0)
        self.assertEqual(queue['candidates'], [])

    def test_description_screening_and_hr_title_exclusions(self):
        body = rss(('Research technician', 'https://employer.test/science', 'Conduct insect and biodiversity surveys.'),
                   ('HR Officer', 'https://employer.test/hr', 'Support an institute researching insects and ecology.'),
                   ('Payroll administrator', 'https://employer.test/payroll', 'Support biodiversity research staff.'),
                   ('Finance assistant', 'https://employer.test/finance', 'Process accounts.'))
        found = discover(body, source(), CONFIG['screening'])
        self.assertEqual([x['url'] for x in found], ['https://employer.test/science'])
        self.assertEqual(found[0]['relevanceStrength'], 'direct')

    def test_canonical_ids_survive_tracking_removal(self):
        self.assertEqual(canonical('https://example.org/jobs/?p198653=&utm_source=alert&from_rss=true#top'),
                         'https://example.org/jobs?p198653=')
        self.assertNotEqual(canonical('https://example.org/jobs/?p198653='), canonical('https://example.org/jobs/?p198654='))

    def test_refresh_deduplicates_preserves_editorial_state_and_counts_coverage(self):
        first, second = source('first'), source('second')
        item = public_item(provenance=['https://aggregator.test/known'])
        data = {'opportunities': [item]}
        previous_task = {'kind': 'changed', 'id': 'public', 'title': item['title'], 'url': item['url'],
                         'reason': 'Previous content change', 'detectedAt': '2026-09-28T00:00:00+00:00'}
        queue = {'candidates': [
            {'title': 'Pending insect role', 'url': 'https://employer.test/pending', 'firstSeen': '2026-09-20',
             'reviewNotes': 'Awaiting salary clarification', 'discoveredVia': ['earlier']},
            {'title': 'Unseen insect role', 'url': 'https://employer.test/unseen', 'firstSeen': '2026-09-18'},
            {'title': 'Already published', 'url': 'https://aggregator.test/known'},
            {'title': 'Already excluded', 'url': 'https://employer.test/excluded'}],
            'excluded': [{'url': 'https://employer.test/excluded', 'reason': 'Not relevant'}],
            'reviewTasks': [previous_task], 'metadata': {'owner': 'editor'}}
        original_data, original_queue = copy.deepcopy(data), copy.deepcopy(queue)
        body = rss(('Insect role', 'https://aggregator.test/known?from_rss=1', ''),
                   ('Insect role', 'https://employer.test/excluded', ''),
                   ('Pending insect role', 'https://employer.test/pending?utm_source=feed', ''),
                   ('Pending duplicate', 'https://employer.test/pending/', 'insect surveys'),
                   ('New insect role', 'https://employer.test/new', ''),
                   ('Finance assistant', 'https://employer.test/finance', ''),
                   ('Expired insect role', 'https://employer.test/expired', 'Deadline: 1 September 2026'))
        client = FakeClient({first['url']: body, second['url']: rss(('New insect role', 'https://employer.test/new/', ''))})
        out, health = refresh(data, {'sources': [first, second], 'screening': CONFIG['screening']},
                              queue, {}, client, NOW, discovery_only=True)
        self.assertEqual(data, original_data)
        self.assertEqual(queue, original_queue)
        self.assertEqual(out['excluded'], queue['excluded'])
        self.assertEqual(out['metadata'], {'owner': 'editor'})
        self.assertEqual(out['reviewTasks'], [previous_task])
        by_url = {x['url']: x for x in out['candidates']}
        self.assertEqual(set(by_url), {'https://employer.test/pending', 'https://employer.test/unseen', 'https://employer.test/new'})
        self.assertEqual(by_url['https://employer.test/pending']['firstSeen'], '2026-09-20')
        self.assertEqual(by_url['https://employer.test/pending']['reviewNotes'], 'Awaiting salary clarification')
        self.assertEqual(by_url['https://employer.test/pending']['lastSeen'], '2026-09-30')
        self.assertEqual(set(by_url['https://employer.test/new']['discoveredVia']), {'first', 'second'})
        self.assertEqual(health['newCandidates'], 1)
        counts = health['sources'][0]
        for name in ('duplicateCount', 'knownCount', 'excludedCount', 'filteredCount', 'pastDeadlineCount', 'pendingSeen', 'newCandidates'):
            self.assertEqual(counts[name], 1, name)
        self.assertNotIn(item['url'], client.calls)

    def test_changed_content_creates_review_task_without_renewing_public_review(self):
        item = public_item()
        old_body, new_body = '<main>Insect technician. Closing 1 October.</main>', '<main>Insect technician. Closing 8 October.</main>'
        data, original = {'opportunities': [item]}, copy.deepcopy(item)
        previous = {'links': [{'id': item['id'], 'hashMethod': HASH_METHOD, 'contentHash': content_signature(old_body)}]}
        queue, health = refresh(data, {'sources': [], 'screening': CONFIG['screening']}, {'candidates': [], 'excluded': []},
                                previous, FakeClient({item['url']: new_body}), NOW)
        self.assertEqual(item, original)
        self.assertTrue(health['links'][0]['contentChanged'])
        self.assertEqual(queue['reviewTasks'][0]['kind'], 'changed')
        self.assertEqual(queue['reviewTasks'][0]['lastChecked'], '2026-09-29')
        self.assertEqual(queue['reviewTasks'][0]['currentHash'], content_signature(new_body))

    def test_changed_notice_remains_until_editorial_task_is_resolved(self):
        item = public_item()
        body = '<main>Updated insect advert</main>'
        previous = {'links': [{'id': item['id'], 'hashMethod': HASH_METHOD, 'contentHash': content_signature(body)}]}
        task = {'kind': 'changed', 'id': item['id'], 'url': item['url'], 'title': item['title'], 'reason': 'Check amended advert'}
        config = {'sources': [], 'screening': CONFIG['screening']}
        _, health = refresh({'opportunities': [item]}, config, {'candidates': [], 'reviewTasks': [task]},
                            previous, FakeClient({item['url']: body}), NOW)
        self.assertTrue(health['links'][0]['contentChanged'])
        _, health = refresh({'opportunities': [item]}, config, {'candidates': [], 'reviewTasks': []},
                            previous, FakeClient({item['url']: body}), NOW)
        self.assertFalse(health['links'][0]['contentChanged'])

    def test_old_hash_migration_does_not_report_a_false_content_change(self):
        item = public_item()
        previous = {'links': [{'id': item['id'], 'contentHash': 'old-full-html-hash'}]}
        queue, health = refresh({'opportunities': [item]}, {'sources': [], 'screening': CONFIG['screening']},
                                {'candidates': [], 'excluded': []}, previous,
                                FakeClient({item['url']: '<main>Insect vacancy</main>'}), NOW)
        self.assertFalse(health['links'][0]['contentChanged'])
        self.assertEqual(health['links'][0]['hashMethod'], HASH_METHOD)
        self.assertEqual(queue['reviewTasks'], [])

    def test_content_hash_ignores_scripts_but_catches_jobposting_deadline_change(self):
        self.assertEqual(content_signature('<main>Insect vacancy</main><script>nonce="one"</script>'),
                         content_signature('<main>Insect vacancy</main><script>nonce="two"</script>'))
        before = '<script type="application/ld+json">{"@type":"JobPosting","title":"Insect vacancy","validThrough":"2026-10-01"}</script>'
        self.assertNotEqual(content_signature(before), content_signature(before.replace('2026-10-01', '2026-10-08')))

    def test_stale_task_begins_at_21_days_and_retains_first_detection(self):
        fresh = public_item(id='fresh', url='https://employer.test/fresh', lastChecked='2026-09-10')
        stale = public_item(id='stale', url='https://employer.test/stale', lastChecked='2026-09-09')
        old_task = {'kind': 'stale', 'id': 'stale', 'title': stale['title'], 'url': stale['url'],
                    'reason': 'Earlier stale check', 'detectedAt': '2026-09-29T12:00:00+00:00'}
        queue, _ = refresh({'opportunities': [fresh, stale]}, {'sources': [], 'screening': CONFIG['screening']},
                           {'candidates': [], 'excluded': [], 'reviewTasks': [old_task]}, {}, FakeClient({}), NOW, discovery_only=True)
        self.assertEqual(len(queue['reviewTasks']), 1)
        self.assertEqual(queue['reviewTasks'][0]['id'], 'stale')
        self.assertEqual(queue['reviewTasks'][0]['reviewAgeDays'], 21)
        self.assertEqual(queue['reviewTasks'][0]['detectedAt'], old_task['detectedAt'])
        self.assertEqual(stale['lastChecked'], '2026-09-09')

    def test_collector_failures_report_partial_then_failed_without_losing_pending(self):
        healthy, broken = source('healthy'), source('broken')
        config = {'sources': [healthy, broken], 'screening': CONFIG['screening']}
        original = {'candidates': [{'title': 'Insect role', 'url': 'https://employer.test/pending'}], 'excluded': []}
        prior = {'sources': [{'id': 'broken', 'lastSucceeded': '2026-09-28T00:00:00+00:00'}]}
        queue, health = refresh({'opportunities': []}, config, original, prior,
                                FakeClient({healthy['url']: rss(), broken['url']: TimeoutError('timed out')}), NOW)
        self.assertEqual(health['discoveryStatus'], 'partial')
        self.assertEqual(queue['candidates'], original['candidates'])
        self.assertEqual(health['sources'][1]['lastSucceeded'], prior['sources'][0]['lastSucceeded'])
        _, failed = refresh({'opportunities': []}, config, original, prior,
                            FakeClient({healthy['url']: '<html>blocked</html>', broken['url']: TimeoutError()}), NOW)
        self.assertEqual(failed['discoveryStatus'], 'failed')

    def test_noon_and_daylight_saving(self):
        self.assertEqual(cutoff({'deadline': '2026-10-16', 'deadlineTime': '12:00'}), '2026-10-16T12:00:00+01:00')
        self.assertEqual(cutoff({'deadline': '2026-10-25'}), '2026-10-26T00:00:00+00:00')
        self.assertEqual(cutoff({'deadline': '2026-09-29'}), '2026-09-30T00:00:00+01:00')

    def test_robots_failure_does_not_fetch_listing(self):
        client = PoliteClient()
        with patch.object(client, 'raw', side_effect=TimeoutError()) as request:
            with self.assertRaisesRegex(ValueError, 'robots.txt unavailable'):
                client.get('https://employer.test/jobs')
            self.assertEqual(request.call_count, 1)

    def test_robots_denial(self):
        client = PoliteClient()
        with patch.object(client, 'raw', return_value='User-agent: *\nDisallow: /jobs') as request:
            with self.assertRaisesRegex(ValueError, 'Disallowed'):
                client.get('https://employer.test/jobs')
            self.assertEqual(request.call_count, 1)


if __name__ == '__main__':
    unittest.main()
