#!/usr/bin/env python3
import importlib.util,json,re
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urljoin

ROOT=Path(__file__).resolve().parent.parent
BASE_SCRIPT=ROOT/'scripts'/'sync-grants.py'
OUT=ROOT/'data'/'dotace.json'

spec=importlib.util.spec_from_file_location('grants_base',BASE_SCRIPT)
base=importlib.util.module_from_spec(spec); spec.loader.exec_module(base)

YEARS=range(2019,2026)
SOURCES=[]
for year in YEARS:
  SOURCES += [
    {'year':year,'area':'Kultura','page':f'https://www.praha8.cz/Granty-Kultura-{year}','kind':'xlsx','required':True},
    {'year':year,'area':'Volnočasové aktivity dětí a mládeže','page':('https://www.praha8.cz/Granty-Volnocasove-nesportovni-aktivity-2020-1' if year==2021 else f'https://www.praha8.cz/Granty-Volnocasove-nesportovni-aktivity-{year}'),'kind':'xlsx','required':year!=2022},
    {'year':year,'area':'Sportovní výchova mládeže','page':('https://www.praha8.cz/Granty-Sportovni-vychova-mladeze-2020-1' if year==2021 else f'https://www.praha8.cz/Granty-Sportovni-vychova-mladeze-{year}'),'kind':'xlsx','required':True},
  ]

SOURCES.append({
  'year':2025,'area':'Sociální oblast','page':'https://m.praha8.cz/appo/usn/676?usn=9LcW1pbxsh2gqAagwwqNdwnaZHIw%3D%3D',
  'publicPage':'https://www.praha8.cz/Dotace-v-socialni-oblasti-2025','kind':'xlsx','required':True,
  'decisionBody':'Rada','resolutionId':'Usn RMC 0264/2025','resolutionDate':'2025-06-11'
})

# Oficiální archiv Prahy 8. Staré ročníky používají směs XLS/XLSX/DOC/PDF, proto je
# nejdřív inventarizujeme a do veřejného datasetu pustíme jen strojově ověřené tabulky.
ARCHIVE_INDEX='https://www.praha8.cz/granty-a-dotace.html'
ARCHIVE_PAGE_PATTERNS=[
  ('Kultura',2009,2018,r'Granty\s*[–-]\s*Kultura\s+(20(?:0[9]|1[0-8]))'),
  ('Volnočasové aktivity dětí a mládeže',2009,2018,r'Granty\s*[–-]\s*Volnočasové nesportovní aktivity\s+(20(?:0[9]|1[0-8]))'),
  ('Sociální oblast',2008,2018,r'(?:Dotace|Granty).*sociální oblasti?\s+(20(?:0[8-9]|1[0-8]))'),
  ('Sport dospělí a dorost',2014,2018,r'Granty\s*[–-]\s*(?:Sport pro dospělé a\s*dorost|Tělovýchovná činnost dospělých)\s+(20(?:1[4-8]))'),
  ('Veřejný prostor',2016,2018,r'Mikrogranty\s*[–-]\s*(?:veřejný prostor|vnitrobloky)\s+(20(?:1[6-8]))'),
]

def read_payload():
  if not OUT.exists(): raise RuntimeError('Chybí data/dotace.json; nejprve spusťte základní import dotací.')
  return json.loads(OUT.read_text(encoding='utf-8'))

def html_links(page_url):
  html=base.fetch_bytes(page_url).decode('utf-8','ignore')
  out=[]
  for m in re.finditer(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',html,re.I|re.S):
    href=urljoin(page_url,m.group(1)); label=re.sub(r'<[^>]+>',' ',m.group(2)); label=base.norm_text(label)
    out.append((label,href))
  return out

def discover_archive_pages():
  pages=[]; seen=set()
  try: links=html_links(ARCHIVE_INDEX)
  except Exception as exc: return [],[f'Archivní rozcestník: {exc}']
  for label,href in links:
    for area,lo,hi,pattern in ARCHIVE_PAGE_PATTERNS:
      m=re.search(pattern,label,re.I)
      if not m: continue
      year=int(m.group(1))
      if lo<=year<=hi and (area,year,href) not in seen:
        seen.add((area,year,href)); pages.append({'year':year,'area':area,'page':href,'label':label})
  # Rozcestník schovává 2008–2018 za souhrnné stránky; přidáme známé stabilní slugy,
  # které web Prahy 8 používá i tehdy, když jednotlivý ročník není přímo v indexu.
  for year in range(2008,2019):
    if year>=2009:
      for area,slug in [
        ('Kultura',f'Granty-Kultura-{year}'),
        ('Volnočasové aktivity dětí a mládeže',f'Granty-Volnocasove-nesportovni-aktivity-{year}')]:
        key=(area,year,f'https://www.praha8.cz/{slug}')
        if key not in seen: seen.add(key); pages.append({'year':year,'area':area,'page':key[2],'label':f'{area} {year}'})
    key=('Sociální oblast',year,f'https://www.praha8.cz/Granty-v-socialni-oblasti-{year}')
    if key not in seen: seen.add(key); pages.append({'year':year,'area':key[0],'page':key[2],'label':f'Sociální oblast {year}'})
  for year in range(2014,2019):
    slug=f'Granty-Sport-pro-dospele-a-dorost-{year}' if year>=2015 else 'Granty-Telovychovna-cinnost-dospelych-2014'
    key=('Sport dospělí a dorost',year,f'https://www.praha8.cz/{slug}')
    if key not in seen: seen.add(key); pages.append({'year':year,'area':key[0],'page':key[2],'label':f'Sport dospělí a dorost {year}'})
  return pages,[]

def archive_inventory():
  pages,warnings=discover_archive_pages(); inventory=[]
  for p in sorted(pages,key=lambda x:(-x['year'],x['area'])):
    try:
      links=html_links(p['page']); files=[]
      for label,href in links:
        ext=href.split('?',1)[0].lower().rsplit('.',1)[-1] if '.' in href.split('?',1)[0] else ''
        if ext in {'xls','xlsx','csv','doc','docx','pdf'}:
          files.append({'label':label,'url':href,'format':ext})
      if files: inventory.append({**p,'status':'nalezeno','files':files})
    except Exception as exc:
      warnings.append(f"{p['area']} {p['year']}: {exc}")
  return inventory,warnings

def parse_flexible(source,file_url,blob):
  rows=base.xlsx_rows(blob); hi=base.find_header(rows)
  if hi is None: raise RuntimeError('nenalezeno záhlaví starší tabulky')
  header=[base.norm_text(x).lower() for x in rows[hi]]
  recipient=approved=ico=project=None
  for i,x in enumerate(header):
    if recipient is None and any(k in x for k in ['žadatel','zadatel','název klubu','nazev klubu','organizace','příjemce','prijemce','název žadatele','nazev zadatele']): recipient=i
    if ico is None and ('ič' in x or 'ico' in x): ico=i
    if project is None and any(k in x for k in ['projekt','účel','ucel','název akce','nazev akce']): project=i
    if approved is None and any(k in x for k in ['schválen','schvalen','poskytnut','přidělen','pridelen','částka','castka','dotace v kč','dotace kc','výše dotace','vyse dotace']): approved=i
  if recipient is None or approved is None: raise RuntimeError('flexibilní parser nenašel příjemce/částku; záhlaví: '+repr(header))
  grants=[]
  for row in rows[hi+1:]:
    get=lambda idx: row[idx] if idx is not None and idx<len(row) else ''
    name,ico_value=base.split_recipient_ico(get(recipient),get(ico)); amount=base.money(get(approved))
    if not name or amount is None or amount<=0: continue
    grants.append({'year':source['year'],'area':source['area'],'type':'dotační řízení','recipient':name,'ico':ico_value,
      'project':base.norm_text(get(project)),'requestedCzk':None,'approvedCzk':amount,'decisionBody':None,
      'resolutionId':None,'resolutionDate':None,'resolutionUrl':None,'sourcePage':source.get('publicPage') or source['page'],'sourceFile':file_url})
  if not grants: raise RuntimeError('flexibilní parser nenačetl žádné kladné částky')
  return grants,{'headerRow':hi+1,'columns':{'recipient':recipient,'ico':ico,'project':project,'approved':approved},'rows':len(grants),'parser':'historical-flex'}

def parse_source(source,file_url,blob):
  try:return base.parse_program(source,file_url,blob)
  except Exception:return parse_flexible(source,file_url,blob)

def main():
  payload=read_payload(); historical=[]; source_meta=[]; failures=[]; warnings=[]
  target_years=set(YEARS)
  for source in SOURCES:
    try:
      file_url,label=base.discover_file(source['page'],source['kind'])
      if not file_url: raise RuntimeError('nenalezen zdrojový soubor')
      grants,qa=parse_source(source,file_url,base.fetch_bytes(file_url)); historical.extend(grants)
      source_meta.append({**source,'file':file_url,'label':label,'status':'načteno','qa':qa})
      print(f"✅ {source['area']} {source['year']}: {len(grants)} dotací")
    except Exception as exc:
      msg=f"{source['area']} {source['year']}: {exc}"
      if source.get('required'): failures.append(msg)
      else: warnings.append(msg); source_meta.append({**source,'status':'nedostupné','error':str(exc)})
      print(('❌' if source.get('required') else '⚠️'),msg)
  if failures: raise RuntimeError('Historický import odmítnut: '+'; '.join(failures))
  counts={y:sum(1 for g in historical if g['year']==y) for y in target_years}
  sparse=[f'{y}: {n}' for y,n in counts.items() if n<10]
  if sparse: raise RuntimeError('Historický import odmítnut: podezřele málo záznamů v ročníku '+'; '.join(sparse))

  inventory,archive_warnings=archive_inventory(); warnings.extend(archive_warnings)
  current=[g for g in payload.get('grants',[]) if int(g.get('year') or 0) not in target_years]
  combined=current+historical
  all_warnings=[w for w in (payload.get('meta',{}).get('warnings') or []) if 'histor' not in w.lower()]+warnings
  ares_qa=base.enrich_ares(combined,all_warnings)
  combined.sort(key=lambda x:(-int(x.get('year') or 0),x.get('area',''),x.get('recipient','').lower(),-(x.get('approvedCzk') or 0)))
  old_sources=[s for s in payload.get('sources',[]) if int(s.get('year') or 0) not in target_years]
  payload['schema']=4; payload['updated']=datetime.now(timezone.utc).isoformat(); payload['sources']=old_sources+source_meta; payload['grants']=combined
  payload['meta']={**payload.get('meta',{}),'records':len(combined),'years':sorted({int(g['year']) for g in combined},reverse=True),
    'areas':sorted({g.get('area','') for g in combined if g.get('area')}),'warnings':all_warnings,'ares':ares_qa,
    'historyCounts':{str(y):counts[y] for y in sorted(counts,reverse=True)},'archiveInventory':inventory,
    'archiveInventoryPages':len(inventory),'archiveInventoryFiles':sum(len(x['files']) for x in inventory),
    'note':'Programové dotace jsou načítány z oficiálních tabulek MČ Praha 8. Historie 2019–2025 se při aktualizaci znovu sestaví a projde QA po jednotlivých ročnících. Archiv 2008–2018 se automaticky inventarizuje; do veřejných záznamů budou staré XLS/DOC/PDF přidávány jen po bezpečném parsování a kontrole součtů. Individuální dotace se zveřejňují jen při jednoznačném určení příjemce a částky.'}
  base.atomic_write_json(OUT,payload)
  print('\n📚 Archiv 2008–2018:',len(inventory),'stránek ·',sum(len(x['files']) for x in inventory),'zdrojových souborů')
  print('✅ HOTOVO:',', '.join(f'{y}: {counts[y]}' for y in sorted(counts,reverse=True)),f'· celkem {len(combined)} záznamů')

if __name__=='__main__': main()
