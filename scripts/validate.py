#!/usr/bin/env python3
"""Validate reviewed adverts and calculate cutoffs from local source dates."""
import argparse,json,sys
from datetime import datetime,timedelta,date
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[1]
TYPES={'job','phd','mres','internship','volunteering'}
COURSES={'entomology','ipm','biological-recording'}
def cutoff(item):
    if not item.get('deadline'):return None
    d=datetime.fromisoformat(item['deadline'])
    if item.get('deadlineTime'):
        h,m=map(int,item['deadlineTime'].split(':'));d=d.replace(hour=h,minute=m)
    else:d+=timedelta(days=1)
    return d.replace(tzinfo=ZoneInfo(item.get('deadlineTimezone','Europe/London'))).isoformat()
def validate(data,config):
    ids=set();urls=set();errors=[];subjects={x['name'] for x in config['keywordGroups']}
    for i,item in enumerate(data['opportunities']):
        label=item.get('id',f'entry {i}')
        def problem(message):errors.append(f'{label}: {message}')
        for key in ['id','title','organisation','type','location','country','workplace','compensation','eligibility','careerLevel','summary','url','source','lastChecked','subjects','courses','tags','reviewStatus','deadlineLabel']:
            if not item.get(key):problem(f'missing {key}')
        if item.get('id') in ids:problem('duplicate id')
        ids.add(item.get('id'))
        if item.get('url') in urls:problem('duplicate advert URL')
        urls.add(item.get('url'))
        if item.get('type') not in TYPES:problem('unknown type')
        if item.get('reviewStatus')!='approved':problem('public entries must be approved')
        if set(item.get('subjects',[]))-subjects:problem('unknown subject')
        if not isinstance(item.get('courses'),list) or not set(item.get('courses',[]))<=COURSES:problem('invalid course tags')
        for key in ['url','sourceUrl']:
            if urlsplit(item.get(key,'')).scheme not in ['http','https']:problem(f'invalid {key}')
        try:
            reviewed=date.fromisoformat(item['lastChecked'])
            if reviewed>datetime.now(ZoneInfo('Europe/London')).date():problem('review date is in the future')
            if cutoff(item)!=item.get('deadlineAt'):problem('deadlineAt differs from local date/time; run --normalise')
        except (ValueError,KeyError,TypeError) as e:problem(f'invalid date: {e}')
    return errors
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--normalise',action='store_true');args=ap.parse_args()
    p=ROOT/'site/data/opportunities.json';data=json.loads(p.read_text());config=json.loads((ROOT/'site/data/sources.json').read_text())
    if args.normalise:
        for item in data['opportunities']:item['deadlineAt']=cutoff(item)
        p.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
    errors=validate(data,config)
    if errors:print('\n'.join(errors));sys.exit(1)
    print(f"Validated {len(data['opportunities'])} reviewed opportunities")
