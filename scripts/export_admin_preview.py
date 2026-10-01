#!/usr/bin/env python3
"""Export a read-only, self-contained preview; no login or network saving."""
import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
html = (SITE / 'admin.html').read_text()
css = (SITE / 'styles.css').read_text() + '\n' + (SITE / 'admin.css').read_text()
for weight in (400, 500, 600, 700):
    font = base64.b64encode((SITE / f'assets/montserrat-{weight}.woff2').read_bytes()).decode()
    css = css.replace(f"url('assets/montserrat-{weight}.woff2')", f"url('data:font/woff2;base64,{font}')")
html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>' + css + '</style>')
html = html.replace('<link rel="stylesheet" href="admin.css">', '')
html = html.replace('<script defer src="admin.js"></script>', '')
html = html.replace('Advert review | Applied Ecology opportunities', 'Admin preview | Applied Ecology opportunities')
html = html.replace('id="admin-title">Advert review', 'id="admin-title">Advert review preview')
queue = json.loads((ROOT / 'data/review-queue.json').read_text())
candidates = queue.get('candidates', [])
payload = json.dumps(candidates, ensure_ascii=False).replace('<', '\\u003c')
script = re.sub(r'initAdmin\(\);\s*$', '', (SITE / 'admin.js').read_text())
bootstrap = '''
adminInitTheme();
adminState.candidates=PREVIEW_CANDIDATES;
adminState.busy=true;
adminElement('signed-out').hidden=true;
adminElement('admin-workspace').hidden=false;
adminElement('signed-in-user').textContent='Read-only preview';
adminElement('admin-repository').textContent=ADMIN_REPOSITORY;
adminElement('queue-search').addEventListener('input',adminRenderQueue);
adminNotice('Preview only. Sign-in and decision controls are disabled. After setup, the portal saves approvals and rejections to GitHub.','warning');
adminRenderQueue();
adminRenderHistory();
'''.replace('PREVIEW_CANDIDATES', payload)
html = html.replace('</body>', '<script>' + (script + bootstrap).replace('</script', '<\\/script') + '</script></body>')
logo = base64.b64encode((SITE / 'assets/harper-adams-logo.png').read_bytes()).decode()
html = html.replace('src="assets/harper-adams-logo.png"', 'src="data:image/png;base64,' + logo + '"')
html = html.replace('</head>', '<!-- Embedded font licence: ' + (SITE / 'assets/OFL.txt').read_text() + ' --></head>')
output = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / 'Entomology_Admin_Preview.html'
output.write_text(html)
print(output)
