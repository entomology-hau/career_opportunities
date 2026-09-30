import unittest,sys,json
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from refresh import canonical,discover,screen,PoliteClient
from validate import cutoff
ROOT=Path(__file__).resolve().parents[1]
CONFIG=json.loads((ROOT/'site/data/sources.json').read_text())
class RefreshTests(unittest.TestCase):
 def test_word_boundaries(self):
  for title in ['Ticket support assistant','We have been hiring','PESTLE analysis software bugs']:
   self.assertEqual(screen(title,CONFIG['screening']),[],title)
  for title in ['Insect technician','Integrated pest management studentship','Bumblebee surveyor','Biological recording officer','Biodiversity data assistant','Botanical survey technician']:
   self.assertTrue(screen(title,CONFIG['screening']),title)
 def test_heading_discovery_not_navigation(self):
  html='<nav><a href="https://employer.test/nav">Jobs</a></nav><h3><a href="https://employer.test/1">Insect <em>technician</em></a></h3><h3><a href="https://employer.test/2">PhD: crop protection</a></h3>'
  out=discover(html,CONFIG['sources'][0],CONFIG['screening'])
  self.assertEqual(len(out),2);self.assertEqual(out[0]['title'],'Insect technician')
  self.assertTrue(all(x['reviewStatus']=='pending' for x in out))
 def test_canonical_ids_survive(self):
  self.assertEqual(canonical('https://example.org/jobs/?p198653=&utm_source=alert#top'),'https://example.org/jobs?p198653=')
  self.assertNotEqual(canonical('https://example.org/jobs/?p198653='),canonical('https://example.org/jobs/?p198654='))
 def test_noon_and_daylight_saving(self):
  self.assertEqual(cutoff({'deadline':'2026-10-16','deadlineTime':'12:00'}),'2026-10-16T12:00:00+01:00')
  self.assertEqual(cutoff({'deadline':'2026-10-25'}),'2026-10-26T00:00:00+00:00')
  self.assertEqual(cutoff({'deadline':'2026-09-29'}),'2026-09-30T00:00:00+01:00')
 def test_robots_failure_does_not_fetch_listing(self):
  client=PoliteClient()
  with patch.object(client,'raw',side_effect=TimeoutError()) as request:
   with self.assertRaisesRegex(ValueError,'robots.txt unavailable'):client.get('https://employer.test/jobs')
   self.assertEqual(request.call_count,1)
 def test_robots_denial(self):
  client=PoliteClient()
  with patch.object(client,'raw',return_value='User-agent: *\nDisallow: /jobs') as request:
   with self.assertRaisesRegex(ValueError,'Disallowed'):client.get('https://employer.test/jobs')
   self.assertEqual(request.call_count,1)
if __name__=='__main__':unittest.main()
