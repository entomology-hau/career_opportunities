#!/usr/bin/env python3
"""Apply an authorized GitHub advert report; keep withdrawal and exclusion evidence."""
import argparse
import copy
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

from refresh import canonical
from review import json_text, load_state, write_changes
from validate import validate

ROOT = Path(__file__).resolve().parents[1]
LABEL = 'remove-advert'


class ModerationError(ValueError):
    pass


def github_api(endpoint, method='GET', payload=None):
    """Use structured JSON on stdin; issue text never becomes shell source."""
    command = ['gh', 'api', '--method', method, endpoint]
    if payload is not None:
        command += ['--input', '-']
    result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True)
    if result.returncode:
        raise ModerationError('GitHub API request failed; check token permissions and rerun the report.')
    return json.loads(result.stdout) if result.stdout.strip() else {}


def url_key(value):
    if not isinstance(value, str) or len(value) > 4096 or re.search(r'\s', value):
        raise ModerationError('Advert URL must be one plain HTTP(S) URL.')
    parsed = urlsplit(value)
    if parsed.scheme not in {'http', 'https'} or not parsed.netloc or parsed.username or parsed.password:
        raise ModerationError('Advert URL must be one plain HTTP(S) URL.')
    return canonical(value)


def parse_report(body):
    if not isinstance(body, str):
        raise ModerationError('Report body is missing.')
    values = {}
    for label in ('Advert ID', 'Advert URL'):
        matches = re.findall(r'^' + label + r':[ \t]*(.*)$', body, flags=re.M)
        if len(matches) != 1 or not matches[0].strip():
            raise ModerationError(f'Report needs exactly one nonempty "{label}:" line.')
        values[label] = matches[0].strip()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,159}', values['Advert ID']):
        raise ModerationError('Advert ID contains unsupported characters.')
    return values['Advert ID'], url_key(values['Advert URL'])


def resolve_report(event, event_name, repository, actor, api=github_api):
    """Authorize the labeler/dispatcher, then verify the current report still matches."""
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository or ''):
        raise ModerationError('A valid GITHUB_REPOSITORY is required.')
    if not re.fullmatch(r'[A-Za-z0-9_-]+(?:\[bot\])?', actor or ''):
        raise ModerationError('A valid GITHUB_ACTOR is required.')
    permissions = api(f'repos/{repository}/collaborators/{actor}/permission')
    # GitHub maps the maintain role to the base write permission.
    if permissions.get('permission') not in {'admin', 'write', 'maintain'}:
        raise ModerationError('Only repository collaborators with write, maintain or admin access may remove adverts.')
    if event.get('repository', {}).get('full_name') != repository:
        raise ModerationError('Event repository does not match this checkout.')
    if event_name == 'issues':
        if event.get('action') != 'labeled' or event.get('label', {}).get('name') != LABEL:
            raise ModerationError('This issue event did not add the remove-advert label.')
        number = event.get('issue', {}).get('number')
    elif event_name == 'workflow_dispatch':
        number = event.get('inputs', {}).get('issue_number')
    else:
        raise ModerationError('Only labeled issues and manual reruns are supported.')
    if not re.fullmatch(r'[1-9][0-9]*', str(number)):
        raise ModerationError('Issue number must be a positive integer.')
    number = int(number)
    issue = api(f'repos/{repository}/issues/{number}')
    expected_url = f'https://github.com/{repository}/issues/{number}'
    if issue.get('number') != number or issue.get('html_url') != expected_url or 'pull_request' in issue:
        raise ModerationError('The referenced item is not this repository issue.')
    if issue.get('state') != 'open':
        raise ModerationError('The report is closed. Reopen it before rerunning removal.')
    labels = {label.get('name') for label in issue.get('labels', []) if isinstance(label, dict)}
    if LABEL not in labels:
        raise ModerationError('The report no longer has the remove-advert label; nothing was changed.')
    if not issue.get('title', '').startswith('[Advert report]'):
        raise ModerationError('Use an issue whose title starts with [Advert report].')
    if event_name == 'issues' and issue.get('body') != event.get('issue', {}).get('body'):
        raise ModerationError('Report was edited after approval. Review it, then remove/reapply the label or dispatch a fresh run.')
    advert_id, advert_url = parse_report(issue.get('body'))
    if event_name == 'workflow_dispatch':
        reviewed = event.get('inputs', {})
        if reviewed.get('advert_id') != advert_id or url_key(reviewed.get('advert_url')) != advert_url:
            raise ModerationError('Report no longer matches the advert ID and URL reviewed for this manual run. Review and dispatch again.')
    return {'advertId': advert_id, 'advertUrl': advert_url, 'issueNumber': number,
            'issueUrl': expected_url, 'repository': repository, 'actor': actor}


def index_url(url, configured):
    key = url_key(url)
    if key in configured:
        return True
    parsed = urlsplit(key)
    # An advert ID in a query can identify a single advert on an otherwise generic path.
    query_keys = {key.casefold() for key, _ in parse_qsl(parsed.query, keep_blank_values=True)}
    if query_keys & {'id', 'jobid', 'job_id', 'vacancy_id', 'vacancyid', 'ref', 'jcode', 'adid'} or any(
            re.fullmatch(r'p[0-9]+', key) for key in query_keys):
        return False
    tail = parsed.path.rstrip('/').rsplit('/', 1)[-1].casefold()
    tail = re.sub(r'\.(?:aspx?|php|html?)$', '', tail)
    return tail in {'', 'jobs', 'careers', 'vacancies', 'current-vacancies', 'current-opportunities',
                    'job-opportunities', 'phd-opportunities', 'opportunities', 'volunteering',
                    'positions', 'recruitment', 'phds'}


def advert_aliases(record, config):
    configured = {url_key(source[key]) for source in config.get('sources', [])
                  for key in ('url', 'fetchUrl') if source.get(key)}
    candidates = [record['url'], *record.get('provenance', [])]
    if record.get('sourceUrl'):
        candidates.append(record['sourceUrl'])
    return {url_key(url) for url in candidates if not index_url(url, configured)}


def withdraw(root, report, now=None):
    root = Path(root)
    data, config, queue = load_state(root)
    matches = [x for x in data['opportunities'] if x.get('id') == report['advertId']]
    if len(matches) != 1:
        raise ModerationError('Advert ID does not identify exactly one current record; review the report against main.')
    record = matches[0]
    aliases = advert_aliases(record, config)
    # sourceUrl may be a useful exclusion alias, but it alone never authorizes a report.
    allowed = {url_key(record['url'])} | (aliases & {url_key(u) for u in record.get('provenance', [])})
    if report['advertUrl'] not in allowed:
        raise ModerationError('Advert ID and URL do not match the same record. No changes made; review the report.')
    other_aliases = {alias for item in data['opportunities'] if item['id'] != record['id']
                     for alias in advert_aliases(item, config)}
    if report['advertUrl'] in other_aliases:
        raise ModerationError('Reported URL also identifies another record; resolve the ambiguity before removing it.')
    # Never suppress another advert through a shared provenance link.
    aliases -= other_aliases
    proposed = copy.deepcopy(data)
    updated = next(x for x in proposed['opportunities'] if x['id'] == record['id'])
    stamp = (now or datetime.now(timezone.utc)).isoformat()
    updated['status'] = 'withdrawn'
    updated.setdefault('withdrawal', {'issueUrl': report['issueUrl'], 'moderatedBy': report['actor'],
                                      'withdrawnAt': stamp})
    prior_excluded = {url_key(item['url']) for item in queue['excluded']}
    added = sorted(aliases - prior_excluded)
    for alias in added:
        queue['excluded'].append({'url': alias, 'id': record['id'], 'title': record['title'],
                                  'reason': 'Removed after an authorized advert report.',
                                  'reviewStatus': 'rejected', 'rejectedAt': stamp,
                                  'reportIssue': report['issueUrl'], 'moderatedBy': report['actor']})
    removal_keys = aliases | {url_key(record['url'])}
    def belongs(item):
        return item.get('id') == record['id'] or (bool(item.get('url')) and url_key(item['url']) in removal_keys)
    queue['candidates'] = [item for item in queue['candidates'] if not belongs(item)]
    queue['reviewTasks'] = [item for item in queue['reviewTasks'] if not belongs(item)]
    errors = validate(proposed, config)
    if errors:
        raise ModerationError('Data validation failed: ' + '; '.join(errors))
    write_changes({root / 'site/data/opportunities.json': json_text(proposed),
                   root / 'data/review-queue.json': json_text(queue)})
    return dict(report, excludedUrls=sorted(aliases), addedExclusions=len(added),
                alreadyWithdrawn=record.get('status') == 'withdrawn')


def acknowledge(receipt, run_url, api=github_api):
    expected = f"https://github.com/{receipt['repository']}/actions/runs/"
    if not run_url.startswith(expected) or not run_url[len(expected):].isdigit():
        raise ModerationError('A valid removal workflow run URL is required for the acknowledgement.')
    # This runs only after persistence and a successful Pages dispatch. It does not claim deployment finished.
    body = (f"Advert `{receipt['advertId']}` has been marked withdrawn. "
            f"{len(receipt['excludedUrls'])} advert URL(s) are excluded from future collection. "
            "Site republication has been requested.\n\n"
            f"[Removal audit]({run_url}) · [Original report]({receipt['issueUrl']})\n\n"
            "The report and label remain available if a maintainer needs to rerun publication.")
    return api(f"repos/{receipt['repository']}/issues/{receipt['issueNumber']}/comments",
               method='POST', payload={'body': body})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    apply = commands.add_parser('apply')
    apply.add_argument('--event', type=Path, required=True)
    apply.add_argument('--event-name', required=True)
    apply.add_argument('--root', type=Path, default=ROOT)
    apply.add_argument('--receipt', type=Path, required=True)
    ack = commands.add_parser('acknowledge')
    ack.add_argument('--receipt', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == 'apply':
            report = resolve_report(json.loads(args.event.read_text()), args.event_name,
                                    os.environ.get('GITHUB_REPOSITORY'), os.environ.get('GITHUB_ACTOR'))
            receipt = withdraw(args.root, report)
            write_changes({args.receipt: json_text(receipt)})
            print(f"Withdrawn {receipt['advertId']}; {receipt['addedExclusions']} new exclusions. "
                  'Save these changes before requesting publication.')
        else:
            receipt = json.loads(args.receipt.read_text())
            run_url = f"https://github.com/{receipt['repository']}/actions/runs/{os.environ.get('GITHUB_RUN_ID', '')}"
            acknowledge(receipt, run_url)
            print('Acknowledged removal and publication request on the report.')
    except (ModerationError, OSError, ValueError, TypeError, KeyError) as error:
        print(f'Removal not completed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
