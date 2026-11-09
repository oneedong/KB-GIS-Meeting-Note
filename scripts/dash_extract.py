#!/usr/bin/env python3
"""GIS 대시보드 엑셀(xlsm) → 앱 대시보드 탭용 평문 JSON (저장소 밖에 둘 것).

    python3 scripts/dash_extract.py <대시보드_데이터.xlsm> <SP>/dash.json

- 보이는 시트 전부를 LibreOffice HTML 내보내기로 읽어 '표시 형식이 적용된 글자'(1,068,088,784 · 82.38% · 2026-11-05)와
  병합·배경색·글자색·굵게·정렬을 셀 단위로 옮긴다. 수식 결과는 엑셀에 저장된 값 그대로.
- 시트마다 '정리 화면'(지표 카드·차트·표/카드 목록)을 scripts/dash_views.py 로 만든다(openpyxl, 저장된 값).
  한 시트의 변환이 실패하면 경고만 내고 그 시트는 원본 격자로만 보인다.
- 평문 JSON은 저장소에 커밋하지 않는다. 암호화: node scripts/vault.mjs encrypt <SP>/dash.json dash.enc.json --salt-from data.enc.json
필요: LibreOffice(soffice), openpyxl
"""
import sys, os, re, json, html, shutil, subprocess, tempfile, datetime
from html.parser import HTMLParser
import openpyxl

SRC, OUT = sys.argv[1], sys.argv[2]

# ── 시트 묶음(앱의 시트 목록 순서·분류). 목록에 없는 새 시트는 '기타'로 뒤에 붙는다.
GROUPS = [
    ("대시보드", ["대시보드(Demo)", "검증"]),
    ("수익", ["2026 현금기준 수익", "2026년 월별 실적", "(총정리) 연도별 CF"]),
    ("약정·KPI", ["약정내역&수수료", "KPI 실적 요약", "KPI보고용"]),
    ("약정 이력", ["약정 통계", "기관별 약정(2010~현재)", "약정내역(2010~2021)"]),
    ("계약·영업", ["2026년 계약서", "2026년 주요 마케팅 펀드 리스트", "2026 RFP·RFI", "2026 로드쇼·세미나"]),
    ("분석", ["(발생기준) 국내 LP별", "(현금기준, 발생기준) GP별", "(현금기준, 발생기준, 계약건) 자산군별"]),
    ("시딩", ["해외대체 시딩 관리판_금액, 수익률"]),
]
SHORT = {"대시보드(Demo)": "대시보드 시트", "(총정리) 연도별 CF": "PA Fee Schedule (연도별 CF)",
         "해외대체 시딩 관리판_금액, 수익률": "해외대체 시딩 관리판", "(현금기준, 발생기준, 계약건) 자산군별": "자산군별 (현금·발생·계약)",
         "(현금기준, 발생기준) GP별": "GP별 (현금·발생)", "(발생기준) 국내 LP별": "국내 LP별 (발생)",
         "약정 통계": "약정 통계 (2010~현재)", "기관별 약정(2010~현재)": "기관별 약정 (2010~현재)", "약정내역(2010~2021)": "약정내역 (2010~2021)"}

NOFREEZE = {"대시보드(Demo)"}   # 표가 아니라 화면 배치인 시트는 머리글 고정 안 함

# 엑셀에만 두고 앱에는 아직 올리지 않는 시트(사용자 요청 — 자료를 더 정리한 뒤 앱에 반영). 앱에 올릴 때 여기서 빼고 GROUPS 에 넣는다.
EXCEL_ONLY = set()

# ── 1) LibreOffice HTML 내보내기
tmp = tempfile.mkdtemp(prefix="dashx_")
shutil.copy(SRC, os.path.join(tmp, "src.xlsm"))
subprocess.run(["soffice", f"-env:UserInstallation=file://{tmp}/prof", "--headless", "--convert-to", "html:HTML (StarCalc)",
                "--outdir", tmp, os.path.join(tmp, "src.xlsm")], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600)
H = open(os.path.join(tmp, "src.html"), encoding="utf-8", errors="replace").read()

HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.sheets = []; self.cur = None; self.in_h1 = False; self.h1 = ""; self.cell = None; self.row = None
        self.fstack = []; self.bold = 0; self.ital = 0; self.inc = False

    def handle_starttag(self, t, a):
        a = dict(a)
        if t == "h1": self.in_h1 = True; self.h1 = ""
        elif t == "table" and self.cur is not None: self.cur["cols"] = []
        elif t == "colgroup" and self.cur is not None:
            self.cur["cols"] += [int(a.get("width", 64) or 64)] * int(a.get("span", 1) or 1)
        elif t == "col" and self.cur is not None: self.cur["cols"].append(int(a.get("width", 64) or 64))
        elif t == "tr" and self.cur is not None: self.row = []; self.cur["rows"].append(self.row); self.cur["rh"].append(0)
        elif t == "td" and self.row is not None:
            bg = a.get("bgcolor") or ""
            sty = a.get("style") or ""
            bd = []
            for side in ("top", "bottom", "left", "right"):
                m = re.search(r"border-" + side + r":\s*(\d+)px", sty)
                bd.append(min(2, int(m.group(1))) if m else 0)
            self.cell = {"t": "", "n": "", "cs": int(a.get("colspan", 1) or 1), "rs": int(a.get("rowspan", 1) or 1),
                         "al": (a.get("align") or "").lower(), "bg": bg.upper() if HEX.match(bg) else "", "fc": "", "b": 0, "i": 0,
                         "bd": "".join(map(str, bd))}
            if a.get("height"): self.cur["rh"][-1] = int(a["height"])
            self.fstack = []
        elif self.cell is not None and t == "comment": self.inc = True
        elif self.cell is not None and self.inc:
            if t == "br": self.cell["n"] += "\n"
        elif self.cell is not None:
            if t == "font":
                c = a.get("color") or ""; self.fstack.append(c.upper() if HEX.match(c) else "")
            elif t == "b": self.bold += 1
            elif t == "i": self.ital += 1
            elif t == "br": self.cell["t"] += "\n"

    def handle_endtag(self, t):
        if t == "h1":
            self.in_h1 = False
            m = re.match(r"Sheet \d+: (.*)", self.h1.strip())
            if m: self.cur = {"name": m.group(1).strip(), "cols": [], "rows": [], "rh": []}; self.sheets.append(self.cur)
            else: self.cur = None
        elif t == "comment": self.inc = False
        elif t == "td" and self.cell is not None:
            c = self.cell; c["t"] = c["t"].strip()
            if re.fullmatch(r"GIS_[A-Z]+", c["t"]): c["t"] = ""      # VBA 시트 표식(BZ1)
            c["n"] = c["n"].strip()
            self.row.append(c); self.cell = None
        elif t == "font" and self.fstack: self.fstack.pop()
        elif t == "b": self.bold = max(0, self.bold - 1)
        elif t == "i": self.ital = max(0, self.ital - 1)
        elif t == "table": self.row = None

    def handle_data(self, d):
        if self.in_h1: self.h1 += d; return
        if self.cell is not None and self.inc: self.cell["n"] += d; return
        if self.cell is not None:
            if d.strip():
                c = self.cell; c["t"] += d
                fc = next((x for x in reversed(self.fstack) if x), "")
                if fc and not c["fc"]: c["fc"] = fc
                if self.bold: c["b"] = 1
                if self.ital: c["i"] = 1


p = P(); p.feed(H)
sheets = p.sheets


def grid_trim(sh):
    """병합(colspan/rowspan)을 격자로 펼쳐 실제로 쓰인 범위만 남긴다. 빈 행이 이어지면 하나로 줄인다."""
    rows = sh["rows"]; occ = {}; pos = []
    for r, row in enumerate(rows):
        c = 0; pr = []
        for cell in row:
            while (r, c) in occ: c += 1
            pr.append(c)
            for dr in range(cell["rs"]):
                for dc in range(cell["cs"]): occ[(r + dr, c + dc)] = (r, c)
            c += cell["cs"]
        pos.append(pr)
    used_r, used_c = -1, -1
    for r, row in enumerate(rows):
        for cell, c in zip(row, pos[r]):
            if cell["t"] or (cell["bg"] and cell["bg"] not in ("#FFFFFF",)):
                if cell["t"]: used_c = max(used_c, c + cell["cs"] - 1)
                used_r = max(used_r, r + cell["rs"] - 1)
    # 배경만 있는 칸은 글자가 있는 마지막 열까지만
    if used_c < 0: return {"cols": [], "rows": [], "rh": []}
    ncol = used_c + 1
    keep_rows = []
    blank_run = 0
    for r in range(used_r + 1):
        row = rows[r]
        has_text = any(cell["t"] for cell in row)
        covered = any(occ.get((r, c), (r, c))[0] != r for c in range(ncol))
        starts_span = any(cell["rs"] > 1 for cell in row)
        has_bg = any(cell["bg"] and cell["bg"] != "#FFFFFF" and c < ncol for cell, c in zip(row, pos[r]))
        if not has_text and not covered and not starts_span and not has_bg:
            blank_run += 1
            if blank_run > 1: continue
        else: blank_run = 0
        keep_rows.append(r)
    out = []
    for r in keep_rows:
        row = []
        for cell, c in zip(rows[r], pos[r]):
            if c >= ncol: continue
            cs = min(cell["cs"], ncol - c)
            row.append(dict(cell, cs=cs))
        out.append(row)
    return {"cols": sh["cols"][:ncol], "rows": out, "rh": [sh["rh"][r] for r in keep_rows]}


styles = []; sidx = {}
def st(cell):
    k = (cell["bg"], cell["fc"], cell["b"], cell["i"], cell["al"], cell["bd"])
    if k not in sidx: sidx[k] = len(styles); styles.append(list(k))
    return sidx[k]


def pack(sh):
    g = grid_trim(sh)
    rows = []
    for row in g["rows"]:
        pr = []
        for cell in row:
            v = [cell["t"], st(cell)]
            if cell["cs"] > 1 or cell["rs"] > 1 or cell["n"]: v += [cell["cs"], cell["rs"]]
            if cell["n"]: v.append(cell["n"])
            pr.append(v)
        rows.append(pr)
    # 머리글 행 추정: 처음 25행 중 '배경색이 있는 글자 칸'이 가장 많은 행(3칸 이상) = 표 머리글. 병합으로 여러 줄이면 그만큼.
    hs, hdr, best = 0, 0, 2
    for i, row in enumerate(g["rows"][:25]):
        filled = [c for c in row if c["t"] and c["bg"] and c["bg"] != "#FFFFFF"]
        if len(filled) > best:
            best = len(filled); hs = i; hdr = i + max(c["rs"] for c in row)
    if sh["name"] in NOFREEZE: hs, hdr = 0, 0
    return {"cols": g["cols"], "rows": rows, "rh": g["rh"], "hs": hs, "hdr": hdr}


order = {n: (gi, i) for gi, (_, names) in enumerate(GROUPS) for i, n in enumerate(names)}
out_sheets = []
for sh in sheets:
    if sh["name"] in EXCEL_ONLY: continue
    pk = pack(sh)
    if not pk["rows"]: continue
    gi, i = order.get(sh["name"], (len(GROUPS), 0))
    out_sheets.append(dict(name=sh["name"], short=SHORT.get(sh["name"], sh["name"]),
                           group=GROUPS[gi][0] if gi < len(GROUPS) else "기타", _o=(gi, i), **pk))
out_sheets.sort(key=lambda s: s["_o"])
for s in out_sheets: s.pop("_o")

# ── 2) 요약(openpyxl, 저장된 값)
wb = openpyxl.load_workbook(SRC, data_only=True)
def num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None

cfg = {}
if "대시보드_설정" in wb.sheetnames:
    for r in wb["대시보드_설정"].iter_rows(min_row=1, max_row=40, max_col=3, values_only=True):
        if r[1]: cfg[str(r[1]).strip()] = r[2]
asof = cfg.get("기준일")
asof = asof.strftime("%Y-%m-%d") if isinstance(asof, (datetime.date, datetime.datetime)) else str(asof or "")

cards = []
if "대시보드(Demo)" in wb.sheetnames:
    d = wb["대시보드(Demo)"]
    UNIT = [("Cash", "억원"), ("발생", "억원"), ("판매금액", "조원"), ("건수", "건"), ("시딩", "억원")]
    for col in ("B", "I", "P", "W", "AD"):
        lab = d[f"{col}5"].value
        if not lab: continue
        lab = str(lab).strip()
        unit = next((u for k, u in UNIT if k in lab), "")
        cards.append({"label": lab, "value": num(d[f"{col}6"].value), "unit": unit, "sub": d[f"{col}7"].value or "",
                      "pct": num(d[f"{col}8"].value), "note": d[f"{col}9"].value or ""})

monthly = []
if "2026 현금기준 수익" in wb.sheetnames:
    c = wb["2026 현금기준 수익"]
    for r in range(1, c.max_row + 1):
        a = c.cell(r, 1).value
        m = re.match(r"^(\d{1,2})월 부서별 수익", str(a or ""))
        if m: monthly.append({"m": int(m.group(1)), "v": num(c.cell(r, 11).value) or 0})

kpi = []
if "KPI 실적 요약" in wb.sheetnames:
    k = wb["KPI 실적 요약"]
    for r in range(5, 30):
        y = k.cell(r, 2).value
        if isinstance(y, int) and 2000 < y < 2100:
            v = [k.cell(r, c).value for c in range(2, 15)]
            kpi.append({"y": y, "saleTgt": num(v[1]), "saleKpi": num(v[6]), "saleRate": num(v[7]), "saleAll": num(v[4]),
                        "paTgt": num(v[9]), "pa": num(v[10]), "paRate": num(v[11])})
        elif kpi: break

fee = {}
if "(총정리) 연도별 CF" in wb.sheetnames:
    f = wb["(총정리) 연도별 CF"]
    for r in range(1, f.max_row + 1):
        lab = str(f.cell(r, 3).value or "")
        if "연합계(KRW" in lab.replace(" ", ""):
            for cc in range(4, f.max_column + 1):
                v = num(f.cell(r, cc).value)
                if v is None: continue
                yr = None
                for c2 in range(cc, 0, -1):
                    h = str(f.cell(4, c2).value or "")
                    m = re.match(r"(\d{4})년", h)
                    if m: yr = m.group(1); break
                if yr: fee[yr] = v

chk = {"ok": 0, "n": 0, "fails": []}
if "검증" in wb.sheetnames:
    v = wb["검증"]
    for r in range(1, v.max_row + 1):
        x = v.cell(r, 4).value
        if isinstance(x, bool):
            chk["n"] += 1
            if x: chk["ok"] += 1
            else: chk["fails"].append(str(v.cell(r, 3).value or ""))

seed = {}
if "해외대체 시딩 관리판_금액, 수익률" in wb.sheetnames:
    s = wb["해외대체 시딩 관리판_금액, 수익률"]
    for r in range(40, 70):
        lab = str(s.cell(r, 3).value or "")
        if lab == "합계": seed["funds"] = num(s.cell(r, 4).value); seed["nav"] = num(s.cell(r, 5).value)
        if lab.startswith("2026년 누적수익"):
            dd = s.cell(r, 4).value
            seed["ytd"] = num(s.cell(r, 5).value); seed["ytdAsof"] = dd.strftime("%Y-%m-%d") if hasattr(dd, "strftime") else str(dd or "")

# ── 3) 시트별 읽기 화면(정리 화면) — scripts/dash_views.py
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dash_views
views, vwarn = dash_views.build_views(wb, [s["name"] for s in out_sheets], {"asof": asof, "wb": wb, "kpi": kpi, "fx": {"USD": num(cfg.get("환율(원/USD)")), "EUR": num(cfg.get("환율(원/EUR)"))}})
for s in out_sheets:
    if s["name"] in views: s["view"] = views[s["name"]]
for w in vwarn: print("경고 — 정리 화면을 만들지 못해 원본 격자만 보임:", w, file=sys.stderr)

data = {
    "kind": "dashboard", "v": 2,
    "generatedAt": datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime("%Y-%m-%d %H:%M"),
    "source": os.path.basename(SRC), "asof": asof,
    "fx": {"usd": num(cfg.get("환율(원/USD)")), "eur": num(cfg.get("환율(원/EUR)"))},
    "summary": {"cards": cards, "monthly": monthly, "kpi": kpi, "fee": fee, "check": chk, "seed": seed,
                "targets": {"fee": num(cfg.get("PA 수수료 목표(백만원)")), "pa": num(cfg.get("신규 계약 목표(건)")), "sale": num(cfg.get("PA 판매 목표(조원)"))}},
    "styles": styles,
    "sheets": out_sheets,
}
def _clean(o):
    if isinstance(o, float): return round(o, 6)
    if isinstance(o, dict): return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, list): return [_clean(v) for v in o]
    return o
json.dump(_clean(data), open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"), default=str)
shutil.rmtree(tmp, ignore_errors=True)
print(f"dash.json → {OUT}  시트 {len(out_sheets)}개 · 셀 {sum(len(r) for s in out_sheets for r in s['rows']):,}개 · "
      f"{os.path.getsize(OUT)/1e6:.1f}MB · 검증 {chk['ok']}/{chk['n']} · 기준일 {asof}")
for s in out_sheets: print(f"  [{s['group']}] {s['name']}: {len(s['rows'])}행 × {len(s['cols'])}열 · 정리 화면 {'블록 ' + str(len(s['view'])) + '개' if s.get('view') else '없음(원본만)'}")
