#!/usr/bin/env python3
"""Normalizuje historické názvy příjemců dotací.

Starší výsledkové tabulky někdy zapisují IČ přímo do buňky s názvem subjektu
(např. „FK Admira Praha, IČ 47607122“ nebo „... o.s. IČO 47607122“).
IČ patří do samostatného pole `ico`; v názvu příjemce způsobuje zbytečné
rozdělení stejného subjektu při agregacích.
"""
import json,re
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
DATA=ROOT/'data'/'dotace.json'


def norm_text(value):
  return re.sub(r'\s+',' ',str(value or '')).strip()


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
    embedded=norm_ico(m.group(1))
    if not embedded:return raw,explicit
    # Pokud už IČ existuje a liší se, nic automaticky nepřepisujeme.
    if explicit and explicit!=embedded:return raw,explicit
    cleaned=norm_text(raw[:m.start()]).rstrip(' ,;:-')
    return cleaned,explicit or embedded
  return raw,explicit


def main():
  payload=json.loads(DATA.read_text(encoding='utf-8'))
  grants=payload.get('grants') or []
  changed=0;extracted=0;stripped=0
  examples=[]

  for grant in grants:
    old_name=norm_text(grant.get('recipient'))
    old_ico=norm_ico(grant.get('ico'))
    new_name,new_ico=split_name_ico(old_name,old_ico)
    if new_name==old_name and new_ico==old_ico:continue
    if old_name!=new_name:stripped+=1
    if not old_ico and new_ico:extracted+=1
    grant['recipient']=new_name
    grant['ico']=new_ico
    changed+=1
    if len(examples)<8:examples.append(f'{old_name} -> {new_name} / IČ {new_ico or "—"}')

  meta=payload.setdefault('meta',{})
  meta['recipientIcoNormalized']=changed
  meta['recipientIcoExtracted']=extracted
  meta['recipientIcoNormalizedAt']=datetime.now(timezone.utc).isoformat()
  payload['updated']=datetime.now(timezone.utc).isoformat()
  DATA.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

  print(f'✅ Normalizace příjemců: upraveno {changed} záznamů; z názvu vytěženo {extracted} IČ; očištěno {stripped} názvů.')
  for item in examples:print('  ',item)


if __name__=='__main__':main()
