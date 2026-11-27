#!/usr/bin/env python3
"""Prepare a scoped static release using current live config and catalog evidence.
Does not deploy, read credentials, or edit the live host.
"""
import argparse, hashlib, json, re, shutil
from pathlib import Path
import xml.etree.ElementTree as ET
p=argparse.ArgumentParser()
p.add_argument('--evidence',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--release',required=True)
a=p.parse_args()
assert re.fullmatch(r'[a-z0-9-]+',a.release)
root=Path(__file__).resolve().parents[1]
a.output.mkdir(parents=True,exist_ok=False)
site=a.output/'site'
shutil.copytree(root/'promotion'/'Dashboard',site/'Dashboard')
card='''<article class="catalog-card catalog-small"><div class="catalog-card-top"><span class="catalog-index">07 / PROJECT CONTROL</span><span class="catalog-badge">OPEN SOURCE · BETA</span></div><div class="catalog-glyph" aria-hidden="true">▤</div><div class="catalog-card-body"><h3>Fieldboard</h3><p>A self-hosted construction dashboard with verified progress, report approvals, materials, crews and expiring customer reports. Open-source software under the MIT license.</p><a href="/Dashboard">Explore Fieldboard <span aria-hidden="true">↗</span></a></div></article>'''
html=(a.evidence/'open-source.before.html').read_text()
assert 'Explore Fieldboard' not in html and '<div class="catalog-grid">' in html
html=html.replace('<div class="catalog-grid">','<div class="catalog-grid">\n'+card,1)
words={5:'five',6:'six',7:'seven',8:'eight',9:'nine',10:'ten'}
count=len(re.findall(r'<article class="catalog-card',html))
for old in words.values():
 html=html.replace(f'{old} open-source projects',f'{words.get(count,str(count))} open-source projects').replace(f'{old.upper()} PROJECTS / ONE PLACE TO START',f'{words.get(count,str(count)).upper()} PROJECTS / ONE PLACE TO START')
(site/'open-source').mkdir()
(site/'open-source'/'index.html').write_text(html)
namespace='http://www.sitemaps.org/schemas/sitemap/0.9'
ET.register_namespace('',namespace)
sitemap=ET.parse(a.evidence/'sitemap.before.xml').getroot()
urls={node.find(f'{{{namespace}}}loc').text for node in sitemap}
assert 'https://cas-tx.com/Dashboard' not in urls
url=ET.SubElement(sitemap,f'{{{namespace}}}url')
ET.SubElement(url,f'{{{namespace}}}loc').text='https://cas-tx.com/Dashboard'
ET.ElementTree(sitemap).write(site/'sitemap.xml',encoding='utf-8',xml_declaration=True)
public_root=f'/var/www/fieldboard-promotion/releases/{a.release}'
addition=f'''# Fieldboard standalone product page and catalog listing. No application data.
@fieldboard_page path /Dashboard /Dashboard/ /Dashboard/index.html
handle @fieldboard_page {{
  root * {public_root}
  rewrite * /Dashboard/index.html
  header X-Fieldboard-Release {a.release}
  header X-Content-Type-Options nosniff
  header X-Frame-Options SAMEORIGIN
  header Cache-Control "public, max-age=0, must-revalidate"
  file_server
}}
@fieldboard_assets path /Dashboard/fieldboard.css /Dashboard/dashboard.png
handle @fieldboard_assets {{
  root * {public_root}
  header X-Content-Type-Options nosniff
  header Cache-Control "public, max-age=300"
  file_server
}}
@fieldboard_catalog path /open-source /open-source/ /open-source/index.html /sitemap.xml
handle @fieldboard_catalog {{
  root * {public_root}
  header X-Fieldboard-Release {a.release}
  header X-Content-Type-Options nosniff
  header Cache-Control "public, max-age=0, must-revalidate"
  file_server
}}
'''
(a.output/'fieldboard-promotion.caddy').write_text(addition)
before=(a.evidence/'Caddyfile.before').read_text()
assert 'fieldboard-promotion.caddy' not in before
lines=before.splitlines(keepends=True)
removed=[]
for index,line in enumerate(lines):
 if line.strip().startswith('@cas_redesign path '):
  parts=line.strip().split()
  old=parts[2:]
  remove={'/open-source','/open-source/','/open-source/index.html','/sitemap.xml'}
  removed=[x for x in old if x in remove]
  assert set(removed)==remove
  indent=line[:len(line)-len(line.lstrip())]
  lines[index]=indent+' '.join(parts[:2]+[x for x in old if x not in remove])+'\n'
assert len(removed)==4
candidate=''.join(lines).replace('cas-tx.com {\n','cas-tx.com {\n\timport /etc/caddy/fieldboard-promotion.caddy\n',1)
(a.output/'Caddyfile.candidate').write_text(candidate)
sha=lambda data:hashlib.sha256(data).hexdigest()
files={str(p.relative_to(site)):sha(p.read_bytes()) for p in site.rglob('*') if p.is_file()}
manifest={'release':a.release,'public_root':public_root,'before_sha256':sha(before.encode()),'candidate_sha256':sha(candidate.encode()),'new_sitemap_entries':len(sitemap),'retained_sitemap_entries':len(urls),'files':files}
(a.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(a.output/'catalog-card.html').write_text(card+'\n')
print(json.dumps(manifest,indent=2))
