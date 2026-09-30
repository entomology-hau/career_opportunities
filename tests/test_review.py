import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from review import ReviewError, approve, digest, entries, reject


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.public = self.root / 'site/data/opportunities.json'
        self.queue_path = self.root / 'data/review-queue.json'
        self.record_path = self.root / 'record.json'
        self.record = {
            'id': 'insect-surveyor', 'title': 'Insect surveyor', 'organisation': 'Example Institute',
            'type': 'job', 'location': 'Shropshire', 'country': 'United Kingdom', 'workplace': 'Field based',
            'funding': 'Paid', 'compensation': 'Salary not stated', 'eligibility': 'Consult full person specification',
            'careerLevel': 'Entry level', 'summary': 'Survey insects and record biodiversity.',
            'url': 'https://example.org/jobs/123', 'source': 'Example Institute',
            'sourceUrl': 'https://example.org/jobs', 'lastChecked': '2026-09-29',
            'subjects': ['Taxonomy'], 'courses': ['entomology', 'biological-recording'], 'tags': ['Identification'],
            'reviewStatus': 'approved', 'status': 'open-no-deadline',
            'deadline': None, 'deadlineAt': None, 'deadlineLabel': 'No closing date advertised',
        }
        self.queue = {'candidates': [{'title': 'Insect surveyor', 'url': self.record['url'] + '/?utm_source=board', 'firstSeen': '2026-09-29'},
                                     {'title': 'Other vacancy', 'url': 'https://example.org/other'}],
                      'excluded': [{'url': 'https://example.org/irrelevant', 'reason': 'Unrelated'}],
                      'reviewTasks': [{'kind': 'changed', 'id': 'insect-surveyor', 'url': self.record['url'], 'reason': 'Content changed'},
                                      {'kind': 'stale', 'id': 'other', 'url': 'https://example.org/old', 'reason': 'Needs review'}],
                      'customMetadata': {'preserve': True}}
        self.save(self.public, {'schemaVersion': 1, 'opportunities': []})
        self.save(self.root / 'site/data/sources.json', {'keywordGroups': [{'name': 'Taxonomy'}]})
        self.save(self.queue_path, self.queue)
        self.save(self.record_path, self.record)

    def save(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))

    def test_approval_removes_matching_queue_items_and_preserves_review_date(self):
        approve(self.root, self.record_path)
        public = json.loads(self.public.read_text())
        queue = json.loads(self.queue_path.read_text())
        self.assertEqual(public['opportunities'], [self.record])
        self.assertEqual([x['title'] for x in queue['candidates']], ['Other vacancy'])
        self.assertEqual([x['id'] for x in queue['reviewTasks']], ['other'])
        self.assertEqual(queue['excluded'], self.queue['excluded'])
        self.assertEqual(queue['customMetadata'], {'preserve': True})

    def test_existing_canonical_url_updates_once_and_rejects_id_change(self):
        existing = dict(self.record, url=self.record['url'] + '/?utm_source=old')
        self.save(self.public, {'opportunities': [existing]})
        wrong_id = dict(self.record, id='duplicate-id')
        self.save(self.record_path, wrong_id)
        before = self.public.read_bytes(), self.queue_path.read_bytes()
        with self.assertRaisesRegex(ReviewError, 'already published'):
            approve(self.root, self.record_path)
        self.assertEqual(before, (self.public.read_bytes(), self.queue_path.read_bytes()))
        self.save(self.record_path, self.record)
        approve(self.root, self.record_path)
        self.assertEqual(json.loads(self.public.read_text())['opportunities'], [self.record])

    def test_incomplete_record_never_writes(self):
        for missing in ('eligibility', 'funding', 'deadline', 'deadlineAt', 'lastChecked'):
            with self.subTest(missing=missing):
                bad = copy.deepcopy(self.record)
                del bad[missing]
                self.save(self.record_path, bad)
                before = self.public.read_bytes(), self.queue_path.read_bytes()
                with self.assertRaises(ReviewError):
                    approve(self.root, self.record_path)
                self.assertEqual(before, (self.public.read_bytes(), self.queue_path.read_bytes()))

    def test_invalid_deadline_is_not_normalised_or_written(self):
        bad = dict(self.record, deadline='2026-10-15', deadlineAt=None)
        self.save(self.record_path, bad)
        before = self.public.read_bytes(), self.queue_path.read_bytes()
        with self.assertRaisesRegex(ReviewError, 'deadlineAt differs'):
            approve(self.root, self.record_path)
        self.assertEqual(before, (self.public.read_bytes(), self.queue_path.read_bytes()))

    def test_reject_records_reason_and_preserves_public_records_and_other_tasks(self):
        before = self.public.read_bytes()
        reject(self.root, self.record['url'], 'This role is unrelated to the course subjects.')
        queue = json.loads(self.queue_path.read_text())
        self.assertEqual(self.public.read_bytes(), before)
        self.assertEqual(len(queue['candidates']), 1)
        self.assertEqual(len(queue['excluded']), 2)
        self.assertEqual(queue['excluded'][-1]['reason'], 'This role is unrelated to the course subjects.')
        self.assertEqual(queue['reviewTasks'], self.queue['reviewTasks'])

    def test_approval_requires_a_pending_candidate_or_task(self):
        self.save(self.queue_path, {'candidates': [], 'excluded': []})
        before = self.public.read_bytes(), self.queue_path.read_bytes()
        with self.assertRaisesRegex(ReviewError, 'No pending'):
            approve(self.root, self.record_path)
        self.assertEqual(before, (self.public.read_bytes(), self.queue_path.read_bytes()))

    def test_redirected_advert_can_reference_original_candidate_url(self):
        record = dict(self.record, url='https://employer.org/vacancies/123')
        self.save(self.record_path, record)
        approve(self.root, self.record_path, self.record['url'])
        record['provenance'] = [self.record['url']]
        self.assertEqual(json.loads(self.public.read_text())['opportunities'], [record])
        self.assertEqual(len(json.loads(self.queue_path.read_text())['candidates']), 1)

    def test_resolved_task_cannot_authorise_publication(self):
        queue = {'candidates': [], 'excluded': [], 'reviewTasks': [
            {'kind': 'changed', 'id': self.record['id'], 'url': self.record['url'], 'reviewStatus': 'resolved'}]}
        self.save(self.queue_path, queue)
        before = self.public.read_bytes(), self.queue_path.read_bytes()
        with self.assertRaisesRegex(ReviewError, 'No pending'):
            approve(self.root, self.record_path)
        self.assertEqual(before, (self.public.read_bytes(), self.queue_path.read_bytes()))

    def test_digest_and_filters_include_new_changed_and_stale(self):
        self.assertEqual(len(entries(self.queue, 'pending')), 4)
        self.assertEqual(len(entries(self.queue, 'new')), 2)
        self.assertEqual(len(entries(self.queue, 'changed')), 1)
        self.assertEqual(len(entries(self.queue, 'stale')), 1)
        content = digest(self.queue)
        self.assertIn('New: Insect surveyor', content)
        self.assertIn('Changed: insect-surveyor', content)
        self.assertIn('Stale: other', content)
        self.assertIn('An automated link check is not an editorial review.', content)


if __name__ == '__main__':
    unittest.main()
