#!/usr/bin/env python3
import json,re
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
DATA=ROOT/'data'/'dotace.json'

payload=json.loads(DATA.read_text(encoding='utf-8'))
grants=payload.get('grants') or []
meta=payload.get('meta') or {}
errors=[]


def fail(message):
  errors.append(str(message))


if not isinstance(grants,list):
  fail('dotace.json: grants není pole')
  grants=[]

# Po opravě historických tabulek mohou zmizet řádky typu „součet všech projektů“.
# Minimum proto hlídá skutečný objem databáze, ne dřívější chybné souhrnné řádky.
if len(grants)<2400:
  fail(f'dotace.json: podezřele málo záznamů ({len(grants)}; bezpečné minimum je 2400)')
if int(meta.get('records') or 0)!=len(grants):
  fail(f'dotace.json: meta.records ({meta.get("records")}) nesouhlasí s počtem záznamů ({len(grants)})')

required_years=set(range(2008,2027))
years=set()
for g in grants:
  try:years.add(int(g.get('year')))
  except Exception:pass
missing=required_years-years
if missing:
  fail(f'dotace.json: chybí povinné roky {sorted(missing)}')

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
  fail(f'dotace.json: chybí oblasti {sorted(missing_areas)}')

counts={y:sum(1 for g in grants if int(g.get('year') or 0)==y) for y in years}
minimums={2026:192,2025:220,2024:220,2023:220,2022:195,2021:180,2020:175,2019:180,2018:175,2017:105,2016:155,2015:130,2014:73,2013:54,2012:37,2011:29,2010:17,2009:13,2008:24}
for year,minimum in minimums.items():
  if counts.get(year,0)<minimum:
    fail(f'dotace.json: rok {year} má jen {counts.get(year,0)} záznamů, bezpečné minimum je {minimum}')

modern_social={int(y) for y in meta.get('modernSocialLoadedYears',[])}
if not {2019,2020,2021}.issubset(modern_social):
  fail(f'dotace.json: chybí ověřené sociální roky 2019–2021; načteno {sorted(modern_social)}')
legacy_sport={int(y) for y in meta.get('legacySportLoadedYears',[])}
if not {2014,2015}.issubset(legacy_sport):
  fail(f'dotace.json: chybí ověřený sport dospělých 2014/2015; načteno {sorted(legacy_sport)}')
extra_unmatched=int(meta.get('extraordinaryUnmatched',meta.get('individualUnmatched',0)) or 0)
if extra_unmatched!=0:
  fail(f'dotace.json: zůstává {extra_unmatched} nevyřešených kandidátů mimořádných dotací')

# Pevný kontrolní součet 2026 se vztahuje jen na dosavadní programové dotace.
# Nově doplněné peněžní dary (mimořádné dotace) se kontrolují samostatně a
# nesmějí rozbít historický referenční součet 19 455 000 Kč.
current_program=[g for g in grants if int(g.get('year') or 0)==2026 and g.get('area')!='Mimořádné dotace' and str(g.get('type') or '').lower()!='mimořádná dotace']
current_program_total=sum(float(g.get('approvedCzk') or 0) for g in current_program)
if round(current_program_total)!=19_455_000:
  fail(f'dotace.json: součet programových dotací roku 2026 je {current_program_total}, očekáváno 19 455 000 Kč')

extraordinary=[g for g in grants if g.get('area')=='Mimořádné dotace' or str(g.get('type') or '').lower()=='mimořádná dotace']
for g in extraordinary:
  if str(g.get('type') or '').lower()!='mimořádná dotace':
    fail(f'dotace.json: mimořádná dotace {g.get("resolutionId") or g.get("recipient")} má neočekávaný typ')
  if 'MČ Praha 8 je dárce' not in str(g.get('method') or ''):
    fail(f'dotace.json: mimořádná dotace {g.get("resolutionId") or g.get("recipient")} nemá potvrzenou metodiku dárce')


def invalid_recipient(value):
  raw=str(value or '').strip()
  if '|' in raw:return True
  name=raw.strip(' |\t')
  if not name or not any(ch.isalnum() for ch in name):return True
  low=re.sub(r'\s+',' ',name.casefold()).strip(' .,:;|-–—')
  bad={
    'celkem','součet','soucet','celkem přiděleno','celkem prideleno',
    'součet všech projektů','soucet vsech projektu','součet projektů','soucet projektu',
    'žadatel','zadatel','příjemce','prijemce','organizace','název organizace','nazev organizace'
  }
  if low in bad:return True
  if 'součet' in low or 'soucet' in low or low.startswith('celkem') or 'celkem projekt' in low:return True
  return False


ico_in_name=re.compile(r'(?:\bIČO?\b|\bICO\b)\s*[:.]?\s*\d{8}\s*$',re.I)
paren_ico_in_name=re.compile(r'\(\d{8}\)\s*$')

for i,g in enumerate(grants):
  recipient=str(g.get('recipient') or '').strip()
  if invalid_recipient(recipient):
    fail(f'dotace.json: záznam {i} má neplatného příjemce {recipient!r}')
  if ico_in_name.search(recipient) or paren_ico_in_name.search(recipient):
    fail(f'dotace.json: záznam {i} má IČ chybně uložené v názvu příjemce {recipient!r}')
  try:
    amount=float(g.get('approvedCzk') or 0)
  except Exception:
    fail(f'dotace.json: záznam {i} má neplatnou částku')
    amount=0
  if amount<=0:
    fail(f'dotace.json: záznam {i} má nekladnou schválenou částku')
  if not (g.get('sourcePage') or g.get('sourceFile') or g.get('resolutionUrl')):
    fail(f'dotace.json: záznam {i} nemá zdroj')

extra_total=sum(float(g.get('approvedCzk') or 0) for g in extraordinary)

if errors:
  print(f'❌ Dotace QA našla {len(errors)} chyb. Vypisuji všechny, ne jen první:')
  for n,message in enumerate(errors,1):
    print(f'  {n:02d}. {message}')
  raise RuntimeError(f'dotace.json: QA našla {len(errors)} chyb; viz kompletní seznam výše')

print(f'✅ Dotace QA: {len(grants)} záznamů · roky {sorted(years,reverse=True)} · programové dotace 2026 {round(current_program_total):,} Kč · mimořádné dotace {len(extraordinary)} záznamů / {round(extra_total):,} Kč')
