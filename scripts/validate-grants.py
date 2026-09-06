#!/usr/bin/env python3
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
DATA=ROOT/'data'/'dotace.json'

payload=json.loads(DATA.read_text(encoding='utf-8'))
grants=payload.get('grants') or []
meta=payload.get('meta') or {}

if not isinstance(grants,list):
  raise RuntimeError('dotace.json: grants není pole')
if len(grants)<2455:
  raise RuntimeError(f'dotace.json: podezřele málo záznamů ({len(grants)}; finální minimum je 2455)')
if int(meta.get('records') or 0)!=len(grants):
  raise RuntimeError(f'dotace.json: meta.records ({meta.get("records")}) nesouhlasí s počtem záznamů ({len(grants)})')

required_years=set(range(2008,2027))
years={int(g.get('year')) for g in grants if g.get('year') is not None}
missing=required_years-years
if missing:
  raise RuntimeError(f'dotace.json: chybí povinné roky {sorted(missing)}')

required_areas={
  'Kultura',
  'Kultura a volnočasové aktivity',
  'Volnočasové aktivity dětí a mládeže',
  'Sportovní výchova mládeže',
  'Sociální oblast',
  'Sport dospělí a dorost',
  'Zvelebování vzhledu MČ Praha 8'
}
areas={str(g.get('area') or '').strip() for g in grants}
missing_areas=required_areas-areas
if missing_areas:
  raise RuntimeError(f'dotace.json: chybí oblasti {sorted(missing_areas)}')

counts={y:sum(1 for g in grants if int(g.get('year') or 0)==y) for y in years}
minimums={2026:192,2025:220,2024:220,2023:220,2022:195,2021:180,2020:175,2019:180,2018:175,2017:110,2016:160,2015:135,2014:78,2013:56,2012:39,2011:29,2010:17,2009:13,2008:24}
for year,minimum in minimums.items():
  if counts.get(year,0)<minimum:
    raise RuntimeError(f'dotace.json: rok {year} má jen {counts.get(year,0)} záznamů, finální minimum je {minimum}')

modern_social={int(y) for y in meta.get('modernSocialLoadedYears',[])}
if not {2019,2020,2021}.issubset(modern_social):
  raise RuntimeError(f'dotace.json: chybí ověřené sociální roky 2019–2021; načteno {sorted(modern_social)}')
legacy_sport={int(y) for y in meta.get('legacySportLoadedYears',[])}
if not {2014,2015}.issubset(legacy_sport):
  raise RuntimeError(f'dotace.json: chybí ověřený sport dospělých 2014/2015; načteno {sorted(legacy_sport)}')
if int(meta.get('individualUnmatched') or 0)!=0:
  raise RuntimeError(f'dotace.json: zůstává {meta.get("individualUnmatched")} nevyřešených výslovných individuálních kandidátů')

current=[g for g in grants if int(g.get('year') or 0)==2026]
current_total=sum(float(g.get('approvedCzk') or 0) for g in current)
if round(current_total)!=19_455_000:
  raise RuntimeError(f'dotace.json: součet roku 2026 je {current_total}, očekáváno 19 455 000 Kč')

for i,g in enumerate(grants):
  if not str(g.get('recipient') or '').strip():
    raise RuntimeError(f'dotace.json: záznam {i} nemá příjemce')
  try:
    amount=float(g.get('approvedCzk') or 0)
  except Exception:
    raise RuntimeError(f'dotace.json: záznam {i} má neplatnou částku')
  if amount<=0:
    raise RuntimeError(f'dotace.json: záznam {i} má nekladnou schválenou částku')
  if not (g.get('sourcePage') or g.get('sourceFile') or g.get('resolutionUrl')):
    raise RuntimeError(f'dotace.json: záznam {i} nemá zdroj')

print(f'✅ Dotace QA: {len(grants)} záznamů · roky {sorted(years,reverse=True)} · 2026 celkem {round(current_total):,} Kč')
