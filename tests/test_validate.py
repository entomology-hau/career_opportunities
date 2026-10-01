import copy
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from validate import cutoff, validate


class ValidateTests(unittest.TestCase):
    TODAY = date(2026, 9, 30)
    CONFIG = {'keywordGroups': [{'name': 'Taxonomy'}]}

    def setUp(self):
        self.approved = {
            'id': 'insect-surveyor', 'title': 'Insect surveyor', 'organisation': 'Example Institute',
            'type': 'job', 'location': 'Unknown', 'country': 'Unknown', 'workplace': 'Unknown',
            'compensation': 'Not stated', 'eligibility': 'Check the original advert', 'careerLevel': 'Unknown',
            'summary': 'Survey insect biodiversity.', 'url': 'https://example.org/jobs/123',
            'source': 'Example Institute', 'sourceUrl': 'https://example.org/jobs',
            'lastChecked': '2026-09-29', 'subjects': ['Taxonomy'], 'courses': ['entomology'],
            'tags': ['Identification'], 'reviewStatus': 'approved', 'deadline': None,
            'deadlineAt': None, 'deadlineLabel': 'Not stated',
        }
        self.automatic = dict(self.approved, reviewStatus='automatic', lastChecked=None,
                              firstSeen='2026-09-29', lastSeen='2026-09-30', sourceId='example-feed')

    def errors(self, item):
        return validate({'opportunities': [item]}, self.CONFIG, today=self.TODAY)

    def test_reviewed_and_automatic_records_coexist_with_minimal_source_config(self):
        auto = dict(self.automatic, id='auto', url='https://example.org/jobs/456')
        self.assertEqual(validate({'opportunities': [self.approved, auto]}, self.CONFIG, today=self.TODAY), [])
        self.assertEqual(self.automatic['lastChecked'], None)

    def test_automatic_requires_real_discovery_dates_and_source_id(self):
        for key in ['firstSeen', 'lastSeen', 'sourceId', 'lastChecked']:
            with self.subTest(key=key):
                invalid = copy.deepcopy(self.automatic)
                del invalid[key]
                self.assertTrue(any(key in error for error in self.errors(invalid)))

    def test_automatic_cannot_claim_human_review_and_approved_requires_it(self):
        errors = self.errors(dict(self.automatic, lastChecked='2026-09-30'))
        self.assertTrue(any('discovery is not a human review' in error for error in errors))
        for value in [None, '', 'not-a-date']:
            self.assertTrue(any('lastChecked' in error for error in self.errors(dict(self.approved, lastChecked=value))))
        self.assertEqual(self.errors(dict(self.automatic, reviewStatus='pending')), [])
        self.assertTrue(any('reviewStatus' in error for error in self.errors(dict(self.automatic, reviewStatus='rejected'))))

    def test_other_type_is_valid_but_unknown_type_is_not(self):
        for item in [self.approved, self.automatic]:
            self.assertEqual(self.errors(dict(item, type='other')), [])
            self.assertTrue(any('unknown type' in error for error in self.errors(dict(item, type='grant-inferred'))))

    def test_activity_dates_are_ordered_valid_past_or_today(self):
        for changes, expected in [({'firstSeen': '2026-09-31'}, 'firstSeen'),
                                  ({'lastSeen': '2026-10-01'}, 'future'),
                                  ({'firstSeen': '2026-09-30', 'lastSeen': '2026-09-29'}, 'after lastSeen'),
                                  ({'firstSeen': '1899-12-31'}, 'predates'),
                                  ({'lastSeen': '20260930'}, 'YYYY-MM-DD')]:
            with self.subTest(changes=changes):
                self.assertTrue(any(expected in error for error in self.errors(dict(self.automatic, **changes))))
        self.assertTrue(any('future' in error for error in self.errors(dict(self.approved, lastChecked='2026-10-01'))))

    def test_source_and_advert_urls_need_http_and_hostnames(self):
        for key in ['url', 'sourceUrl']:
            for value in ['https:///jobs/123', 'https:', '/jobs/123', 'javascript:alert(1)',
                          'https://example.org:broken/path', 'https://exa mple.org/path', 'https://[invalid']:
                with self.subTest(key=key, value=value):
                    self.assertTrue(any(f'invalid {key}' in error for error in self.errors(dict(self.automatic, **{key: value}))))

    def test_cutoff_preserves_noon_and_date_only_dst_rules(self):
        for values, expected in [({'deadline': '2026-10-16', 'deadlineTime': '12:00'}, '2026-10-16T12:00:00+01:00'),
                                 ({'deadline': '2026-10-25'}, '2026-10-26T00:00:00+00:00')]:
            self.assertEqual(cutoff(values), expected)
            self.assertEqual(self.errors(dict(self.automatic, **values, deadlineAt=expected)), [])
        self.assertTrue(any('deadlineAt differs' in error for error in self.errors(dict(self.automatic, deadline='2026-10-16'))))
        self.assertTrue(any('invalid deadline' in error for error in self.errors(dict(self.automatic, deadlineTime='12:00'))))


if __name__ == '__main__':
    unittest.main()
