#!/usr/bin/env python3
"""Sociální granty 2008–2014 ze starých výsledkových XLS/DOC souborů.

Tyto roky mají na oficiálním webu Prahy 8 výsledky označené jako
„Kompletní seznam přidělených grantů“ nebo „Přehled podpořených žádostí“.
Obecný archivní filtr slovo „žádost“ z bezpečnostních důvodů odmítá, proto
mají tyto jasně označené výsledkové dokumenty vlastní úzký importer.
"""
import importlib.util,json,re
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
ARCHIVE_SCRIPT=ROOT/'scripts'/'sync-grants-archive.py'
OUT=ROOT/'data'/'dotace.json'

spec=importlib.util.spec_from_file_location('grants_archive_legacy_social',ARCHIVE_SCRIPT)
arc=importlib.util.module_from_spec(spec);spec.loader.exec_module(arc)
base=arc.base

SOURCES=[
  {'year':2008,'page':'https://www.praha8.cz/Granty-v-socialni-oblasti-2008'},
  {'year':2009,'page':'https://www.praha8.cz/Granty-v-socialni-oblasti-2009'},
  {'year':2010,'page':'https://www.praha8.cz/Granty-v-socialni-oblasti-2010'},
  {'year':2011,'page':'https://www.praha8.cz/Granty-v-socialni-oblasti-2011'},
  {'year':2012,'page':'https://www.praha8.cz/Granty-v-socialni-oblasti-2012'},
  {'year':2013,'page':'https://www.praha8.cz/Granty-v-socialni-oblasti-2013'},
  {'year':2014,'page':'https://www.praha8.cz/Granty-v-socialni-oblasti-2014'},
]

def result_files(src):
  out=[]
  for label,href in arc.html_links(src['page']):
    low=(label+' '+href).lower()
    ext='doc' if '.doc' in low and '.docx' not in low else ('docx' if '.docx' in low else ('xls' if '.xls' in low and '.xlsx' not in low else ('xlsx' if '.xlsx' in low else None)))
    if not ext:continue
    result=('přehled podpořen' in low or 'prehled podporen' in low or 'kompletní seznam přidělen' in low or 'kompletni seznam pridelen' in low)
    if src['year']==2008 and re.search(r'\bgranty\s*[12]\b',low):result=True
    if result:out.append((href,label,ext))
  seen=set();unique=[]
  for item in out:
    if item[0] in seen:continue
    seen.add(item[0]);unique.append(item)
  return unique

def dedupe(rows):return arc.dedupe(rows)

def main():
  payload=arc.read_json(OUT,{})
  loaded=[];loaded_keys=set();source_meta=[];warnings=[]
  for src in SOURCES:
    files=result_files(src)
    if not files:
      warning=f"Archiv Sociální oblast {src['year']}: nenalezen oficiální výsledkový soubor"
      warnings.append(warning);print('⚠️',warning)
      continue
    rows=[];qas=[]
    for href,label,ext in files:
      source={'year':src['year'],'area':'Sociální oblast','resolvedPage':src['page']}
      try:
        found,qa=arc.parse(source,href,ext)
        rows.extend(found);qas.append({**qa,'file':href,'label':label})
      except Exception as exc:
        warning=f"Archiv Sociální oblast {src['year']} / {label}: {exc}"
        warnings.append(warning);print('⚠️',warning)
        # Dočasná diagnostika pouze pro chybějící ročník 2011; nevstupuje do datasetu.
        if src['year']==2011 and ext=='doc':
          try:
            sample=arc.doc_rows(base.fetch_bytes(href))[:25]
            print('🔎 2011 DOC sample:',json.dumps(sample,ensure_ascii=False))
          except Exception as debug_exc:
            print('🔎 2011 DOC sample nelze načíst:',debug_exc)
    rows=dedupe(rows)
    if not rows:continue
    loaded.extend(rows);loaded_keys.add((src['year'],'Sociální oblast'))
    source_meta.append({'year':src['year'],'area':'Sociální oblast','page':src['page'],'kind':'archive-legacy-social','required':False,'status':'načteno','rows':len(rows),'qa':qas})
    print(f"✅ Archiv Sociální oblast {src['year']}: {len(rows)} dotací")

  if not loaded_keys:
    print('ℹ️ Starý sociální archiv: nic nového bezpečně načteno; data se nemění.')
    return

  existing=payload.get('grants') or []
  current=[g for g in existing if (int(g.get('year') or 0),g.get('area')) not in loaded_keys]
  combined=dedupe(current+loaded)
  old_sources=[s for s in (payload.get('sources') or []) if (int(s.get('year') or 0),s.get('area')) not in loaded_keys]
  all_warnings=[w for w in (payload.get('meta',{}).get('warnings') or []) if not str(w).startswith('Archiv Sociální oblast')]+warnings
  ares_qa=base.enrich_ares(combined,all_warnings)
  combined.sort(key=lambda x:(-int(x.get('year') or 0),x.get('area',''),str(x.get('recipient','')).lower(),-(x.get('approvedCzk') or 0)))
  years=sorted({int(g['year']) for g in combined},reverse=True)
  counts={str(y):sum(1 for g in combined if int(g['year'])==y) for y in years}
  payload['schema']=max(int(payload.get('schema') or 0),14)
  payload['updated']=datetime.now(timezone.utc).isoformat()
  payload['grants']=combined;payload['sources']=old_sources+source_meta
  payload['meta']={**payload.get('meta',{}),'records':len(combined),'years':years,
    'areas':sorted({g.get('area','') for g in combined if g.get('area')}),
    'warnings':all_warnings,'ares':ares_qa,'historyCounts':counts,
    'legacySocialLoadedYears':sorted([y for y,_ in loaded_keys],reverse=True)}
  base.atomic_write_json(OUT,payload)
  print(f'✅ Starý sociální archiv: přidáno/obnoveno {len(loaded)} záznamů v {len(loaded_keys)} ročnících.')

if __name__=='__main__':main()
