#!/usr/bin/env python3
"""Normalizace názvů příjemců pouze u mimořádných dotací.

Usnesení zapisují smluvní strany různými právními a gramatickými obaly
("spolkem", "nadačním fondem", "nemocnicí"), někdy za názvem přidávají
místní údaj ("Praha 8") nebo popis projektu. Pro agregace potřebujeme stabilní
název subjektu, nikoli celou větu z usnesení.

Tento krok je záměrně oddělený od obecné normalizace historických dotací a
mění jen mimořádné dotace.
"""
import json,re
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
DATA=ROOT/'data'/'dotace.json'


def norm(value):
  return re.sub(r'\s+',' ',str(value or '')).strip()


def is_extraordinary(grant):
  return grant.get('area')=='Mimořádné dotace' or str(grant.get('type') or '').casefold()=='mimořádná dotace'


def normalize_legal_forms(name):
  # Zkratky právních forem mají jednotný zápis. Hlavně z.s. musí mít tečku i za s.
  name=re.sub(r'\bz\s*\.\s*s\s*\.?', 'z.s.', name, flags=re.I)
  name=re.sub(r'\bo\s*\.\s*p\s*\.\s*s\s*\.?', 'o.p.s.', name, flags=re.I)
  name=re.sub(r'\bs\s*\.\s*r\s*\.\s*o\s*\.?', 's.r.o.', name, flags=re.I)
  return name


def normalize_recipient(value):
  original=norm(value)
  name=original.strip(' ,;:-"')
  was_spolek=bool(re.match(r'^spolkem\b',name,re.I))

  # Právní/gramatický obal smluvní strany není součást názvu.
  name=re.sub(r'^spolkem\s+','',name,flags=re.I)
  name=re.sub(r'^nadačním\s+fondem\s+','Nadační fond ',name,flags=re.I)
  name=re.sub(r'^nadacnim\s+fondem\s+','Nadační fond ',name,flags=re.I)
  name=re.sub(r'^nemocnicí\s+','Nemocnice ',name,flags=re.I)
  name=re.sub(r'^nemocnici\s+','Nemocnice ',name,flags=re.I)

  # Za názvem příjemce může následovat už jen účel daru / název projektu.
  name=re.split(r'\s+(?:k\s+realizaci\s+projektu|na\s+realizaci\s+projektu|pro\s+realizaci\s+projektu)\b',name,maxsplit=1,flags=re.I)[0]

  name=normalize_legal_forms(norm(name))

  # Pokud titul výslovně říká "spolkem" a za vlastním názvem není žádná
  # právní forma, sjednotíme ji jako z.s. Tak se tentýž spolek neseká do více názvů.
  if was_spolek and not re.search(r'\b(?:z\.s\.|o\.p\.s\.|s\.r\.o\.)\s*$',name,re.I):
    name=name.rstrip(' ,.;:-')+', z.s.'

  # Praha N za právní formou je v těchto usneseních lokalita, ne název subjektu.
  # Platí pouze pro mimořádné dotace a jen tehdy, je-li před ní právní forma.
  name=re.sub(
    r'(?P<form>\b(?:z\.s\.|o\.p\.s\.|s\.r\.o\.))\s*,\s*Praha\s+\d+[A-Za-z]?(?:\s*[-–—].*)?\s*$',
    r'\g<form>',name,flags=re.I
  )

  # Častý zbytek po rozpadlé závorce v titulku.
  name=re.sub(r'\s*\(\s*$','',name)
  name=norm(name).strip(' ,;:-"')
  name=normalize_legal_forms(name)
  return name


def validate(grants):
  errors=[]
  bad_prefix=re.compile(r'^(?:spolkem|nadačním\s+fondem|nadacnim\s+fondem|nemocnicí|nemocnici)\b',re.I)
  bad_location=re.compile(r'\b(?:z\.s\.|o\.p\.s\.|s\.r\.o\.)\s*,\s*Praha\s+\d+',re.I)
  bad_zs=re.compile(r'\bz\s*\.\s*s(?!\.)',re.I)
  project_tail=re.compile(r'\b(?:k|na|pro)\s+realizaci\s+projektu\b',re.I)
  for i,g in enumerate(grants):
    if not is_extraordinary(g):continue
    name=norm(g.get('recipient'))
    if not name:errors.append(f'záznam {i}: prázdný příjemce')
    if bad_prefix.search(name):errors.append(f'záznam {i}: právní obal v názvu {name!r}')
    if bad_location.search(name):errors.append(f'záznam {i}: lokalita Praha za právní formou {name!r}')
    if bad_zs.search(name):errors.append(f'záznam {i}: nejednotná zkratka z.s. {name!r}')
    if project_tail.search(name):errors.append(f'záznam {i}: účel/projekt zůstal v názvu {name!r}')
    if name.endswith('('):errors.append(f'záznam {i}: otevřená závorka na konci {name!r}')
  if errors:
    print(f'❌ Normalizace mimořádných dotací našla {len(errors)} chyb:')
    for n,e in enumerate(errors,1):print(f'  {n:02d}. {e}')
    raise RuntimeError('Názvy příjemců mimořádných dotací nejsou po normalizaci čisté')


def main():
  payload=json.loads(DATA.read_text(encoding='utf-8'))
  grants=payload.get('grants') or []
  changed=0
  examples=[]
  for g in grants:
    if not is_extraordinary(g):continue
    old=norm(g.get('recipient'))
    new=normalize_recipient(old)
    if new!=old:
      g['recipient']=new
      changed+=1
      if len(examples)<12:examples.append(f'{old} -> {new}')

  validate(grants)
  meta=payload.setdefault('meta',{})
  meta['extraordinaryRecipientFormatNormalized']=changed
  meta['extraordinaryRecipientFormatNormalizedAt']=datetime.now(timezone.utc).isoformat()
  meta['extraordinaryRecipientFormatPolicy']='U mimořádných dotací se odstraňují právní/gramatické obaly smluvních stran, lokalita Praha N za právní formou a text účelu projektu; zkratka z.s. se zapisuje jednotně.'
  payload['updated']=datetime.now(timezone.utc).isoformat()
  DATA.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

  print(f'✅ Formát příjemců mimořádných dotací: upraveno {changed} záznamů.')
  for item in examples:print('  ',item)


if __name__=='__main__':main()
