#!/usr/bin/env python3
"""Doplní výsledky sportu dospělých a dorostu pro roky 2014–2015.

Starší stránky Prahy 8 používají pro výsledky mimo jiné označení „Přehled
podpořených žádostí“. Obecný archivní filtr slovo „žádost“ z bezpečnostních
důvodů odmítá, proto jsou tyto dvě jasně vymezené výsledkové stránky načítány
samostatným úzkým importerem. Pro rok 2015 zkoušíme také přílohy oficiálního
Usn RMC 0298/2015. Při chybě se existující data nemažou.
"""
import importlib.util
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
ARCHIVE_SCRIPT=ROOT/'scripts'/'sync-grants-archive.py'
OUT=ROOT/'data'/'dotace.json'
USNESENI=ROOT/'data'/'usneseni.json'
AREA='Sport dospělí a dorost'

spec=importlib.util.spec_from_file_location('grants_sport_legacy_archive',ARCHIVE_SCRIPT)
arc=importlib.util.module_from_spec(spec);spec.loader.exec_module(arc)
base=arc.base

SOURCES=[
  {'year':2014,'pages':['https://www.praha8.cz/Granty-Telovychovna-cinnost-dospelych-2014','https://m.praha8.cz/Granty-Telovychovna-cinnost-dospelych-2014']},
  {'year':2015,'pages':['https://www.praha8.cz/Granty-Sport-pro-dospele-a-dorost-2015','https://m.praha8.cz/Granty-Sport-pro-dospele-a-dorost-2015']},
]

def ext_of(text):
  low=text.lower()
  if '.docx' in low:return 'docx'
  if '.doc' in low:return 'doc'
  if '.xlsx' in low:return 'xlsx'
  if '.xls' in low:return 'xls'
  return None

def result_files(source):
  out=[]
  for page in source['pages']:
    try:
      for label,href in arc.html_links(page):
        low=(label+' '+href).lower(); ext=ext_of(low)
        if not ext:continue
        result=(
          'přehled podpořen' in low or 'prehled podporen' in low or
          'poskytnuté dotace' in low or 'poskytnute dotace' in low or
          'výsled' in low or 'vysled' in low
        )
        if not result:continue
        if 'vyúčt' in low or 'vyuct' in low or 'formul' in low or 'podmín' in low or 'podmin' in low or 'smlouv' in low:continue
        out.append((href,label,ext,page))
    except Exception:
      continue
  seen=set();unique=[]
  for item in out:
    if item[0] in seen:continue
    seen.add(item[0]);unique.append(item)
  return unique

def resolution_2015_files():
  data=arc.read_json(USNESENI,[])
  target=None
  for r in data if isinstance(data,list) else []:
    rid=str(r.get('id') or '')
    title=base.norm_text(r.get('title')).lower()
    if rid=='Usn RMC 0298/2015' or ('sportu pro dospělé a dorost' in title and '2015' in title and 'poskytnut' in title):
      target=r;break
  if not target or not target.get('url'):
    print('🔎 Sport 2015: Usn RMC 0298/2015 není v lokálním datasetu usnesení s URL.')
    return []
  out=[]; all_files=[]
  try:
    links=arc.html_links(target['url'])
  except Exception as exc:
    print(f"🔎 Sport 2015: stránku {target.get('url')} nelze projít: {exc}")
    return []
  for label,href in links:
    low=(label+' '+href).lower();ext=ext_of(low)
    if any(s in low for s in ['.pdf','.doc','.docx','.xls','.xlsx']):
      all_files.append((label,href))
    if not ext:continue
    # U tohoto konkrétního usnesení je příloha č. 1 výsledkový seznam. Odmítáme
    # důvodovou zprávu, vzor smlouvy a formuláře.
    if any(x in low for x in ['důvodov','duvodov','smlouv','formul','žádost','zadost','podmín','podmin']):continue
    if 'příloh' in low or 'priloh' in low or 'seznam' in low or 'sport' in low or 'grant' in low or 'dotac' in low:
      out.append((href,label,ext,target['url']))
  if not out:
    print('🔎 Sport 2015: podporované přílohy RMC 0298 nenalezeny. Odkazy na soubory:')
    for label,href in all_files[:20]:print(f'  - {label} | {href}')
  return out

def main():
  payload=arc.read_json(OUT,{})
  existing=payload.get('grants') or []
  loaded=[];loaded_keys=set();source_meta=[];warnings=[]
  for source in SOURCES:
    rows=[];qas=[]
    files=result_files(source)
    if source['year']==2015 and not files:
      files=resolution_2015_files()
    if not files:
      warnings.append(f"Starý sport {source['year']}: nenalezen oficiální výsledkový soubor; existující data zachována.")
      print(f"⚠️ Starý sport {source['year']}: nenalezen výsledkový soubor")
      continue
    for href,label,ext,page in files:
      try:
        found,qa=arc.parse({'year':source['year'],'area':AREA,'resolvedPage':page},href,ext)
        rows.extend(found);qas.append({**qa,'file':href,'label':label})
      except Exception as exc:
        warnings.append(f"Starý sport {source['year']} / {label}: {exc}")
    rows=arc.dedupe(rows)
    if not rows:
      print(f"⚠️ Starý sport {source['year']}: výsledkový soubor se nepodařilo bezpečně rozparsovat")
      continue
    loaded.extend(rows);loaded_keys.add((source['year'],AREA))
    source_meta.append({'year':source['year'],'area':AREA,'page':rows[0].get('sourcePage'),'kind':'archive-legacy-sport','required':False,'status':'načteno','rows':len(rows),'qa':qas})
    print(f"✅ Starý sport {source['year']}: {len(rows)} dotací")

  if not loaded_keys:
    print('ℹ️ Starý sport: nic nového bezpečně načteno; data se nemění.')
    return

  current=[g for g in existing if (int(g.get('year') or 0),g.get('area')) not in loaded_keys]
  combined=arc.dedupe(current+loaded)
  old_sources=[s for s in (payload.get('sources') or []) if (int(s.get('year') or 0),s.get('area')) not in loaded_keys]
  all_warnings=[w for w in (payload.get('meta',{}).get('warnings') or []) if not str(w).startswith('Starý sport ') and not (str(w).startswith('Sport dospělí a dorost ') and any(str(y) in str(w) for y,_ in loaded_keys))]+warnings
  ares_qa=base.enrich_ares(combined,all_warnings)
  combined.sort(key=lambda x:(-int(x.get('year') or 0),x.get('area',''),str(x.get('recipient','')).lower(),-(x.get('approvedCzk') or 0)))
  years=sorted({int(g['year']) for g in combined},reverse=True)
  counts={str(y):sum(1 for g in combined if int(g['year'])==y) for y in years}
  payload['schema']=max(int(payload.get('schema') or 0),17)
  payload['updated']=datetime.now(timezone.utc).isoformat()
  payload['grants']=combined
  payload['sources']=old_sources+source_meta
  payload['meta']={**payload.get('meta',{}),'records':len(combined),'years':years,
    'areas':sorted({g.get('area','') for g in combined if g.get('area')}),
    'warnings':all_warnings,'ares':ares_qa,'historyCounts':counts,
    'legacySportLoadedYears':sorted([y for y,_ in loaded_keys],reverse=True)}
  base.atomic_write_json(OUT,payload)
  print(f'✅ Starý sport: přidáno/obnoveno {len(loaded)} záznamů v {len(loaded_keys)} ročnících.')

if __name__=='__main__':main()
