#!/usr/bin/env python3
import io,json,os,re,tempfile,time,urllib.request,zipfile
from datetime import datetime,timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'data'/'dotace.json'
USNESENI=ROOT/'data'/'usneseni.json'
ARES_CACHE=ROOT/'data'/'grants-ares-cache.json'
UA='Praha8-v-prehledech/3.0.13 (+public-data-indexer; public sources only)'
ARES_BASE='https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/'

SOURCES=[
  {'year':2026,'area':'Kultura','page':'https://m.praha8.cz/Granty-Kultura-2026','kind':'xlsx','required':True},
  {'year':2026,'area':'Volnočasové aktivity dětí a mládeže','page':'https://m.praha8.cz/granty-volnocasove-nesportovni-aktivity-2026','kind':'xlsx','required':True},
  {'year':2026,'area':'Sportovní výchova mládeže','page':'https://www.praha8.cz/Granty-Sportovni-vychova-mladeze-2026','kind':'xlsx','required':True},
  {
    'year':2026,'area':'Sociální oblast',
    'page':'https://m.praha8.cz/appo/usn/676?usn=2paI5LABKyLbK1pbxsh2U6i5yktw%3D%3D',
    'publicPage':'https://www.praha8.cz/Dotace-v-socialni-oblasti-2026',
    'kind':'xlsx','required':True,
    'decisionBody':'Rada','resolutionId':'Usn RMC 0223/2026','resolutionDate':'2026-05-27'
  }
]

class LinkParser(HTMLParser):
  def __init__(self): super().__init__(); self.links=[]; self.href=None; self.text=[]
  def handle_starttag(self,tag,attrs):
    if tag=='a': self.href=dict(attrs).get('href'); self.text=[]
  def handle_data(self,data):
    if self.href is not None: self.text.append(data)
  def handle_endtag(self,tag):
    if tag=='a' and self.href is not None:
      self.links.append((self.href,' '.join(''.join(self.text).split())))
      self.href=None; self.text=[]

def fetch_bytes(url,timeout=45):
  req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'*/*'})
  with urllib.request.urlopen(req,timeout=timeout) as r: return r.read()

def fetch_text(url): return fetch_bytes(url).decode('utf-8','replace')

def fetch_json(url): return json.loads(fetch_bytes(url).decode('utf-8','replace'))

def discover_file(page,kind):
  p=LinkParser(); p.feed(fetch_text(page))
  ext='.'+kind.lower()
  candidates=[]
  for href,text in p.links:
    full=urljoin(page,href)
    low=(full+' '+text).lower()
    if ext in low and ('poskytnut' in low or 'výsled' in low or 'vysled' in low or 'dotace' in low): candidates.append((full,text))
  if not candidates:
    for href,text in p.links:
      full=urljoin(page,href)
      if ext in full.lower(): candidates.append((full,text))
  return candidates[0] if candidates else (None,None)

def col_num(ref):
  m=re.match(r'[A-Z]+',ref or '')
  if not m:return 0
  n=0
  for ch in m.group(0): n=n*26+ord(ch)-64
  return n-1

def norm_text(v): return re.sub(r'\s+',' ',str(v or '')).strip()

def plain(v):
  return norm_text(v).lower().normalize('NFD') if False else norm_text(v).lower()

def norm_ico(v):
  s=re.sub(r'\D','',str(v or ''))
  if not s or len(s)>8:return ''
  s=s.zfill(8)
  if s=='00000000':return ''
  a=[int(x) for x in s]; total=sum(a[i]*(8-i) for i in range(7)); check=(11-(total%11))%10
  return s if a[7]==check else ''

def split_recipient_ico(recipient,explicit_ico=''):
  recipient=norm_text(recipient)
  ico=norm_ico(explicit_ico)
  if ico:return recipient,ico
  m=re.search(r'\s*\((\d{8})\)\s*$',recipient)
  if not m:return recipient,''
  candidate=norm_ico(m.group(1))
  if not candidate:return recipient,''
  return norm_text(recipient[:m.start()]),candidate

def money(v):
  if v is None:return None
  s=str(v).strip().replace('\xa0',' ').replace('Kč','').replace('CZK','').replace(' ','').replace(',','.')
  s=re.sub(r'[^0-9.\-]','',s)
  if not s:return None
  try:return round(float(s),2)
  except:return None

def xlsx_rows(blob):
  z=zipfile.ZipFile(io.BytesIO(blob))
  ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
  shared=[]
  if 'xl/sharedStrings.xml' in z.namelist():
    root=ET.fromstring(z.read('xl/sharedStrings.xml'))
    for si in root.findall('m:si',ns): shared.append(''.join(t.text or '' for t in si.findall('.//m:t',ns)))
  wb=ET.fromstring(z.read('xl/workbook.xml')); first=wb.find('m:sheets/m:sheet',ns)
  rel_id=first.attrib.get('{%s}id'%ns['r'])
  rels=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
  target=None
  for rel in rels:
    if rel.attrib.get('Id')==rel_id: target=rel.attrib['Target']; break
  if not target: raise RuntimeError('XLSX neobsahuje odkaz na první list')
  sheet_path='xl/'+target.lstrip('/') if not target.startswith('xl/') else target
  root=ET.fromstring(z.read(sheet_path)); rows=[]
  for row in root.findall('.//m:sheetData/m:row',ns):
    vals={}
    for c in row.findall('m:c',ns):
      idx=col_num(c.attrib.get('r','A1')); typ=c.attrib.get('t'); v=c.find('m:v',ns)
      if typ=='inlineStr': val=''.join(t.text or '' for t in c.findall('.//m:t',ns))
      elif v is None: val=''
      elif typ=='s':
        try: val=shared[int(v.text)]
        except: val=''
      else: val=v.text or ''
      vals[idx]=norm_text(val)
    if vals:
      width=max(vals)+1; rows.append([vals.get(i,'') for i in range(width)])
  return rows

def find_header(rows):
  for i,row in enumerate(rows[:40]):
    txt=' | '.join(norm_text(x).lower() for x in row)
    hits=sum(any(k in txt for k in group) for group in [
      ('žadatel','zadatel','příjemce','prijemce','organizace','název poskytovatele služby'),('ič','ico'),('projekt','název','nazev','služba','sluzba'),('schválen','schvalen','poskytnut','dotace','částka','castka')])
    if hits>=3:return i
  return None

def map_cols(header):
  out={}
  for i,h in enumerate(header):
    x=norm_text(h).lower()
    if not x:continue
    if 'ič' in x or re.search(r'\bico\b',x):out.setdefault('ico',i)
    if any(k in x for k in ['žadatel','zadatel','příjemce','prijemce','organizace','subjekt','poskytovatel služby']):out.setdefault('recipient',i)
    if any(k in x for k in ['projekt','název projektu','nazev projektu','účel','ucel','sociální služba','socialni sluzba','název služby','nazev sluzby']):out.setdefault('project',i)
    if 'požad' in x or 'pozad' in x:out.setdefault('requested',i)
    if any(k in x for k in ['schválen','schvalen','poskytnut','přidělen','pridelen','výše dotace','vyse dotace','částka dotace','castka dotace']):out.setdefault('approved',i)
  return out

def parse_program(source,file_url,blob):
  rows=xlsx_rows(blob); hi=find_header(rows)
  if hi is None: raise RuntimeError(f"{source['area']}: nenašel jsem záhlaví XLSX")
  cols=map_cols(rows[hi])
  if 'recipient' not in cols or 'approved' not in cols: raise RuntimeError(f"{source['area']}: chybí sloupec příjemce nebo schválená částka")
  grants=[]
  for r in rows[hi+1:]:
    get=lambda k: r[cols[k]] if k in cols and cols[k]<len(r) else ''
    recipient,ico=split_recipient_ico(get('recipient'),get('ico'))
    approved=money(get('approved'))
    if not recipient or approved is None or approved<=0: continue
    grants.append({
      'year':source['year'],'area':source['area'],'type':'programová','recipient':recipient,
      'ico':ico,'project':norm_text(get('project')),'requestedCzk':money(get('requested')),
      'approvedCzk':approved,'decisionBody':source.get('decisionBody'),'resolutionId':source.get('resolutionId'),
      'resolutionDate':source.get('resolutionDate'),'resolutionUrl':source.get('page') if source.get('resolutionId') else None,
      'sourcePage':source.get('publicPage') or source['page'],'sourceFile':file_url
    })
  if not grants: raise RuntimeError(f"{source['area']}: XLSX neobsahuje žádné schválené dotace")
  return grants,{'headerRow':hi+1,'columns':cols,'rows':len(grants)}

def read_json(path,fallback):
  try:return json.loads(path.read_text(encoding='utf-8'))
  except:return fallback

def approved_block(text):
  low=text.lower()
  pos=low.find('schvaluje')
  if pos<0:return text
  block=text[pos:]
  ends=[x for x in (block.lower().find('ukládá'),block.lower().find('uklada')) if x>0]
  return block[:min(ends)] if ends else block

def extract_amount(text):
  vals=[]
  for m in re.finditer(r'(?:ve|v)\s+výši\s+([0-9][0-9\s\u00a0.]{0,18}(?:,[0-9]{1,2})?)\s*Kč',text,re.I):
    n=money(m.group(1))
    if n and n>0 and n not in vals:vals.append(n)
  return vals[0] if len(vals)==1 else None

def clean_recipient_name(name):
  name=norm_text(name).strip(' ,.;:-"“”')
  name=re.sub(r'^(?:spolkem|společností|spolecnosti|organizací|organizaci|ústavem|ustavem|nadací|nadaci|obecně prospěšnou společností)\s+','',name,flags=re.I)
  name=re.split(r'\s*,\s*(?:se sídlem|sidlo|sídlo|IČO|IČ|ICO)\b',name,maxsplit=1,flags=re.I)[0]
  return norm_text(name).strip(' ,.;:-"“”')

def extract_recipient(text):
  q=text.replace('“','"').replace('”','"').replace('„','"')
  patterns=[
    r'mezi\s+městskou\s+částí\s+Praha\s*8.{0,180}?jako\s+["\']?poskytovatelem["\']?.{0,120}?\ba\s+(?P<name>.+?)\s*,?\s*jako\s+["\']?příjemcem["\']?',
    r'mezi\s+MČ\s+Praha\s*8.{0,180}?jako\s+["\']?poskytovatelem["\']?.{0,120}?\ba\s+(?P<name>.+?)\s*,?\s*jako\s+["\']?příjemcem["\']?',
    r'poskytnutí\s+(?:individuální\s+|mimořádné\s+)?dotace\s+(?:spolku|společnosti|organizaci|organizaci|ústavu|nadaci)\s+(?P<name>.+?)(?=\s+(?:ve|v)\s+výši|,\s*(?:IČ|IČO|se sídlem|sídlo))'
  ]
  for pat in patterns:
    m=re.search(pat,q,re.I|re.S)
    if m:
      name=clean_recipient_name(m.group('name'))
      if 2<len(name)<180:return name
  return ''

def extract_ico(text):
  for m in re.finditer(r'\bIČ(?:O)?\s*[:č.]?\s*(\d{8})\b',text,re.I):
    ico=norm_ico(m.group(1))
    if ico:return ico
  return ''

def individual_candidate(r):
  if r.get('organ')!='Rada' or not str(r.get('date','')).startswith('2026'):return False
  title=norm_text(r.get('title')); content=norm_text(r.get('content')); text=(title+' '+content).lower()
  if 'dotac' not in text:return False
  if any(x in text for x in ['vyhlášení dotačního řízení','vyhlaseni dotacniho rizeni','podání žádosti','podani zadosti']):return False
  if any(x in title.lower() for x in ['v oblasti kultury','volnočasov','volnocasov','sportovní výchov','sportovni vychov','sociální oblasti','socialni oblasti']):return False
  if re.search(r'městsk(?:á|ou) část(?:í)? Praha\s*8.{0,80}jako\s+["“”]?příjemcem',text,re.I):return False
  if 'hlavním městem prahou jako' in text and 'poskytovatelem' in text:return False
  if 'z rozpočtu hl. m. prahy' in text or 'z rozpočtu hlavního města prahy' in text:return False
  return ('veřejnoprávní smlouv' in text or 'verejnopravni smlouv' in text or 'poskytnutí dotace' in text or 'poskytnuti dotace' in text)

def parse_individual_grants():
  resolutions=read_json(USNESENI,[])
  grants=[]; unmatched=[]
  for r in resolutions if isinstance(resolutions,list) else []:
    if not individual_candidate(r):continue
    title=norm_text(r.get('title')); content=norm_text(r.get('content')); text=title+' '+content
    block=approved_block(text)
    recipient=extract_recipient(block) or extract_recipient(text)
    amount=extract_amount(block)
    if not recipient or amount is None:
      unmatched.append({'id':r.get('id'),'title':title,'reason':'příjemce' if not recipient else 'částka'})
      continue
    if re.search(r'hlavní(?:m)?\s+měst(?:o|em)\s+praha',recipient,re.I):
      unmatched.append({'id':r.get('id'),'title':title,'reason':'vyloučen HMP'});continue
    grants.append({
      'year':int(str(r.get('date'))[:4]),'area':'Individuální dotace','type':'individuální dotace',
      'recipient':recipient,'ico':extract_ico(block) or extract_ico(text),'project':title,
      'requestedCzk':None,'approvedCzk':amount,'decisionBody':'Rada','resolutionId':r.get('id'),
      'resolutionDate':r.get('date'),'resolutionUrl':r.get('url'),'sourcePage':r.get('url'),'sourceFile':None
    })
  seen=set(); unique=[]
  for g in grants:
    key=(g.get('resolutionId'),g.get('recipient','').lower(),g.get('approvedCzk'))
    if key in seen:continue
    seen.add(key);unique.append(g)
  return unique,unmatched

def load_ares_cache():
  data=read_json(ARES_CACHE,{})
  return data if isinstance(data,dict) else {}

def save_ares_cache(cache): atomic_write_json(ARES_CACHE,cache)

def enrich_ares(grants,warnings):
  cache=load_ares_cache(); changed=False; looked_up=0; renamed=0
  for g in grants:
    ico=norm_ico(g.get('ico'))
    if not ico:continue
    entry=cache.get(ico)
    if not entry:
      try:
        raw=fetch_json(ARES_BASE+ico)
        name=norm_text(raw.get('obchodniJmeno'))
        entry={'name':name,'updated':datetime.now(timezone.utc).isoformat()} if name else {'name':'','updated':datetime.now(timezone.utc).isoformat()}
        cache[ico]=entry; changed=True; looked_up+=1
        time.sleep(0.08)
      except Exception as e:
        warnings.append(f'ARES {ico}: {e}')
        cache[ico]={'name':'','updated':datetime.now(timezone.utc).isoformat(),'error':str(e)};changed=True
        continue
    official=norm_text(entry.get('name'))
    if official and official!=g.get('recipient'):
      g['recipientSourceName']=g.get('recipient')
      g['recipient']=official;renamed+=1
  if changed:save_ares_cache(cache)
  return {'lookedUp':looked_up,'renamed':renamed,'cacheSize':len(cache)}

def atomic_write_json(path,payload):
  path.parent.mkdir(parents=True,exist_ok=True)
  data=json.dumps(payload,ensure_ascii=False,indent=2)+'\n'
  fd,tmp=tempfile.mkstemp(prefix=path.name+'.',suffix='.tmp',dir=path.parent)
  try:
    with os.fdopen(fd,'w',encoding='utf-8') as f:
      f.write(data); f.flush(); os.fsync(f.fileno())
    os.replace(tmp,path)
  except Exception:
    try: os.unlink(tmp)
    except OSError: pass
    raise

def main():
  all_grants=[]; src_meta=[]; warnings=[]; required_failures=[]
  for s in SOURCES:
    try:
      file_url,label=discover_file(s['page'],s['kind'])
      if not file_url: raise RuntimeError('nenalezen zdrojový soubor')
      grants,qa=parse_program(s,file_url,fetch_bytes(file_url)); all_grants.extend(grants)
      src_meta.append({**s,'file':file_url,'label':label,'status':'načteno','qa':qa})
      print(f"✅ {s['area']} {s['year']}: {len(grants)} dotací")
    except Exception as e:
      src_meta.append({**s,'status':'chyba','error':str(e)}); warnings.append(f"{s['area']} {s['year']}: {e}")
      if s.get('required'): required_failures.append(f"{s['area']} {s['year']}: {e}")
      print(f"❌ {s['area']} {s['year']}: {e}")

  if required_failures:
    raise RuntimeError('Import odmítnut: selhal povinný zdroj: '+'; '.join(required_failures))

  individual,unmatched=parse_individual_grants(); all_grants.extend(individual)
  if unmatched:
    warnings.append(f"Individuální dotace 2026: {len(unmatched)} kandidátů z usnesení nebylo bezpečně vytěženo; nejsou publikovány bez ručního ověření.")
  src_meta.append({'year':2026,'area':'Individuální dotace','page':'data/usneseni.json','kind':'resolution-dataset','required':False,'status':'načteno','qa':{'rows':len(individual),'unmatchedCandidates':unmatched}})
  print(f"✅ Individuální dotace z usnesení Rady 2026: {len(individual)} bezpečně vytěžených; {len(unmatched)} kandidátů k ruční kontrole")

  if len(all_grants)<10:
    raise RuntimeError(f'Import odmítnut: načteno podezřele málo dotačních záznamů ({len(all_grants)}).')

  ares_qa=enrich_ares(all_grants,warnings)
  print(f"✅ ARES: {ares_qa['renamed']} názvů sjednoceno podle IČO; cache {ares_qa['cacheSize']} subjektů")

  all_grants.sort(key=lambda x:(-x['year'],x['area'],x['recipient'].lower(),-(x['approvedCzk'] or 0)))
  payload={
    'schema':2,'updated':datetime.now(timezone.utc).isoformat(),'source':'https://www.praha8.cz/Granty-a-dotace.html',
    'meta':{
      'records':len(all_grants),'years':sorted({x['year'] for x in all_grants},reverse=True),
      'areas':sorted({x['area'] for x in all_grants}),'warnings':warnings,
      'ares':ares_qa,'individualUnmatched':len(unmatched),
      'note':'Programové a sociální dotace jsou načítány z oficiálních tabulek. Individuální dotace se bezpečně vytěžují z usnesení Rady; nejednoznačné kandidáty importér raději vynechá. Dotace, kde je MČ Praha 8 příjemcem od HMP či jiného poskytovatele, se nezahrnují.'
    },
    'sources':src_meta,'grants':all_grants
  }
  atomic_write_json(OUT,payload)
  print(f"\n✅ HOTOVO: {len(all_grants)} dotací atomicky zapsáno do data/dotace.json")

if __name__=='__main__': main()
