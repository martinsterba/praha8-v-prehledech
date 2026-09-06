#!/usr/bin/env python3
"""Normalizuje historické názvy příjemců dotací.

Starší výsledkové tabulky někdy zapisují IČ přímo do buňky s názvem subjektu
(např. „FK Admira Praha, IČ 47607122“ nebo „... o.s. IČO 47607122“).
IČ patří do samostatného pole `ico`; v názvu příjemce způsobuje zbytečné
rozdělení stejného subjektu při agregacích.

Staré DOC/textové exporty navíc používají znak `|` jako hranici tabulkové
buňky. Pokud zůstane na začátku nebo konci názvu příjemce, bezpečně ho
odstraníme. Řádky, které po odstranění hranic neobsahují žádný skutečný název,
se zahodí jako rozpadlé tabulkové řádky.

Současně odstraňujeme jednoznačné souhrnné řádky typu „Celkem“ nebo „Součet
všech projektů“. Nejde o příjemce dotace a jejich ponechání by zkreslovalo
počty i součty.

Důležitý detail: staré podklady mohou obsahovat i osmimístné číslo označené
jako IČ, které neprojde kontrolním součtem. Takové číslo nikdy nepřebíráme do
pole `ico`, ale z názvu příjemce ho přesto odstraníme. Název tak zůstane čistý
a do agregace se nepřenese nedůvěryhodný identifikátor.
"""
import json,re
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
DATA=ROOT/'data'/'dotace.json'


def norm_text(value):
  return re.sub(r'\s+',' ',str(value or '')).strip()


def clean_table_boundaries(value):
  """Odstraní jen tabulkové hranice na okrajích názvu, nikdy `|` uvnitř textu."""
  raw=norm_text(value)
  cleaned=re.sub(r'^\s*\|+\s*','',raw)
  cleaned=re.sub(r'\s*\|+\s*$','',cleaned)
  return norm_text(cleaned)


def norm_ico(value):
  s=re.sub(r'\D','',str(value or ''))
  if not s or len(s)>8:return ''
  s=s.zfill(8)
  if s=='00000000':return ''
  a=[int(x) for x in s]
  total=sum(a[i]*(8-i) for i in range(7))
  check=(11-(total%11))%10
  return s if a[7]==check else ''


# Pouze koncové IČ/IČO. Neodstraňujeme čísla uprostřed názvu ani projektu.
ICO_SUFFIXES=(
  re.compile(r'\s*[,;]?\s*(?:IČO|IČ|ICO)\s*[:.]?\s*(\d{8})\s*$',re.I),
  re.compile(r'\s*\((\d{8})\)\s*$')
)


def split_name_ico(name,explicit_ico=''):
  raw=norm_text(name)
  explicit=norm_ico(explicit_ico)
  for pattern in ICO_SUFFIXES:
    m=pattern.search(raw)
    if not m:continue

    # Název čistíme vždy, i když starý podklad uvádí neplatné IČ.
    # Neplatné číslo ale nepřenášíme do samostatného pole `ico`.
    embedded=norm_ico(m.group(1))
    cleaned=norm_text(raw[:m.start()]).rstrip(' ,;:-')

    # Pokud už máme důvěryhodné explicitní IČ, má přednost. Případné jiné
    # číslo z názvu pouze odstraníme, ale automaticky jím nic nepřepisujeme.
    if explicit:return cleaned,explicit
    return cleaned,embedded
  return raw,explicit


def aggregate_recipient(name):
  raw=norm_text(name).strip(' |\t')
  low=raw.casefold().strip(' .,:;|-–—')
  exact={
    'celkem','součet','soucet','celkem přiděleno','celkem prideleno',
    'součet všech projektů','soucet vsech projektu','součet projektů','soucet projektu',
    'žadatel','zadatel','příjemce','prijemce','organizace','název organizace','nazev organizace'
  }
  if low in exact:return True
  if low.startswith('součet všech projektů') or low.startswith('soucet vsech projektu'):return True
  if low.startswith('celkem ') or 'celkem projekt' in low:return True
  return False


def main():
  payload=json.loads(DATA.read_text(encoding='utf-8'))
  grants=payload.get('grants') or []
  changed=0;extracted=0;stripped=0;removed=0;invalid_suffix=0
  boundary_cleaned=0;empty_boundary_rows=0
  examples=[];clean=[]

  for grant in grants:
    original_name=norm_text(grant.get('recipient'))
    old_name=clean_table_boundaries(original_name)
    if old_name!=original_name:
      boundary_cleaned+=1

    # Samotná tabulková hranice (např. "|") není příjemce.
    if not old_name or not any(ch.isalnum() for ch in old_name):
      empty_boundary_rows+=1
      removed+=1
      if len(examples)<8:examples.append(f'ODSTRANĚNO: {original_name}')
      continue

    if aggregate_recipient(old_name):
      removed+=1
      if len(examples)<8:examples.append(f'ODSTRANĚNO: {original_name}')
      continue

    old_ico=norm_ico(grant.get('ico'))
    suffix_match=next((m for p in ICO_SUFFIXES if (m:=p.search(old_name))),None)
    if suffix_match and not norm_ico(suffix_match.group(1)):
      invalid_suffix+=1

    new_name,new_ico=split_name_ico(old_name,old_ico)
    if original_name!=new_name:stripped+=1
    if not old_ico and new_ico:extracted+=1
    if new_name!=original_name or new_ico!=old_ico:
      grant['recipient']=new_name
      grant['ico']=new_ico
      changed+=1
      if len(examples)<8:examples.append(f'{original_name} -> {new_name} / IČ {new_ico or "—"}')
    clean.append(grant)

  payload['grants']=clean
  meta=payload.setdefault('meta',{})
  meta['records']=len(clean)
  meta['recipientIcoNormalized']=changed
  meta['recipientIcoExtracted']=extracted
  meta['recipientInvalidIcoSuffixRemoved']=invalid_suffix
  meta['recipientTableBoundaryCleaned']=boundary_cleaned
  meta['recipientBrokenBoundaryRowsRemoved']=empty_boundary_rows
  meta['recipientAggregateRowsRemoved']=removed
  meta['recipientIcoNormalizedAt']=datetime.now(timezone.utc).isoformat()
  counts={}
  for g in clean:
    y=str(int(g.get('year') or 0))
    counts[y]=counts.get(y,0)+1
  meta['historyCounts']=counts
  payload['updated']=datetime.now(timezone.utc).isoformat()
  DATA.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

  print(f'✅ Normalizace příjemců: upraveno {changed} záznamů; z názvu vytěženo {extracted} IČ; očištěno {stripped} názvů; odstraněno {removed} neplatných/souhrnných řádků; očištěno {boundary_cleaned} tabulkových hranic; odstraněno {empty_boundary_rows} prázdných tabulkových řádků; odstraněno {invalid_suffix} neplatných IČ jen z názvu.')
  for item in examples:print('  ',item)


if __name__=='__main__':main()
