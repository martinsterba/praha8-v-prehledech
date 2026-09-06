#!/usr/bin/env python3
import importlib.util,json
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
BASE_SCRIPT=ROOT/'scripts'/'sync-grants.py'
OUT=ROOT/'data'/'dotace.json'

spec=importlib.util.spec_from_file_location('grants_base',BASE_SCRIPT)
base=importlib.util.module_from_spec(spec); spec.loader.exec_module(base)

YEARS=range(2019,2026)
SOURCES=[]
for year in YEARS:
  SOURCES += [
    {'year':year,'area':'Kultura','page':f'https://www.praha8.cz/Granty-Kultura-{year}','kind':'xlsx','required':year in {2023,2024,2025}},
    {'year':year,'area':'Volnočasové aktivity dětí a mládeže','page':('https://www.praha8.cz/Granty-Volnocasove-nesportovni-aktivity-2020-1' if year==2021 else f'https://www.praha8.cz/Granty-Volnocasove-nesportovni-aktivity-{year}'),'kind':'xlsx','required':year in {2020,2023,2024,2025}},
    {'year':year,'area':'Sportovní výchova mládeže','page':('https://www.praha8.cz/Granty-Sportovni-vychova-mladeze-2020-1' if year==2021 else f'https://www.praha8.cz/Granty-Sportovni-vychova-mladeze-{year}'),'kind':'xlsx','required':year in {2019,2020,2021,2023,2024,2025}},
  ]

SOURCES.append({
  'year':2025,'area':'Sociální oblast','page':'https://m.praha8.cz/appo/usn/676?usn=9LcW1pbxsh2gqAagwwqNdwnaZHIw%3D%3D',
  'publicPage':'https://www.praha8.cz/Dotace-v-socialni-oblasti-2025','kind':'xlsx','required':True,
  'decisionBody':'Rada','resolutionId':'Usn RMC 0264/2025','resolutionDate':'2025-06-11'
})

def read_payload():
  if not OUT.exists(): raise RuntimeError('Chybí data/dotace.json; nejprve spusťte základní import dotací.')
  return json.loads(OUT.read_text(encoding='utf-8'))

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
      if source.get('required'):
        failures.append(msg); print('❌',msg)
      else:
        warnings.append(msg); source_meta.append({**source,'status':'čeká na doplnění','error':str(exc)}); print('⚠️',msg)

  if failures: raise RuntimeError('Historický import odmítnut kvůli povinnému zdroji: '+'; '.join(failures))
  if len(historical)<100: raise RuntimeError(f'Historický import odmítnut: podezřele málo ověřených záznamů ({len(historical)}).')

  counts={y:sum(1 for g in historical if g['year']==y) for y in target_years}
  loaded_years={y for y,n in counts.items() if n>0}
  required_loaded={2019,2020,2021,2023,2024,2025}
  if not required_loaded <= loaded_years:
    raise RuntimeError('Historický import odmítnut: chybí některý z již ověřených ročníků '+repr(sorted(loaded_years)))

  current=[g for g in payload.get('grants',[]) if int(g.get('year') or 0) not in target_years]
  combined=current+historical
  all_warnings=[w for w in (payload.get('meta',{}).get('warnings') or []) if 'histor' not in w.lower()]+warnings
  ares_qa=base.enrich_ares(combined,all_warnings)
  combined.sort(key=lambda x:(-int(x.get('year') or 0),x.get('area',''),x.get('recipient','').lower(),-(x.get('approvedCzk') or 0)))
  old_sources=[s for s in payload.get('sources',[]) if int(s.get('year') or 0) not in target_years]
  payload['schema']=4
  payload['updated']=datetime.now(timezone.utc).isoformat()
  payload['sources']=old_sources+source_meta
  payload['grants']=combined
  payload['meta']={
    **payload.get('meta',{}),
    'records':len(combined),
    'years':sorted({int(g['year']) for g in combined},reverse=True),
    'areas':sorted({g.get('area','') for g in combined if g.get('area')}),
    'warnings':all_warnings,
    'ares':ares_qa,
    'historyCounts':{str(y):counts[y] for y in sorted(counts,reverse=True)},
    'historyLoadedYears':sorted(loaded_years,reverse=True),
    'archiveStatus':'Archiv 2008–2018 se zpracovává samostatně mimo kritickou publikační cestu.',
    'note':'Historické dotace se zveřejňují postupně po ověřených zdrojích. Výpadek nebo odlišný formát jednoho staršího zdroje nezablokuje publikaci ostatních ověřených ročníků. Chybějící části zůstávají označené k doplnění; archiv 2008–2018 se načítá samostatně po bezpečném parsování a QA.'
  }
  base.atomic_write_json(OUT,payload)
  print('\n✅ HOTOVO:',', '.join(f'{y}: {counts[y]}' for y in sorted(counts,reverse=True)),f'· celkem {len(combined)} záznamů')

if __name__=='__main__': main()
