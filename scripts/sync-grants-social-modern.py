#!/usr/bin/env python3
"""Doplní sociální dotace 2019–2021 přímo z oficiálních výsledkových stránek.

Tyto roky mají na webu Prahy 8 samostatné výsledkové soubory, ale původní
historický importer je nebral. Tento importer je záměrně úzký: načítá pouze
výsledkové soubory na třech známých oficiálních stránkách a nahrazuje jen
kombinace rok + oblast, které skutečně bezpečně rozparsuje.
"""
import importlib.util
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
ARCHIVE_SCRIPT=ROOT/'scripts'/'sync-grants-archive.py'
OUT=ROOT/'data'/'dotace.json'

spec=importlib.util.spec_from_file_location('grants_social_modern_archive',ARCHIVE_SCRIPT)
arc=importlib.util.module_from_spec(spec);spec.loader.exec_module(arc)
base=arc.base

SOURCES=[
  {'year':2019,'area':'Sociální oblast','pages':['https://www.praha8.cz/Dotace-v-socialni-oblasti-2019','https://m.praha8.cz/Dotace-v-socialni-oblasti-2019']},
  {'year':2020,'area':'Sociální oblast','pages':['https://www.praha8.cz/Dotace-v-socialni-oblasti-2020','https://m.praha8.cz/Dotace-v-socialni-oblasti-2020']},
  {'year':2021,'area':'Sociální oblast','pages':['https://www.praha8.cz/Dotace-v-socialni-oblasti-2021','https://m.praha8.cz/Dotace-v-socialni-oblasti-2021']},
]

def result_files(source):
  ranked=[]
  for page in source['pages']:
    try:
      for label,href in arc.html_links(page):
        low=(label+' '+href).lower()
        ext='xlsx' if '.xlsx' in low else ('xls' if '.xls' in low and '.xlsx' not in low else None)
        if not ext:continue
        if 'vyúčt' in low or 'vyuct' in low or 'žádost' in low or 'zadost' in low or 'formul' in low or 'pravidl' in low:continue
        score=0
        if 'výsled' in low or 'vysled' in low:score+=10
        if 'dotačního řízení' in low or 'dotacniho rizeni' in low:score+=5
        if 'sociál' in low or 'social' in low:score+=4
        if score>=10:ranked.append((score,href,label,ext,page))
    except Exception:
      continue
  ranked.sort(key=lambda x:x[0],reverse=True)
  if not ranked:return []
  best=ranked[0][0]
  return [(href,label,ext,page) for score,href,label,ext,page in ranked if score>=best-1]

def main():
  payload=arc.read_json(OUT,{})
  existing=payload.get('grants') or []
  loaded=[];loaded_keys=set();source_meta=[];warnings=[]

  for source in SOURCES:
    files=result_files(source)
    if not files:
      warnings.append(f"Moderní sociální archiv {source['year']}: nenalezen výsledkový XLS/XLSX; existující data zachována.")
      print(f"⚠️ Moderní sociální archiv {source['year']}: nenalezen výsledkový soubor")
      continue
    rows=[];qas=[]
    for href,label,ext,page in files:
      s={**source,'resolvedPage':page}
      try:
        found,qa=arc.parse(s,href,ext)
        rows.extend(found);qas.append({**qa,'file':href,'label':label})
      except Exception as exc:
        warnings.append(f"Moderní sociální archiv {source['year']} / {label}: {exc}")
    rows=arc.dedupe(rows)
    if not rows:
      print(f"⚠️ Moderní sociální archiv {source['year']}: výsledkový soubor se nepodařilo bezpečně rozparsovat")
      continue
    loaded.extend(rows);loaded_keys.add((source['year'],source['area']))
    source_meta.append({'year':source['year'],'area':source['area'],'page':rows[0].get('sourcePage'),'kind':'official-results-page','required':False,'status':'načteno','rows':len(rows),'qa':qas})
    print(f"✅ Moderní sociální archiv {source['year']}: {len(rows)} dotací")

  if not loaded_keys:
    print('ℹ️ Moderní sociální archiv: nic nového bezpečně načteno; data se nemění.')
    return

  current=[g for g in existing if (int(g.get('year') or 0),g.get('area')) not in loaded_keys]
  combined=arc.dedupe(current+loaded)
  old_sources=[s for s in (payload.get('sources') or []) if (int(s.get('year') or 0),s.get('area')) not in loaded_keys]
  all_warnings=[w for w in (payload.get('meta',{}).get('warnings') or []) if not str(w).startswith('Moderní sociální archiv ') and not (str(w).startswith('Resolution archive Sociální oblast ') and any(str(y) in str(w) for y,_ in loaded_keys))]+warnings
  ares_qa=base.enrich_ares(combined,all_warnings)
  combined.sort(key=lambda x:(-int(x.get('year') or 0),x.get('area',''),str(x.get('recipient','')).lower(),-(x.get('approvedCzk') or 0)))
  years=sorted({int(g['year']) for g in combined},reverse=True)
  counts={str(y):sum(1 for g in combined if int(g['year'])==y) for y in years}

  payload['schema']=max(int(payload.get('schema') or 0),16)
  payload['updated']=datetime.now(timezone.utc).isoformat()
  payload['grants']=combined
  payload['sources']=old_sources+source_meta
  payload['meta']={**payload.get('meta',{}),'records':len(combined),'years':years,
    'areas':sorted({g.get('area','') for g in combined if g.get('area')}),
    'warnings':all_warnings,'ares':ares_qa,'historyCounts':counts,
    'modernSocialLoadedYears':sorted([y for y,_ in loaded_keys],reverse=True)}
  base.atomic_write_json(OUT,payload)
  print(f'✅ Moderní sociální archiv: přidáno/obnoveno {len(loaded)} záznamů v {len(loaded_keys)} ročnících.')

if __name__=='__main__':main()
