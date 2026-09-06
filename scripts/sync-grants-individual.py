#!/usr/bin/env python3
import importlib.util,json,re
from collections import Counter
from datetime import datetime,timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
BASE_SCRIPT=ROOT/'scripts'/'sync-grants.py'
OUT=ROOT/'data'/'dotace.json'
USNESENI=ROOT/'data'/'usneseni.json'
MIN_YEAR=2015
AREA='Mimořádné dotace'
TYPE='mimořádná dotace'
LEGACY_AREAS={'Individuální dotace','Mimořádné dotace'}

spec=importlib.util.spec_from_file_location('grants_base_extraordinary',BASE_SCRIPT)
base=importlib.util.module_from_spec(spec); spec.loader.exec_module(base)

DONATION_MARKERS=('darovací smlouv','darovaci smlouv')

class TextParser(HTMLParser):
  def __init__(self):
    super().__init__(); self.parts=[]; self.skip=0
  def handle_starttag(self,tag,attrs):
    if tag in ('script','style'): self.skip+=1
  def handle_endtag(self,tag):
    if tag in ('script','style') and self.skip: self.skip-=1
  def handle_data(self,data):
    if not self.skip:self.parts.append(data)
  def text(self):return base.norm_text(' '.join(self.parts))

def read_json(path,fallback):
  try:return json.loads(path.read_text(encoding='utf-8'))
  except Exception:return fallback

def clean_name(name):
  name=base.norm_text(name).strip(' ,.;:-\"“”')
  name=re.sub(r'^(?:a|s|mezi|obdarovan(?:ý|á|ým|ou|ému|é)|spolku|spolkem|spolek|společnosti|společností|spolecnosti|organizaci|organizace|ústavu|ustavu|nadaci|nadace|obecně prospěšné společnosti|obecne prospesne spolecnosti)\s+','',name,flags=re.I)
  name=re.split(r'\s*,\s*(?:se sídlem|se sidlem|sídlo|sidlo|IČO|IČ|ICO|zastoupen|jako\s+[\"“”]?obdarovan)\b',name,maxsplit=1,flags=re.I)[0]
  return base.norm_text(name).strip(' ,.;:-\"“”')

def mc_role(text):
  """Vrátí roli Prahy 8 jen při výslovném přiřazení role přímo u názvu.

  Záměrně nepoužíváme široké okno stovek znaků: na stránce usnesení je text
  „Městská část Praha 8“ i v hlavičce a mohl by se omylem spojit s dárcem jiné
  organizace uvedeným až později v dokumentu.
  """
  q=base.norm_text(text).replace('“','\"').replace('”','\"').replace('„','\"').replace('·',' ')
  mc=r'(?:městsk(?:á|ou|é|ou|ou)?\s+část(?:i|í)?\s+praha\s*8|m[eě]stsk(?:a|ou|e)?\s+cast(?:i)?\s+praha\s*8|MČ\s+Praha\s*8)'
  donor=(
    rf'{mc}\s*,?\s*(?:jako\s+)?[\"]?dárc',
    rf'{mc}\s*,?\s*(?:jako\s+)?[\"]?darc',
    rf'(?:dárce|dárcem)\s*[:\-]?\s*(?:je\s+)?{mc}',
    rf'(?:darce|darcem)\s*[:\-]?\s*(?:je\s+)?{mc}'
  )
  recipient=(
    rf'{mc}\s*,?\s*(?:jako\s+)?[\"]?obdarovan',
    rf'(?:obdarovaný|obdarovaná|obdarovaným|obdarovanou|obdarovany|obdarovana|obdarovanym|obdarovanou)\s*[:\-]?\s*(?:je\s+)?{mc}'
  )
  if any(re.search(p,q,re.I|re.S) for p in donor):return 'donor'
  if any(re.search(p,q,re.I|re.S) for p in recipient):return 'recipient'
  return None

def recipient_from_text(text):
  q=base.norm_text(text).replace('“','\"').replace('”','\"').replace('„','\"').replace('·',' ')

  # Typický titul: „Darovací smlouvy mezi XYZ, jako obdarovaným, a MČ Praha 8, jako dárcem“.
  title_patterns=(
    r'darovací\s+smlouv(?:y|y\")?.{0,80}?\bmezi\s+(?P<name>.+?)\s*,\s*(?:jako\s+)?[\"]?obdarovan',
    r'darovaci\s+smlouv(?:y|y\")?.{0,80}?\bmezi\s+(?P<name>.+?)\s*,\s*(?:jako\s+)?[\"]?obdarovan'
  )
  for pat in title_patterns:
    m=re.search(pat,q,re.I|re.S)
    if m:
      name=clean_name(m.group('name'))
      if 2<len(name)<180 and 'městská část praha 8' not in name.lower() and 'mestska cast praha 8' not in name.lower():return name

  after_patterns=(
    r'(?:obdarovan(?:ý|á|ým|ou|ému|é))\s*(?:je|bude|:)?\s*(?P<name>.+?)(?=\s+(?:ve|v)\s+výši|,\s*(?:IČ|IČO|ICO|se sídlem|se sidlem|zastoupen)|[.;])',
    r'(?:obdarovany|obdarovana|obdarovanym|obdarovanou)\s*(?:je|bude|:)?\s*(?P<name>.+?)(?=\s+(?:ve|v)\s+vysi|,\s*(?:IC|ICO|se sidlem|zastoupen)|[.;])'
  )
  for pat in after_patterns:
    m=re.search(pat,q,re.I|re.S)
    if m:
      name=clean_name(m.group('name'))
      if 2<len(name)<180 and 'městská část praha 8' not in name.lower() and 'mestska cast praha 8' not in name.lower():return name

  before_patterns=(
    r'(?:\ba\b|\bs\b)\s+(?P<name>[^.;]{2,220}?)(?=,\s*(?:IČ|IČO|ICO|se sídlem|se sidlem|sídlo|sidlo|zastoupen)[^.;]{0,220},?\s*(?:jako\s+)?[\"“”]?obdarovan)',
    r'(?:\ba\b|\bs\b)\s+(?P<name>[^.;]{2,220}?)(?=,\s*(?:jako\s+)?[\"“”]?obdarovan)'
  )
  for pat in before_patterns:
    matches=list(re.finditer(pat,q,re.I|re.S))
    if matches:
      name=clean_name(matches[-1].group('name'))
      if 2<len(name)<180 and 'městská část praha 8' not in name.lower() and 'mestska cast praha 8' not in name.lower():return name

  got=base.extract_recipient(q)
  got=clean_name(got) if got else ''
  if got and 'městská část praha 8' not in got.lower() and 'mestska cast praha 8' not in got.lower():return got
  return ''

def czk_number(raw):
  s=str(raw or '').replace('\xa0',' ').strip()
  s=re.sub(r'\s+','',s)
  s=s.replace(',-','').replace(',-Kč','')
  # V českých dokumentech je tečka běžně oddělovač tisíců a čárka desetinná.
  if ',' in s:
    whole,dec=s.rsplit(',',1)
    whole=whole.replace('.','')
    s=whole+'.'+re.sub(r'\D','',dec)
  else:
    s=s.replace('.','')
  s=re.sub(r'[^0-9.]','',s)
  if not s:return None
  try:
    n=float(s)
    return round(n,2) if n>0 else None
  except Exception:return None

def extract_amount(text):
  q=base.norm_text(text).replace('·',' ')
  values=[]
  patterns=(
    r'(?:ve|v)\s+výši\s+([0-9][0-9\s\u00a0.]{0,20}(?:,\s*(?:-?|\d{1,2}))?)\s*Kč',
    r'(?:ve|v)\s+vysi\s+([0-9][0-9\s\u00a0.]{0,20}(?:,\s*(?:-?|\d{1,2}))?)\s*Kc',
    r'(?:částku|částka|finanční\s+dar(?:u)?|peněžitý\s+dar(?:u)?)\D{0,50}([0-9][0-9\s\u00a0.]{0,20}(?:,\s*(?:-?|\d{1,2}))?)\s*Kč',
    r'(?:castku|castka|financni\s+dar(?:u)?|penezity\s+dar(?:u)?)\D{0,50}([0-9][0-9\s\u00a0.]{0,20}(?:,\s*(?:-?|\d{1,2}))?)\s*Kc'
  )
  for pat in patterns:
    for m in re.finditer(pat,q,re.I|re.S):
      n=czk_number(m.group(1))
      if n and n not in values:values.append(n)
  if len(values)==1:return values[0]
  # Zachováme i původní bezpečný extraktor pro standardní zápis.
  fallback=base.extract_amount(q)
  if fallback is not None and fallback>0 and fallback not in values:values.append(float(fallback))
  return values[0] if len(values)==1 else None

def candidate(r):
  date=str(r.get('date') or '')
  try:year=int(date[:4])
  except Exception:return False
  if year<MIN_YEAR:return False
  # Základní filtr je výhradně název usnesení, jak je metodicky zamýšleno.
  title=base.norm_text(r.get('title')).lower()
  return any(x in title for x in DONATION_MARKERS)

def detail_text(r):
  local=base.norm_text(r.get('content'))
  url=r.get('url') or ''
  if not url:return local
  try:
    parser=TextParser();parser.feed(base.fetch_text(url));remote=parser.text()
    return base.norm_text((local+' '+remote).strip())
  except Exception as exc:
    print(f"⚠️ Mimořádná dotace {r.get('id')}: detail usnesení nelze načíst ({exc})")
    return local

def parse():
  resolutions=read_json(USNESENI,[])
  grants=[];unmatched=[];candidates=0;donor_candidates=0;noncash=0
  for r in resolutions if isinstance(resolutions,list) else []:
    if not candidate(r):continue
    candidates+=1
    title=base.norm_text(r.get('title'))
    title_role=mc_role(title)

    # Pokud už titul výslovně říká, že je Praha 8 obdarovaná, detail ani
    # nestahujeme. U ostatních kandidátů ověříme roli na oficiálním detailu.
    if title_role=='recipient':continue
    content=detail_text(r)
    text=base.norm_text(title+' '+content)
    role=title_role or mc_role(text)
    if role!='donor':continue
    donor_candidates+=1

    # Nepeněžní dary nejsou mimořádnou dotací v našem finančním přehledu.
    low=text.lower()
    if 'kč' not in low and ' kc' not in low and 'czk' not in low:
      noncash+=1
      continue

    block=base.approved_block(text)
    recipient=recipient_from_text(title) or recipient_from_text(block) or recipient_from_text(text)
    amount=extract_amount(block)
    if amount is None:amount=extract_amount(text)
    ico=base.extract_ico(block) or base.extract_ico(text)

    if not recipient or amount is None or float(amount)<=0:
      unmatched.append({'id':r.get('id'),'date':r.get('date'),'title':title,'reason':'příjemce' if not recipient else 'částka','recipientAttempt':recipient or '','amountAttempt':amount,'snippet':content[:900],'url':r.get('url')})
      continue

    low_recipient=recipient.lower()
    if 'hlavní město praha' in low_recipient or 'městská část praha 8' in low_recipient or 'mestska cast praha 8' in low_recipient:
      unmatched.append({'id':r.get('id'),'date':r.get('date'),'title':title,'reason':'vyloučen veřejný příjemce','recipientAttempt':recipient,'amountAttempt':amount,'snippet':content[:900],'url':r.get('url')})
      continue

    year=int(str(r.get('date'))[:4])
    grants.append({'year':year,'area':AREA,'type':TYPE,'recipient':recipient,'ico':ico,'project':title,'requestedCzk':None,'approvedCzk':float(amount),'decisionBody':r.get('organ') or None,'resolutionId':r.get('id'),'resolutionDate':r.get('date'),'resolutionUrl':r.get('url'),'sourcePage':r.get('url'),'sourceFile':None,'method':'peněžní dar – darovací smlouva; MČ Praha 8 je dárce'})

  seen=set();unique=[]
  for g in grants:
    key=(g.get('resolutionId'),g.get('recipient','').lower(),g.get('approvedCzk'))
    if key in seen:continue
    seen.add(key);unique.append(g)
  print(f'🔎 Mimořádné dotace: {candidates} usnesení s „Darovací smlouva“ v názvu; {donor_candidates} s MČ Praha 8 jako dárcem; {noncash} nepeněžních.')
  return unique,unmatched

def main():
  payload=read_json(OUT,{})
  existing=payload.get('grants') or []
  previous=[g for g in existing if g.get('area') in LEGACY_AREAS and int(g.get('year') or 0)>=MIN_YEAR]
  grants,unmatched=parse()
  if unmatched:
    print('🔎 Audit kandidátů mimořádných dotací (darovacích smluv):')
    for i,u in enumerate(unmatched,1):
      amount='—' if u.get('amountAttempt') is None else str(u.get('amountAttempt'));recipient=u.get('recipientAttempt') or '—'
      print(f"AUDIT {i:02d} | {u.get('date')} | {u.get('id')} | {u.get('reason')} | příjemce={recipient} | částka={amount}")
      print(f"  titul: {u.get('title')}");print(f"  text: {u.get('snippet')}");print(f"  zdroj: {u.get('url')}")
  if previous and not grants:raise RuntimeError(f'Mimořádné dotace: nový průchod našel 0 záznamů, ale dříve bylo publikováno {len(previous)}. Zachovávám poslední funkční dataset.')
  current=[g for g in existing if not (g.get('area') in LEGACY_AREAS and int(g.get('year') or 0)>=MIN_YEAR)]
  combined=current+grants
  warnings=[w for w in (payload.get('meta',{}).get('warnings') or []) if 'individuální dotace' not in str(w).lower() and 'mimořádné dotace' not in str(w).lower()]
  if unmatched:warnings.append(f'Mimořádné dotace {MIN_YEAR}–2026: {len(unmatched)} peněžních darovacích smluv, kde je MČ Praha 8 dárcem, nebylo možné bezpečně vytěžit; nejsou publikovány bez jednoznačného příjemce a částky.')
  ares_qa=base.enrich_ares(combined,warnings)
  combined.sort(key=lambda x:(-int(x.get('year') or 0),x.get('area',''),x.get('recipient','').lower(),-(x.get('approvedCzk') or 0)))
  years=sorted({int(g['year']) for g in combined},reverse=True);counts={str(y):sum(1 for g in combined if int(g['year'])==y) for y in years}
  old_sources=[s for s in (payload.get('sources') or []) if s.get('area') not in LEGACY_AREAS]
  by_year=Counter(g['year'] for g in grants)
  source_meta=[{'year':year,'area':AREA,'page':'data/usneseni.json','kind':'resolution-title+official-detail','required':False,'status':'načteno','qa':{'rows':count}} for year,count in sorted(by_year.items(),reverse=True)]
  payload['schema']=max(int(payload.get('schema') or 0),22);payload['updated']=datetime.now(timezone.utc).isoformat();payload['grants']=combined;payload['sources']=old_sources+source_meta
  payload['meta']={**payload.get('meta',{}),'records':len(combined),'years':years,'areas':sorted({g.get('area','') for g in combined if g.get('area')}),'warnings':warnings,'ares':ares_qa,'historyCounts':counts,'individualRows':len(grants),'individualUnmatched':len(unmatched),'extraordinaryRows':len(grants),'extraordinaryUnmatched':len(unmatched),'extraordinaryYears':sorted(by_year,reverse=True),'extraordinaryPolicy':'Mimořádná dotace = peněžní dar schválený formou darovací smlouvy, v níž je Městská část Praha 8 dárcem. Kandidáty vybíráme jen z usnesení s „Darovací smlouva“ v názvu; dary, kde je Praha 8 obdarovaná, ani nepeněžní převody se nezahrnují.'}
  base.atomic_write_json(OUT,payload)
  print(f'✅ Mimořádné dotace: {len(grants)} bezpečně vytěžených peněžních darů z let {MIN_YEAR}–2026; {len(unmatched)} kandidátů ponecháno mimo publikaci.')

if __name__=='__main__':main()
