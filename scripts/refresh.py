#!/usr/bin/env python3
"""Collect source-listed opportunities; automatic publication never invents a human review."""
import argparse
import hashlib
import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit, urlunsplit, parse_qsl, urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.robotparser import RobotFileParser

ROOT = Path(__file__).resolve().parents[1]
USER_AGENT = 'EntomologyOpportunitiesBot/2.0'
MAX_BYTES = 3_000_000
REDIRECTS = {301, 302, 303, 307, 308}
HASH_METHOD = 'advert-content-v1'


def read(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    temporary.replace(path)


def canonical(url):
    p = urlsplit(url)
    pairs = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True)
             if not k.lower().startswith('utm_') and k.lower() not in {'fbclid', 'gclid', 'from_rss'}]
    return urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path.rstrip('/') or '/', urlencode(sorted(pairs)), ''))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class PoliteClient:
    def __init__(self):
        self.robots = {}
        self.last = {}
        self.opener = build_opener(NoRedirect())

    def raw(self, url, delay=1):
        host = urlsplit(url).netloc
        time.sleep(max(0, delay - (time.monotonic() - self.last.get(host, 0))))
        try:
            req = Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html,application/rss+xml,application/atom+xml,application/xml;q=0.9,text/plain;q=0.9,*/*;q=0.8'})
            with self.opener.open(req, timeout=20) as response:
                if int(response.headers.get('Content-Length', '0')) > MAX_BYTES:
                    raise ValueError('Response too large')
                data = response.read(MAX_BYTES + 1)
                if len(data) > MAX_BYTES:
                    raise ValueError('Response too large')
                return data.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
        finally:
            self.last[host] = time.monotonic()

    def robots_text(self, url, redirects=0):
        try:
            return self.raw(url)
        except HTTPError as error:
            if error.code in REDIRECTS and error.headers.get('Location') and redirects < 5:
                target = urljoin(url, error.headers['Location'])
                if urlsplit(target).scheme not in {'http', 'https'}:
                    raise ValueError('Unsupported robots redirect')
                return self.robots_text(target, redirects + 1)
            raise

    def rules(self, url):
        p = urlsplit(url)
        origin = f'{p.scheme}://{p.netloc}'
        if origin not in self.robots:
            try:
                raw = self.robots_text(origin + '/robots.txt')
                if '<html' in raw.lower():
                    raise ValueError('robots.txt returned HTML')
                parser = RobotFileParser()
                parser.parse(raw.splitlines())
                self.robots[origin] = parser
            except HTTPError as error:
                if error.code == 404:
                    parser = RobotFileParser()
                    parser.parse(['User-agent: *', 'Disallow:'])
                    self.robots[origin] = parser
                else:
                    self.robots[origin] = None
            except Exception:
                self.robots[origin] = None
        parser = self.robots[origin]
        if parser is None:
            raise ValueError('robots.txt unavailable; skipped conservatively')
        if not parser.can_fetch(USER_AGENT, url):
            raise ValueError('Disallowed by robots.txt')
        delay = max(1, parser.crawl_delay(USER_AGENT) or parser.crawl_delay('*') or 1)
        rate = parser.request_rate(USER_AGENT) or parser.request_rate('*')
        if rate and rate.requests:
            delay = max(delay, rate.seconds / rate.requests)
        if delay > 60:
            raise ValueError('Long crawl delay; skipped conservatively')
        return delay

    def get(self, url, redirects=0):
        p = urlsplit(url)
        if p.scheme not in {'https', 'http'} or not p.netloc:
            raise ValueError('Unsupported URL')
        try:
            return self.raw(url, self.rules(url))
        except HTTPError as error:
            if error.code in REDIRECTS and error.headers.get('Location') and redirects < 5:
                return self.get(urljoin(url, error.headers['Location']), redirects + 1)
            raise


class Node:
    def __init__(self, tag, attrs=None, parent=None):
        self.tag, self.attrs, self.parent = tag, dict(attrs or []), parent
        self.children = []

    def nodes(self):
        for child in self.children:
            if isinstance(child, Node):
                yield child
                yield from child.nodes()

    def text(self):
        if self.tag in {'script', 'style', 'noscript'}:
            return ''
        return ' '.join(child.text() if isinstance(child, Node) else child for child in self.children)


class Document(HTMLParser):
    """Small tolerant tree, including RES's <a><h3>title</a></h3> markup."""
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('document')
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def plain(html):
    document = Document()
    document.feed(html)
    return ' '.join(document.root.text().split())


def ancestors(node):
    while node.parent:
        node = node.parent
        yield node


def deadline_hint(text):
    match = re.search(r'(?:deadline\s*(?:is|:)|closing\s+date\s*:)\s*(\d{1,2}/\d{1,2}/\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})', text, re.I)
    if not match:
        return {}
    value = match.group(1)
    for fmt in ['%d/%m/%Y', '%d/%m/%y', '%d %b %Y', '%d %B %Y']:
        try:
            return {'deadlineSuggestion': datetime.strptime(value, fmt).date().isoformat(), 'deadlineEvidence': match.group(0)}
        except ValueError:
            pass
    return {}


def location_fields(location):
    """Normalise an explicitly supplied place; never assume UK from the provider."""
    fields = {'location': location.strip(' ,.')}
    country_patterns = [
        (r'\b(?:UK|United Kingdom|England|Scotland|Wales|Northern Ireland)\b', 'United Kingdom'),
        (r'\b(?:USA|United States)\b', 'United States'),
    ] + [(r'\b' + re.escape(country) + r'\b', country) for country in
         ['Germany', 'Netherlands', 'Sweden', 'France', 'Switzerland', 'Austria', 'Belgium',
          'Denmark', 'Norway', 'Australia', 'Canada', 'Ireland', 'Costa Rica', 'South Africa', 'New Zealand', 'Spain', 'Italy']]
    for pattern, country in country_patterns:
        if re.search(pattern, location, re.I):
            fields['country'] = country
            break
    if re.search(r'\bhybrid\b', location, re.I):
        fields['workplace'] = 'Hybrid'
    elif re.search(r'\bremote\b', location, re.I):
        fields['workplace'] = 'Remote'
    return fields


def feed_metadata(description, source):
    """Read environmentjob's compact organisation/place/pay header, not advert prose."""
    if source['id'] not in {'environmentjob', 'environmentjob-volunteering'}:
        employer = source.get('employerName')
        return {'organisation': employer} if employer else {}
    marker = re.search(r'£|\b(?:Voluntary|Unpaid|Competitive salary)\b', description, re.I)
    if not marker:
        return {}
    header = description[:marker.start()].strip(' ,.')
    parts = header.split(', ', 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return {}
    compensation = re.split(r'\.\s+(?=[A-Z])', description[marker.start():], maxsplit=1)[0].strip(' .')[:180]
    return {'organisation': parts[0], 'compensation': compensation, **location_fields(parts[1])}


class HeadingLinks:
    def __init__(self, base):
        self.base, self.links = base, []

    def feed(self, html):
        document = Document()
        document.feed(html)
        for heading in document.root.nodes():
            if heading.tag != 'h3':
                continue
            if any(n.tag in {'nav', 'header', 'footer'} for n in ancestors(heading)):
                continue
            anchor = next((n for n in heading.nodes() if n.tag == 'a' and n.attrs.get('href')), None)
            if anchor is None:
                anchor = next((n for n in ancestors(heading) if n.tag == 'a' and n.attrs.get('href')), None)
            if anchor is None:
                continue
            title = ' '.join(heading.text().split())
            url = canonical(urljoin(self.base, anchor.attrs['href']))
            if not title or urlsplit(url).scheme not in {'http', 'https'}:
                continue
            container = next((n for n in ancestors(heading) if 'opportunity' in n.attrs.get('class', '').split()), heading)
            evidence = ' '.join(container.text().split())
            metadata = {}
            article = next((n for n in container.nodes() if n.tag == 'article'), None)
            if article:
                organisation = next((n for n in article.nodes() if n.tag == 'a'), None)
                if organisation:
                    org = ' '.join(organisation.text().split())
                    metadata['organisation'] = org
                    detail = ' '.join(article.text().split())
                    detail = detail[len(org):].strip() if detail.startswith(org) else detail
                    place = re.match(r'in\s+(.+?)(?:\s+The deadline|\s+Closing date|$)', detail, re.I)
                    if place:
                        metadata.update(location_fields(place.group(1)))
            self.links.append({'title': title, 'url': url, 'evidenceSnippet': evidence[:320], '_screenText': evidence,
                               **metadata, **deadline_hint(evidence)})


def rss_entries(text, base):
    root = ET.fromstring(text)
    local = lambda tag: tag.rsplit('}', 1)[-1]
    if local(root.tag) not in {'rss', 'RDF', 'feed'}:
        raise ValueError('Response is not an RSS or Atom feed')
    found = []
    for item in root.iter():
        if local(item.tag) not in {'item', 'entry'}:
            continue
        fields = {local(child.tag): child for child in item}
        value = lambda key: ''.join(fields[key].itertext()) if key in fields else ''
        title = plain(value('title'))
        link_node = fields.get('link')
        if local(item.tag) == 'entry':
            link_node = next((child for child in item if local(child.tag) == 'link' and child.attrib.get('rel', 'alternate') == 'alternate'), None)
            link = link_node.attrib.get('href', '') if link_node is not None else ''
        else:
            link = value('link')
        description = plain(value('description') or value('summary') or value('content'))
        if not title or not link:
            continue
        url = canonical(urljoin(base, link.strip()))
        if urlsplit(url).scheme not in {'http', 'https'}:
            continue
        found.append({'title': title, 'url': url, 'evidenceSnippet': description[:320], '_screenText': description, **deadline_hint(description)})
    return found


def screen(text, config):
    if any(p.casefold() in text.casefold() for p in config.get('excludedPhrases', [])):
        return []
    return [p for p in config.get('strongPatterns', []) + config.get('contextPatterns', []) if re.search(p, text, re.I)]


def suggested_type(title, source):
    if re.search(r'\bpost[ -]?doc', title, re.I):
        return 'job'
    if re.search(r'\b(?:mobility grants?|writing opportunity|range of roles|research projects)\b', title, re.I):
        return 'other'
    if re.search(r'\bvolunteer(?:ing)?\b', title, re.I):
        return 'volunteering'
    for pattern, kind in [(r'\bph\.?d\b|studentship', 'phd'), (r'\bmres\b', 'mres'), (r'\bintern', 'internship')]:
        if re.search(pattern, title, re.I):
            return kind
    return source.get('defaultType') or {'res-jobs': 'job', 'res-phds': 'phd'}.get(source['id'])


def collect_entries(body, source):
    mode = source.get('mode', 'res-headings')
    if mode == 'res-headings':
        parser = HeadingLinks(source['url'])
        parser.feed(body)
        if not parser.links:
            raise ValueError('No linked advert headings found; check source layout')
        return parser.links
    if mode == 'rss':
        return rss_entries(body, source.get('fetchUrl', source['url']))
    raise ValueError(f'Unsupported automatic collector: {mode}')


def evaluate(entry, source, config):
    text = entry['title'] + ' ' + entry.get('_screenText', '')
    if any(p.casefold() in text.casefold() for p in config.get('excludedPhrases', [])):
        return None
    if any(re.search(p, entry['title'], re.I) for p in config.get('excludedTitlePatterns', [])):
        return None
    matches = screen(text, config)
    if not matches and not source.get('curatedIndex'):
        return None
    direct = any(re.search(p, text, re.I) for p in config.get('strongPatterns', []))
    candidate = {k: v for k, v in entry.items() if not k.startswith('_')}
    terms = []
    for pattern in matches:
        for match in re.finditer(pattern, text, re.I):
            value = match.group(0)
            if value.casefold() not in {x.casefold() for x in terms}:
                terms.append(value)
    candidate['matchedTerms'] = terms[:20]
    if source.get('mode') == 'rss':
        candidate.update(feed_metadata(entry.get('_screenText', ''), source))
        candidate['evidenceSnippet'] = 'Matched source terms: ' + ', '.join(terms[:20])
    candidate.update(source=source['name'], sourceId=source['id'], sourceUrl=source['url'], matchedPatterns=matches,
                     reason='Source listing matched the configured subject scope; follow the original advert for current details.',
                     reviewStatus='pending', relevanceStrength='direct' if direct else 'needs-context')
    kind = suggested_type(entry['title'], source)
    if kind:
        candidate['suggestedType'] = kind
    return candidate


def discover(body, source, config):
    return [candidate for entry in collect_entries(body, source) if (candidate := evaluate(entry, source, config))]


def content_signature(body):
    """Prefer advert JSON-LD; otherwise compare visible page content, not scripts."""
    document = Document()
    document.feed(body)
    def job_objects(value):
        if isinstance(value, list):
            for child in value:
                yield from job_objects(child)
        elif isinstance(value, dict):
            types = value.get('@type', [])
            if isinstance(types, str):
                types = [types]
            if 'JobPosting' in types:
                yield {key: value.get(key) for key in ['title', 'description', 'validThrough', 'employmentType', 'jobLocation', 'baseSalary']}
            for child in value.values():
                if isinstance(child, (dict, list)):
                    yield from job_objects(child)
    adverts = []
    for node in document.root.nodes():
        if node.tag == 'script' and node.attrs.get('type', '').lower() == 'application/ld+json':
            try:
                adverts.extend(job_objects(json.loads(''.join(c for c in node.children if isinstance(c, str)))))
            except (ValueError, TypeError):
                pass
    if adverts:
        value = json.dumps(adverts, sort_keys=True, ensure_ascii=False)
    else:
        main = next((n for n in document.root.nodes() if n.tag == 'main'), None)
        if main is None:
            main = next((n for n in document.root.nodes() if n.tag == 'article'), document.root)
        value = ' '.join(main.text().split())
    return hashlib.sha256(value.encode()).hexdigest()


def refresh(data, config, queue, previous, client, now=None, discovery_only=False, fixture_dir=None):
    now = now or datetime.now(timezone.utc)
    stamp, today = now.isoformat(), now.astimezone(ZoneInfo('Europe/London')).date().isoformat()
    def held(item):
        return item.get('reviewStatus') == 'pending' or (
            config.get('publication', {}).get('mode') == 'hybrid' and
            item.get('reviewStatus') == 'automatic' and item.get('relevanceTier') == 'Related field')
    known = {canonical(u) for item in data['opportunities'] if not held(item)
             for u in [item['url'], *item.get('provenance', [])]}
    excluded = {canonical(url) for item in queue.get('excluded', []) for url in [item['url'], *item.get('provenance', [])]}
    indexed = {canonical(item['url']): dict(item) for item in queue.get('candidates', []) if canonical(item['url']) not in known | excluded}
    public = {item['id']: item for item in data['opportunities']}
    tasks = {item.get('taskKey', item['id'] + ':' + item['kind']): dict(item) for item in queue.get('reviewTasks', [])
             if item.get('reviewStatus', 'pending') == 'pending' and item['id'] in public and public[item['id']].get('status') not in {'closed', 'withdrawn'}}
    health = {'schemaVersion': 3, 'lastRun': stamp, 'sources': [], 'links': [], '_listings': []}
    manifest = read(fixture_dir / 'manifest.json', {}) if fixture_dir else {}
    old_sources = {item['id']: item for item in previous.get('sources', [])}
    new_count = 0
    for source in config['sources']:
        if not source.get('enabled'):
            continue
        state = {'id': source['id'], 'status': 'unavailable', 'lastAttempt': stamp}
        if old_sources.get(source['id'], {}).get('lastSucceeded'):
            state['lastSucceeded'] = old_sources[source['id']]['lastSucceeded']
        try:
            body = (fixture_dir / manifest[source['id']]).read_text() if fixture_dir else client.get(source.get('fetchUrl', source['url']))
            entries = collect_entries(body, source)
            state.update(status='ok', lastSucceeded=stamp, entriesFound=len(entries), candidatesFound=0, newCandidates=0,
                         knownCount=0, excludedCount=0, filteredCount=0, pendingSeen=0, duplicateCount=0, pastDeadlineCount=0)
            seen = set()
            for entry in entries:
                key = canonical(entry['url'])
                if key in seen:
                    state['duplicateCount'] += 1
                    continue
                seen.add(key)
                if key in excluded:
                    state['excludedCount'] += 1
                    continue
                candidate = evaluate(entry, source, config['screening'])
                # Keep this run's sightings for publication and source activity dates.
                if candidate:
                    candidate.update(firstSeen=indexed.get(key, {}).get('firstSeen', today), lastSeen=today)
                    health['_listings'].append(candidate)
                elif key in known:
                    health['_listings'].append({**{k: v for k, v in entry.items() if not k.startswith('_')},
                                               'source': source['name'], 'sourceId': source['id'], 'sourceUrl': source['url'], 'lastSeen': today})
                if key in known:
                    state['knownCount'] += 1
                    continue
                if not candidate:
                    state['filteredCount'] += 1
                    continue
                if candidate.get('deadlineSuggestion', today) < today:
                    state['pastDeadlineCount'] += 1
                    continue
                state['candidatesFound'] += 1
                if key in indexed:
                    state['pendingSeen'] += 1
                    prior = indexed[key]
                    candidate.update({k: v for k, v in prior.items() if k in {'firstSeen', 'reviewNotes'}})
                    candidate.update(lastSeen=today, discoveredVia=sorted(set(prior.get('discoveredVia', []) + [source['id']])))
                    indexed[key] = candidate
                else:
                    candidate.update(firstSeen=today, lastSeen=today, discoveredVia=[source['id']])
                    indexed[key] = candidate
                    state['newCandidates'] += 1
                    new_count += 1
        except Exception as error:
            state.update(status='unavailable', message=str(error)[:240])
        health['sources'].append(state)

    def task(item, kind, reason, **details):
        key = item['id'] + ':' + kind
        record = tasks.get(key, {})
        record.update(taskKey=key, id=item['id'], kind=kind, title=item['title'], url=item['url'], reason=reason,
                      reviewStatus='pending', detectedAt=record.get('detectedAt', stamp), lastSeen=stamp,
                      lastChecked=item['lastChecked'], **details)
        tasks[key] = record

    old_links = {item['id']: item for item in previous.get('links', [])}
    for item in data['opportunities']:
        if item.get('status') in {'closed', 'withdrawn'}:
            continue
        state = {'id': item['id'], 'lastAttempt': stamp}
        old = old_links.get(item['id'], {})
        if old.get('lastSucceeded'):
            state['lastSucceeded'] = old['lastSucceeded']
        if item.get('deadlineAt') and datetime.fromisoformat(item['deadlineAt']) <= now:
            state['status'] = 'past-deadline'
            health['links'].append(state)
            continue
        if item.get('reviewStatus') in {'automatic', 'pending'}:
            # Source presence is the evidence for these records, never a human review.
            aliases = {canonical(u) for u in [item['url'], *item.get('provenance', [])]}
            listed = any(canonical(x['url']) in aliases for x in health['_listings'])
            state.update(status='source-listed' if listed else 'not-seen', lastSeen=item.get('lastSeen'))
            health['links'].append(state)
            continue
        age = (now.date() - datetime.fromisoformat(item['lastChecked']).date()).days
        if age >= 21:
            task(item, 'stale', 'Editorial review is at least 21 days old; confirm that the advert is still open.', reviewAgeDays=age)
        if discovery_only:
            state = dict(old) if old else {'id': item['id'], 'status': 'not-tested'}
            health['links'].append(state)
            continue
        try:
            signature = content_signature(client.get(item['url']))
            changed = old.get('hashMethod') == HASH_METHOD and bool(old.get('contentHash')) and old['contentHash'] != signature
            state.update(status='reachable', lastSucceeded=stamp, contentHash=signature, hashMethod=HASH_METHOD,
                         contentChanged=changed or item['id'] + ':changed' in tasks)
            if changed:
                task(item, 'changed', 'Visible advert content changed; check relevance, eligibility, deadline and whether it remains open.', previousHash=old['contentHash'], currentHash=signature)
        except Exception as error:
            state.update(status='needs-check', message=str(error)[:240])
            task(item, 'unreachable', 'The automated link check could not reach this advert. Check it manually before updating its status.', evidence=state['message'])
        health['links'].append(state)
    queue = dict(queue)
    queue['candidates'] = sorted(indexed.values(), key=lambda x: (x.get('relevanceStrength') != 'direct', x.get('deadlineSuggestion', '9999'), x['title'].casefold()))
    queue['reviewTasks'] = sorted(tasks.values(), key=lambda x: (x['kind'], x['title'].casefold()))
    good = sum(item['status'] == 'ok' for item in health['sources'])
    total = len(health['sources'])
    needs_check = sum(item['status'] == 'needs-check' for item in health['links'])
    health.update(discoveryStatus='ok' if total and good == total else 'partial' if good else 'failed',
                  newCandidates=new_count, pendingCandidates=len(queue['candidates']), reviewTasks=len(queue['reviewTasks']),
                  manualSources=sum(not item.get('enabled') for item in config['sources']), linkChecksSkipped=discovery_only)
    health['summary'] = f'{good} of {total} collectors working; {new_count} new candidates; {len(queue["candidates"])} awaiting editorial review.'
    if discovery_only:
        health['summary'] += ' Existing advert link checks were not run.'
    else:
        health['summary'] += f' {needs_check} advert links need checking.'
    return queue, health


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--offline', action='store_true', help='Validate collector configuration without requests or writes')
    ap.add_argument('--discovery-only', action='store_true', help='Collect candidates without checking existing advert links')
    ap.add_argument('--fixture-dir', type=Path, help='Replay response fixtures with a manifest; never writes')
    args = ap.parse_args()
    config = read(ROOT / 'site/data/sources.json')
    if args.offline:
        for source in config['sources']:
            if source.get('enabled') and source.get('mode') not in {'rss', 'res-headings'}:
                raise ValueError(f'Unsupported collector: {source["id"]}')
        print(json.dumps({'offline': True, 'enabledCollectors': sum(bool(x.get('enabled')) for x in config['sources']), 'writes': False}))
        return
    data = read(ROOT / 'site/data/opportunities.json')
    queue, health = refresh(data, config,
                            read(ROOT / 'data/review-queue.json', {'candidates': [], 'excluded': []}),
                            read(ROOT / 'site/data/health.json', {}), PoliteClient(),
                            discovery_only=args.discovery_only or bool(args.fixture_dir), fixture_dir=args.fixture_dir)
    from publish import publish_matches
    from validate import validate
    data, queue, health = publish_matches(data, queue, health, config)
    queue['publicationMode'] = config.get('publication', {}).get('mode', 'manual')
    errors = validate(data, config)
    if errors:
        raise ValueError('Collected data failed validation: ' + '; '.join(errors))
    if not args.fixture_dir:
        write(ROOT / 'site/data/opportunities.json', data)
        write(ROOT / 'data/review-queue.json', queue)
        write(ROOT / 'site/data/health.json', health)
    print(health['summary'])
    if health['discoveryStatus'] != 'ok':
        print('::warning::Automatic collection is incomplete. Inspect site/data/health.json and the review artifact.')
    if args.fixture_dir:
        print(json.dumps({'writes': False, 'sources': health['sources']}, indent=2))


if __name__ == '__main__':
    main()
