#!/usr/bin/env python3
import importlib.util,json,re
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
BASE_SCRIPT=ROOT/'scripts'/'sync-grants.py'
OUT=ROOT/'data'/'dotace.json'
USNESENI=ROOT/'data'/'usneseni.json'
MIN_YEAR=2015
AREA='Individuální dotace'

spec=importlib.util.spec_from_file_location('grants_base_individual',BASE_SCRIPT)
base=importlib.util.module_from_spec(spec); spec.loader.exec_module(base)

PROGRAM_WORDS=(
  'vyhlášení dotačního řízení','vyhlaseni dotacniho rizeni',
  'dotační řízení v oblasti','dotacni rizeni v oblasti',
  'grantové řízení','grantove rizeni',
  'podání žádosti','podani zadosti',
  'výsledky dotačního řízení','vysledky dotacniho rizeni'
)
PROGRAM_AREAS=(
  'v oblasti kultury','volnočasov','volnocasov','sportovní výchov',
  'sportovni vychov','sociální oblasti','socialni oblasti'
)
INDIVIDUAL_MARKERS=(
  'individuální dotac','individualni dotac',
  'mimořádn','mimoradn'
)
# Ruční audit všech 34 dřívějších kandidátů ukázal, že šlo o falešné zásahy:
# vzory smluv, dodatky a smlouvy pro vlastní příspěvkové organizace, nikoli
# identifikovatelné individuální dotace externím příjemcům.
FALSE_POSITIVE_MARKERS=(
  'příspěvkovými organizacemi městské části praha 8',
  'prispevkovymi organizacemi mestske casti praha 8',
  'příspěvkovou organizací městské části praha 8',
  'prispevkovou organizaci mestske casti praha 8',
  'vzorového textu','vzoroveho textu',
  'vzorového textu veřejnoprávní smlouvy','vzoroveho textu verejnopravni smlouvy',
  'znění veřejnoprávní smlouvy','zneni verejnopravni smlouvy',
  'změna návrhu vzorového textu','zmena navrhu vzoroveho textu'
)

def read_json(path,fallback):
  try:return json.loads(path.read_text(encoding='utf-8'))
  except Exception:return fallback

def clean_name(name):
  name=base.norm_text(name).strip(' ,.;:-"“”')
  name=re.sub(r'^(?:spolku|spolek|společnosti|spolecnosti|organizaci|organizace|ústavu|ustavu|nadaci|nadace|obecně prospěšné společnosti|obecne prospesne spolecnosti)\s+','',name,flags=re.I)
  name=re.split(r'\s*,\s*(?:se sídlem|se sidlem|sídlo|sidlo|IČO|IČ|ICO)\b',name,maxsplit=1,flags=re.I)[0]
  return base.norm_text(name).strip(' ,.;:-"“”')

def recipient_from_text(text):
  got=base.extract_recipient(text)
  if got:return got
  q=text.replace('“','"').replace('”','"').replace('„','"')
  patterns=[
    r'(?:poskytnutí|poskytnuti)\s+(?:individuální|individualni|mimořádné|mimoradne)?\s*dotace\s+(?:pro|subjektu|organizaci|spolku|společnosti|spolecnosti|ústavu|ustavu|nadaci)?\s*(?P<name>.+?)(?=\s+(?:ve|v)\s+výši|,\s*(?:IČ|IČO|ICO|se sídlem|se sidlem)|\s+na\s+(?:projekt|akci|činnost|cinnost))',
    r'(?:uzavření|uzavreni)\s+veřejnoprávní\s+smlouvy.+?\s+s\s+(?P<name>.+?)(?=,\s*(?:IČ|IČO|ICO|se sídlem|se sidlem)|\s+jako\s+příjemcem)',
    r'(?:příjemcem|prijemcem)\s+(?:dotace\s+)?(?:je|bude)?\s*(?P<name>.+?)(?=,\s*(?:IČ|IČO|ICO|se sídlem|se sidlem)|\s+(?:ve|v)\s+výši)'
  ]
  for pat in patterns:
    m=re.search(pat,q,re.I|re.S)
    if m:
      name=clean_name(m.group('name'))
      if 2<len(name)<180 and 'městská část praha 8' not in name.lower():
        return name
  return ''

def candidate(r):
  if r.get('organ')!='Rada':return False
  date=str(r.get('date') or '')
  try:year=int(date[:4])
  except Exception:return False
  if year<MIN_YEAR:return False
  title=base.norm_text(r.get('title'))
  content=base.norm_text(r.get('content'))
  text=(title+' '+content).lower()
  if 'dotac' not in text:return False
  if any(x in text for x in PROGRAM_WORDS):return False
  if any(x in title.lower() for x in PROGRAM_AREAS):return False
  if any(x in text for x in FALSE_POSITIVE_MARKERS):return False
  if re.search(r'městsk(?:á|ou) část(?:í)? Praha\s*8.{0,100}jako\s+["“”]?příjemcem',text,re.I):return False
  if ('hlavním městem prahou' in text or 'hl. m. prah' in text) and 'poskytovatelem' in text:return False
  if 'z rozpočtu hl. m. prahy' in text or 'z rozpočtu hlavního města prahy' in text:return False

  # Po auditu už obecné „veřejnoprávní smlouvy o poskytnutí dotace“ bez dalšího
  # nepovažujeme za individuální dotaci. Musí být výslovně označena jako
  # individuální nebo mimořádná; tím nepublikujeme smluvní šablony ani programy.
  return any(x in text for x in INDIVIDUAL_MARKERS)

def parse():
  resolutions=read_json(USNESENI,[])
  grants=[]; unmatched=[]
  for r in resolutions if isinstance(resolutions,list) else []:
    if not candidate(r):continue
    title=base.norm_text(r.get('title'))
    content=base.norm_text(r.get('content'))
    text=title+' '+content
    block=base.approved_block(text)
    recipient=recipient_from_text(block) or recipient_from_text(text)
    amount=base.extract_amount(block)
    if amount is None:
      amount=base.extract_amount(text)
    if not recipient or amount is None:
      unmatched.append({
        'id':r.get('id'),'date':r.get('date'),'title':title,
        'reason':'příjemce' if not recipient else 'částka',
        'recipientAttempt':recipient or '',
        'amountAttempt':amount,
        'snippet':base.norm_text(content)[:360],
        'url':r.get('url')
      })
      continue
    low_recipient=recipient.lower()
    if 'hlavní město praha' in low_recipient or 'městská část praha 8' in low_recipient:
      unmatched.append({
        'id':r.get('id'),'date':r.get('date'),'title':title,
        'reason':'vyloučen veřejný poskytovatel/příjemce',
        'recipientAttempt':recipient,'amountAttempt':amount,
        'snippet':base.norm_text(content)[:360],
        'url':r.get('url')
      })
      continue
    year=int(str(r.get('date'))[:4])
    grants.append({
      'year':year,'area':AREA,'type':'individuální dotace',
      'recipient':recipient,'ico':base.extract_ico(block) or base.extract_ico(text),
      'project':title,'requestedCzk':None,'approvedCzk':amount,
      'decisionBody':'Rada','resolutionId':r.get('id'),'resolutionDate':r.get('date'),
      'resolutionUrl':r.get('url'),'sourcePage':r.get('url'),'sourceFile':None
    })
  seen=set(); unique=[]
  for g in grants:
    key=(g.get('resolutionId'),g.get('recipient','').lower(),g.get('approvedCzk'))
    if key in seen:continue
    seen.add(key); unique.append(g)
  return unique,unmatched

def main():
  payload=read_json(OUT,{})
  existing=payload.get('grants') or []
  previous=[g for g in existing if g.get('area')==AREA and int(g.get('year') or 0)>=MIN_YEAR]
  grants,unmatched=parse()

  # Audit je pouze v logu workflow, nevstupuje do veřejného datasetu.
  if unmatched:
    print('🔎 Audit kandidátů individuálních dotací:')
    for i,u in enumerate(unmatched,1):
      amount='—' if u.get('amountAttempt') is None else str(u.get('amountAttempt'))
      recipient=u.get('recipientAttempt') or '—'
      print(f"AUDIT {i:02d} | {u.get('date')} | {u.get('id')} | {u.get('reason')} | příjemce={recipient} | částka={amount}")
      print(f"  titul: {u.get('title')}")
      print(f"  text: {u.get('snippet')}")
      print(f"  zdroj: {u.get('url')}")

  if previous and not grants:
    raise RuntimeError(f'Individuální dotace: nový průchod našel 0 záznamů, ale publikováno je {len(previous)}. Zachovávám poslední funkční dataset.')

  current=[g for g in existing if not (g.get('area')==AREA and int(g.get('year') or 0)>=MIN_YEAR)]
  combined=current+grants
  warnings=[w for w in (payload.get('meta',{}).get('warnings') or []) if 'individuální dotace' not in str(w).lower()]
  if unmatched:
    warnings.append(f'Individuální dotace {MIN_YEAR}–2026: {len(unmatched)} výslovných kandidátů nebylo možné bezpečně vytěžit; nejsou publikovány bez jednoznačného příjemce a částky.')

  ares_qa=base.enrich_ares(combined,warnings)
  combined.sort(key=lambda x:(-int(x.get('year') or 0),x.get('area',''),x.get('recipient','').lower(),-(x.get('approvedCzk') or 0)))
  years=sorted({int(g['year']) for g in combined},reverse=True)
  counts={str(y):sum(1 for g in combined if int(g['year'])==y) for y in years}

  old_sources=[s for s in (payload.get('sources') or []) if s.get('area')!=AREA]
  by_year=Counter(g['year'] for g in grants)
  source_meta=[
    {'year':year,'area':AREA,'page':'data/usneseni.json','kind':'resolution-dataset','required':False,
     'status':'načteno','qa':{'rows':count}}
    for year,count in sorted(by_year.items(),reverse=True)
  ]

  payload['schema']=max(int(payload.get('schema') or 0),18)
  payload['updated']=datetime.now(timezone.utc).isoformat()
  payload['grants']=combined
  payload['sources']=old_sources+source_meta
  payload['meta']={
    **payload.get('meta',{}),
    'records':len(combined),'years':years,
    'areas':sorted({g.get('area','') for g in combined if g.get('area')}),
    'warnings':warnings,'ares':ares_qa,'historyCounts':counts,
    'individualRows':len(grants),'individualUnmatched':len(unmatched),
    'individualYears':sorted(by_year,reverse=True),
    'individualPolicy':'Jen výslovně označené individuální nebo mimořádné dotace s jednoznačným příjemcem a částkou; smluvní šablony, dodatky a dotace vlastním příspěvkovým organizacím se nepovažují za individuální dotace.'
  }
  base.atomic_write_json(OUT,payload)
  print(f'✅ Individuální dotace: {len(grants)} bezpečně vytěžených z let {MIN_YEAR}–2026; {len(unmatched)} výslovných kandidátů ponecháno mimo publikaci.')

if __name__=='__main__':main()
