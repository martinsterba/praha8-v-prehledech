#!/usr/bin/env python3
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
GRANTS=ROOT/'data'/'dotace.json'
STATUS=ROOT/'data'/'source-status.json'


def read_json(path, fallback):
  try:
    return json.loads(path.read_text(encoding='utf-8'))
  except Exception:
    return fallback


def main():
  grants=read_json(GRANTS,{})
  status=read_json(STATUS,{})
  rows=grants.get('grants') or []
  count=int((grants.get('meta') or {}).get('records') or len(rows))
  updated=grants.get('updated') or datetime.now(timezone.utc).isoformat()

  if count<=0:
    raise RuntimeError('Dotace: nelze zapsat stav zdroje, dataset je prázdný.')

  status['grants']={
    'status':'data načtena',
    'count':count,
    'updated':updated,
    'mode':'aktualizováno'
  }
  STATUS.write_text(json.dumps(status,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
  print(f'✅ Stav datového zdroje Dotace a granty: {count} záznamů · {updated}')


if __name__=='__main__':main()
