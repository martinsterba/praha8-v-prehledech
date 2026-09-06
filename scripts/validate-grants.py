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
if len(grants)<1300:
  raise RuntimeError(f'dotace.json: podezřele málo záznamů ({len(grants)})')
if int(meta.get('records') or 0)!=len(grants):
  raise RuntimeError(f'dotace.json: meta.records ({meta.get("records")}) nesouhlasí s počtem záznamů ({len(grants)})')

required_years={2019,2020,2021,2022,2023,2024,2025,2026}
years={int(g.get('year')) for g in grants if g.get('year') is not None}
missing=required_years-years
if missing:
  raise RuntimeError(f'dotace.json: chybí povinné roky {sorted(missing)}')

required_areas={
  'Kultura',
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
minimums={2026:190,2025:200,2024:140,2023:140,2022:190,2021:100,2020:100,2019:70}
for year,minimum in minimums.items():
  if counts.get(year,0)<minimum:
    raise RuntimeError(f'dotace.json: rok {year} má jen {counts.get(year,0)} záznamů, minimum je {minimum}')

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

print(f'✅ Dotace QA: {len(grants)} záznamů · roky {sorted(years,reverse=True)}')
