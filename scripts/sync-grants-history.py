#!/usr/bin/env python3
import importlib.util,json,re
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urljoin

ROOT=Path(__file__).resolve().parent.parent
BASE_SCRIPT=ROOT/'scripts'/'sync-grants.py'
OUT=ROOT/'data'/'dotace.json'
INDEX='https://www.praha8.cz/Granty-a-dotace.html'

spec=importlib.util.spec_from_file_location('grants_base',BASE_SCRIPT)
base=importlib.util.module_from_spec(spec); spec.loader.exec_module(base)

# 2022 je na veřejných stránkách neúplný (výsledkové XLSX jsou u usnesení Rady),
# proto používáme přímo úřední usnesení, kde jsou přílohy se seznamy příjemců.
SPECIAL_2022={
  'Kultura':{
    'page':'https://www.praha8.cz/appo/usn/676?usn=4l5GcSBZF3Dl0Si8wY3pbxpl4IKg%3D%3D',
    'publicPage':'https://www.praha8.cz/Granty-Kultura-2022',
    'resolutionId':'Usn RMC 0192/2022','resolutionDate':'2022-04-11','decisionBody':'Rada','multi':True},
  'Volnočasové aktivity dětí a mládeže':{
    'page':'https://www.praha8.cz/appo/usn/676?usn=Ly63W4CAfigftrdhEBFrrA%3D%3D',
    'publicPage':'https://www.praha8.cz/Granty-Volnocasove-nesportovni-aktivity-2022',
    'resolutionId':'Usn RMC 0193/2022','resolutionDate':'2022-04-11','decisionBody':'Rada','multi':True},
  'Sportovní výchova mládeže':{
    'page':'https://www.praha8.cz/appo/usn/676?usn=KHBuc6sYsovNITpB3pbxpl4b3pbxpl4sxw%3D%3D',
    'publicPage':'https://www.praha8.cz/Granty-Sportovni-vychova-mladeze-2022',
    'resolutionId':'Usn RMC 0203/2022','resolutionDate':'2022-04-20','decisionBody':'Rada','multi':True},
  'Sociální oblast':{
    'page':'https://www.praha8.cz/appo/usn/676?usn=Nb4tsOhTPlKwkt7TVty2KA%3D%3D',
    'publicPage':'https://www.praha8.cz/Dotace-v-socialni-oblasti-2022',
    'resolutionId':'Usn RMC 0244/2022','resolutionDate':'2022-05-04','decisionBody':'Rada','multi':True},
}


def html_links(url):
  p=base.LinkParser(); p.feed(base.fetch_text(url))
  return [(base.norm_text(text),urljoin(url,href)) for href,text in p.links if href]


def index_pages():
  out={}
  for label,href in html_links(INDEX):
    clean=re.sub(r'\s+',' ',label).strip().lower()
    m=re.search(r'(20\d{2})$',clean)
    if not m: continue
    year=int(m.group(1))
    if 'granty' in clean and 'kultura' in clean and 'volnočas' not in clean:
      out[('Kultura',year)]=href
    elif 'volnočas' in clean:
      out[('Volnočasové aktivity dětí a mládeže',year)]=href
    elif 'sportovní výchova mládeže' in clean:
      out[('Sportovní výchova mládeže',year)]=href
    elif 'dotace v sociální oblasti' in clean:
      out[('Sociální oblast',year)]=href
    elif ('sport pro dospělé' in clean or 'tělovýchovná činnost dospělých' in clean):
      out[('Sport dospělí a dorost',year)]=href
    elif 'mikrogranty' in clean and 'veřejný prostor' in clean:
      out[('Zvelebování vzhledu MČ',year)]=href
  return out


def build_sources():
  pages=index_pages(); sources=[]
  for year in range(2019,2026):
    for area in ['Kultura','Volnočasové aktivity dětí a mládeže','Sportovní výchova mládeže']:
      if year==2022:
        s={'year':year,'area':area,'kind':'xlsx','required':True,**SPECIAL_2022[area]}
      else:
        page=pages.get((area,year))
        if not page: continue
        s={'year':year,'area':area,'page':page,'kind':'xlsx','required':year in {2023,2024,2025}}
      sources.append(s)
  # Sociální oblast 2025 a 2022 mají ověřené XLSX přílohy usnesení.
  sources.append({'year':2025,'area':'Sociální oblast','page':'https://m.praha8.cz/appo/usn/676?usn=9LcW1pbxsh2gqAagwwqNdwnaZHIw%3D%3D',
    'publicPage':'https://www.praha8.cz/Dotace-v-socialni-oblasti-2025','kind':'xlsx','required':True,
    'decisionBody':'Rada','resolutionId':'Usn RMC 0264/2025','resolutionDate':'2025-06-11','multi':True})
  sources.append({'year':2022,'area':'Sociální oblast','kind':'xlsx','required':True,**SPECIAL_2022['Sociální oblast']})

  # Samostatná historická větev, kterou hlavní rozcestník skutečně uvádí.
  for year in range(2014,2019):
    page=pages.get(('Sport dospělí a dorost',year))
    if page: sources.append({'year':year,'area':'Sport dospělí a dorost','page':page,'kind':'xlsx','required':False,'multi':True})
  return sources


def discover_files(source):
  ext='.'+source.get('kind','xlsx').lower()
  links=html_links(source['page'])
  ranked=[]
  for label,href in links:
    low=(label+' '+href).lower()
    if ext not in href.lower() and ext not in low: continue
    score=0
    if 'poskytnut' in low: score+=5
    if 'výsled' in low or 'vysled' in low: score+=4
    if 'příloh' in low or 'priloh' in low: score+=2
    if 'vyúčt' in low or 'vyuct' in low: score-=5
    if 'žádost' in low or 'zadost' in low or 'podmín' in low or 'podmin' in low: score-=5
    ranked.append((score,href,label))
  if not ranked:return []
  ranked.sort(key=lambda x:x[0],reverse=True)
  if source.get('multi'):
    best=max(x[0] for x in ranked)
    # U usnesení často potřebujeme dvě přílohy (do/nad limit). Nebereme pomocné XLSX s nižším skóre.
    return [(href,label) for score,href,label in ranked if score>=max(best-1,0)]
  score,href,label=ranked[0]
  return [(href,label)]


def read_payload():
  if not OUT.exists(): raise RuntimeError('Chybí data/dotace.json; nejprve spusťte základní import dotací.')
  return json.loads(OUT.read_text(encoding='utf-8'))


def parse_flexible(source,file_url,blob):
  rows=base.xlsx_rows(blob); hi=base.find_header(rows)
  if hi is None: raise RuntimeError('nenalezeno záhlaví starší tabulky')
  header=[base.norm_text(x).lower() for x in rows[hi]]
  recipient=approved=ico=project=requested=None
  for i,x in enumerate(header):
    if recipient is None and any(k in x for k in ['žadatel','zadatel','název klubu','nazev klubu','organizace','příjemce','prijemce','název žadatele','nazev zadatele']): recipient=i
    if ico is None and ('ič' in x or 'ico' in x): ico=i
    if project is None and any(k in x for k in ['projekt','účel','ucel','název akce','nazev akce']): project=i
    if requested is None and ('požad' in x or 'pozad' in x): requested=i
    if approved is None and any(k in x for k in ['schválen','schvalen','poskytnut','přidělen','pridelen','částka','castka','dotace v kč','dotace kc','výše dotace','vyse dotace']): approved=i
  if recipient is None or approved is None: raise RuntimeError('flexibilní parser nenašel příjemce/částku; záhlaví: '+repr(header))
  grants=[]
  for row in rows[hi+1:]:
    get=lambda idx: row[idx] if idx is not None and idx<len(row) else ''
    name,ico_value=base.split_recipient_ico(get(recipient),get(ico)); amount=base.money(get(approved))
    if not name or amount is None or amount<=0: continue
    grants.append({'year':source['year'],'area':source['area'],'type':'dotační řízení','recipient':name,'ico':ico_value,
      'project':base.norm_text(get(project)),'requestedCzk':base.money(get(requested)),'approvedCzk':amount,
      'decisionBody':source.get('decisionBody'),'resolutionId':source.get('resolutionId'),'resolutionDate':source.get('resolutionDate'),
      'resolutionUrl':source.get('page') if source.get('resolutionId') else None,
      'sourcePage':source.get('publicPage') or source['page'],'sourceFile':file_url})
  if not grants: raise RuntimeError('flexibilní parser nenačetl žádné kladné částky')
  return grants,{'headerRow':hi+1,'columns':{'recipient':recipient,'ico':ico,'project':project,'requested':requested,'approved':approved},'rows':len(grants),'parser':'historical-flex'}


def parse_source(source,file_url,blob):
  try:return base.parse_program(source,file_url,blob)
  except Exception:return parse_flexible(source,file_url,blob)


def dedupe(rows):
  out=[]; seen=set()
  for g in rows:
    key=(g.get('year'),g.get('area'),g.get('ico') or g.get('recipient','').lower(),g.get('project','').lower(),g.get('approvedCzk'))
    if key in seen: continue
    seen.add(key); out.append(g)
  return out


def main():
  payload=read_payload(); historical=[]; source_meta=[]; failures=[]; warnings=[]
  sources=build_sources(); target_years={s['year'] for s in sources}
  for source in sources:
    try:
      files=discover_files(source)
      if not files: raise RuntimeError('nenalezen výsledkový XLSX soubor')
      source_rows=[]; qas=[]
      for file_url,label in files:
        grants,qa=parse_source(source,file_url,base.fetch_bytes(file_url)); source_rows.extend(grants); qas.append({**qa,'file':file_url,'label':label})
      source_rows=dedupe(source_rows)
      historical.extend(source_rows)
      source_meta.append({**source,'files':[x[0] for x in files],'status':'načteno','qa':qas,'rows':len(source_rows)})
      print(f"✅ {source['area']} {source['year']}: {len(source_rows)} dotací ({len(files)} souborů)")
    except Exception as exc:
      msg=f"{source['area']} {source['year']}: {exc}"
      if source.get('required'):
        failures.append(msg); print('❌',msg)
      else:
        warnings.append(msg); source_meta.append({**source,'status':'čeká na doplnění','error':str(exc)}); print('⚠️',msg)

  if failures: raise RuntimeError('Historický import odmítnut kvůli povinnému zdroji: '+'; '.join(failures))
  historical=dedupe(historical)
  if len(historical)<100: raise RuntimeError(f'Historický import odmítnut: podezřele málo ověřených záznamů ({len(historical)}).')

  counts={y:sum(1 for g in historical if g['year']==y) for y in target_years}
  loaded_years={y for y,n in counts.items() if n>0}
  if 2022 not in loaded_years: raise RuntimeError('Historický import odmítnut: rok 2022 se z úředních příloh nenačetl.')

  current=[g for g in payload.get('grants',[]) if int(g.get('year') or 0) not in target_years]
  combined=dedupe(current+historical)
  all_warnings=[w for w in (payload.get('meta',{}).get('warnings') or []) if 'histor' not in w.lower()]+warnings
  ares_qa=base.enrich_ares(combined,all_warnings)
  combined.sort(key=lambda x:(-int(x.get('year') or 0),x.get('area',''),x.get('recipient','').lower(),-(x.get('approvedCzk') or 0)))
  old_sources=[s for s in payload.get('sources',[]) if int(s.get('year') or 0) not in target_years]
  payload['schema']=5; payload['updated']=datetime.now(timezone.utc).isoformat(); payload['sources']=old_sources+source_meta; payload['grants']=combined
  payload['meta']={**payload.get('meta',{}),'records':len(combined),'years':sorted({int(g['year']) for g in combined},reverse=True),
    'areas':sorted({g.get('area','') for g in combined if g.get('area')}),'warnings':all_warnings,'ares':ares_qa,
    'historyCounts':{str(y):counts[y] for y in sorted(counts,reverse=True)},'historyLoadedYears':sorted(loaded_years,reverse=True),
    'note':'Historické dotace se dohledávají primárně z oficiálního rozcestníku Granty a dotace. Rok 2022 se načítá z výsledkových XLSX příloh příslušných usnesení Rady, protože veřejné tematické stránky výsledkové tabulky neobsahují. Samostatně se načítá i větev Sport dospělí a dorost 2014–2018, pokud je na stránce dostupná výsledková XLSX.'}
  base.atomic_write_json(OUT,payload)
  print('\n✅ HOTOVO:',', '.join(f'{y}: {counts[y]}' for y in sorted(counts,reverse=True)),f'· celkem {len(combined)} záznamů')

if __name__=='__main__': main()
