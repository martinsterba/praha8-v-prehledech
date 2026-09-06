#!/usr/bin/env python3
import importlib.util,io,json,os,re,subprocess,tempfile,zipfile
import xml.etree.ElementTree as ET
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urljoin

ROOT=Path(__file__).resolve().parent.parent
BASE_SCRIPT=ROOT/'scripts'/'sync-grants.py'
OUT=ROOT/'data'/'dotace.json'

spec=importlib.util.spec_from_file_location('grants_base_archive',BASE_SCRIPT)
base=importlib.util.module_from_spec(spec); spec.loader.exec_module(base)

def read_json(path,fallback):
  try:return json.loads(path.read_text(encoding='utf-8'))
  except Exception:return fallback

def html_links(url):
  p=base.LinkParser(); p.feed(base.fetch_text(url))
  return [(base.norm_text(text),urljoin(url,href)) for href,text in p.links if href]

def candidates():
  out=[]
  for year in range(2009,2019):
    out.append({'year':year,'area':'Kultura','pages':[f'https://www.praha8.cz/Kultura-{year}',f'https://www.praha8.cz/Granty-Kultura-{year}']})
    out.append({'year':year,'area':'Volnočasové aktivity dětí a mládeže','pages':[f'https://www.praha8.cz/Volnocasove-nesportovni-aktivity-{year}',f'https://www.praha8.cz/Granty-Volnocasove-nesportovni-aktivity-{year}']})
  for year in range(2008,2019):
    pages=[f'https://www.praha8.cz/Dotace-v-socialni-oblasti-{year}',f'https://www.praha8.cz/Granty-v-socialni-oblasti-{year}']
    out.append({'year':year,'area':'Sociální oblast','pages':pages})
  out.append({'year':2014,'area':'Sport dospělí a dorost','pages':['https://www.praha8.cz/Granty-Telovychovna-cinnost-dospelych-2014']})
  out.append({'year':2015,'area':'Sport dospělí a dorost','pages':['https://www.praha8.cz/Granty-Sport-pro-dospele-a-dorost-2015']})
  return out

def score_link(label,href):
  low=(label+' '+href).lower()
  ext=None
  # Kontrolujeme delší přípony první, aby .xlsx nebylo zaměněno za .xls.
  for suffix,name in [('.xlsx','xlsx'),('.docx','docx'),('.xls','xls'),('.doc','doc')]:
    if suffix in low:
      ext=name;break
  if not ext:return None
  if any(x in low for x in ['vyúčt','vyuct','žádost','zadost','formulář','formular','pravidl','podmín','podmin','smlouv']):return None
  score=0
  if 'výsled' in low or 'vysled' in low:score+=10
  if 'přidělen' in low or 'pridelen' in low:score+=8
  if 'poskytnut' in low:score+=8
  if 'seznam' in low and ('grant' in low or 'dotac' in low):score+=7
  if 'grant' in low or 'dotac' in low:score+=2
  # Staré stránky často používají obecné názvy typu „přidělené granty“.
  if score<8:return None
  return score,href,label,ext

def discover(source):
  ranked=[]
  for page in source['pages']:
    try:
      for label,href in html_links(page):
        item=score_link(label,href)
        if item:ranked.append((*item,page))
    except Exception:
      continue
  if not ranked:return []
  ranked.sort(key=lambda x:x[0],reverse=True)
  best=ranked[0][0]
  # Bereme jen stejně silné výsledkové soubory; tím nevytáhneme vedle výsledků např. formulář.
  return [(href,label,ext,page) for score,href,label,ext,page in ranked if score>=best-1]

def docx_rows(blob):
  z=zipfile.ZipFile(io.BytesIO(blob))
  root=ET.fromstring(z.read('word/document.xml'))
  ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
  rows=[]
  for tr in root.findall('.//w:tr',ns):
    row=[]
    for tc in tr.findall('./w:tc',ns):
      row.append(base.norm_text(' '.join(t.text or '' for t in tc.findall('.//w:t',ns))))
    if any(row):rows.append(row)
  return rows

def xls_rows(blob):
  try:import xlrd
  except ImportError as exc:raise RuntimeError('pro staré XLS chybí Python balíček xlrd') from exc
  book=xlrd.open_workbook(file_contents=blob,on_demand=True)
  if book.nsheets<1:raise RuntimeError('XLS neobsahuje žádný list')
  sheet=book.sheet_by_index(0);rows=[]
  for r in range(sheet.nrows):
    row=[]
    for c in range(sheet.ncols):
      v=sheet.cell_value(r,c)
      if isinstance(v,float) and v.is_integer():v=str(int(v))
      row.append(base.norm_text(v))
    if any(row):rows.append(row)
  return rows

def doc_rows(blob):
  # antiword je použit jen pro staré binární DOC. Výstup se následně ještě musí
  # projít stejnou kontrolou záhlaví a minimálního počtu záznamů jako jiné formáty.
  fd,path=tempfile.mkstemp(suffix='.doc')
  try:
    with os.fdopen(fd,'wb') as f:f.write(blob)
    try:
      proc=subprocess.run(['antiword','-w','0',path],capture_output=True,check=False,timeout=30)
    except FileNotFoundError as exc:
      raise RuntimeError('pro staré DOC chybí nástroj antiword') from exc
    if proc.returncode!=0:raise RuntimeError('antiword nedokázal DOC bezpečně přečíst')
    text=proc.stdout.decode('utf-8','replace')
  finally:
    try:os.unlink(path)
    except OSError:pass
  rows=[]
  for raw in text.splitlines():
    line=raw.strip()
    if not line:continue
    # Wordové tabulky antiword typicky oddělí tabulátorem nebo více mezerami.
    cells=[base.norm_text(x) for x in re.split(r'\t+|\s{2,}',line) if base.norm_text(x)]
    if cells:rows.append(cells)
  return rows

def flexible_rows(source,file_url,rows,parser):
  hi=base.find_header(rows)
  if hi is None:
    for i,row in enumerate(rows[:60]):
      t=' | '.join(base.norm_text(x).lower() for x in row)
      if any(k in t for k in ['žadatel','zadatel','příjemce','prijemce','organizace','subjekt','název organizace','nazev organizace']) and any(k in t for k in ['částka','castka','dotace','schválen','schvalen','přidělen','pridelen','výše','vyse']):
        hi=i;break
  if hi is None:raise RuntimeError('nenalezeno záhlaví výsledkové tabulky')
  header=[base.norm_text(x).lower() for x in rows[hi]]
  recipient=approved=ico=project=requested=None
  for i,x in enumerate(header):
    if recipient is None and any(k in x for k in ['žadatel','zadatel','příjemce','prijemce','organizace','subjekt','název organizace','nazev organizace','název žadatele','nazev zadatele']):recipient=i
    if ico is None and ('ič' in x or 'ico' in x):ico=i
    if project is None and any(k in x for k in ['projekt','účel','ucel','název akce','nazev akce','služba','sluzba','aktivita']):project=i
    if requested is None and ('požad' in x or 'pozad' in x):requested=i
    if approved is None and any(k in x for k in ['schválen','schvalen','přidělen','pridelen','poskytnut','částka','castka','výše','vyse']):approved=i
  if recipient is None or approved is None:raise RuntimeError('chybí sloupec příjemce nebo schválená částka')
  grants=[]
  for row in rows[hi+1:]:
    get=lambda idx: row[idx] if idx is not None and idx<len(row) else ''
    name,ico_value=base.split_recipient_ico(get(recipient),get(ico))
    amount=base.money(get(approved))
    if not name or amount is None or amount<=0:continue
    # Sumární řádky nesmí skončit jako příjemci.
    if base.norm_text(name).lower() in {'celkem','součet','soucet','celkem přiděleno','celkem prideleno'}:continue
    grants.append({
      'year':source['year'],'area':source['area'],'type':'dotační řízení',
      'recipient':name,'ico':ico_value,'project':base.norm_text(get(project)),
      'requestedCzk':base.money(get(requested)),'approvedCzk':amount,
      'decisionBody':None,'resolutionId':None,'resolutionDate':None,'resolutionUrl':None,
      'sourcePage':source.get('resolvedPage'),'sourceFile':file_url
    })
  if len(grants)<2:raise RuntimeError(f'podezřele málo záznamů ({len(grants)})')
  return grants,{'rows':len(grants),'headerRow':hi+1,'parser':parser}

def parse(source,file_url,ext):
  blob=base.fetch_bytes(file_url)
  if ext=='docx':return flexible_rows(source,file_url,docx_rows(blob),'archive-docx')
  if ext=='doc':return flexible_rows(source,file_url,doc_rows(blob),'archive-doc-antiword')
  if ext=='xls':return flexible_rows(source,file_url,xls_rows(blob),'archive-xls-xlrd')
  try:return base.parse_program(source,file_url,blob)
  except Exception:return flexible_rows(source,file_url,base.xlsx_rows(blob),'archive-xlsx-flex')

def dedupe(rows):
  out=[];seen=set()
  for g in rows:
    key=(g.get('year'),g.get('area'),g.get('ico') or g.get('recipient','').lower(),g.get('project','').lower(),g.get('approvedCzk'))
    if key in seen:continue
    seen.add(key);out.append(g)
  return out

def main():
  payload=read_json(OUT,{})
  loaded=[]; source_meta=[]; loaded_keys=set(); warnings=[]
  for source in candidates():
    files=discover(source)
    if not files:continue
    source_rows=[];qas=[]
    for href,label,ext,page in files:
      s={**source,'resolvedPage':page}
      try:
        rows,qa=parse(s,href,ext);source_rows.extend(rows);qas.append({**qa,'file':href,'label':label})
      except Exception as exc:
        warnings.append(f"Archiv {source['area']} {source['year']} / {label}: {exc}")
    source_rows=dedupe(source_rows)
    if not source_rows:continue
    loaded.extend(source_rows);loaded_keys.add((source['year'],source['area']))
    source_meta.append({'year':source['year'],'area':source['area'],'page':source_rows[0].get('sourcePage'),'kind':'archive','required':False,'status':'načteno','rows':len(source_rows),'qa':qas})
    print(f"✅ Archiv {source['area']} {source['year']}: {len(source_rows)} dotací")

  if not loaded_keys:
    print('ℹ️ Archiv: žádný nový bezpečně čitelný výsledkový zdroj; produkční data zůstávají beze změny.')
    return

  existing=payload.get('grants') or []
  current=[g for g in existing if (int(g.get('year') or 0),g.get('area')) not in loaded_keys]
  combined=dedupe(current+loaded)
  all_warnings=[w for w in (payload.get('meta',{}).get('warnings') or []) if not str(w).startswith('Archiv ')]+warnings
  ares_qa=base.enrich_ares(combined,all_warnings)
  combined.sort(key=lambda x:(-int(x.get('year') or 0),x.get('area',''),x.get('recipient','').lower(),-(x.get('approvedCzk') or 0)))
  years=sorted({int(g['year']) for g in combined},reverse=True)
  counts={str(y):sum(1 for g in combined if int(g['year'])==y) for y in years}
  old_sources=[s for s in (payload.get('sources') or []) if (int(s.get('year') or 0),s.get('area')) not in loaded_keys]

  payload['schema']=max(int(payload.get('schema') or 0),11)
  payload['updated']=datetime.now(timezone.utc).isoformat()
  payload['grants']=combined
  payload['sources']=old_sources+source_meta
  payload['meta']={
    **payload.get('meta',{}),'records':len(combined),'years':years,
    'areas':sorted({g.get('area','') for g in combined if g.get('area')}),
    'warnings':all_warnings,'ares':ares_qa,'historyCounts':counts,
    'archiveLoadedKeys':[f'{y}|{a}' for y,a in sorted(loaded_keys,key=lambda x:(-x[0],x[1]))]
  }
  base.atomic_write_json(OUT,payload)
  print(f'✅ Archiv: přidáno/obnoveno {len(loaded)} záznamů v {len(loaded_keys)} kombinacích roku a oblasti.')

if __name__=='__main__':main()
