#!/usr/bin/env python3
"""Export the same board as a single HTML file for offline review."""
import base64,json,re,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
site=root/'site'
html=(site/'index.html').read_text();css=(site/'styles.css').read_text();js=(site/'app.js').read_text()
for weight in [400,500,600,700]:
    font=base64.b64encode((site/f'assets/montserrat-{weight}.woff2').read_bytes()).decode()
    css=css.replace(f"url('assets/montserrat-{weight}.woff2')",f"url('data:font/woff2;base64,{font}')")
html=html.replace('<link rel="stylesheet" href="styles.css">','<style>'+css+'</style>').replace('<script defer src="app.js"></script>','')
payload={f'data/{name}.json':json.loads((site/f'data/{name}.json').read_text()) for name in ['opportunities','sources','health']}
encoded=json.dumps(payload,ensure_ascii=False).replace('<','\\u003c')
bootstrap='const previewData='+encoded+'; window.fetch=async function(url){if(Object.hasOwn(previewData,url))return {ok:true,json:async()=>structuredClone(previewData[url])};return {ok:false};};'
html=html.replace('</head>','<!-- Embedded font licence: '+(site/'assets/OFL.txt').read_text()+' --></head>')
html=html.replace('</body>','<script>'+bootstrap+'\n'+js.replace('</script','<\\/script')+'</script></body>')
logo=base64.b64encode((site/'assets/harper-adams-logo.png').read_bytes()).decode()
html=html.replace('src="assets/harper-adams-logo.png"','src="data:image/png;base64,'+logo+'"')
html=html.replace(' | Opportunities</title>',' | Opportunities preview</title>')
output=Path(sys.argv[1]) if len(sys.argv)>1 else root.parent/'Entomology_Opportunities_Preview.html'
output.write_text(html);print(output)
