#!/usr/bin/env python3
"""Bezpečný vstup pro aktualizaci aktuálního ročníku dotací.

Původní sync-grants.py umí správně sestavit aktuální rok, ale historicky vznikl
jako samostatný importer a zapisuje nový dotace.json od nuly. V kompletním
pipeline by tím před historickými kroky dočasně zahodil starší roky a některé
staré oblasti, které už na hlavním rozcestníku nejsou snadno znovu objevitelné.

Tento wrapper proto před spuštěním uchová poslední validní historii a po
úspěšném sestavení aktuálního roku ji atomicky připojí zpět. Historické
importéry pak jednotlivé roky/oblasti bezpečně obnoví, pokud mají novější
ověřený zdroj. Krátkodobé chyby webu Prahy 8 (typicky HTTP 500) zkoušíme
několikrát, aby jednorázový výpadek zbytečně neshodil celý týdenní běh.
"""
import importlib.util,json,time
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
BASE_SCRIPT=ROOT/'scripts'/'sync-grants.py'
OUT=ROOT/'data'/'dotace.json'
CURRENT_YEAR=2026
MAX_ATTEMPTS=3

spec=importlib.util.spec_from_file_location('grants_current_base',BASE_SCRIPT)
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)


def read_payload():
  try:return json.loads(OUT.read_text(encoding='utf-8'))
  except Exception:return {'grants':[],'sources':[],'meta':{}}


def dedupe(rows):
  out=[];seen=set()
  for g in rows:
    key=(int(g.get('year') or 0),g.get('area'),g.get('ico') or str(g.get('recipient','')).lower(),str(g.get('project','')).lower(),g.get('approvedCzk'),g.get('resolutionId'))
    if key in seen:continue
    seen.add(key);out.append(g)
  return out


def run_current_with_retry():
  last=None
  for attempt in range(1,MAX_ATTEMPTS+1):
    try:
      base.main()
      if attempt>1:print(f'✅ Aktuální grantové zdroje uspěly na pokus {attempt}/{MAX_ATTEMPTS}.')
      return
    except Exception as exc:
      last=exc
      if attempt>=MAX_ATTEMPTS:break
      wait=5*attempt
      print(f'⚠️ Aktuální grantové zdroje: pokus {attempt}/{MAX_ATTEMPTS} selhal ({exc}). Opakuji za {wait} s.')
      time.sleep(wait)
  raise last


def main():
  before=read_payload()
  preserved=[g for g in (before.get('grants') or []) if int(g.get('year') or 0)!=CURRENT_YEAR]
  preserved_sources=[s for s in (before.get('sources') or []) if int(s.get('year') or 0)!=CURRENT_YEAR]

  # Zapíše pouze nový aktuální ročník. Při chybě base.main() používá atomický zápis
  # a wrapper skončí dřív, takže poslední produkční soubor zůstane beze změny.
  run_current_with_retry()
  fresh=read_payload()
  current=[g for g in (fresh.get('grants') or []) if int(g.get('year') or 0)==CURRENT_YEAR]
  combined=dedupe(current+preserved)
  combined.sort(key=lambda x:(-int(x.get('year') or 0),x.get('area',''),str(x.get('recipient','')).lower(),-(x.get('approvedCzk') or 0)))

  years=sorted({int(g.get('year') or 0) for g in combined if g.get('year')},reverse=True)
  counts={str(y):sum(1 for g in combined if int(g.get('year') or 0)==y) for y in years}
  fresh['grants']=combined
  fresh['sources']=(fresh.get('sources') or [])+preserved_sources
  fresh['schema']=max(int(before.get('schema') or 0),int(fresh.get('schema') or 0),13)
  fresh['meta']={
    **before.get('meta',{}),
    **fresh.get('meta',{}),
    'records':len(combined),
    'years':years,
    'areas':sorted({g.get('area','') for g in combined if g.get('area')}),
    'historyCounts':counts,
    'currentYearPreservedHistory':True,
  }
  base.atomic_write_json(OUT,fresh)
  print(f'✅ Aktuální rok {CURRENT_YEAR}: {len(current)} záznamů; zachováno {len(preserved)} historických záznamů.')

if __name__=='__main__':main()
