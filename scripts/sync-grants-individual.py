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
DONATION_MARKERS=('darovací smlouv','darovaci smlouv')

spec=importlib.util.spec_from_file_location('grants_base_extraordinary',BASE_SCRIPT)
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)

class TextParser(HTMLParser):
  def __init__(self):super().__init__();self.parts=[];self.skip=0
  def handle_starttag(self,tag,attrs):
    if tag in ('script','style'):self.skip+=1
  def handle_endtag(self,tag):
    if tag in ('script','style') and self.skip:self.skip-=1
  def handle_data(self,data):
    if not self.skip:self.parts.append(data)
  def text(self):return norm(' '.join(self.parts))

def norm(v):
  return base.norm_text(v).replace('“','"').replace('”','"').replace('„','"').replace('·',' ')

def read_json(path,fallback):
  try:return json.loads(path.read_text(encoding='utf-8'))
  except Exception:return fallback

def clean_name(name):
  name=norm(name).strip(' ,.;:-"')
  name=re.sub(r'^(?:a|s|mezi|organizací|organizaci|organizace|spolkem|spolek|společností|společnosti)\s+','',name,flags=re.I)
  # Starší usnesení často píší IČ přímo za názvem bez čárky, např.
  # „... (církevní organizace) IČ: 49371480“. IČ do názvu příjemce nepatří.
  name=re.split(r'\s*(?:,\s*)?(?:se sídlem|se sidlem|sídlo|sidlo|IČO|IČ|ICO|zastoupen|jako\s+"?obdarovan)\b',name,maxsplit=1,flags=re.I)[0]
  return norm(name).strip(' ,.;:-"')

def candidate(r):
  try:year=int(str(r.get('date') or '')[:4])
  except Exception:return False
  if year<MIN_YEAR:return False
  # Kandidáty vybíráme výhradně z názvu usnesení.
  title=norm(r.get('title')).lower()
  return any(x in title for x in DONATION_MARKERS)

def mc_role(text):
  q=norm(text)
  mc=r'(?:městsk(?:á|ou|é)\s+část(?:i|í)?\s+praha\s*8|mestska\s+cast(?:i)?\s+praha\s*8|MČ\s+Praha\s*8)'
  donor=(rf'{mc}\s*,?\s*(?:na\s+straně\s+jedné\s*,?\s*)?(?:jako\s+)?"?dárc',rf'(?:dárce|dárcem)\s*[:\-]?\s*(?:je\s+)?{mc}')
  recipient=(rf'{mc}\s*,?\s*(?:na\s+straně\s+jedné\s*,?\s*)?(?:jako\s+)?"?obdarovan',rf'(?:obdarovaný|obdarovaná|obdarovaným|obdarovanou)\s*[:\-]?\s*(?:je\s+)?{mc}')
  if any(re.search(p,q,re.I|re.S) for p in recipient):return 'recipient'
  if any(re.search(p,q,re.I|re.S) for p in donor):return 'donor'
  return None

def explicit_noncash(text):
  q=norm(text).lower()
  markers=(
    'věcného daru','vecneho daru','věcný dar','vecny dar','věcném daru','vecnem daru',
    'darování movitého majetku','darovani moviteho majetku','darování movité věci','darovani movite veci',
    'darování majetku','darovani majetku','movitého majetku','moviteho majetku'
  )
  return any(x in q for x in markers)

def monetary_evidence(text):
  q=norm(text)
  patterns=(
    r'finančn\w*\s+dar\w*',r'financn\w*\s+dar\w*',r'peněž\w*\s+dar\w*',r'penez\w*\s+dar\w*',
    r'dar\w*\s+(?:ve|v)\s+výši\s+[0-9]',r'dar\w*\s+(?:ve|v)\s+vysi\s+[0-9]',
    r'dar\w*\s+(?:v\s+částce|částku)\s+[0-9]',r'dar\w*\s+(?:v\s+castce|castku)\s+[0-9]',
    r'(?:částka|částku|castka|castku)\D{0,30}[0-9][0-9 .\u00a0,]*\s*(?:Kč|Kc|CZK)'
  )
  return any(re.search(p,q,re.I|re.S) for p in patterns)

def recipient_from_text(text):
  q=norm(text)
  mc=r'(?:městsk(?:á|ou|é)\s+část(?:i|í)?\s+praha\s*8|mestska\s+cast(?:i)?\s+praha\s*8|MČ\s+Praha\s*8)'
  patterns=(
    # Praha 8 je první smluvní stranou / dárcem.
    rf'{mc}\s*,?\s*(?:na\s+straně\s+jedné\s*,?\s*)?(?:jako\s+)?"?dárc\w*"?\s*,?\s*(?:a|s)\s+(?P<name>.+?)(?=\s*,?\s*(?:na\s+straně\s+druhé\s*,?\s*)?(?:jako\s+)?"?obdarovan)',
    # Obdarovaný je uveden první, Praha 8 až za ním.
    rf'\bmezi\s+(?P<name>.+?)(?=\s*,?\s*(?:jako\s+)?"?obdarovan\w*"?\s*,?\s*(?:a|s)\s+{mc})',
    # Role Prahy 8 je potvrzena z detailu, titul uvádí jen dvě strany.
    rf'darovací\s+smlouv\w*.*?\bmezi\s+{mc}\s+(?:a|s)\s+(?P<name>.+?)(?=$|\s*,\s*(?:o\s+darování|ve\s+věci|na\s+podporu))',
    rf'darovaci\s+smlouv\w*.*?\bmezi\s+{mc}\s+(?:a|s)\s+(?P<name>.+?)(?=$|\s*,\s*(?:o\s+darovani|ve\s+veci|na\s+podporu))'
  )
  for pat in patterns:
    m=re.search(pat,q,re.I|re.S)
    if not m:continue
    name=clean_name(m.group('name'))
    low=name.lower()
    if 2<len(name)<200 and 'městská část praha 8' not in low and 'mestska cast praha 8' not in low:return name
  got=base.extract_recipient(q)
  got=clean_name(got) if got else ''
  low=got.lower()
  if got and 'městská část praha 8' not in low and 'mestska cast praha 8' not in low:return got
  return ''

def czk_number(raw):
  s=str(raw or '').replace('\xa0',' ').strip();s=re.sub(r'\s+','',s);s=s.replace(',-','')
  if ',' in s:
    whole,dec=s.rsplit(',',1);whole=whole.replace('.','');digits=re.sub(r'\D','',dec);s=whole+('.'+digits if digits else '')
  else:s=s.replace('.','')
  s=re.sub(r'[^0-9.]','',s)
  if not s:return None
  try:
    n=float(s);return round(n,2) if n>0 else None
  except Exception:return None

def extract_amount(text):
  q=norm(text);values=[]
  money=r'([0-9][0-9\s\u00a0.]{0,20}(?:,\s*(?:-?|\d{1,2}))?)\s*(?:Kč|Kc|CZK)'
  prefixes=(
    r'(?:ve|v)\s+(?:výši|vysi)\s+',
    r'(?:částku|částka|castku|castka)\D{0,35}',
    r'(?:finančn\w*|financn\w*|peněž\w*|penez\w*)\s+dar\w*\D{0,80}',
    r'dar\w*\s+(?:v\s+částce|v\s+castce|ve\s+výši|ve\s+vysi)\s+'
  )
  for prefix in prefixes:
    for m in re.finditer(prefix+money,q,re.I|re.S):
      n=czk_number(m.group(1))
      if n and n not in values:values.append(n)
  if len(values)==1:return values[0]
  return None

def recipient_ico(text,recipient):
  if not recipient:return ''
  q=norm(text);needle=norm(recipient)
  pos=q.lower().find(needle.lower())
  if pos<0:return ''
  # Nejprve vezmeme IČ bezprostředně za názvem obdarovaného. Tím zabráníme,
  # aby se z širšího bloku omylem vzalo IČ dárce nebo jiné smluvní strany.
  tail=q[pos+len(needle):pos+len(needle)+120]
  m=re.search(r'^\s*[,;]?\s*(?:IČO|IČ|ICO)\s*[:.]?\s*(\d{8})\b',tail,re.I)
  if m:
    ico=base.norm_ico(m.group(1))
    if ico and ico!='00063797':return ico
  window=q[pos:pos+450]
  ico=base.extract_ico(window)
  # IČ MČ Praha 8 nesmí být omylem přiřazeno obdarovanému.
  return '' if ico=='00063797' else ico

def detail_text(r):
  local=norm(r.get('content'));url=r.get('url') or ''
  if not url:return local
  try:
    parser=TextParser();parser.feed(base.fetch_text(url));return norm((local+' '+parser.text()).strip())
  except Exception as exc:
    print(f"⚠️ Mimořádná dotace {r.get('id')}: detail usnesení nelze načíst ({exc})");return local

def parse():
  resolutions=read_json(USNESENI,[])
  grants=[];unmatched=[];candidates=donor_candidates=noncash=unproven=0
  for r in resolutions if isinstance(resolutions,list) else []:
    if not candidate(r):continue
    candidates+=1;title=norm(r.get('title'));title_role=mc_role(title)
    if title_role=='recipient':continue
    content=detail_text(r);text=norm(title+' '+content);role=title_role or mc_role(text)
    if role!='donor':continue
    donor_candidates+=1

    # Výslovně věcné/majetkové dary nejsou finanční dotací, i když je u nich uvedena hodnota v Kč.
    if explicit_noncash(title) or explicit_noncash(base.approved_block(text)):
      noncash+=1;continue

    block=base.approved_block(text)
    # Bez pozitivního důkazu, že jde o peněžní/finanční dar, záznam raději nezařadíme.
    # Není to chyba importu: jde o konzervativní vyloučení neurčeného typu daru.
    if not (monetary_evidence(block) or monetary_evidence(title)):
      unproven+=1;continue

    recipient=recipient_from_text(title) or recipient_from_text(block) or recipient_from_text(text)
    amount=extract_amount(block)
    if amount is None:amount=extract_amount(text)
    if not recipient or amount is None or amount<=0:
      unmatched.append({'id':r.get('id'),'date':r.get('date'),'title':title,'reason':'příjemce' if not recipient else 'částka','recipientAttempt':recipient or '','amountAttempt':amount,'snippet':content[:900],'url':r.get('url')});continue

    low=recipient.lower()
    if 'hlavní město praha' in low or 'městská část praha 8' in low or 'mestska cast praha 8' in low:
      unmatched.append({'id':r.get('id'),'date':r.get('date'),'title':title,'reason':'vyloučen veřejný příjemce','recipientAttempt':recipient,'amountAttempt':amount,'snippet':content[:900],'url':r.get('url')});continue

    year=int(str(r.get('date'))[:4]);ico=recipient_ico(block,recipient) or recipient_ico(text,recipient)
    grants.append({'year':year,'area':AREA,'type':TYPE,'recipient':recipient,'ico':ico,'project':title,'requestedCzk':None,'approvedCzk':float(amount),'decisionBody':r.get('organ') or None,'resolutionId':r.get('id'),'resolutionDate':r.get('date'),'resolutionUrl':r.get('url'),'sourcePage':r.get('url'),'sourceFile':None,'method':'peněžní dar – darovací smlouva; MČ Praha 8 je dárce'})

  seen=set();unique=[]
  for g in grants:
    key=(g.get('resolutionId'),g.get('recipient','').casefold(),g.get('approvedCzk'))
    if key not in seen:seen.add(key);unique.append(g)
  print(f'🔎 Mimořádné dotace: {candidates} usnesení s „Darovací smlouva“ v názvu; {donor_candidates} s MČ Praha 8 jako dárcem; {noncash} výslovně nepeněžních; {unproven} bez bezpečného důkazu peněžního daru.')
  return unique,unmatched,unproven,noncash

def main():
  payload=read_json(OUT,{});existing=payload.get('grants') or []
  previous=[g for g in existing if g.get('area') in LEGACY_AREAS and int(g.get('year') or 0)>=MIN_YEAR]
  grants,unmatched,unproven,noncash=parse()
  if unmatched:
    print('🔎 Audit skutečně peněžních kandidátů, které se nepodařilo bezpečně vytěžit:')
    for i,u in enumerate(unmatched,1):
      print(f"AUDIT {i:02d} | {u.get('date')} | {u.get('id')} | {u.get('reason')} | příjemce={u.get('recipientAttempt') or '—'} | částka={u.get('amountAttempt') if u.get('amountAttempt') is not None else '—'}")
      print(f"  titul: {u.get('title')}");print(f"  zdroj: {u.get('url')}")
  if previous and not grants:raise RuntimeError(f'Mimořádné dotace: nový průchod našel 0 záznamů, ale dříve bylo publikováno {len(previous)}. Zachovávám poslední funkční dataset.')

  current=[g for g in existing if not (g.get('area') in LEGACY_AREAS and int(g.get('year') or 0)>=MIN_YEAR)]
  combined=current+grants
  warnings=[w for w in (payload.get('meta',{}).get('warnings') or []) if 'individuální dotace' not in str(w).lower() and 'mimořádné dotace' not in str(w).lower()]
  if unmatched:warnings.append(f'Mimořádné dotace {MIN_YEAR}–2026: {len(unmatched)} prokazatelně peněžních darovacích smluv nebylo možné bezpečně vytěžit; nejsou publikovány.')
  if unproven:warnings.append(f'Mimořádné dotace {MIN_YEAR}–2026: {unproven} darovacích smluv s MČ Praha 8 jako dárcem nebylo z textu usnesení možné bezpečně označit za peněžní dar; nejsou zahrnuty.')
  ares_qa=base.enrich_ares(combined,warnings)
  combined.sort(key=lambda x:(-int(x.get('year') or 0),x.get('area',''),x.get('recipient','').casefold(),-(x.get('approvedCzk') or 0)))
  years=sorted({int(g['year']) for g in combined},reverse=True);counts={str(y):sum(1 for g in combined if int(g['year'])==y) for y in years}
  old_sources=[s for s in (payload.get('sources') or []) if s.get('area') not in LEGACY_AREAS];by_year=Counter(g['year'] for g in grants)
  source_meta=[{'year':year,'area':AREA,'page':'data/usneseni.json','kind':'resolution-title+official-detail','required':False,'status':'načteno','qa':{'rows':count}} for year,count in sorted(by_year.items(),reverse=True)]
  payload['schema']=max(int(payload.get('schema') or 0),23);payload['updated']=datetime.now(timezone.utc).isoformat();payload['grants']=combined;payload['sources']=old_sources+source_meta
  payload['meta']={**payload.get('meta',{}),'records':len(combined),'years':years,'areas':sorted({g.get('area','') for g in combined if g.get('area')}),'warnings':warnings,'ares':ares_qa,'historyCounts':counts,'individualRows':len(grants),'individualUnmatched':len(unmatched),'extraordinaryRows':len(grants),'extraordinaryUnmatched':len(unmatched),'extraordinaryUnprovenMoney':unproven,'extraordinaryNoncash':noncash,'extraordinaryYears':sorted(by_year,reverse=True),'extraordinaryPolicy':'Mimořádná dotace = prokazatelně peněžní dar schválený formou darovací smlouvy, v níž je Městská část Praha 8 dárcem. Kandidáty vybíráme jen z usnesení s „Darovací smlouva“ v názvu. Výslovně věcné dary a případy bez bezpečného důkazu peněžního plnění se nezahrnují.'}
  base.atomic_write_json(OUT,payload)
  print(f'✅ Mimořádné dotace: {len(grants)} bezpečně vytěžených peněžních darů; {len(unmatched)} nevyřešených peněžních kandidátů; {unproven} neurčených; {noncash} nepeněžních.')

if __name__=='__main__':main()
