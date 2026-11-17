#!/usr/bin/env python3
"""해외대체 펀드 라인업 엑셀 → 앱 '라인업' 탭용 평문 JSON (저장소 밖에 둘 것).

    python3 scripts/lineup_build.py <KB_Securities_Offshore_Fund_Line-Up_YYMM.xlsx> <SP>/lineup.json

- 첫 시트(Fund Line-up (전체 라인업))의 B~R열을 펀드 하나씩 옮긴다. 셀 글자는 그대로(줄바꿈 포함), 고치지 않는다.
- 기준일은 B3 머리글의 '기준일: YYYY.MM.DD', 각주는 표 아래 '※' 줄.
- 펀드 수·번호 연속·자산군·최종 수정일 형식을 확인하고, 어긋나면 멈춘다.
- 평문 JSON은 커밋하지 않는다. 암호화: node scripts/vault.mjs encrypt <SP>/lineup.json lineup.enc.json --salt-from data.enc.json
필요: openpyxl
"""
import sys, re, json, datetime
import openpyxl

SRC, OUT = sys.argv[1], sys.argv[2]
KEYS = ['no', 'fund', 'gp', 'ac', 'type', 'strategy', 'target', 'geo', 'structure', 'size',
        'ret', 'status', 'timeline', 'overview', 'details', 'track', 'lastmod']   # B..R
ACS = ['Private Equity', 'Private Credit', 'Real Estate', 'Infrastructure', 'Aviation', 'Multi-Asset']
STATUS = {'모집 중', '상시 모집', '모집 예정', '모집 완료', '-'}

wb = openpyxl.load_workbook(SRC)
ws = wb.worksheets[0]

def txt(v):
    if v is None:
        return '-'
    s = str(v).strip()
    return s if s else '-'

asof = None
m = re.search(r'기준일:\s*(\d{4})\.(\d{2})\.(\d{2})', str(ws['B3'].value or ''))
if m:
    asof = f'{m[1]}-{m[2]}-{m[3]}'
title = str(ws['B2'].value or '').strip()

funds, notice, errs = [], [], []
for r in range(1, ws.max_row + 1):
    b = ws.cell(r, 2).value
    if isinstance(b, str) and b.strip().startswith('※'):
        notice.append(b.strip())
        continue
    if not isinstance(b, int):
        continue
    d = {k: txt(ws.cell(r, 2 + i).value) for i, k in enumerate(KEYS)}
    d['no'] = b
    # 펀드명 셀 2번째 줄이 '※ …'·'舊 …' 이면 보조 설명(note), 아니면 이름의 일부(줄바꿈만 공백으로)
    lines = [x.strip() for x in d['fund'].split('\n') if x.strip()]
    name, note = [], []
    for x in lines:
        (note if (name and x[:1] in ('※', '舊')) else name).append(x)
    d['fund'] = ' '.join(name)
    if note:
        d['note'] = ' '.join(note)
    if d['ac'] not in ACS:
        errs.append(f"No.{b} 자산군 '{d['ac']}'")
    if d['status'] not in STATUS:
        errs.append(f"No.{b} 상태 '{d['status']}'")
    lm = re.fullmatch(r"'(\d{2})\.(\d{2})\.(\d{2})", d['lastmod'])
    d['lm'] = f'20{lm[1]}-{lm[2]}-{lm[3]}' if lm else None
    if not lm:
        errs.append(f"No.{b} 최종 수정일 '{d['lastmod']}'")
    funds.append(d)

nos = [f['no'] for f in funds]
if nos != list(range(1, len(funds) + 1)):
    errs.append(f'번호가 1부터 연속이 아님: {nos}')
if not asof:
    errs.append('B3 에서 기준일을 찾지 못함')
if errs:
    sys.exit('멈춤 — ' + ' / '.join(errs))

out = {
    'kind': 'lineup', 'v': 1,
    'generatedAt': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
    'asof': asof, 'title': title, 'source': SRC.rsplit('/', 1)[-1],
    'acs': [a for a in ACS if any(f['ac'] == a for f in funds)],
    'notice': notice, 'funds': funds,
}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
cnt = {a: sum(f['ac'] == a for f in funds) for a in out['acs']}
print(f'라인업 {len(funds)}개 펀드 · 기준일 {asof} · ' + ' · '.join(f'{a} {n}' for a, n in cnt.items()))
