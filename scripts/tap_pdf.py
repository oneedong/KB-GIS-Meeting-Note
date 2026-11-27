#!/usr/bin/env python3
"""태핑 플랜 → 자산군별 A4 가로 PDF(표 중심 보고서). 데이터는 복호화한 DB 의 tap(평문 — 스크래치패드에만).

    python3 scripts/tap_pdf.py <SP>/data.json <SP>/out [--font-dir <Pretendard woff2 폴더>]

- 자산군마다 '{year}_태핑대상_<자산군>_<작성일>.pdf' 하나. 구성: 요약 · 구분별 기관 수 · 우선 태핑 · 2027 계획 확인 · 재개 대기·조건부 · 제외 · 태핑 일정(안).
- PDF 는 Playwright(Chromium)로 인쇄. 글꼴 폴더를 주면 Pretendard(없으면 시스템 글꼴).
- 출력 PDF 도 평문(기관 발언) — 저장소에 두지 않는다(.gitignore *.pdf).
"""
import html, json, sys, os, subprocess, tempfile
args = sys.argv[1:]
FONT = ""
if "--font-dir" in args:
    i = args.index("--font-dir"); FONT = os.path.abspath(args[i + 1]); del args[i:i + 2]
DATA, OUTDIR = args[0], args[1]
os.makedirs(OUTDIR, exist_ok=True)
d = json.load(open(DATA)); t = d.get("tap")
if not t: sys.exit("DB 에 tap(태핑 플랜)이 없습니다")
TYPE = {o["id"]: o.get("type") or "" for o in d["orgs"]}
h = lambda v: html.escape(str(v if v is not None else ""))
TIERS = [(1, "우선 태핑 대상", f"{t['year']}년 투자 의향을 직접 밝힌 기관"),
         (2, f"{t['year']} 계획 확인 대상", "올해 진행·관심이 확인된 기관. 내년 계획은 아직 듣지 못함"),
         (3, "재개 대기·조건부", "보류 중이거나 내부 제약이 풀려야 하는 기관"),
         (4, "제외", "투자하지 않겠다고 밝힌 기관")]
FILE = {"PC": "PrivateCredit", "PE": "PE", "INFRA": "인프라", "RE": "부동산"}
TITLE = {"PC": "Private Credit", "PE": "Private Equity", "INFRA": "인프라", "RE": "부동산"}
ff = lambda w, n: f'@font-face{{font-family:"Pretendard";font-weight:{w};src:url("file://{FONT}/Pretendard-{n}.woff2") format("woff2")}}'
FONTS = "".join(ff(w, n) for w, n in [(400, "Regular"), (500, "Medium"), (600, "SemiBold"), (700, "Bold")]) if FONT else ""
CSS = FONTS + """
@page{size:A4 landscape;margin:11mm 12mm 13mm}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:"Pretendard",sans-serif;color:#1d1d1d;font-size:8.6pt;line-height:1.45;word-break:keep-all}
.hd{display:flex;justify-content:space-between;font-size:7.8pt;color:#555;padding-bottom:4px;border-bottom:1px solid #1d1d1d}
.hd b{color:#1d1d1d}
h1{font-size:16pt;font-weight:700;margin:12px 0 2px;letter-spacing:-.02em}
h1 span{display:inline-block;border-bottom:3px solid #FFBC00;padding-bottom:1px}
.meta{font-size:8pt;color:#555;margin:0 0 10px}
h2{font-size:10.5pt;font-weight:700;margin:14px 0 5px}
h2{break-after:avoid;page-break-after:avoid}
.blk{break-inside:auto}
.blk>h2+table tbody tr:first-child,.blk>h2+.none{break-before:avoid}
h2 small{font-size:8pt;font-weight:400;color:#666;margin-left:6px}
.top{display:grid;grid-template-columns:1.55fr 1fr;gap:16px;align-items:start}
ol.sum{margin:0;padding:0;list-style:none}
ol.sum li{position:relative;padding:3px 0 3px 18px;border-bottom:1px solid #e3e3e3}
ol.sum li::before{content:attr(data-n);position:absolute;left:0;top:3px;font-weight:600}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th,td{border-bottom:1px solid #cfcfcf;padding:4px 5px;vertical-align:top;text-align:left}
thead th{background:#f1f1f1;font-weight:600;font-size:8pt;border-top:1.5px solid #1d1d1d;border-bottom:1px solid #1d1d1d}
tbody tr{break-inside:avoid}
td.n{color:#777;text-align:center}
td.o{font-weight:600}
td.o small{display:block;font-weight:400;color:#777;font-size:7.4pt}
td.w{white-space:normal}
.cnt td,.cnt th{padding:4px 6px}
.cnt td.k{font-weight:600;white-space:nowrap}
.cnt td.v{text-align:right;font-weight:600;white-space:nowrap}
.hear{color:#9a6b00;font-size:7.4pt;font-weight:500}
.none{color:#666;padding:6px 0;border-top:1.5px solid #1d1d1d;border-bottom:1px solid #cfcfcf}
.note{margin-top:10px;font-size:7.6pt;color:#555}
.note p{margin:1px 0}
.sched td.t{font-weight:600;white-space:nowrap}
.cols2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
"""
def otype(it): return TYPE.get(it["orgId"], "")
def cell(s): return h(s or "")
def big_table(items):
    rows = "".join(f'''<tr><td class="n">{i}</td><td class="o">{h(it["org"])}{'<small class="hear">전언 포함</small>' if it.get("hear") else ''}<small>{h(otype(it))}</small></td>
<td>{cell(it["strat"])}</td><td>{cell(it["said"])}</td><td>{cell(it.get("cond"))}</td><td class="w">{cell(it.get("when"))}</td><td>{cell(it.get("act"))}</td></tr>''' for i, it in enumerate(items, 1))
    return f'''<table><colgroup><col style="width:3%"><col style="width:12%"><col style="width:11%"><col style="width:27%"><col style="width:23%"><col style="width:9%"><col style="width:15%"></colgroup>
<thead><tr><th>No</th><th>기관</th><th>관심 전략</th><th>{t["year"]} 관련 발언 · 최근 동향</th><th>조건 · 선호</th><th>시점</th><th>다음 액션(제안)</th></tr></thead><tbody>{rows}</tbody></table>'''
def small_table(items):
    rows = "".join(f'''<tr><td class="n">{i}</td><td class="o">{h(it["org"])}{'<small class="hear">전언 포함</small>' if it.get("hear") else ''}<small>{h(otype(it))}</small></td>
<td>{cell(it["strat"])}</td><td>{cell(it["said"])}</td><td>{cell(it.get("cond"))}</td></tr>''' for i, it in enumerate(items, 1))
    return f'''<table><colgroup><col style="width:3%"><col style="width:14%"><col style="width:13%"><col style="width:42%"><col style="width:28%"></colgroup>
<thead><tr><th>No</th><th>기관</th><th>전략</th><th>상황</th><th>비고</th></tr></thead><tbody>{rows}</tbody></table>'''

jobs = []
for c in t["classes"]:
    by = {k: [i for i in c["items"] if i["tier"] == k] for k, _, _ in TIERS}
    cnt = "".join(f'<tr><td class="k">{h(n)}</td><td class="v">{len(by[k])}곳</td><td>{h(", ".join(i["org"] for i in by[k])) or "-"}</td></tr>' for k, n, _ in TIERS)
    summ = "".join(f'<li data-n="{"가나다라마바사"[i]}.">{h(s)}</li>' for i, s in enumerate(c["summary"]))
    sec = []
    for no, (k, n, desc) in enumerate(TIERS, 3):
        body = (big_table(by[k]) if k <= 2 else small_table(by[k])) if by[k] else '<div class="none">해당 기관 없음</div>'
        sec.append(f'<div class="blk"><h2>{no}. {h(n)}<small>{h(desc)} · {len(by[k])}곳</small></h2>{body}</div>')
    sched = "".join(f'<tr><td class="t">{h(s["t"])}</td><td class="o">{h(s["org"])}</td><td>{h(s["do"])}</td></tr>' for s in c["sched"])
    doc = f'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>{h(t["year"])} {h(TITLE.get(c["key"], c["name"]))} 태핑 대상 기관</title><style>{CSS}</style></head><body>
<div class="hd"><span><b>KB증권 글로벌상품영업부</b></span><span>대외비 · 내부 검토용 · 작성 {t["asof"]}</span></div>
<h1><span>{h(t["year"])}년 {h(TITLE.get(c["key"], c["name"]))} 태핑 대상 기관</span></h1>
<p class="meta">근거: {h(t["basis"])}의 미팅 발언. 괄호 안 날짜는 발언이 나온 미팅일. 대상 전략: {h(" · ".join(c["subs"]))}</p>
<div class="top">
 <div><h2 style="margin-top:4px">1. 요약</h2><ol class="sum">{summ}</ol></div>
 <div><h2 style="margin-top:4px">2. 구분별 기관 수</h2><table class="cnt"><colgroup><col style="width:30%"><col style="width:12%"><col></colgroup>
 <thead><tr><th>구분</th><th style="text-align:right">기관 수</th><th>기관</th></tr></thead><tbody>{cnt}</tbody></table></div>
</div>
{"".join(sec)}
<div class="blk"><h2>7. 태핑 일정(안)<small>당부서 제안</small></h2>
<table class="sched"><colgroup><col style="width:9%"><col style="width:24%"><col></colgroup><thead><tr><th>시기</th><th>기관</th><th>내용</th></tr></thead><tbody>{sched}</tbody></table></div>
<div class="note"><p>※ 기관 발언은 미팅 당시 기준이며 이후 계획이 바뀌었을 수 있음. '전언 포함'은 다른 기관·운용사를 통해 들은 내용이 섞인 것으로 직접 확인 필요.</p>
<p>※ '다음 액션', '태핑 일정(안)', '당부서 계획·판단'은 당부서 의견임. 기관 내부 규정·티켓 규모·인사 정보가 포함돼 있어 외부(GP 포함) 공유 시 기관명·관심 전략·시점 수준으로 줄여 전달.</p></div>
</body></html>'''
    tmp = tempfile.mkdtemp(prefix="tap_")
    src = os.path.join(tmp, f'{c["key"]}.html'); open(src, "w", encoding="utf-8").write(doc)
    out = os.path.join(os.path.abspath(OUTDIR), f'{t["year"]}_태핑대상_{FILE.get(c["key"], c["key"])}_{str(t["asof"]).replace("-", "")}.pdf')
    jobs.append((src, out))
# Playwright 로 인쇄(바닥글: 쪽 번호)
JS = r"""
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const jobs = JSON.parse(process.argv[1]);
(async () => { const b = await chromium.launch(); const p = await b.newPage();
  for (const [src, out] of jobs) { await p.goto('file://' + src); await p.evaluate(() => document.fonts.ready);
    await p.pdf({ path: out, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;font-size:7px;color:#888;padding:0 12mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>KB Securities · Global Product Sales · Confidential</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>' });
    console.log(out); }
  await b.close(); })();
"""
subprocess.run(["node", "-e", JS, json.dumps(jobs)], check=True)
