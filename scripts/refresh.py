#!/usr/bin/env python3
"""Polite discovery and availability checks; NEVER promote or re-verify adverts automatically."""
import argparse, hashlib, json, re, time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit, parse_qsl, urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from urllib.robotparser import RobotFileParser

ROOT=Path(__file__).resolve().parents[1]
USER_AGENT='EntomologyOpportunitiesBot/1.0'
MAX_BYTES=3_000_000


def read(path,default=None):
    return json.loads(path.read_text()) if path.exists() else default


def write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
    temporary.replace(path)


def canonical(url):
    p=urlsplit(url)
    pairs=[(k,v) for k,v in parse_qsl(p.query,keep_blank_values=True) if not k.lower().startswith('utm_') and k.lower() not in ['fbclid','gclid']]
    return urlunsplit((p.scheme.lower(),p.netloc.lower(),p.path.rstrip('/') or '/',urlencode(sorted(pairs)),''))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        return None


class PoliteClient:
    def __init__(self):
        self.robots={};self.last={};self.opener=build_opener(NoRedirect())

    def raw(self,url,delay=1):
        host=urlsplit(url).netloc
        time.sleep(max(0,delay-(time.monotonic()-self.last.get(host,0))))
        try:
            with self.opener.open(Request(url,headers={'User-Agent':USER_AGENT,'Accept':'text/html,application/rss+xml,application/xml;q=0.9'}),timeout=20) as r:
                if int(r.headers.get('Content-Length','0'))>MAX_BYTES:raise ValueError('Response too large')
                data=r.read(MAX_BYTES+1)
                if len(data)>MAX_BYTES:raise ValueError('Response too large')
                return data.decode(r.headers.get_content_charset() or 'utf-8',errors='replace')
        finally:self.last[host]=time.monotonic()

    def rules(self,url):
        p=urlsplit(url);origin=f'{p.scheme}://{p.netloc}'
        if origin not in self.robots:
            try:
                raw=self.raw(origin+'/robots.txt')
                if '<html' in raw.lower():raise ValueError('robots.txt returned HTML')
                parser=RobotFileParser();parser.parse(raw.splitlines());self.robots[origin]=parser
            except HTTPError as e:
                if e.code==404:
                    parser=RobotFileParser();parser.parse(['User-agent: *','Disallow:']);self.robots[origin]=parser
                else:self.robots[origin]=None
            except Exception:self.robots[origin]=None
        parser=self.robots[origin]
        if parser is None:raise ValueError('robots.txt unavailable; skipped conservatively')
        if not parser.can_fetch(USER_AGENT,url):raise ValueError('Disallowed by robots.txt')
        delay=max(1,parser.crawl_delay(USER_AGENT) or parser.crawl_delay('*') or 1)
        if delay>60:raise ValueError('Long crawl delay; skipped conservatively')
        return delay

    def get(self,url,redirects=0):
        p=urlsplit(url)
        if p.scheme not in ['https','http'] or not p.netloc:raise ValueError('Unsupported URL')
        delay=self.rules(url)
        try:return self.raw(url,delay)
        except HTTPError as e:
            if e.code in [301,302,303,307,308] and e.headers.get('Location') and redirects<5:
                return self.get(urljoin(url,e.headers['Location']),redirects+1)
            raise


class HeadingLinks(HTMLParser):
    """RES uses linked h3 advert headings; ignore footer/navigation anchors."""
    def __init__(self,base):
        super().__init__(convert_charrefs=True);self.base=base;self.heading=False;self.anchor=None;self.links=[]
    def handle_starttag(self,tag,attrs):
        if tag=='h3':self.heading=True
        if tag=='a' and self.heading:
            href=dict(attrs).get('href','')
            self.anchor={'url':urljoin(self.base,href),'parts':[]}
    def handle_data(self,text):
        if self.anchor is not None:self.anchor['parts'].append(text)
    def handle_endtag(self,tag):
        if tag=='a' and self.anchor is not None:
            title=' '.join(''.join(self.anchor['parts']).split());url=self.anchor['url']
            if title and urlsplit(url).scheme in ['http','https']:
                self.links.append({'title':title,'url':url})
            self.anchor=None
        if tag=='h3':self.heading=False;self.anchor=None


def screen(title,config):
    if any(p.casefold() in title.casefold() for p in config['excludedPhrases']):return []
    return [p for p in config['strongPatterns']+config['contextPatterns'] if re.search(p,title,re.I)]


def discover(html,source,config):
    parser=HeadingLinks(source['url']);parser.feed(html)
    found=[]
    for entry in parser.links:
        if urlsplit(entry['url']).netloc==urlsplit(source['url']).netloc:continue
        matches=screen(entry['title'],config)
        if matches or source.get('curatedIndex'):
            entry.update({'source':source['name'],'sourceUrl':source['url'],'matchedPatterns':matches,'reason':'Check substantive relevance, type, funding, eligibility and dates before publication.','reviewStatus':'pending'})
            found.append(entry)
    return found


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--offline',action='store_true');args=ap.parse_args()
    data=read(ROOT/'site/data/opportunities.json');config=read(ROOT/'site/data/sources.json');queue=read(ROOT/'data/review-queue.json',{'candidates':[],'excluded':[]})
    previous=read(ROOT/'site/data/health.json',{})
    now=datetime.now(timezone.utc);stamp=now.isoformat();today=now.date().isoformat()
    known={canonical(u) for x in data['opportunities'] for u in [x['url'],*x.get('provenance',[])]}
    known|={canonical(x['url']) for x in queue.get('excluded',[])}
    indexed={canonical(x['url']):x for x in queue['candidates'] if canonical(x['url']) not in known}
    health={'lastRun':stamp,'sources':[],'links':[],'summary':''};client=PoliteClient()
    for source in config['sources']:
        if not source.get('enabled'):continue
        state={'id':source['id'],'status':'not-tested','lastAttempt':stamp}
        old=next((x for x in previous.get('sources',[]) if x['id']==source['id']),{})
        if old.get('lastSucceeded'):state['lastSucceeded']=old['lastSucceeded']
        try:
            if args.offline:raise ValueError('Offline run; source requests not attempted')
            html=client.get(source['url']);entries=discover(html,source,config['screening'])
            if not entries:raise ValueError('No candidate headings found; check source format')
            state.update(status='ok',lastSucceeded=stamp,candidatesFound=len(entries))
            for entry in entries:
                key=canonical(entry['url'])
                if key in known:continue
                if key in indexed:indexed[key]['lastSeen']=today
                else:entry.update(firstSeen=today,lastSeen=today);indexed[key]=entry
        except Exception as e:state.update(status='unavailable',message=str(e)[:200])
        health['sources'].append(state)
    old_links={x['id']:x for x in previous.get('links',[])}
    for item in data['opportunities']:
        state={'id':item['id'],'lastAttempt':stamp}
        if old_links.get(item['id'],{}).get('lastSucceeded'):state['lastSucceeded']=old_links[item['id']]['lastSucceeded']
        if item.get('deadlineAt') and datetime.fromisoformat(item['deadlineAt'])<=now:
            state['status']='past-deadline';health['links'].append(state);continue
        try:
            if args.offline:raise ValueError('Offline run; link request not attempted')
            html=client.get(item['url'])
            state.update(status='reachable',lastSucceeded=stamp,contentHash=hashlib.sha256(html.encode()).hexdigest())
            # Reachable is not the same as open; lastChecked is deliberately untouched.
        except Exception as e:state.update(status='needs-check',message=str(e)[:200])
        health['links'].append(state)
    queue['candidates']=list(indexed.values())
    good=sum(x['status']=='ok' for x in health['sources'])
    unavailable=sum(x['status']=='needs-check' for x in health['links'])
    health['summary']=f'{good} of {len(health["sources"])} discovery sources reached; {unavailable} advert links need checking. New adverts require editorial review.'
    if args.offline:
        print(json.dumps({'offline':True,'summary':health['summary'],'writes':False}));return
    write(ROOT/'data/review-queue.json',queue);write(ROOT/'site/data/health.json',health)
    print(health['summary'])


if __name__=='__main__':main()
