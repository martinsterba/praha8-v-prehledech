#!/usr/bin/env python3
"""Historické granty kultury a volného času 2009–2018.

V letech před rozdělením dotačních řízení Praha 8 zveřejňovala kulturu a
volnočasové nesportovní aktivity v jedné společné výsledkové tabulce. Proto je
nepřepisujeme uměle do dvou dnešních kategorií, ale zachováváme historický
název oblasti. Starší stránky zároveň nemají jednotné URL, takže je dohledáváme
i přes oficiální archivní rozcestník 2009–2018.
"""
import importlib.util,re
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
ARCHIVE_SCRIPT=ROOT/'scripts'/'sync-grants-archive.py'
OUT=ROOT/'data'/'dotace.json'
ARCHIVE_INDEXES=['https://www.praha8.cz/2009-2018','https://m.praha8.cz/2009-2018']

spec=importlib.util.spec_from_file_location('grants_archive_common',ARCHIVE_SCRIPT)
arc=importlib.util.module_from_spec(spec);spec.loader.exec_module(arc)
base=arc.base

_INDEX_LINKS=None

def index_links():
  global _INDEX_LINKS
  if _INDEX_LINKS is not None:return _INDEX_LINKS
  links=[]
  for url in ARCHIVE_INDEXES:
    try:links.extend((label,href,url) for label,href in arc.html_links(url))
    except Exception:continue
  seen=set();out=[]
  for label,href,page in links:
    if href in seen:continue
    seen.add(href);out.append((label,href,page))
  _INDEX_LINKS=out
  return out

def archive_pages_for(year):
  pages=[]
  for label,href,_ in index_links():
    low=(label+' '+href).lower()
    if str(year) not in low:continue
    if any(ext in low for ext in ['.xlsx','.xls','.docx','.doc','.pdf']):continue
    if any(k in low for k in ['kultur','volno','grant']):pages.append(href)
  return pages

def direct_archive_files(source):
  # Některé verze archivního rozcestníku odkazují rovnou na výsledkový soubor.
  ranked=[]
  for label,href,page in index_links():
    low=(label+' '+href).lower()
    if str(source['year']) not in low:continue
    item=arc.score_link(label,href)
    if item:
      score,file_url,file_label,ext=item
      ranked.append((score,file_url,file_label,ext,page))
  if not ranked:return []
  ranked.sort(key=lambda x:x[0],reverse=True)
  best=ranked[0][0]
  return [(href,label,ext,page) for score,href,label,ext,page in ranked if score>=best-1]

def sources():
  out=[]
  for year in range(2009,2018):
    pages=[
      f'https://www.praha8.cz/Kultura-a-volnocasove-nesportovni-aktivity-{year}',
      f'https://www.praha8.cz/Granty-Kultura-a-volnocasove-nesportovni-aktivity-{year}',
      f'https://m.praha8.cz/Kultura-a-volnocasove-nesportovni-aktivity-{year}',
      f'https://m.praha8.cz/Granty-Kultura-a-volnocasove-nesportovni-aktivity-{year}',
    ]
    pages.extend(archive_pages_for(year))
    out.append({'year':year,'area':'Kultura a volnočasové aktivity','pages':list(dict.fromkeys(pages))})
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
    if source['year']<2018:
      files=list(dict.fromkeys(files+direct_archive_files(source)))
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
