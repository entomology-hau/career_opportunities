#!/usr/bin/env python3
"""Validate reviewed or automatically collected adverts and source-date cutoffs."""
import argparse
import json
import re
import sys
from datetime import datetime, timedelta, date
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
TYPES = {'job', 'phd', 'mres', 'internship', 'volunteering', 'other'}
COURSES = {'entomology', 'ipm', 'biological-recording'}
MIN_ACTIVITY_DATE = date(2000, 1, 1)


def calendar_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('expected YYYY-MM-DD')
    return date.fromisoformat(value)


def cutoff(item):
    if not item.get('deadline'):
        if item.get('deadlineTime'):
            raise ValueError('deadlineTime requires a deadline date')
        return None
    source_date = calendar_date(item['deadline'])
    d = datetime.combine(source_date, datetime.min.time())
    if item.get('deadlineTime'):
        value = item['deadlineTime']
        if not isinstance(value, str) or not re.fullmatch(r'\d{2}:\d{2}', value):
            raise ValueError('deadlineTime must use HH:MM')
        h, m = map(int, value.split(':'))
        d = d.replace(hour=h, minute=m)
    else:
        d += timedelta(days=1)
    return d.replace(tzinfo=ZoneInfo(item.get('deadlineTimezone', 'Europe/London'))).isoformat()


def valid_url(value):
    if not isinstance(value, str) or re.search(r'\s', value):
        return False
    try:
        parsed = urlsplit(value)
        return bool(parsed.scheme in {'http', 'https'} and parsed.netloc and parsed.hostname
                    and (parsed.port is None or 0 < parsed.port <= 65535))
    except ValueError:
        return False


def validate(data, config, today=None):
    today = today or datetime.now(ZoneInfo('Europe/London')).date()
    ids, urls, errors = set(), set(), []
    subjects = {x['name'] for x in config['keywordGroups']}
    for i, item in enumerate(data['opportunities']):
        if not isinstance(item, dict):
            errors.append(f'entry {i}: advert must be an object')
            continue
        label = item.get('id', f'entry {i}')

        def problem(message):
            errors.append(f'{label}: {message}')

        for key in ['id', 'title', 'organisation', 'type', 'location', 'country', 'workplace',
                    'compensation', 'eligibility', 'careerLevel', 'summary', 'url', 'source',
                    'sourceUrl', 'reviewStatus', 'deadlineLabel']:
            if not isinstance(item.get(key), str) or not item[key].strip():
                problem(f'missing or invalid {key}')
        for key, values in [('id', ids), ('url', urls)]:
            value = item.get(key)
            if isinstance(value, str):
                if value in values:
                    problem('duplicate id' if key == 'id' else 'duplicate advert URL')
                values.add(value)
        if not isinstance(item.get('type'), str) or item['type'] not in TYPES:
            problem('unknown type')
        for key in ['subjects', 'courses', 'tags']:
            values = item.get(key)
            if not isinstance(values, list) or not values or not all(isinstance(x, str) and x.strip() for x in values):
                problem(f'{key} must be a nonempty list of strings')
            elif key == 'subjects' and set(values) - subjects:
                problem('unknown subject')
            elif key == 'courses' and set(values) - COURSES:
                problem('invalid course tags')
        for key in ['url', 'sourceUrl']:
            if not valid_url(item.get(key)):
                problem(f'invalid {key}')

        review_status = item.get('reviewStatus')
        required_dates = []
        if review_status == 'approved':
            required_dates = ['lastChecked']
        elif review_status in {'automatic', 'pending'}:
            required_dates = ['firstSeen', 'lastSeen']
            if 'lastChecked' not in item or item['lastChecked'] is not None:
                problem(f'{review_status} records require lastChecked: null; discovery is not a human review')
            if not isinstance(item.get('sourceId'), str) or not item['sourceId'].strip():
                problem(f'{review_status} records require sourceId')
        else:
            problem('reviewStatus must be approved, automatic or pending')
        parsed_dates = {}
        for key in ['lastChecked', 'firstSeen', 'lastSeen']:
            value = item.get(key)
            if key not in required_dates and value is None:
                continue
            try:
                activity_date = calendar_date(value)
                parsed_dates[key] = activity_date
                if activity_date > today:
                    problem(f'{key} is in the future')
                if activity_date < MIN_ACTIVITY_DATE:
                    problem(f'{key} predates the supported activity history (2000 onwards)')
            except (ValueError, TypeError):
                problem(f'missing or invalid {key}; expected YYYY-MM-DD')
        if 'firstSeen' in parsed_dates and 'lastSeen' in parsed_dates and parsed_dates['firstSeen'] > parsed_dates['lastSeen']:
            problem('firstSeen must not be after lastSeen')
        try:
            if cutoff(item) != item.get('deadlineAt'):
                problem('deadlineAt differs from local date/time; run --normalise')
        except (ValueError, KeyError, TypeError, OverflowError) as error:
            problem(f'invalid deadline: {error}')
    return errors


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--normalise', action='store_true')
    args = ap.parse_args()
    p = ROOT / 'site/data/opportunities.json'
    data = json.loads(p.read_text())
    config = json.loads((ROOT / 'site/data/sources.json').read_text())
    if args.normalise:
        for item in data['opportunities']:
            item['deadlineAt'] = cutoff(item)
    errors = validate(data, config)
    if errors:
        print('\n'.join(errors))
        sys.exit(1)
    if args.normalise:
        p.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    print(f"Validated {len(data['opportunities'])} opportunities")
