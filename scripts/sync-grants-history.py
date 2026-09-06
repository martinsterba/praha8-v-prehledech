#!/usr/bin/env python3
import importlib.util,json
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
BASE_SCRIPT=ROOT/'scripts'/'sync-grants.py'
OUT=ROOT/'data'/'dotace.json'

spec=importlib.util.spec_from_file_location('grants_base',BASE_SCRIPT)
base=importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

SOURCES_2025=[
  {'year':2025,'area':'Kultura','page':'https://www.praha8.cz/Granty-Kultura-2025','kind':'xlsx','required':True},
  {'year':2025,'area':'Volnočasové aktivity dětí a mládeže','page':'https://www.praha8.cz/Granty-Volnocasove-nesportovni-aktivity-2025','kind':'xlsx','required':True},
  {'year':2025,'area':'Sportovní výchova mládeže','page':'https://www.praha8.cz/Granty-Sportovni-vychova-mladeze-2025','kind':'xlsx','required':True},
  {
    'year':2025,'area':'Sociální oblast',
    'page':'https://m.praha8.cz/appo/usn/676?usn=9LcW1pbxsh2gqAagwwqNdwnaZHIw%3D%3D',
    'publicPage':'https://www.praha8.cz/Dotace-v-socialni-oblasti-2025',
    'kind':'xlsx','required':True,
    'decisionBody':'Rada','resolutionId':'Usn RMC 0264/2025','resolutionDate':'2025-06-11'
  }
]

def read_payload():
  if not OUT.exists(): raise RuntimeError('Chybí data/dotace.json; nejprve spusťte základní import dotací.')
  return json.loads(OUT.read_text(encoding='utf-8'))

def parse_older_sports(source,file_url,blob):
  rows=base.xlsx_rows(blob)
  hi=base.find_header(rows)
  if hi is None: raise RuntimeError('nenalezeno záhlaví starší sportovní tabulky')
  header=[base.norm_text(x).lower() for x in rows[hi]]
  recipient=None; approved=None; ico=None; project=None
  for i,x in enumerate(header):
    if recipient is None and any(k in x for k in ['žadatel','zadatel','název klubu','nazev klubu','organizace','příjemce','prijemce']): recipient=i
    if ico is None and ('ič' in x or 'ico' in x): ico=i
    if project is None and any(k in x for k in ['projekt','účel','ucel']): project=i
    if approved is None and any(k in x for k in ['schválen','schvalen','poskytnut','přidělen','pridelen','částka','castka','dotace v kč','dotace kc']): approved=i
  if recipient is None or approved is None:
    raise RuntimeError('ani flexibilní parser nenašel příjemce/částku; záhlaví: '+repr(header))
  grants=[]
  for row in rows[hi+1:]:
    get=lambda idx: row[idx] if idx is not None and idx<len(row) else ''
    name,ico_value=base.split_recipient_ico(get(recipient),get(ico))
    amount=base.money(get(approved))
    if not name or amount is None or amount<=0: continue
    grants.append({
      'year':source['year'],'area':source['area'],'type':'programová','recipient':name,'ico':ico_value,
      'project':base.norm_text(get(project)),'requestedCzk':None,'approvedCzk':amount,
      'decisionBody':None,'resolutionId':None,'resolutionDate':None,'resolutionUrl':None,
      'sourcePage':source['page'],'sourceFile':file_url
    })
  if not grants: raise RuntimeError('flexibilní parser nenačetl žádné kladné částky')
  return grants,{'headerRow':hi+1,'columns':{'recipient':recipient,'ico':ico,'project':project,'approved':approved},'rows':len(grants),'parser':'older-sports-flex'}

def parse_source(source,file_url,blob):
  try:
    return base.parse_program(source,file_url,blob)
  except Exception:
    if source['area']=='Sportovní výchova mládeže' and source['year']==2025:
      return parse_older_sports(source,file_url,blob)
    raise

def main():
  payload=read_payload()
  historical=[]; source_meta=[]; failures=[]
  for source in SOURCES_2025:
    try:
      file_url,label=base.discover_file(source['page'],source['kind'])
      if not file_url: raise RuntimeError('nenalezen zdrojový soubor')
      grants,qa=parse_source(source,file_url,base.fetch_bytes(file_url))
      historical.extend(grants)
      source_meta.append({**source,'file':file_url,'label':label,'status':'načteno','qa':qa})
      print(f"✅ {source['area']} {source['year']}: {len(grants)} dotací")
    except Exception as exc:
      failures.append(f"{source['area']} {source['year']}: {exc}")
      print(f"❌ {source['area']} {source['year']}: {exc}")

  if failures:
    raise RuntimeError('Historický import odmítnut: '+'; '.join(failures))
  if len(historical)<20:
    raise RuntimeError(f'Historický import odmítnut: podezřele málo záznamů ({len(historical)}).')

  current=[g for g in payload.get('grants',[]) if int(g.get('year') or 0)!=2025]
  combined=current+historical
  warnings=list(payload.get('meta',{}).get('warnings') or [])
  ares_qa=base.enrich_ares(combined,warnings)
  combined.sort(key=lambda x:(-int(x.get('year') or 0),x.get('area',''),x.get('recipient','').lower(),-(x.get('approvedCzk') or 0)))

  old_sources=[s for s in payload.get('sources',[]) if int(s.get('year') or 0)!=2025]
  payload['schema']=3
  payload['updated']=datetime.now(timezone.utc).isoformat()
  payload['sources']=old_sources+source_meta
  payload['grants']=combined
  payload['meta']={
    **payload.get('meta',{}),
    'records':len(combined),
    'years':sorted({int(g['year']) for g in combined},reverse=True),
    'areas':sorted({g.get('area','') for g in combined if g.get('area')}),
    'warnings':warnings,
    'ares':ares_qa,
    'note':'Programové a sociální dotace jsou načítány z oficiálních tabulek. Historické ročníky se přidávají po ročnících až po samostatném QA. Individuální dotace se bezpečně vytěžují z usnesení Rady; nejednoznačné kandidáty se nezveřejňují. Dotace, kde je MČ Praha 8 příjemcem od HMP či jiného poskytovatele, se nezahrnují.'
  }
  base.atomic_write_json(OUT,payload)
  print(f"\n✅ HOTOVO: přidáno {len(historical)} dotací za rok 2025; celkem {len(combined)} záznamů.")

if __name__=='__main__': main()
