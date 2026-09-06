#!/usr/bin/env python3
"""Doplňuje historická programová dotační řízení z příloh usnesení Rady.

Používá se pouze pro kombinace roku/oblasti, kde na veřejné stránce dotačního
programu chybí nebo není snadno dostupný výsledkový XLSX. Zdrojová usnesení už
máme v data/usneseni.json. Import je fail-safe: pokud se pro kombinaci nepodaří
najít a bezpečně rozparsovat výsledkovou přílohu, existující data se nemažou.
"""
import importlib.util,json,re
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'data'/'dotace.json'
USNESENI=ROOT/'data'/'usneseni.json'
ARCHIVE_SCRIPT=ROOT/'scripts'/'sync-grants-archive.py'

spec=importlib.util.spec_from_file_location('grants_archive_resolution_programs',ARCHIVE_SCRIPT)
arc=importlib.util.module_from_spec(spec);spec.loader.exec_module(arc)
base=arc.base

# Známé mezery ve veřejných výsledkových stránkách. Nehledáme mimo ně, abychom
# omylem nepřepsali roky, které už mají stabilní primární importer.
TARGETS=[
  (2019,'Kultura'),
  (2019,'Sociální oblast'),
  (2020,'Sociální oblast'),
  (2021,'Sociální oblast'),
  (2023,'Sociální oblast'),
  (2024,'Sociální oblast'),
]

def read_json(path,fallback):
  try:return json.loads(path.read_text(encoding='utf-8'))
  except Exception:return fallback

def norm(s):
  return base.norm_text(s).lower()

def title_matches(title,year,area):
  t=norm(title)
  if str(year) not in t:return False
  if 'vyhláš' in t or 'vyhlas' in t:return False
  if 'poskytnut' not in t or 'dotac' not in t:return False
  if area=='Kultura':return 'kultur' in t
  if area=='Sociální oblast':return 'sociál' in t or 'social' in t
  return False

def candidate_resolutions(resolutions,year,area):
  out=[]
  for r in resolutions if isinstance(resolutions,list) else []:
    if r.get('organ')!='Rada':continue
    if not title_matches(r.get('title',''),year,area):continue
    url=r.get('url')
    if not url:continue
    score=0
    t=norm(r.get('title'))
    if 'k návrhu poskytnutí' in t or 'k navrhu poskytnuti' in t:score+=5
    if f'rok {year}' in t or f'roku {year}' in t:score+=3
    if str(r.get('date','')).startswith(str(year)):score+=2
    out.append((score,r))
  out.sort(key=lambda x:x[0],reverse=True)
  return [r for _,r in out]

def attachment_candidates(url):
  ranked=[]
  for label,href in arc.html_links(url):
    low=norm(label+' '+href)
    ext='xlsx' if '.xlsx' in low else ('xls' if '.xls' in low else None)
    if not ext:continue
    score=1
    for token,pts in [('final',6),('dotace',5),('grant',4),('návrh',3),('navrh',3),('do_rady',3),('do-rady',3),('příloh',2),('priloh',2),('schválen',2),('schvalen',2)]:
      if token in low:score+=pts
    for token,pts in [('vyúčt',10),('vyuct',10),('smlouv',8),('podmín',8),('podmin',8),('žádost',8),('zadost',8),('formul',6)]:
      if token in low:score-=pts
    ranked.append((score,href,label,ext))
  ranked.sort(key=lambda x:x[0],reverse=True)
  return ranked

def parse_resolution(r,year,area):
  source={'year':year,'area':area,'resolvedPage':r.get('url')}
  successes=[];errors=[]
  for score,href,label,ext in attachment_candidates(r.get('url')):
    if score<0:continue
    try:
      rows,qa=arc.parse(source,href,ext)
      if rows:
        successes.append((score,len(rows),rows,{**qa,'file':href,'label':label}))
    except Exception as exc:
      errors.append(f'{label}: {exc}')
  if not successes:return [],None,errors
  # Preferujeme nejlépe pojmenovanou přílohu, při shodě tu s více záznamy.
  successes.sort(key=lambda x:(x[0],x[1]),reverse=True)
  _,_,rows,qa=successes[0]
  for g in rows:
    g['decisionBody']='Rada'
    g['resolutionId']=r.get('id')
    g['resolutionDate']=r.get('date')
    g['resolutionUrl']=r.get('url')
    g['sourcePage']=r.get('url')
  return rows,qa,errors

def main():
  payload=read_json(OUT,{})
  resolutions=read_json(USNESENI,[])
  existing=payload.get('grants') or []
  loaded=[];loaded_keys=set();source_meta=[];warnings=[]

  for year,area in TARGETS:
    found=[];qa=None;used=None;errors=[]
    for r in candidate_resolutions(resolutions,year,area):
      rows,row_qa,row_errors=parse_resolution(r,year,area)
      errors.extend(row_errors)
      if rows:
        found=rows;qa=row_qa;used=r;break
    found=arc.dedupe(found)
    if not found:
      warnings.append(f'Resolution archive {area} {year}: výsledkovou přílohu se nepodařilo bezpečně načíst; existující data zachována.')
      print(f'⚠️ Resolution archive {area} {year}: nenalezen bezpečný výsledek')
      continue
    loaded.extend(found);loaded_keys.add((year,area))
    source_meta.append({'year':year,'area':area,'page':used.get('url'),'kind':'resolution-attachment','required':False,'status':'načteno','rows':len(found),'qa':qa})
    print(f'✅ Resolution archive {area} {year}: {len(found)} dotací · {used.get("id")}')

  if not loaded_keys:
    print('ℹ️ Resolution archive: nic nového bezpečně načteno; data se nemění.')
    return

  current=[g for g in existing if (int(g.get('year') or 0),g.get('area')) not in loaded_keys]
  combined=arc.dedupe(current+loaded)
  old_sources=[s for s in (payload.get('sources') or []) if (int(s.get('year') or 0),s.get('area')) not in loaded_keys]
  all_warnings=[w for w in (payload.get('meta',{}).get('warnings') or []) if not str(w).startswith('Resolution archive ')]+warnings
  ares_qa=base.enrich_ares(combined,all_warnings)
  combined.sort(key=lambda x:(-int(x.get('year') or 0),x.get('area',''),x.get('recipient','').lower(),-(x.get('approvedCzk') or 0)))
  years=sorted({int(g['year']) for g in combined},reverse=True)
  counts={str(y):sum(1 for g in combined if int(g['year'])==y) for y in years}

  payload['schema']=max(int(payload.get('schema') or 0),15)
  payload['updated']=datetime.now(timezone.utc).isoformat()
  payload['grants']=combined
  payload['sources']=old_sources+source_meta
  payload['meta']={**payload.get('meta',{}),'records':len(combined),'years':years,
    'areas':sorted({g.get('area','') for g in combined if g.get('area')}),
    'warnings':all_warnings,'ares':ares_qa,'historyCounts':counts,
    'resolutionProgramLoadedKeys':[f'{y}|{a}' for y,a in sorted(loaded_keys,key=lambda x:(-x[0],x[1]))]}
  base.atomic_write_json(OUT,payload)
  print(f'✅ Resolution archive: přidáno/obnoveno {len(loaded)} záznamů v {len(loaded_keys)} kombinacích.')

if __name__=='__main__':main()
