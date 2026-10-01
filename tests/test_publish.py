import copy
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from publish import publish_matches
from validate import validate

NOW = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
CONFIG = {'publication': {'mode': 'automatic'}, 'keywordGroups': [
    {'name': 'Insect biology & behaviour', 'terms': ['entomology']},
    {'name': 'Crop protection & IPM', 'terms': ['IPM']},
    {'name': 'Taxonomy & biodiversity recording', 'terms': ['biological recording']},
    {'name': 'Ecology & conservation', 'terms': ['biodiversity']},
    {'name': 'Monitoring & environmental risk', 'terms': ['GIS']},
]}
HYBRID = dict(CONFIG, publication={'mode': 'hybrid'})


def listing(**changes):
    return dict({'title': 'Entomology technician', 'url': 'https://employer.test/jobs/1',
                 'source': 'Example feed', 'sourceId': 'feed', 'sourceUrl': 'https://source.test/jobs',
                 'matchedTerms': ['entomology'], 'matchedPatterns': [r'\bentomolog\w*\b'],
                 'relevanceStrength': 'direct'}, **changes)


def health(*listings):
    return {'sources': [{'id': 'feed', 'status': 'ok'}], 'links': [], '_listings': list(listings)}


def run(records=None, queue=None, current=None, config=None):
    return publish_matches({'opportunities': records or []}, queue or {'candidates': [], 'excluded': []},
                           current or health(), config or CONFIG, NOW)


def unsure(**changes):
    return listing(**dict({'title': 'GIS technician', 'matchedTerms': ['GIS'], 'matchedPatterns': [r'\bGIS\b'],
                            'relevanceStrength': 'needs-context', 'firstSeen': '2026-09-20', 'lastSeen': '2026-09-29'}, **changes))


def decision(candidate, action='approve', identifier='decision-1', **changes):
    return dict({'id': identifier, 'advertUrl': candidate['url'], 'action': action,
                 'decidedBy': 'reviewer-login', 'decidedAt': '2026-09-29T23:30:00+00:00',
                 'expectedCandidate': copy.deepcopy(candidate)}, **changes)


class PublishTests(unittest.TestCase):
    def test_new_record_has_explicit_unknowns_no_false_review_and_no_source_prose(self):
        candidate = listing(evidenceSnippet='Long source prose that must not be republished', _screenText='Private full description')
        inputs = ({'opportunities': []}, {'candidates': [candidate], 'excluded': [], 'reviewTasks': [], 'audit': {'keep': True}}, health(candidate))
        originals = copy.deepcopy(inputs)
        data, queue, result = publish_matches(*inputs, CONFIG, NOW)
        self.assertEqual(inputs, originals)
        record = data['opportunities'][0]
        self.assertEqual(validate(data, CONFIG, today=NOW.date()), [])
        for key, value in {'organisation': 'Organisation not supplied', 'location': 'Location not supplied',
                           'country': 'Not supplied', 'funding': 'Not supplied', 'compensation': 'Not supplied',
                           'workplace': 'Workplace not supplied', 'careerLevel': 'Not supplied',
                           'eligibility': 'Check original advert for eligibility'}.items():
            self.assertEqual(record[key], value)
        self.assertEqual(record['type'], 'other')
        self.assertIsNone(record['lastChecked'])
        self.assertIsNone(record['deadline'])
        self.assertEqual(record['reviewStatus'], 'automatic')
        self.assertTrue(record['classificationInferred'])
        self.assertEqual(record['firstSeen'], '2026-09-30')
        self.assertEqual(record['lastSeen'], '2026-09-30')
        self.assertNotIn('Long source prose', str(data))
        self.assertNotIn('_listings', result)
        self.assertEqual(queue['audit'], {'keep': True})
        self.assertEqual(queue['candidates'], [])
        self.assertEqual(result['newPublished'], 1)
        self.assertEqual(result['autoPublished'], 1)

    def test_cross_source_duplicates_publish_once_and_unseen_queue_is_not_promoted(self):
        prior = listing(firstSeen='2026-09-10')
        unseen = listing(url='https://employer.test/unseen', title='Unseen opportunity')
        data, queue, result = run(queue={'candidates': [prior, unseen], 'excluded': []},
                                  current=health(listing(url=prior['url'] + '/?from_rss=1'),
                                                 listing(sourceId='second', url=prior['url'] + '?utm_source=second')))
        self.assertEqual(len(data['opportunities']), 1)
        self.assertEqual(data['opportunities'][0]['firstSeen'], '2026-09-10')
        self.assertEqual(queue['candidates'], [unseen])
        self.assertEqual(result['newPublished'], 1)
        other, _, _ = run(current=health(listing()))
        self.assertEqual(data['opportunities'][0]['id'], other['opportunities'][0]['id'])

    def test_existing_approved_record_is_preserved_except_last_seen(self):
        data, _, _ = run(current=health(listing()))
        record = dict(data['opportunities'][0], reviewStatus='approved', lastChecked='2026-09-29',
                      title='Human reviewed title', organisation='Verified employer', type='job',
                      notes='Preserve all editorial metadata', provenance=['https://aggregator.test/original'])
        expected = dict(record, lastSeen='2026-09-30')
        data, _, result = run(records=[record], current=health(listing(url='https://aggregator.test/original', title='Feed title')))
        self.assertEqual(data['opportunities'], [expected])
        self.assertEqual(record['lastChecked'], '2026-09-29')
        self.assertEqual(result['newPublished'], 0)
        self.assertEqual(result['autoPublished'], 0)

    def test_excluded_aliases_and_closed_or_withdrawn_records_are_never_resurrected(self):
        seeded, _, _ = run(current=health(listing()))
        closed = dict(seeded['opportunities'][0], status='closed', provenance=['https://alias.test/closed'])
        withdrawn = dict(closed, id='withdrawn', status='withdrawn', url='https://employer.test/withdrawn', provenance=[])
        excluded = {'url': 'https://employer.test/excluded', 'provenance': ['https://alias.test/excluded'], 'reason': 'Unrelated'}
        data, queue, result = run(records=[closed, withdrawn], queue={'candidates': [], 'excluded': [excluded]},
                                  current=health(listing(url='https://alias.test/closed'), listing(url=withdrawn['url']),
                                                 listing(url='https://alias.test/excluded?from_rss=1')))
        self.assertEqual(data['opportunities'], [closed, withdrawn])
        self.assertEqual(queue['excluded'], [excluded])
        self.assertEqual(result['newPublished'], 0)
        self.assertEqual(result['activePublished'], 0)

    def test_expired_source_deadlines_are_not_published_or_erased_on_later_feed_runs(self):
        data, _, result = run(current=health(listing(deadlineSuggestion='2026-09-29')))
        self.assertEqual(data['opportunities'], [])
        self.assertEqual(result['newPublished'], 0)
        future, _, _ = run(current=health(listing(deadlineSuggestion='2026-10-05')))
        old = dict(future['opportunities'][0], deadline='2026-09-29', deadlineAt='2026-09-30T00:00:00+01:00',
                   deadlineLabel='29 September', lastSeen='2026-09-29')
        data, _, result = run(records=[old], current=health(listing()))
        self.assertEqual(data['opportunities'], [old])
        self.assertEqual(result['autoPublished'], 0)

    def test_automatic_update_preserves_identity_and_first_seen_but_refreshes_source_fields(self):
        data, _, _ = run(current=health(listing(firstSeen='2026-09-10', suggestedType='job')))
        old = dict(data['opportunities'][0], lastSeen='2026-09-29')
        updated = listing(title='Insect survey internship', suggestedType='internship', organisation='Named employer',
                          matchedTerms=['insect'], firstSeen='2026-09-30', deadlineSuggestion='2026-10-05',
                          deadlineEvidence='Closing date: 5 October 2026')
        data, _, result = run(records=[old], current=health(updated))
        record = data['opportunities'][0]
        self.assertEqual(record['id'], old['id'])
        self.assertEqual(record['firstSeen'], '2026-09-10')
        self.assertEqual(record['lastSeen'], '2026-09-30')
        self.assertIsNone(record['lastChecked'])
        self.assertEqual(record['title'], updated['title'])
        self.assertEqual(record['organisation'], 'Named employer')
        self.assertEqual(record['type'], 'internship')
        self.assertEqual(record['deadlineAt'], '2026-10-06T00:00:00+01:00')
        self.assertIn('confirm closing time', record['deadlineLabel'])
        self.assertEqual(result['newPublished'], 0)

    def test_contextual_gis_maps_to_monitoring_and_recording_with_minimal_config_fallback(self):
        data, _, _ = run(current=health(listing(title='GIS technician', matchedTerms=['GIS'],
                                               matchedPatterns=[r'\bGIS\b'], relevanceStrength='context')))
        record = data['opportunities'][0]
        self.assertEqual(record['subjects'], ['Monitoring & environmental risk'])
        self.assertEqual(record['courses'], ['biological-recording'])
        self.assertEqual(record['relevanceTier'], 'Related field')
        minimal = {'publication': {'mode': 'automatic'}, 'keywordGroups': [{'name': 'Taxonomy'}]}
        data, _, _ = run(current=health(listing()), config=minimal)
        self.assertEqual(validate(data, minimal, today=NOW.date()), [])

    def test_disabled_publication_and_invalid_source_metadata_do_not_publish(self):
        data, queue, result = run(current=health(listing()), config={'keywordGroups': CONFIG['keywordGroups']})
        self.assertEqual(data, {'opportunities': []})
        self.assertEqual(queue, {'candidates': [], 'excluded': []})
        self.assertNotIn('_listings', result)
        data, _, result = run(current=health(listing(sourceUrl='https:///missing-host')))
        self.assertEqual(data['opportunities'], [])
        self.assertEqual(result['publicationSkipped'], 1)

    def test_live_counts_exclude_stale_and_expired_records_without_deleting_history(self):
        seeded, _, _ = run(current=health(listing()))
        live = seeded['opportunities'][0]
        stale = dict(live, id='stale', url='https://employer.test/stale', firstSeen='2026-08-01', lastSeen='2026-08-30')
        expired = dict(live, id='expired', url='https://employer.test/expired',
                       deadline='2026-09-29', deadlineAt='2026-09-30T00:00:00+01:00')
        source_health = health()
        source_health['links'] = [{'id': 'stale', 'status': 'needs-check'}]
        data, _, result = run(records=[live, stale, expired], current=source_health)
        self.assertEqual(len(data['opportunities']), 3)
        self.assertEqual(result['autoPublished'], 1)
        self.assertEqual(result['activePublished'], 1)
        self.assertIn('1 advert links need checking', result['summary'])

    def test_current_source_sighting_keeps_old_reviewed_record_live_without_renewing_review(self):
        seeded, _, _ = run(current=health(listing()))
        reviewed = dict(seeded['opportunities'][0], reviewStatus='approved',
                        lastChecked='2026-08-01', lastSeen='2026-08-01')
        data, _, result = run(records=[reviewed], current=health(listing()))
        self.assertEqual(data['opportunities'][0]['lastChecked'], '2026-08-01')
        self.assertEqual(data['opportunities'][0]['lastSeen'], '2026-09-30')
        self.assertEqual(result['activePublished'], 1)
        self.assertEqual(result['autoPublished'], 0)

    def test_hybrid_gates_only_relevance_not_unknown_type_or_deadline(self):
        context = unsure(url='https://employer.test/context')
        data, queue, result = run(current=health(listing(), context), config=HYBRID)
        self.assertEqual(len(data['opportunities']), 1)
        self.assertEqual(data['opportunities'][0]['type'], 'other')
        self.assertIsNone(data['opportunities'][0]['deadline'])
        self.assertEqual(data['opportunities'][0]['reviewStatus'], 'automatic')
        self.assertEqual([item['url'] for item in queue['candidates']], [context['url']])
        self.assertEqual(result['pendingCandidates'], 1)
        self.assertEqual(result['activePublished'], 1)

    def test_hybrid_migrates_related_automatic_records_but_preserves_manual_reviews(self):
        seeded, _, _ = run(current=health(unsure(), listing(url='https://employer.test/core')))
        related, core = seeded['opportunities']
        manual = dict(related, id='manual', url='https://employer.test/manual', provenance=[],
                      reviewStatus='approved', lastChecked='2026-09-29')
        original = copy.deepcopy([related, core, manual])
        data, queue, result = run(records=original, config=HYBRID)
        self.assertEqual([item['reviewStatus'] for item in data['opportunities']], ['pending', 'automatic', 'approved'])
        self.assertEqual(data['opportunities'][2], manual)
        self.assertEqual(original[0]['reviewStatus'], 'automatic')
        self.assertEqual(queue['candidates'][0]['url'], related['url'])
        self.assertEqual(queue['candidates'][0]['lastSeen'], related['lastSeen'])
        self.assertIsNone(data['opportunities'][0]['lastChecked'])
        self.assertEqual(result['activePublished'], 2)
        self.assertEqual(validate(data, HYBRID, today=NOW.date()), [])

    def test_direct_duplicate_takes_precedence_over_context_regardless_of_source_order(self):
        for observations in [(listing(), unsure()), (unsure(), listing())]:
            with self.subTest(order=[item['relevanceStrength'] for item in observations]):
                data, queue, result = run(current=health(*observations), config=HYBRID)
                self.assertEqual(len(data['opportunities']), 1)
                self.assertEqual(data['opportunities'][0]['reviewStatus'], 'automatic')
                self.assertEqual(queue['candidates'], [])
                self.assertEqual(result['newPublished'], 1)

    def test_approval_uses_snapshot_despite_feed_refresh_and_is_idempotent(self):
        expected = unsure(title='Snapshot title', organisation='Snapshot organisation')
        refreshed = unsure(title='New feed title', organisation='New feed organisation', lastSeen='2026-09-30')
        pending = {'candidates': [refreshed], 'excluded': [], 'decisions': [decision(expected)], 'audit': {'keep': True}}
        original_queue = copy.deepcopy(pending)
        data, queue, result = run(queue=pending, current=health(refreshed), config=HYBRID)
        record = data['opportunities'][0]
        self.assertEqual(pending, original_queue)
        self.assertEqual(record['title'], 'Snapshot title')
        self.assertEqual(record['organisation'], 'Snapshot organisation')
        self.assertEqual(record['reviewStatus'], 'approved')
        self.assertEqual(record['lastChecked'], '2026-09-30')  # UTC decision was 29th; UK date was 30th.
        self.assertEqual(record['lastSeen'], '2026-09-30')  # Actual same-run feed sighting, not the approval.
        self.assertEqual(record['reviewAudit'][0]['decidedBy'], 'reviewer-login')
        self.assertEqual(queue['decisions'][0]['resolutionStatus'], 'applied')
        self.assertEqual(queue['audit'], {'keep': True})
        self.assertEqual(queue['candidates'], [])
        self.assertEqual(result['decisionsApplied'], 1)
        repeated_data, repeated_queue, repeated_result = run(records=data['opportunities'], queue=queue, config=HYBRID)
        self.assertEqual(repeated_data, data)
        self.assertEqual(repeated_queue, queue)
        self.assertEqual(repeated_result['decisionsApplied'], 0)
        self.assertEqual(len(repeated_data['opportunities'][0]['reviewAudit']), 1)

    def test_approval_without_new_sighting_keeps_actual_source_date(self):
        candidate = unsure()
        data, _, _ = run(queue={'candidates': [candidate], 'excluded': [], 'decisions': [decision(candidate)]}, config=HYBRID)
        record = data['opportunities'][0]
        self.assertEqual(record['lastSeen'], '2026-09-29')
        self.assertEqual(record['lastChecked'], '2026-09-30')
        self.assertEqual(record['type'], 'other')
        self.assertIsNone(record['deadline'])
        self.assertEqual(validate(data, HYBRID, today=NOW.date()), [])

    def test_rejection_excludes_and_withdraws_held_record_without_resurrection(self):
        seeded, _, _ = run(current=health(unsure()))
        held_data, held_queue, _ = run(records=seeded['opportunities'], config=HYBRID)
        candidate = held_queue['candidates'][0]
        held_queue['decisions'] = [decision(candidate, action='reject')]
        data, queue, result = run(records=held_data['opportunities'], queue=held_queue,
                                  current=health(listing()), config=HYBRID)
        self.assertEqual(data['opportunities'][0]['status'], 'withdrawn')
        self.assertEqual(queue['excluded'][0]['url'], candidate['url'])
        self.assertEqual(queue['decisions'][0]['resolutionStatus'], 'applied')
        self.assertEqual(queue['candidates'], [])
        self.assertEqual(result['activePublished'], 0)
        next_data, next_queue, _ = run(records=data['opportunities'], queue=queue, current=health(listing()), config=HYBRID)
        self.assertEqual(next_data, data)
        self.assertEqual(next_queue, queue)

    def test_stale_expired_excluded_and_absent_candidates_cannot_be_approved(self):
        fresh = unsure()
        cases = [
            {'candidate': unsure(lastSeen='2026-08-30', firstSeen='2026-08-01')},
            {'candidate': unsure(deadlineSuggestion='2026-09-29')},
            {'candidate': fresh, 'excluded': [{'url': fresh['url'], 'reason': 'Excluded'}]},
            {'candidate': fresh, 'absent': True},
        ]
        for case in cases:
            with self.subTest(case=case):
                candidate = case['candidate']
                data, queue, result = run(queue={'candidates': [] if case.get('absent') else [candidate],
                                                 'excluded': case.get('excluded', []), 'decisions': [decision(candidate)]}, config=HYBRID)
                self.assertEqual(data['opportunities'], [])
                self.assertEqual(queue['decisions'][0]['resolutionStatus'], 'ignored')
                self.assertEqual(result['decisionsIgnored'], 1)

    def test_refresh_preserves_held_candidate_and_exact_backend_decision(self):
        from refresh import refresh
        seeded, _, _ = run(current=health(unsure()))
        data, queue, _ = run(records=seeded['opportunities'], config=HYBRID)
        queue['decisions'] = [decision(queue['candidates'][0])]
        original = copy.deepcopy(queue)
        config = dict(HYBRID, sources=[], screening={})
        refreshed, status = refresh(data, config, queue, {}, object(), NOW, discovery_only=True)
        self.assertEqual(refreshed['candidates'], original['candidates'])
        self.assertEqual(refreshed['decisions'], original['decisions'])
        self.assertEqual(queue, original)
        published, completed, _ = publish_matches(data, refreshed, status, config, NOW)
        self.assertEqual(published['opportunities'][0]['reviewStatus'], 'approved')
        self.assertEqual(completed['decisions'][0]['resolutionStatus'], 'applied')


if __name__ == '__main__':
    unittest.main()
