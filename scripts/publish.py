"""Turn current, matched source listings into explicitly automatic public records."""
import copy
import hashlib
import re
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

from validate import MIN_ACTIVITY_DATE, TYPES, calendar_date, cutoff, valid_url

LONDON = ZoneInfo('Europe/London')
GROUP_PATTERNS = {
    'Insect biology & behaviour': r'entomolog|insect|arthropod|arachnid|drosophila',
    'Crop protection & IPM': r'integrated pest|\bipm\b|crop|plant health|patholog|agronom|weed|nematolog|pest manage',
    'Biological control': r'biological control|biocontrol|parasitoid|entomopathogen|biopesticid',
    'Ecology & conservation': r'ecolog|conserv|biodivers|habitat|nature recovery|ukhab|agroforest',
    'Pollination & beneficial insects': r'pollinat|\bbees?\b|bumblebee|apicultur|ecosystem service',
    'Taxonomy & biodiversity recording': r'taxonom|biological record|biodiversity data|records centre|species ident|systematic|collection|botanic|bryophyt|lichen|mycolog|record validation|metabarcod',
    'Vectors & veterinary entomology': r'medical entom|veterinary entom|vector biology|vector-borne|mosquit|\bticks?\b',
    'Monitoring & environmental risk': r'monitor|\bq?gis\b|edna|ecotoxic|statistic|remote sens|environmental risk|field technician|research technician|ecological data|citizen|modelling',
}


def canonical(url):
    parsed = urlsplit(url)
    query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True)
             if not key.lower().startswith('utm_') and key.lower() not in {'fbclid', 'gclid', 'from_rss'}]
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip('/') or '/',
                       urlencode(sorted(query)), ''))


def aliases(item):
    values = [item.get('url'), *(item.get('provenance') or [])]
    return {canonical(url) for url in values if valid_url(url)}


def text(value, fallback=''):
    return ' '.join(value.split()) if isinstance(value, str) and value.strip() else fallback


def actual_date(value, today):
    try:
        parsed = calendar_date(value)
        return value if MIN_ACTIVITY_DATE <= parsed <= today else None
    except (TypeError, ValueError):
        return None


def classification(listing, config):
    groups = config.get('keywordGroups', [])
    terms = list(dict.fromkeys(text(term) for term in listing.get('matchedTerms', []) if text(term)))
    searchable = ' '.join([listing['title'], *terms]).casefold()
    # Regex evidence is used only for category hints; it is never displayed as advert prose.
    patterns = ' '.join(listing.get('matchedPatterns', []))
    pattern_words = re.sub(r'\\[bBwWsSdD]', ' ', patterns).casefold()
    evidence = searchable + ' ' + pattern_words
    selected = []
    for group in groups:
        name = group['name']
        term_match = any(re.search(r'(?<!\w)' + re.escape(term.casefold()) + r'(?!\w)', searchable)
                         for term in group.get('terms', []) if isinstance(term, str) and term)
        heuristic = GROUP_PATTERNS.get(name)
        if term_match or (heuristic and re.search(heuristic, evidence)):
            selected.append(name)
    if not selected and groups:
        selected = [groups[0]['name']]
    courses = set()
    insect_match = bool(re.search(r'entomolog|insect|arthropod|invertebrate|arachnid|drosophila|butterfl|moth|mosquit|bumblebee', evidence))
    for name in selected:
        if name in {'Insect biology & behaviour', 'Vectors & veterinary entomology'}:
            courses.add('entomology')
        elif name == 'Crop protection & IPM':
            courses.add('ipm')
        elif name == 'Biological control':
            courses.update(['entomology', 'ipm'])
        elif name in {'Ecology & conservation', 'Pollination & beneficial insects'}:
            courses.update(['entomology', 'biological-recording'])
        elif name in {'Taxonomy & biodiversity recording', 'Monitoring & environmental risk'}:
            courses.add('biological-recording')
            if insect_match:
                courses.add('entomology')
        elif re.search(r'taxonom|record|ecolog|monitor', name, re.I):
            courses.add('biological-recording')
        elif re.search(r'ipm|crop|pest', name, re.I):
            courses.add('ipm')
        else:
            courses.add('entomology')
    if insect_match:
        courses.add('entomology')
    return selected, sorted(courses), terms[:4] or ['Source match']


def source_deadline(listing, previous=None):
    value = listing.get('deadlineSuggestion')
    if value:
        try:
            calendar_date(value)
            return {'deadline': value, 'deadlineAt': cutoff({'deadline': value}),
                    'deadlineTimezone': 'Europe/London',
                    'deadlineLabel': value + ' · source date; confirm closing time',
                    'dateBasis': text(listing.get('deadlineEvidence'), 'Date supplied by source; closing time not supplied.')}
        except (ValueError, TypeError, OverflowError):
            pass
    if previous and previous.get('deadline'):
        return {key: previous.get(key) for key in ['deadline', 'deadlineAt', 'deadlineTimezone',
                                                  'deadlineTime', 'deadlineLabel', 'dateBasis'] if key in previous}
    return {'deadline': None, 'deadlineAt': None, 'deadlineLabel': 'Closing date not supplied',
            'dateBasis': 'No closing date supplied by the source listing.'}


def expired(record, now):
    if not record.get('deadlineAt'):
        return False
    try:
        return datetime.fromisoformat(record['deadlineAt']) <= now
    except (TypeError, ValueError):
        return True


def automatic_record(listing, config, today, previous=None, pending=None):
    previous, pending = previous or {}, pending or {}
    url = canonical(listing['url'])
    subjects, courses, tags = classification(listing, config)
    # A current listing is fresh evidence today, independently of feed publication dates.
    first_seen = actual_date(previous.get('firstSeen'), today)
    if not first_seen:
        dates = [value for item in [listing, pending]
                 if (value := actual_date(item.get('firstSeen'), today))]
        first_seen = min(dates, default=today.isoformat())
    deadline = source_deadline(listing, previous)
    source_name = text(listing.get('source'), 'Source not supplied')
    topic_text = ', '.join(tags) if tags != ['Source match'] else 'the source’s specialist opportunity listing'
    record = dict(previous)
    for key in ['_screenText', 'description', 'evidenceSnippet']:
        record.pop(key, None)
    # Explicit placeholders ensure a missing source field does not become an invented fact.
    record.update({
        'id': previous.get('id') or 'auto-' + hashlib.sha256(url.encode()).hexdigest()[:16],
        'title': text(listing['title']), 'url': url,
        'organisation': text(listing.get('organisation'), 'Organisation not supplied'),
        'location': text(listing.get('location'), 'Location not supplied'),
        'country': text(listing.get('country'), 'Not supplied'),
        'workplace': text(listing.get('workplace'), 'Workplace not supplied'),
        'funding': text(listing.get('funding'), 'Not supplied'),
        'compensation': text(listing.get('compensation'), 'Not supplied'),
        'eligibility': text(listing.get('eligibility'), 'Check original advert for eligibility'),
        'careerLevel': text(listing.get('careerLevel'), 'Not supplied'),
        'type': listing.get('suggestedType') if listing.get('suggestedType') in TYPES else 'other',
        'classificationInferred': True,
        'summary': f'Automatically collected from {source_name}. Matched: {topic_text}. See the original advert for full details.',
        'fitReason': f'Source terms connect this advert to {", ".join(subjects)}.',
        'source': source_name, 'sourceId': listing['sourceId'], 'sourceUrl': listing['sourceUrl'],
        'reviewStatus': 'automatic', 'lastChecked': None, 'firstSeen': first_seen, 'lastSeen': today.isoformat(),
        'subjects': subjects, 'courses': courses, 'tags': tags,
        'relevanceTier': 'Core subject' if listing.get('relevanceStrength') == 'direct' else 'Related field',
        'status': 'open' if deadline['deadline'] else 'open-no-deadline',
        'provenance': sorted(aliases(previous) | aliases(listing)),
    })
    # A replacement date-only hint must not retain an old explicit cutoff time.
    for key in ['deadline', 'deadlineAt', 'deadlineTimezone', 'deadlineTime', 'deadlineLabel', 'dateBasis']:
        record.pop(key, None)
    record.update(deadline)
    return record


def active(record, now, today):
    if record.get('reviewStatus') not in {'approved', 'automatic'} or record.get('status') in {'closed', 'withdrawn'} or expired(record, now):
        return False
    value = actual_date(record.get('lastSeen') or record.get('lastChecked'), today)
    return bool(value and (today - calendar_date(value)).days <= 30)


def valid_listing(listing):
    return (isinstance(listing, dict) and bool(text(listing.get('title'))) and
            bool(text(listing.get('sourceId'))) and valid_url(listing.get('url')) and
            valid_url(listing.get('sourceUrl')))


def held_candidate(record):
    """Recover minimal discovery metadata from a previously automatic record."""
    candidate = {key: copy.deepcopy(record[key]) for key in [
        'title', 'url', 'source', 'sourceId', 'sourceUrl', 'firstSeen', 'lastSeen', 'provenance',
        'organisation', 'location', 'country', 'workplace', 'compensation', 'funding', 'eligibility', 'careerLevel'
    ] if key in record}
    candidate.update(matchedTerms=[term for term in record.get('tags', []) if term != 'Source match'],
                     matchedPatterns=[], suggestedType=record.get('type', 'other'),
                     reviewStatus='pending', relevanceStrength='needs-context',
                     reason='Confirm whether this related-field opportunity is relevant before publication.')
    if record.get('deadline'):
        candidate.update(deadlineSuggestion=record['deadline'], deadlineEvidence=record.get('dateBasis', 'Source date'))
    return candidate


def consume_decisions(records, queue, config, now, today):
    """Apply backend-validated snapshots once, before processing newer feed sightings."""
    counts = {'applied': 0, 'ignored': 0, 'published': 0}
    seen_ids = set()
    for decision in queue.get('decisions', []):
        if not isinstance(decision, dict):
            continue
        identifier = decision.get('id')
        duplicate = isinstance(identifier, str) and identifier in seen_ids
        if isinstance(identifier, str):
            seen_ids.add(identifier)
        if decision.get('resolutionStatus') in {'applied', 'ignored'}:
            continue

        def resolve(applied, reason):
            decision.update(resolutionStatus='applied' if applied else 'ignored',
                            resolvedAt=now.isoformat(), resolutionReason=reason)
            counts['applied' if applied else 'ignored'] += 1

        snapshot = decision.get('expectedCandidate')
        action = decision.get('action')
        if (duplicate or not text(identifier) or action not in {'approve', 'reject'} or
                not text(decision.get('decidedBy')) or not isinstance(snapshot, dict) or
                not valid_url(decision.get('advertUrl')) or not valid_url(snapshot.get('url'))):
            resolve(False, 'Invalid or duplicate decision metadata.')
            continue
        key = canonical(decision['advertUrl'])
        if key != canonical(snapshot['url']):
            resolve(False, 'Decision URL does not match its candidate snapshot.')
            continue
        try:
            decided_at = datetime.fromisoformat(decision['decidedAt'])
            if decided_at.tzinfo is None or decided_at > now:
                raise ValueError('Decision timestamp must be timezone-aware and not future.')
        except (KeyError, TypeError, ValueError):
            resolve(False, 'Invalid decision timestamp.')
            continue
        candidates = [item for item in queue.get('candidates', []) if key in aliases(item)]
        excluded = {alias for item in queue.get('excluded', []) for alias in aliases(item)}
        keys = aliases(snapshot) | {key}
        for item in candidates:
            keys.update(aliases(item))
        indexes = [index for index, item in enumerate(records) if aliases(item) & keys]
        if not candidates or keys & excluded or len(indexes) > 1:
            resolve(False, 'Candidate is no longer pending, is excluded, or has conflicting published aliases.')
            continue
        index = indexes[0] if indexes else None
        previous = records[index] if index is not None else None
        if previous and previous.get('reviewStatus') == 'approved':
            resolve(False, 'An existing manually approved record is preserved.')
            continue
        if previous and previous.get('status') in {'closed', 'withdrawn'}:
            resolve(False, 'A closed or withdrawn record cannot be republished by this decision.')
            continue
        audit = {name: decision[name] for name in ['id', 'action', 'decidedBy', 'decidedAt']}
        if action == 'reject':
            queue.setdefault('excluded', []).append({
                'url': key, 'title': text(snapshot.get('title'), 'Rejected opportunity'),
                'provenance': sorted(keys), 'reason': text(decision.get('reason'), 'Rejected by reviewer.'),
                'decisionId': identifier, 'decidedBy': decision['decidedBy'], 'decidedAt': decision['decidedAt']})
            if previous:
                previous['status'] = 'withdrawn'
                previous.setdefault('reviewAudit', []).append(audit)
            resolve(True, 'Candidate excluded; any matching held record was withdrawn.')
        else:
            sighting = actual_date(snapshot.get('lastSeen'), today)
            if not valid_listing(snapshot) or not sighting or (today - calendar_date(sighting)).days > 30:
                resolve(False, 'Approval requires complete source metadata and a source sighting within 30 days.')
                continue
            if decided_at.astimezone(LONDON).date() < MIN_ACTIVITY_DATE:
                resolve(False, 'Decision date predates the supported review history.')
                continue
            reviewed_snapshot = dict(snapshot)
            reviewed_snapshot['firstSeen'] = actual_date(snapshot.get('firstSeen'), today) or sighting
            record = automatic_record(reviewed_snapshot, config, today, previous, reviewed_snapshot)
            record['lastSeen'] = sighting
            record['firstSeen'] = min(record['firstSeen'], sighting)
            # Newer feed evidence may already establish expiry; never revive a known expired advert.
            known_expired = expired(record, now) or any(expired(source_deadline(item, previous), now) for item in candidates)
            if not record['subjects'] or not record['courses'] or known_expired:
                resolve(False, 'The advert has a known expired deadline or lacks a usable subject classification.')
                continue
            record.update(reviewStatus='approved', lastChecked=decided_at.astimezone(LONDON).date().isoformat())
            record.setdefault('reviewAudit', []).append(audit)
            if index is None:
                records.append(record)
                counts['published'] += 1
            else:
                if previous.get('reviewStatus') == 'pending':
                    counts['published'] += 1
                records[index] = record
            resolve(True, 'The exact candidate snapshot was approved; subsequent sightings preserve its reviewed fields.')
        queue['candidates'] = [item for item in queue.get('candidates', []) if not aliases(item) & keys]
    return counts


def publish_matches(data, queue, health, config, now=None):
    """Return new state; only current collector evidence may create or refresh adverts."""
    data, queue, health = copy.deepcopy(data), copy.deepcopy(queue), copy.deepcopy(health)
    listings = health.pop('_listings', [])
    mode = config.get('publication', {}).get('mode')
    if mode not in {'automatic', 'hybrid'}:
        return data, queue, health
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    today = now.astimezone(LONDON).date()
    records = data.setdefault('opportunities', [])
    queue.setdefault('candidates', [])
    if mode == 'hybrid':
        for record in records:
            if (record.get('reviewStatus') == 'automatic' and record.get('relevanceTier') == 'Related field'
                    and record.get('status') not in {'closed', 'withdrawn'}):
                record.update(reviewStatus='pending', lastChecked=None)
            if record.get('reviewStatus') == 'pending' and record.get('status') not in {'closed', 'withdrawn'}:
                if not any(aliases(record) & aliases(candidate) for candidate in queue['candidates']):
                    queue['candidates'].append(held_candidate(record))
    decisions = consume_decisions(records, queue, config, now, today)
    public_aliases = {alias: index for index, record in enumerate(records) for alias in aliases(record)}
    excluded = {alias for record in queue.get('excluded', []) for alias in aliases(record)}
    pending = {alias: record for record in queue.get('candidates', []) for alias in aliases(record)}
    direct_keys = set()
    if mode == 'hybrid':
        for listing in listings:
            if valid_listing(listing) and listing.get('relevanceStrength') == 'direct':
                keys = aliases(listing)
                direct_keys.update(keys)
                for key in keys:
                    if key in public_aliases:
                        direct_keys.update(aliases(records[public_aliases[key]]))
    new_count, skipped = decisions['published'], 0
    for listing in listings:
        if not valid_listing(listing):
            skipped += 1
            continue
        keys = aliases(listing)
        if mode == 'hybrid' and listing.get('relevanceStrength') != 'direct' and keys & direct_keys:
            continue  # A weaker duplicate source must not override a current direct match.
        indexes = {public_aliases[key] for key in keys if key in public_aliases}
        if keys & excluded or len(indexes) > 1:
            skipped += 1
            continue
        index = next(iter(indexes), None)
        previous = records[index] if index is not None else None
        if previous and aliases(previous) & excluded:
            skipped += 1
            continue
        if previous and previous.get('status') in {'closed', 'withdrawn'}:
            skipped += 1
            continue
        if previous and previous.get('reviewStatus') == 'approved':
            previous['lastSeen'] = today.isoformat()
            continue
        previous_pending = next((pending[key] for key in keys if key in pending), {})
        record = automatic_record(listing, config, today, previous, previous_pending)
        if not record['subjects'] or not record['courses'] or expired(record, now):
            skipped += 1
            continue
        if mode == 'hybrid' and listing.get('relevanceStrength') != 'direct':
            candidate = {key: copy.deepcopy(value) for key, value in listing.items()
                         if not key.startswith('_') and key not in {'description', 'evidenceSnippet'}}
            candidate.update(firstSeen=record['firstSeen'], lastSeen=today.isoformat(), reviewStatus='pending',
                             reason='Confirm whether this related-field opportunity is relevant before publication.')
            for key in ['reviewNotes', 'discoveredVia']:
                if key in previous_pending:
                    candidate[key] = copy.deepcopy(previous_pending[key])
            queue['candidates'] = [item for item in queue['candidates'] if not aliases(item) & keys] + [candidate]
            for key in keys:
                pending[key] = candidate
            if index is not None:
                record.update(reviewStatus='pending', lastChecked=None)
                records[index] = record
            continue
        if index is None:
            index = len(records)
            records.append(record)
            new_count += 1
        else:
            if previous.get('reviewStatus') == 'pending':
                new_count += 1
            records[index] = record
        for alias in aliases(record):
            public_aliases[alias] = index
    known = {alias for record in records for alias in aliases(record)
             if record.get('reviewStatus') in {'approved', 'automatic'} or record.get('status') in {'closed', 'withdrawn'}}
    queue['candidates'] = [record for record in queue.get('candidates', []) if not aliases(record) & (known | excluded)]
    data['publicationMode'] = mode
    queue['publicationMode'] = mode
    visible = [record for record in records if active(record, now, today)]
    automatic_count = sum(record.get('reviewStatus') == 'automatic' for record in visible)
    good = sum(item.get('status') == 'ok' for item in health.get('sources', []))
    total = len(health.get('sources', []))
    needs_check = sum(item.get('status') == 'needs-check' for item in health.get('links', []))
    health.update(publicationMode=mode, newPublished=new_count, autoPublished=automatic_count,
                  activePublished=len(visible), pendingCandidates=len(queue['candidates']), publicationSkipped=skipped,
                  decisionsApplied=decisions['applied'], decisionsIgnored=decisions['ignored'])
    health['summary'] = (f'{good} of {total} collectors working; {new_count} new adverts; '
                         f'{len(visible)} adverts live ({automatic_count} automatically collected). ')
    if mode == 'hybrid':
        health['summary'] += f'{len(queue["candidates"])} unsure matches awaiting review. '
    health['summary'] += ('Existing advert link checks were not run.' if health.get('linkChecksSkipped')
                          else f'{needs_check} advert links need checking.')
    return data, queue, health
