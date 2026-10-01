import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from moderate import (ModerationError, acknowledge, github_api, parse_report,
                      resolve_report, withdraw)


REPO = 'owner/opportunities'
URL = 'https://employer.test/jobs/123'
ALIAS = 'https://board.test/jobs/456'
INDEX = 'https://board.test/jobs'
ISSUE_URL = 'https://github.com/owner/opportunities/issues/17'
NOW = datetime(2026, 9, 30, 17, 0, tzinfo=timezone.utc)


def issue():
    return {'number': 17, 'html_url': ISSUE_URL, 'state': 'open',
            'labels': [{'name': 'remove-advert'}], 'title': '[Advert report] Insect surveyor',
            'body': f'Advert ID: insect-surveyor\nAdvert URL: {URL}\n\nReason: Closed.'}


def event():
    return {'repository': {'full_name': REPO}, 'action': 'labeled',
            'label': {'name': 'remove-advert'}, 'issue': issue()}


class AuthorizationTests(unittest.TestCase):
    def api(self, current=None, permission='write'):
        return Mock(side_effect=[{'permission': permission}, current or issue()])

    def test_write_and_admin_authorize_exact_label_event(self):
        for permission in ('write', 'admin', 'maintain'):
            with self.subTest(permission=permission):
                api = self.api(permission=permission)
                result = resolve_report(event(), 'issues', REPO, 'owner', api)
                self.assertEqual(result['advertId'], 'insect-surveyor')
                self.assertEqual(result['advertUrl'], URL)
                self.assertEqual(api.call_args_list[0].args,
                                 ('repos/owner/opportunities/collaborators/owner/permission',))

    def test_read_triage_and_unknown_permissions_fail_before_reading_issue(self):
        for permission in ('read', 'triage', 'none', None):
            api = self.api(permission=permission)
            with self.assertRaisesRegex(ModerationError, 'Only repository'):
                resolve_report(event(), 'issues', REPO, 'reader', api)
            self.assertEqual(api.call_count, 1)

    def test_edited_body_or_removed_label_cannot_retarget_approval(self):
        current = issue()
        for updates in ({'body': current['body'].replace(URL, ALIAS)}, {'labels': []},
                        {'state': 'closed'}, {'pull_request': {}}, {'html_url': ISSUE_URL + '0'}):
            with self.subTest(updates=updates):
                changed = dict(current, **updates)
                with self.assertRaises(ModerationError):
                    resolve_report(event(), 'issues', REPO, 'owner', self.api(changed))

    def test_manual_dispatch_reads_current_labeled_issue(self):
        dispatch = {'repository': {'full_name': REPO},
                    'inputs': {'issue_number': '17', 'advert_id': 'insect-surveyor', 'advert_url': URL}}
        self.assertEqual(resolve_report(dispatch, 'workflow_dispatch', REPO, 'owner', self.api())['issueNumber'], 17)
        dispatch['inputs']['issue_number'] = '17; echo unsafe'
        with self.assertRaisesRegex(ModerationError, 'positive integer'):
            resolve_report(dispatch, 'workflow_dispatch', REPO, 'owner', self.api())

    def test_manual_dispatch_cannot_be_retargeted_by_later_issue_edits(self):
        dispatch = {'repository': {'full_name': REPO},
                    'inputs': {'issue_number': '17', 'advert_id': 'insect-surveyor', 'advert_url': URL}}
        changed = issue()
        changed['body'] = f'Advert ID: another-advert\nAdvert URL: {ALIAS}'
        with self.assertRaisesRegex(ModerationError, 'no longer matches'):
            resolve_report(dispatch, 'workflow_dispatch', REPO, 'owner', self.api(changed))

    def test_duplicate_or_invalid_fields_are_rejected(self):
        for body in (f'Advert ID: one\nAdvert ID: two\nAdvert URL: {URL}',
                     f'Advert ID: one\nAdvert URL: {URL}\nAdvert URL: {ALIAS}',
                     'Advert ID: $(touch x)\nAdvert URL: https://example.test/x',
                     'Advert ID: one\nAdvert URL: javascript:alert(1)',
                     'Advert ID: one\nAdvert URL: https://user:password@example.test/x'):
            with self.subTest(body=body), self.assertRaises(ModerationError):
                parse_report(body)

    def test_api_passes_untrusted_text_as_json_stdin_without_shell(self):
        payload = {'body': 'Report with `backticks`, $(touch unsafe), and\nnewlines'}
        with patch('moderate.subprocess.run', return_value=Mock(returncode=0, stdout='{}')) as run:
            github_api('repos/owner/opportunities/issues/17/comments', 'POST', payload)
        args, kwargs = run.call_args
        self.assertEqual(args[0][-2:], ['--input', '-'])
        self.assertEqual(json.loads(kwargs['input']), payload)
        self.assertNotIn('shell', kwargs)


class WithdrawalTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.public_path = self.root / 'site/data/opportunities.json'
        self.queue_path = self.root / 'data/review-queue.json'
        self.record = {
            'id': 'insect-surveyor', 'title': 'Insect surveyor', 'organisation': 'Example Institute',
            'type': 'job', 'location': 'Shropshire', 'country': 'United Kingdom', 'workplace': 'Field based',
            'funding': 'Paid', 'compensation': 'Salary not stated', 'eligibility': 'Relevant experience',
            'careerLevel': 'Entry level', 'summary': 'Survey insects and record biodiversity.',
            'url': URL, 'source': 'Example Institute', 'sourceUrl': INDEX,
            'lastChecked': '2026-09-29', 'subjects': ['Taxonomy'], 'courses': ['entomology'],
            'tags': ['Identification'], 'reviewStatus': 'approved', 'status': 'open-no-deadline',
            'deadline': None, 'deadlineAt': None, 'deadlineLabel': 'No deadline stated',
            'provenance': [ALIAS + '?from_rss=true', INDEX + '/',
                           'https://another.test/current-vacancies',
                           'https://another.test/jobs?keywords=insects'],
            'customMetadata': {'preserve': True},
        }
        self.other = dict(self.record, id='other', url='https://employer.test/jobs/999', provenance=[])
        self.queue = {
            'candidates': [{'url': URL + '?utm_source=feed'}, {'url': ALIAS},
                           {'url': 'https://board.test/jobs/789'}, {'url': INDEX}],
            'excluded': [{'url': 'https://unrelated.test/old', 'reason': 'Preserve this reason'}],
            'reviewTasks': [{'id': 'insect-surveyor', 'kind': 'changed', 'url': URL},
                            {'id': 'other', 'kind': 'stale', 'url': self.other['url']}],
            'customMetadata': {'preserve': True},
        }
        self.report = {'advertId': 'insect-surveyor', 'advertUrl': URL, 'issueNumber': 17,
                       'issueUrl': ISSUE_URL, 'repository': REPO, 'actor': 'owner'}
        self.save(self.public_path, {'opportunities': [self.record, self.other], 'schemaVersion': 1})
        self.save(self.queue_path, self.queue)
        self.save(self.root / 'site/data/sources.json', {
            'keywordGroups': [{'name': 'Taxonomy'}],
            'sources': [{'url': INDEX, 'fetchUrl': 'https://board.test/jobs.rss'}]})

    def save(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))

    def test_withdrawal_preserves_metadata_excludes_advert_aliases_and_clears_matching_work(self):
        receipt = withdraw(self.root, self.report, NOW)
        public = json.loads(self.public_path.read_text())
        queue = json.loads(self.queue_path.read_text())
        updated = public['opportunities'][0]
        self.assertEqual(updated['status'], 'withdrawn')
        self.assertEqual(updated['withdrawal']['issueUrl'], ISSUE_URL)
        self.assertEqual(updated['lastChecked'], '2026-09-29')
        self.assertEqual({k: v for k, v in updated.items() if k not in {'status', 'withdrawal'}},
                         {k: v for k, v in self.record.items() if k != 'status'})
        self.assertEqual(public['opportunities'][1], self.other)
        self.assertEqual(receipt['excludedUrls'], [ALIAS, URL])
        self.assertEqual(queue['excluded'][0], self.queue['excluded'][0])
        self.assertEqual({x['url'] for x in queue['excluded'][1:]}, {URL, ALIAS})
        self.assertEqual([x['url'] for x in queue['candidates']], ['https://board.test/jobs/789', INDEX])
        self.assertEqual([x['id'] for x in queue['reviewTasks']], ['other'])
        self.assertEqual(queue['customMetadata'], self.queue['customMetadata'])

    def test_repeat_is_idempotent_and_preserves_prior_exclusion_notes(self):
        self.queue['excluded'].append({'url': URL, 'reason': 'Earlier editorial reason'})
        self.save(self.queue_path, self.queue)
        withdraw(self.root, self.report, NOW)
        before = self.public_path.read_bytes(), self.queue_path.read_bytes()
        receipt = withdraw(self.root, self.report, NOW.replace(day=30, hour=18))
        self.assertTrue(receipt['alreadyWithdrawn'])
        self.assertEqual(receipt['addedExclusions'], 0)
        self.assertEqual(before, (self.public_path.read_bytes(), self.queue_path.read_bytes()))
        self.assertEqual(json.loads(self.queue_path.read_text())['excluded'][1]['reason'], 'Earlier editorial reason')

    def test_direct_provenance_url_authorizes_but_index_and_wrong_id_do_not(self):
        receipt = withdraw(self.root, dict(self.report, advertUrl=ALIAS), NOW)
        self.assertEqual(receipt['advertId'], 'insect-surveyor')
        for updates in ({'advertUrl': INDEX}, {'advertUrl': self.other['url']}, {'advertId': 'missing'}):
            before = self.public_path.read_bytes(), self.queue_path.read_bytes()
            with self.subTest(updates=updates), self.assertRaises(ModerationError):
                withdraw(self.root, dict(self.report, **updates), NOW)
            self.assertEqual(before, (self.public_path.read_bytes(), self.queue_path.read_bytes()))

    def test_shared_alias_is_not_blacklisted_or_used_for_ambiguous_report(self):
        self.other['provenance'] = [ALIAS]
        self.save(self.public_path, {'opportunities': [self.record, self.other]})
        with self.assertRaisesRegex(ModerationError, 'another record'):
            withdraw(self.root, dict(self.report, advertUrl=ALIAS), NOW)
        receipt = withdraw(self.root, self.report, NOW)
        self.assertEqual(receipt['excludedUrls'], [URL])

    def test_invalid_existing_data_never_writes(self):
        invalid = copy.deepcopy(self.record)
        invalid['courses'] = ['invalid-course']
        self.save(self.public_path, {'opportunities': [invalid, self.other]})
        before = self.public_path.read_bytes(), self.queue_path.read_bytes()
        with self.assertRaisesRegex(ModerationError, 'validation failed'):
            withdraw(self.root, self.report, NOW)
        self.assertEqual(before, (self.public_path.read_bytes(), self.queue_path.read_bytes()))

    def test_acknowledgement_links_audit_without_claiming_deployment_finished(self):
        receipt = dict(self.report, excludedUrls=[URL, ALIAS])
        api = Mock(return_value={})
        acknowledge(receipt, 'https://github.com/owner/opportunities/actions/runs/123', api)
        body = api.call_args.kwargs['payload']['body']
        self.assertIn('republication has been requested', body)
        self.assertIn('/actions/runs/123', body)
        self.assertEqual(api.call_args.kwargs['method'], 'POST')
        with self.assertRaises(ModerationError):
            acknowledge(receipt, 'https://other.test/123', api)


if __name__ == '__main__':
    unittest.main()
