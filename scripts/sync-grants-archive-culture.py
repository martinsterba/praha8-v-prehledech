#!/usr/bin/env python3
"""Historické granty kultury a volného času 2009–2018.

V letech před rozdělením dotačních řízení Praha 8 zveřejňovala kulturu a
volnočasové nesportovní aktivity v jedné společné výsledkové tabulce. Proto je
nepřepisujeme uměle do dvou dnešních kategorií, ale zachováváme historický
název oblasti. Rok 2018 už má samostatné stránky a importuje se odděleně.
"""
import importlib.util,json
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
ARCHIVE_SCRIPT=ROOT/'scripts'/'sync-grants-archive.py'
OUT=ROOT/'data'/'dotace.json'

spec=importlib.util.spec_from_file_location('grants_archive_common',ARCHIVE_SCRIPT)
arc=importlib.util.module_from_spec(spec);spec.loader.exec_module(arc)
base=arc.base


def sources():
  out=[]
  # 2009–2017 šlo na webu Prahy 8 převážně o společné řízení kultura + volný čas.
  for year in range(2009,2018):
    out.append({
      'year':year,
      'area':'Kultura a volnočasové aktivity',
      'pages':[
        f'https://www.praha8.cz/Kultura-a-volnocasove-nesportovni-aktivity-{year}',
        f'https://www.praha8.cz/Granty-Kultura-a-volnocasove-nesportovni-aktivity-{year}',
        f'https://m.praha8.cz/Kultura-a-volnocasove-nesportovni-aktivity-{year}',
        f'https://m.praha8.cz/Granty-Kultura-a-volnocasove-nesportovni-aktivity-{year}',
      ]
    })
  # V roce 2018 už Praha 8 uvádí samostatná řízení Kultura a Volnočasové aktivity.
  out += [
    {'year':2018,'area':'Kultura','pages':['https://www.praha8.cz/Kultura-2018','https://m.praha8.cz/Kultura-2018']},
    {'year':2018,'area':'Volnočasové aktivity dětí a mládeže','pages':['https://www.praha8.cz/Volnocasove-nesportovni-aktivity-2018','https://m.praha8.cz/Volnocasove-nesportovni-aktivity-2018']},
  ]
  return out


def main():
  payload=arc.read_json(OUT,{})
  loaded=[];source_meta=[];loaded_keys=set();warnings=[]
  for source in sources():
    files=arc.discover(source)
    if not files:
      warnings.append(f"Archiv kultura/volný čas {source['year']}: nenalezen bezpečný výsledkový soubor")
      continue
    rows=[];qas=[]
    for href,label,ext,page in files:
      s={**source,'resolvedPage':page}
      try:
        found,qa=arc.parse(s,href,ext)
        rows.extend(found);qas.append({**qa,'file':href,'label':label})
      except Exception as exc:
        warnings.append(f"Archiv kultura/volný čas {source['year']} / {label}: {exc}")
    rows=arc.dedupe(rows)
    if not rows:continue
    loaded.extend(rows);loaded_keys.add((source['year'],source['area']))
    source_meta.append({'year':source['year'],'area':source['area'],'page':rows[0].get('sourcePage'),'kind':'archive','required':False,'status':'načteno','rows':len(rows),'qa':qas})
    print(f"✅ Archiv {source['area']} {source['year']}: {len(rows)} dotací")

  if not loaded_keys:
    print('ℹ️ Archiv kultura/volný čas: nic nového bezpečně načteno; data se nemění.')
    return

  existing=payload.get('grants') or []
  current=[g for g in existing if (int(g.get('year') or 0),g.get('area')) not in loaded_keys]
  combined=arc.dedupe(current+loaded)
  old_sources=[s for s in (payload.get('sources') or []) if (int(s.get('year') or 0),s.get('area')) not in loaded_keys]
  all_warnings=[w for w in (payload.get('meta',{}).get('warnings') or []) if not str(w).startswith('Archiv kultura/volný čas')]+warnings
  ares_qa=base.enrich_ares(combined,all_warnings)
  combined.sort(key=lambda x:(-int(x.get('year') or 0),x.get('area',''),x.get('recipient','').lower(),-(x.get('approvedCzk') or 0)))
  years=sorted({int(g['year']) for g in combined},reverse=True)
  counts={str(y):sum(1 for g in combined if int(g['year'])==y) for y in years}

  payload['schema']=max(int(payload.get('schema') or 0),12)
  payload['updated']=datetime.now(timezone.utc).isoformat()
  payload['grants']=combined
  payload['sources']=old_sources+source_meta
  payload['meta']={**payload.get('meta',{}),'records':len(combined),'years':years,
    'areas':sorted({g.get('area','') for g in combined if g.get('area')}),
    'warnings':all_warnings,'ares':ares_qa,'historyCounts':counts,
    'archiveCultureLoadedKeys':[f'{y}|{a}' for y,a in sorted(loaded_keys,key=lambda x:(-x[0],x[1]))]}
  base.atomic_write_json(OUT,payload)
  print(f'✅ Archiv kultura/volný čas: přidáno/obnoveno {len(loaded)} záznamů v {len(loaded_keys)} kombinacích.')

if __name__=='__main__':main()
