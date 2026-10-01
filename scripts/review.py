#!/usr/bin/env python3
"""Review discoveries explicitly; never infer advert facts or renew review dates."""
import argparse
import copy
import json
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from refresh import canonical
from validate import validate

ROOT = Path(__file__).resolve().parents[1]
RESOLVED = {'approved', 'rejected', 'resolved'}


class ReviewError(ValueError):
    pass


def load_state(root):
    root = Path(root)
    data = json.loads((root / 'site/data/opportunities.json').read_text())
    config = json.loads((root / 'site/data/sources.json').read_text())
    path = root / 'data/review-queue.json'
    queue = json.loads(path.read_text()) if path.exists() else {}
    for name in ('candidates', 'excluded', 'reviewTasks'):
        queue.setdefault(name, [])
    return data, config, queue


def write_changes(changes):
    """Prepare every replacement first; restore originals if a replacement fails."""
    prepared, originals, replaced = {}, {}, []
    try:
        for path, content in changes.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            originals[path] = path.read_bytes() if path.exists() else None
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                             prefix=path.name + '.', delete=False) as file:
                prepared[path] = Path(file.name)
                file.write(content)
        for path, temporary in prepared.items():
            temporary.replace(path)
            replaced.append(path)
    except Exception:
        for path in reversed(replaced):
            if originals[path] is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(originals[path])
        raise
    finally:
        for temporary in prepared.values():
            temporary.unlink(missing_ok=True)


def json_text(data):
    return json.dumps(data, indent=2, ensure_ascii=False) + '\n'


def entries(queue, kind='pending'):
    results = []
    for candidate in queue.get('candidates', []):
        if candidate.get('reviewStatus') not in RESOLVED:
            results.append(dict(candidate, kind='new'))
    for task in queue.get('reviewTasks', []):
        if task.get('reviewStatus') not in RESOLVED:
            results.append(dict(task, kind=task.get('kind', 'changed')))
    return results if kind in ('pending', 'all') else [x for x in results if x['kind'] == kind]


def single_line(value):
    return ' '.join(str(value or '').split())


def markdown(value):
    value = single_line(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    return re.sub(r'([\\`*_{}\[\]#!|])', r'\\\1', value)


def digest(queue, kind='pending'):
    items = entries(queue, kind)
    automatic = queue.get('publicationMode') == 'automatic'
    hybrid = queue.get('publicationMode') == 'hybrid'
    description = ('Matching adverts publish automatically. These are optional checks for missing source observations, '
                   'changed pages or unavailable links. They do not block publication. Use Report advert on the site '
                   'to request removal of an irrelevant, closed or incorrect listing.' if automatic else
                   'Direct relevance matches publish automatically. Unsure matches wait in the signed-in admin portal. '
                   'Open the original advert and confirm that it is relevant and active, then Approve or Reject it. '
                   'Missing salary, eligibility or closing-date information remains explicitly unknown. '
                   'Other link/page checks below are optional maintenance.' if hybrid else
                   'Check each original advert before approving. Confirm relevance, opportunity type, '
                   'pay or funding, eligibility and deadline; missing facts must remain explicit unknowns. '
                   'An automated link check is not an editorial review.')
    lines = ['# Advert checks' if automatic or hybrid else '# Opportunity review', '', description, '',
             f'Items in this view: {len(items)}', '']
    for item in items:
        lines += [f"## {markdown(item['kind'].title())}: {markdown(item.get('title') or item.get('id') or 'Untitled')}", '']
        url = item.get('url', '')
        if urlsplit(url).scheme in ('http', 'https'):
            safe = url.replace(' ', '%20').replace('<', '%3C').replace('>', '%3E')
            lines += [f'Original advert: <{safe}>', '']
        for label, key in [('ID', 'id'), ('Source', 'source'), ('Reason', 'reason'),
                           ('Provisional relevance', 'relevanceStrength'), ('Suggested type', 'suggestedType'),
                           ('Detected', 'detectedAt'), ('First seen', 'firstSeen'),
                           ('Last seen', 'lastSeen'), ('Last editorial review', 'lastChecked'),
                           ('Advertised deadline', 'deadline'), ('Suggested deadline — verify', 'deadlineSuggestion'),
                           ('Deadline evidence', 'deadlineEvidence'), ('Source snippet', 'evidenceSnippet'), ('Evidence', 'evidence')]:
            if item.get(key):
                value = item[key]
                if isinstance(value, (dict, list)):
                    value = json.dumps(value, ensure_ascii=False)
                lines.append(f'- **{label}:** {markdown(value)}')
        lines += ['', '- [ ] Reviewed the original advert',
                  '- [ ] Confirmed relevance and current availability' if hybrid else
                  '- [ ] Confirmed classification, funding, eligibility and deadline', '']
    return '\n'.join(lines).rstrip() + '\n'


def check_record(record, config):
    if not isinstance(record, dict):
        raise ReviewError('The record file must contain one complete advert object.')
    # These explicit fields prevent missing dates/status or funding becoming silent defaults.
    required_text = ('id', 'title', 'organisation', 'type', 'location', 'country', 'workplace',
                     'funding', 'compensation', 'eligibility', 'careerLevel', 'summary', 'url',
                     'source', 'sourceUrl', 'lastChecked', 'reviewStatus', 'deadlineLabel', 'status')
    errors = [f'missing or invalid {key}' for key in required_text
              if not isinstance(record.get(key), str) or not record[key].strip()]
    for key in ('subjects', 'courses', 'tags'):
        values = record.get(key)
        if not isinstance(values, list) or not values or not all(isinstance(x, str) and x.strip() for x in values):
            errors.append(f'{key} must be a nonempty list of strings')
    for key in ('deadline', 'deadlineAt'):
        if key not in record or (record[key] is not None and
                                 (not isinstance(record[key], str) or not record[key].strip())):
            errors.append(f'{key} must be supplied explicitly as a date/timestamp or null')
    if 'provenance' in record and (not isinstance(record['provenance'], list) or
                                 not all(isinstance(x, str) for x in record['provenance'])):
        errors.append('provenance must be a list of URLs')
    if record.get('status') not in {'open', 'open-no-deadline', 'rolling', 'closed', 'withdrawn'}:
        errors.append('invalid status')
    for key in ('url', 'sourceUrl'):
        parsed = urlsplit(record.get(key, '') if isinstance(record.get(key), str) else '')
        if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
            errors.append(f'invalid {key}')
    if errors:
        raise ReviewError('\n'.join(errors))
    try:
        errors = validate({'opportunities': [record]}, config)
    except (ValueError, TypeError, KeyError) as error:
        raise ReviewError(f'Invalid record: {error}') from error
    if errors:
        raise ReviewError('\n'.join(errors))


def approve(root, record_path, queue_url=None):
    root = Path(root)
    record = json.loads(Path(record_path).read_text())
    data, config, queue = load_state(root)
    check_record(record, config)
    advert_key = canonical(record['url'])
    queue_key = canonical(queue_url or record['url'])
    keys = {advert_key, queue_key}
    candidates = [x for x in queue['candidates'] if canonical(x.get('url', '')) in keys
                  and x.get('reviewStatus') not in RESOLVED]
    tasks = [x for x in queue['reviewTasks']
             if (canonical(x.get('url', '')) in keys or x.get('id') == record['id'])
             and x.get('reviewStatus') not in RESOLVED]
    if not candidates and not tasks:
        raise ReviewError('No pending candidate or review task matches this advert. '
                          'Use --url for its original queued URL.')
    # Keep the observed source URL so the next discovery run recognises the approved advert.
    if queue_key != advert_key:
        provenance = record.setdefault('provenance', [])
        if queue_key not in {canonical(url) for url in provenance}:
            provenance.append(queue_url)
    proposed = copy.deepcopy(data)
    matches = [i for i, item in enumerate(proposed['opportunities'])
               if item['id'] == record['id'] or canonical(item['url']) == advert_key]
    if len(matches) > 1:
        raise ReviewError('The record ID and URL refer to different published adverts.')
    action = 'approved'
    if matches:
        existing = proposed['opportunities'][matches[0]]
        if existing['id'] != record['id']:
            raise ReviewError(f"This URL is already published as {existing['id']}; retain that ID.")
        if canonical(existing['url']) not in keys and not tasks:
            raise ReviewError('This ID already belongs to another advert; use a distinct ID.')
        proposed['opportunities'][matches[0]] = record
        action = 'updated'
    else:
        proposed['opportunities'].append(record)
    errors = validate(proposed, config)
    public_keys = [canonical(x['url']) for x in proposed['opportunities']]
    if len(public_keys) != len(set(public_keys)):
        errors.append('duplicate canonical advert URL')
    if errors:
        raise ReviewError('\n'.join(errors))
    queue['candidates'] = [x for x in queue['candidates'] if canonical(x.get('url', '')) not in keys]
    queue['reviewTasks'] = [x for x in queue['reviewTasks']
                            if canonical(x.get('url', '')) not in keys and x.get('id') != record['id']]
    queue['excluded'] = [x for x in queue['excluded'] if canonical(x.get('url', '')) not in keys]
    write_changes({root / 'site/data/opportunities.json': json_text(proposed),
                   root / 'data/review-queue.json': json_text(queue)})
    return f"{action.title()} {record['id']}; explicit review date retained: {record['lastChecked']}"


def reject(root, url, reason):
    root = Path(root)
    if not reason.strip():
        raise ReviewError('A rejection reason is required.')
    _, _, queue = load_state(root)
    key = canonical(url)
    matches = [x for x in queue['candidates'] if canonical(x.get('url', '')) == key
               and x.get('reviewStatus') not in RESOLVED]
    if not matches:
        raise ReviewError('No pending candidate matches this URL. Existing adverts require an explicit reviewed record.')
    rejected = dict(matches[0], reason=reason.strip(), reviewStatus='rejected',
                    rejectedAt=datetime.now(timezone.utc).isoformat())
    queue['candidates'] = [x for x in queue['candidates'] if canonical(x.get('url', '')) != key]
    queue['excluded'] = [x for x in queue['excluded'] if canonical(x.get('url', '')) != key] + [rejected]
    write_changes({root / 'data/review-queue.json': json_text(queue)})
    return f"Rejected {single_line(rejected.get('title', url))}"


def main(argv=None, root=ROOT):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('list', 'digest'):
        command = commands.add_parser(name, help='List pending reviews' if name == 'list' else 'Export a Markdown review digest')
        command.add_argument('--kind', choices=['pending', 'all', 'new', 'changed', 'stale', 'unreachable'], default='pending')
        if name == 'digest':
            command.add_argument('--output', type=Path, help='Write a file; otherwise print to stdout')
    command = commands.add_parser('approve', help='Publish/update an explicitly reviewed, complete record')
    command.add_argument('--record', required=True, type=Path)
    command.add_argument('--url', help='Original candidate URL if the reviewed advert uses a different URL')
    command = commands.add_parser('reject', help='Reject a pending candidate without modifying public adverts')
    command.add_argument('--url', required=True)
    command.add_argument('--reason', required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == 'approve':
            print(approve(root, args.record, args.url))
        elif args.command == 'reject':
            print(reject(root, args.url, args.reason))
        else:
            _, _, queue = load_state(root)
            if args.command == 'list':
                items = entries(queue, args.kind)
                for item in items:
                    print('\t'.join(single_line(item.get(key)) for key in ('kind', 'id', 'title', 'url', 'reason')))
                print(f'{len(items)} pending review item(s).')
            else:
                content = digest(queue, args.kind)
                if args.output:
                    write_changes({args.output: content})
                    print(f'Wrote {args.output}')
                else:
                    print(content, end='')
    except (ReviewError, OSError, json.JSONDecodeError) as error:
        print(f'Review failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
