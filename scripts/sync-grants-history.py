#!/usr/bin/env python3
import importlib.util,io,json,re,zipfile
import xml.etree.ElementTree as ET
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urljoin

ROOT=Path(__file__).resolve().parent.parent
BASE_SCRIPT=ROOT/'scripts'/'sync-grants.py'
OUT=ROOT/'data'/'dotace.json'
INDEX='https://www.praha8.cz/Granty-a-dotace.html'

spec=importlib.util.spec_from_file_location('grants_base',BASE_SCRIPT)
base=importlib.util.module_from_spec(spec); spec.loader.exec_module(base)

SPECIAL_2022={
  'Kultura':{'page':'https://www.praha8.cz/appo/usn/676?usn=8NMdXKPRbAYyZD5cJQjUhA%3D%3D','mirrorPage':'https://praha8.online/rada/usneseni/2022/0192/','publicPage':'https://www.praha8.cz/Granty-Kultura-2022','resolutionId':'Usn RMC 0192/2022','resolutionDate':'2022-04-11','decisionBody':'Rada','multi':True,'required':True},
  'Volnočasové aktivity dětí a mládeže':{'page':'https://www.praha8.cz/appo/usn/676?usn=4l5GcSBZF3Dl0Si8wY3pbxpl4IKg%3D%3D','mirrorPage':'https://praha8.online/rada/usneseni/2022/0193/','publicPage':'https://www.praha8.cz/Granty-Volnocasove-nesportovni-aktivity-2022','resolutionId':'Usn RMC 0193/2022','resolutionDate':'2022-04-11','decisionBody':'Rada','multi':True,'required':True},
  'Sportovní výchova mládeže':{'page':'https://www.praha8.cz/appo/usn/676?usn=biy50w2GILPPbOjWCETdhw%3D%3D','mirrorPage':'https://praha8.online/rada/usneseni/2022/0203/','publicPage':'https://www.praha8.cz/Granty-Sportovni-vychova-mladeze-2022','resolutionId':'Usn RMC 0203/2022','resolutionDate':'2022-04-20','decisionBody':'Rada','multi':True,'required':True},
  'Sociální oblast':{'page':'https://www.praha8.cz/appo/usn/676?usn=LFMBDOBTy5eWHsComlKmZw%3D%3D','mirrorPage':'https://praha8.online/rada/usneseni/2022/0244/','publicPage':'https://www.praha8.cz/Dotace-v-socialni-oblasti-2022','resolutionId':'Usn RMC 0244/2022','resolutionDate':'2022-05-04','decisionBody':'Rada','multi':True,'required':True},
}

def html_links(url):
  p=base.LinkParser(); p.feed(base.fetch_text(url))
  return [(base.norm_text(text),urljoin(url,href)) for href,text in p.links if href]

def index_pages():
  out={}
  for label,href in html_links(INDEX):
    clean=re.sub(r'\s+',' ',label).strip().lower(); m=re.search(r'(20\d{2})$',clean)
    if not m: continue
    year=int(m.group(1))
    if 'granty' in clean and 'kultura' in clean and 'volnočas' not in clean: out[('Kultura',year)]=href
    elif 'volnočas' in clean: out[('Volnočasové aktivity dětí a mládeže',year)]=href
    elif 'sportovní výchova mládeže' in clean: out[('Sportovní výchova mládeže',year)]=href
    elif 'dotace v sociální oblasti' in clean: out[('Sociální oblast',year)]=href
    elif 'sport pro dospělé' in clean or 'tělovýchovná činnost dospělých' in clean: out[('Sport dospělí a dorost',year)]=href
    elif 'mikrogranty' in clean and 'veřejný prostor' in clean: out[('Zvelebování vzhledu MČ Praha 8',year)]=href
    elif 'mikrogranty' in clean and 'vnitrobloky' in clean: out[('Zvelebování vzhledu MČ Praha 8 – vnitrobloky',year)]=href
  return out

def build_sources():
  pages=index_pages(); sources=[]
  for year in range(2019,2026):
    for area in ['Kultura','Volnočasové aktivity dětí a mládeže','Sportovní výchova mládeže']:
      if year==2022: sources.append({'year':year,'area':area,'kind':'xlsx',**SPECIAL_2022[area]}); continue
      page=pages.get((area,year))
      if page: sources.append({'year':year,'area':area,'page':page,'kind':'xlsx','required':year in {2023,2024,2025}})
  sources.append({'year':2025,'area':'Sociální oblast','page':'https://m.praha8.cz/appo/usn/676?usn=9LcW1pbxsh2gqAagwwqNdwnaZHIw%3D%3D','publicPage':'https://www.praha8.cz/Dotace-v-socialni-oblasti-2025','kind':'xlsx','required':True,'decisionBody':'Rada','resolutionId':'Usn RMC 0264/2025','resolutionDate':'2025-06-11','multi':True})
  sources.append({'year':2022,'area':'Sociální oblast','kind':'xlsx',**SPECIAL_2022['Sociální oblast']})
  for year in range(2014,2019):
    page=pages.get(('Sport dospělí a dorost',year))
    if page: sources.append({'year':year,'area':'Sport dospělí a dorost','page':page,'kind':'xlsx','required':False,'multi':True})
  page=pages.get(('Zvelebování vzhledu MČ Praha 8',2016))
  if page: sources.append({'year':2016,'area':'Zvelebování vzhledu MČ Praha 8','page':page,'kind':'docx','required':False})
  page=pages.get(('Zvelebování vzhledu MČ Praha 8 – vnitrobloky',2016))
  if page: sources.append({'year':2016,'area':'Zvelebování vzhledu MČ Praha 8','page':page,'kind':'docx','required':False})
  return sources

def rank_files(source,url):
  ext='.'+source.get('kind','xlsx').lower(); ranked=[]
  for label,href in html_links(url):
    low=(label+' '+href).lower()
    if ext not in href.lower() and ext not in low: continue
    score=0
    if 'poskytnut' in low: score+=5
    if 'výsled' in low or 'vysled' in low: score+=6
    if 'příloh' in low or 'priloh' in low: score+=2
    if source.get('resolutionId') and ('xlsx' in low or 'příloha' in low or 'priloha' in low): score+=4
    if 'vyúčt' in low or 'vyuct' in low: score-=8
    if 'žádost' in low or 'zadost' in low or 'podmín' in low or 'podmin' in low or 'smlouv' in low: score-=6
    ranked.append((score,href,label))
  return ranked

def discover_files(source):
  ranked=[]
  for url in [source.get('page'),source.get('mirrorPage')]:
    if not url: continue
    try:
      found=rank_files(source,url)
      if found:
        ranked=found
        break
    except Exception:
      continue
  if not ranked:return []
  ranked.sort(key=lambda x:x[0],reverse=True)
  if source.get('multi'):
    best=max(x[0] for x in ranked); return [(href,label) for score,href,label in ranked if score>=max(best-1,0)]
  _,href,label=ranked[0]; return [(href,label)]

def read_payload():
  if not OUT.exists(): raise RuntimeError('Chybí data/dotace.json')
  return json.loads(OUT.read_text(encoding='utf-8'))

def parse_rows(source,file_url,rows,parser_name):
  hi=base.find_header(rows)
  if hi is None:
    for i,row in enumerate(rows[:30]):
      t=' | '.join(base.norm_text(x).lower() for x in row)
      social_header=('název organizace' in t or 'nazev organizace' in t) and ('návrh dk' in t or 'navrh dk' in t)
      generic_header=any(k in t for k in ['žadatel','zadatel','příjemce','prijemce','organizace']) and any(k in t for k in ['částka','castka','dotace','schválen','schvalen','přidělen','pridelen'])
      if social_header or generic_header: hi=i; break
  if hi is None: raise RuntimeError('nenalezeno záhlaví tabulky')
  header=[base.norm_text(x).lower() for x in rows[hi]]; recipient=approved=ico=project=requested=None
  for i,x in enumerate(header):
    if recipient is None and any(k in x for k in ['žadatel','zadatel','název klubu','nazev klubu','organizace','příjemce','prijemce','název žadatele','nazev zadatele','název organizace','nazev organizace','subjekt']): recipient=i
    if ico is None and ('ič' in x or 'ico' in x): ico=i
    if project is None and any(k in x for k in ['projekt','účel','ucel','název akce','nazev akce','záměr','zamer']): project=i
    if requested is None and ('požad' in x or 'pozad' in x): requested=i
    if approved is None and any(k in x for k in ['schválen','schvalen','poskytnut','přidělen','pridelen','částka','castka','dotace','výše','vyse','návrh dk','navrh dk']): approved=i
  if recipient is None or approved is None: raise RuntimeError('parser nenašel příjemce/částku; záhlaví: '+repr(header))
  grants=[]
  for row in rows[hi+1:]:
    get=lambda idx: row[idx] if idx is not None and idx<len(row) else ''
    name,ico_value=base.split_recipient_ico(get(recipient),get(ico)); amount=base.money(get(approved))
    if not name or amount is None or amount<=0: continue
    grants.append({'year':source['year'],'area':source['area'],'type':'dotační řízení','recipient':name,'ico':ico_value,'project':base.norm_text(get(project)),'requestedCzk':base.money(get(requested)),'approvedCzk':amount,'decisionBody':source.get('decisionBody'),'resolutionId':source.get('resolutionId'),'resolutionDate':source.get('resolutionDate'),'resolutionUrl':source.get('page') if source.get('resolutionId') else None,'sourcePage':source.get('publicPage') or source['page'],'sourceFile':file_url})
  if not grants: raise RuntimeError('parser nenačetl žádné kladné částky')
  return grants,{'headerRow':hi+1,'rows':len(grants),'parser':parser_name}

def docx_rows(blob):
  z=zipfile.ZipFile(io.BytesIO(blob)); root=ET.fromstring(z.read('word/document.xml'))
  ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}; rows=[]
  for tr in root.findall('.//w:tr',ns):
    row=[]
    for tc in tr.findall('./w:tc',ns): row.append(base.norm_text(' '.join(t.text or '' for t in tc.findall('.//w:t',ns))))
    if any(row): rows.append(row)
  return rows

def parse_source(source,file_url,blob):
  if source.get('kind')=='docx': return parse_rows(source,file_url,docx_rows(blob),'historical-docx')
  try:return base.parse_program(source,file_url,blob)
  except Exception:return parse_rows(source,file_url,base.xlsx_rows(blob),'historical-flex')

def dedupe(rows):
  out=[]; seen=set()
  for g in rows:
    key=(g.get('year'),g.get('area'),g.get('ico') or g.get('recipient','').lower(),g.get('project','').lower(),g.get('approvedCzk'))
    if key not in seen: seen.add(key); out.append(g)
  return out

def main():
  payload=read_payload(); historical=[]; source_meta=[]; failures=[]; warnings=[]; loaded_keys=set()
  for source in build_sources():
    try:
      files=discover_files(source)
      if not files: raise RuntimeError('nenalezen výsledkový '+source.get('kind','xlsx').upper()+' soubor')
      source_rows=[]; qas=[]
      for file_url,label in files:
        grants,qa=parse_source(source,file_url,base.fetch_bytes(file_url)); source_rows.extend(grants); qas.append({**qa,'file':file_url,'label':label})
      source_rows=dedupe(source_rows); historical.extend(source_rows); loaded_keys.add((source['year'],source['area']))
      source_meta.append({**source,'files':[x[0] for x in files],'status':'načteno','qa':qas,'rows':len(source_rows)})
      print(f"✅ {source['area']} {source['year']}: {len(source_rows)} dotací")
    except Exception as exc:
      msg=f"{source['area']} {source['year']}: {exc}"; source_meta.append({**source,'status':'čeká na doplnění','error':str(exc)})
      if source.get('required'): failures.append(msg); print('❌',msg)
      else: warnings.append(msg); print('⚠️',msg)
  if failures: raise RuntimeError('Historický import odmítnut: '+'; '.join(failures))
  historical=dedupe(historical)
  if not any(g['year']==2022 for g in historical): raise RuntimeError('Rok 2022 se nenačetl ani částečně.')

  current=[g for g in payload.get('grants',[]) if (int(g.get('year') or 0),g.get('area')) not in loaded_keys]
  combined=dedupe(current+historical)
  old_sources=[s for s in payload.get('sources',[]) if (int(s.get('year') or 0),s.get('area')) not in loaded_keys]
  all_warnings=[w for w in (payload.get('meta',{}).get('warnings') or []) if 'histor' not in w.lower()]+warnings
  ares_qa=base.enrich_ares(combined,all_warnings)
  combined.sort(key=lambda x:(-int(x.get('year') or 0),x.get('area',''),x.get('recipient','').lower(),-(x.get('approvedCzk') or 0)))
  years=sorted({int(g['year']) for g in combined},reverse=True); counts={str(y):sum(1 for g in combined if int(g['year'])==y) for y in years}
  payload['schema']=7; payload['updated']=datetime.now(timezone.utc).isoformat(); payload['sources']=old_sources+source_meta; payload['grants']=combined
  payload['meta']={**payload.get('meta',{}),'records':len(combined),'years':years,'areas':sorted({g.get('area','') for g in combined if g.get('area')}),'warnings':all_warnings,'ares':ares_qa,'historyCounts':counts,'historyLoadedKeys':[f'{y}|{a}' for y,a in sorted(loaded_keys,key=lambda x:(-x[0],x[1]))],'note':'Historické dotace se načítají z oficiálního rozcestníku Granty a dotace a z výsledkových příloh. Každý zveřejněný záznam odkazuje na primární zdroj MČ Praha 8. Neúspěch jednoho starého formátu nemaže dříve publikovaná data.'}
  base.atomic_write_json(OUT,payload)
  print('\n✅ HOTOVO:',len(combined),'záznamů; roky',years)

if __name__=='__main__': main()
