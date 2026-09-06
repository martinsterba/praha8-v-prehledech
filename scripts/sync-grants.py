#!/usr/bin/env python3
import io,json,re,sys,urllib.request,zipfile
from datetime import datetime,timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'data'/'dotace.json'
UA='Praha8-v-prehledech/3.0.13 (+public-data-indexer; public sources only)'

SOURCES=[
  {'year':2026,'area':'Kultura','page':'https://m.praha8.cz/Granty-Kultura-2026','kind':'xlsx'},
  {'year':2026,'area':'Volnočasové aktivity dětí a mládeže','page':'https://m.praha8.cz/granty-volnocasove-nesportovni-aktivity-2026','kind':'xlsx'},
  {'year':2026,'area':'Sportovní výchova mládeže','page':'https://www.praha8.cz/Granty-Sportovni-vychova-mladeze-2026','kind':'xlsx'},
  {'year':2026,'area':'Sociální oblast','page':'https://www.praha8.cz/Dotace-v-socialni-oblasti-2026','kind':'pdf'}
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

def discover_file(page,kind):
  p=LinkParser(); p.feed(fetch_text(page))
  ext='.'+kind.lower()
  candidates=[]
  for href,text in p.links:
    full=urljoin(page,href)
    low=(full+' '+text).lower()
    if ext in low and ('poskytnut' in low or 'výsled' in low or 'vysled' in low): candidates.append((full,text))
  if not candidates:
    for href,text in p.links:
      full=urljoin(page,href)
      if ext in full.lower(): candidates.append((full,text))
  return candidates[0] if candidates else (None,None)

def col_num(ref):
  n=0
  for ch in re.match(r'[A-Z]+',ref or '').group(0): n=n*26+ord(ch)-64
  return n-1

def norm_text(v): return re.sub(r'\s+',' ',str(v or '')).strip()

def norm_ico(v):
  s=re.sub(r'\D','',str(v or ''))
  if not s: return ''
  if len(s)>8:return ''
  s=s.zfill(8)
  if s=='00000000':return ''
  a=[int(x) for x in s]; total=sum(a[i]*(8-i) for i in range(7)); check=(11-(total%11))%10
  return s if a[7]==check else ''

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
  for i,row in enumerate(rows[:30]):
    txt=' | '.join(norm_text(x).lower() for x in row)
    hits=sum(any(k in txt for k in group) for group in [
      ('žadatel','zadatel','příjemce','prijemce','organizace'),('ič','ico'),('projekt','název','nazev'),('schválen','schvalen','poskytnut','dotace')])
    if hits>=3:return i
  return None

def map_cols(header):
  out={}
  for i,h in enumerate(header):
    x=norm_text(h).lower()
    if not x:continue
    if 'ič' in x or re.search(r'\bico\b',x):out.setdefault('ico',i)
    if any(k in x for k in ['žadatel','zadatel','příjemce','prijemce','organizace','subjekt']):out.setdefault('recipient',i)
    if any(k in x for k in ['projekt','název projektu','nazev projektu','účel','ucel']):out.setdefault('project',i)
    if 'požad' in x or 'pozad' in x:out.setdefault('requested',i)
    if any(k in x for k in ['schválen','schvalen','poskytnut','přidělen','pridelen']):out.setdefault('approved',i)
  return out

def parse_program(source,file_url,blob):
  rows=xlsx_rows(blob); hi=find_header(rows)
  if hi is None: raise RuntimeError(f"{source['area']}: nenašel jsem záhlaví XLSX")
  cols=map_cols(rows[hi])
  if 'recipient' not in cols or 'approved' not in cols: raise RuntimeError(f"{source['area']}: chybí sloupec příjemce nebo schválená částka")
  grants=[]
  for r in rows[hi+1:]:
    get=lambda k: r[cols[k]] if k in cols and cols[k]<len(r) else ''
    recipient=norm_text(get('recipient')); approved=money(get('approved'))
    if not recipient or approved is None or approved<=0: continue
    grants.append({
      'year':source['year'],'area':source['area'],'type':'programová','recipient':recipient,
      'ico':norm_ico(get('ico')),'project':norm_text(get('project')),'requestedCzk':money(get('requested')),
      'approvedCzk':approved,'decisionBody':None,'resolutionId':None,'resolutionDate':None,'resolutionUrl':None,
      'sourcePage':source['page'],'sourceFile':file_url
    })
  if not grants: raise RuntimeError(f"{source['area']}: XLSX neobsahuje žádné schválené dotace")
  return grants,{'headerRow':hi+1,'columns':cols,'rows':len(grants)}

def main():
  all_grants=[]; src_meta=[]; warnings=[]
  for s in SOURCES:
    try:
      file_url,label=discover_file(s['page'],s['kind'])
      if not file_url: raise RuntimeError('nenalezen zdrojový soubor')
      if s['kind']=='xlsx':
        grants,qa=parse_program(s,file_url,fetch_bytes(file_url)); all_grants.extend(grants)
        src_meta.append({**s,'file':file_url,'label':label,'status':'načteno','qa':qa})
        print(f"✅ {s['area']} {s['year']}: {len(grants)} dotací")
      else:
        src_meta.append({**s,'file':file_url,'label':label,'status':'čeká na parser PDF'})
        warnings.append(f"{s['area']} {s['year']}: zdroj nalezen, parser PDF ještě není zapojen")
        print(f"⚠️ {s['area']} {s['year']}: PDF nalezen, zatím neimportuji")
    except Exception as e:
      src_meta.append({**s,'status':'chyba','error':str(e)}); warnings.append(f"{s['area']} {s['year']}: {e}")
      print(f"❌ {s['area']} {s['year']}: {e}")
  all_grants.sort(key=lambda x:(-x['year'],x['area'],x['recipient'].lower(),-(x['approvedCzk'] or 0)))
  payload={'schema':1,'updated':datetime.now(timezone.utc).isoformat(),'source':'https://www.praha8.cz/Granty-a-dotace.html','meta':{'records':len(all_grants),'years':sorted({x['year'] for x in all_grants},reverse=True),'areas':sorted({x['area'] for x in all_grants}),'warnings':warnings,'note':'První bezpečný import programových dotací. Individuální/mimořádné dotace a sociální PDF se doplní samostatnou větví.'},'sources':src_meta,'grants':all_grants}
  OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
  if len(all_grants)<10: raise RuntimeError('Import odmítnut: načteno podezřele málo dotačních záznamů.')
  print(f"\n✅ HOTOVO: {len(all_grants)} programových dotací zapsáno do data/dotace.json")

if __name__=='__main__': main()
