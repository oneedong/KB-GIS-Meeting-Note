"""대시보드 엑셀 → 앱용 '읽기 화면' 데이터(시트별 블록). dash_extract.py 가 불러 쓴다.

엑셀 격자를 그대로 옮기지 않고, 시트마다 내용에 맞는 블록으로 다시 묶는다.
  kpis   지표 카드          table  표(PC)·카드 목록(휴대폰) — 묶음(secs)·필터·정렬·찾기·펼침(x)
  bars   가로 막대(순위)    col    세로 막대(월별·연도별, 여러 계열·누적)    notes  안내 문장
  row    블록 나란히(PC)      tabs   단추로 하나씩 보기 {items:[{k, l, blocks}], sel} (연도별 등)
값은 가공하지 않은 숫자로 두고 표시 형식(f)만 붙인다. 화면에서 형식을 입힌다.
  f: won(원) wk(원→억) eok(억) eok1 usd usd2 musd n0 n1 n2 pct pct0 pct2 x2 date text tag bar months amt(통화+금액)
시트 구조가 바뀌어 한 시트의 변환이 실패하면 그 시트만 원본 격자로 보이고(경고 출력) 나머지는 그대로 만든다.
"""
import re, datetime
from openpyxl.utils import column_index_from_string as CI, get_column_letter as CL

# ── 공통 ───────────────────────────────────────────────────────────────────────


def clean(v):
    if v is None: return None
    if isinstance(v, bool): return v
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%d") if (v.hour, v.minute, v.second) == (0, 0, 0) else v.strftime("%Y-%m-%d %H:%M")
    if isinstance(v, datetime.date): return v.strftime("%Y-%m-%d")
    if isinstance(v, datetime.time): return v.strftime("%H:%M")
    if isinstance(v, float):
        return int(v) if v.is_integer() and abs(v) < 1e15 else v
    if isinstance(v, str):
        s = v.strip()
        if s in ("", "#N/A", "#REF!", "#VALUE!", "#DIV/0!"): return None
        return s
    return v


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def serial_date(v):
    """엑셀 날짜 일련번호(46303)를 날짜 글자로."""
    if isinstance(v, (int, float)) and 40000 < v < 60000:
        return (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(v))).strftime("%Y-%m-%d")
    return v


class Sh:
    """시트 읽기 도우미: 숨긴 행·열 건너뛰기, 병합 셀 값, 배경색."""

    def __init__(self, ws):
        self.ws = ws
        self.hr = {r for r, d in ws.row_dimensions.items() if d.hidden}
        self.hc = set()
        for k, d in ws.column_dimensions.items():
            if d.hidden:
                lo, hi = (d.min or CI(k)), (d.max or CI(k))
                self.hc.update(range(lo, hi + 1))
        self.anchor = {}
        for m in ws.merged_cells.ranges:
            for r in range(m.min_row, m.max_row + 1):
                for c in range(m.min_col, m.max_col + 1):
                    self.anchor[(r, c)] = (m.min_row, m.min_col)
        self.maxr, self.maxc = ws.max_row, ws.max_column

    @staticmethod
    def ci(c):
        return CI(c) if isinstance(c, str) else c

    def v(self, r, c):
        return clean(self.ws.cell(r, self.ci(c)).value)

    def mv(self, r, c):   # 병합 범위 안이면 첫 칸 값
        c = self.ci(c)
        a = self.anchor.get((r, c))
        return clean(self.ws.cell(*a).value) if a else clean(self.ws.cell(r, c).value)

    def n(self, r, c):
        return num(self.v(r, c))

    def t(self, r, c):
        x = self.v(r, c)
        return None if x is None else str(x)

    def fill(self, r, c):
        f = self.ws.cell(r, self.ci(c)).fill
        if not f or f.fill_type in (None, "none"): return None
        k = f.fgColor
        if k.type == "rgb":
            return None if k.rgb in ("FFFFFFFF", "00000000") else k.rgb
        if k.type == "theme": return f"th{k.theme}{k.tint:+.2f}"
        if k.type == "indexed": return f"ix{k.indexed}"
        return None

    def vis(self, r):
        return r not in self.hr

    def rows(self, r0, r1=None):
        for r in range(r0, (r1 or self.maxr) + 1):
            if self.vis(r): yield r

    def empty(self, r, c0=1, c1=None):
        return all(self.v(r, c) is None for c in range(self.ci(c0), self.ci(c1 or self.maxc) + 1))

    def find(self, pred, r0=1, r1=None, c0=1, c1=None):
        for r in range(r0, min(r1 or self.maxr, self.maxr) + 1):
            for c in range(self.ci(c0), min(self.ci(c1 or self.maxc), self.maxc) + 1):
                x = self.t(r, c)
                if x is not None and pred(x): return r, c
        return None


def scan_end(s, r, c, stop=("합계", "전체 건수", "총합")):
    """r행부터 c열이 빌 때까지(또는 합계 행에서) — 마지막 행 번호."""
    last = r - 1
    while r <= s.maxr and s.v(r, c) is not None:
        last = r
        if str(s.v(r, c)).strip() in stop: break
        r += 1
    return last


def col(k, l, f="text", **kw):
    d = {"k": k, "l": l, "f": f}
    d.update({a: b for a, b in kw.items() if b is not None})
    return d


def nf2f(nf, v):
    """엑셀 표시 형식 → 화면 형식."""
    if not isinstance(v, (int, float)) or isinstance(v, bool): return None
    nf = nf or "General"
    if "%" in nf:
        m = re.search(r"0\.(0+)%", nf)
        return "pct" if m and len(m.group(1)) == 1 else ("pct2" if m else "pct0")
    m = re.search(r"0\.(0+)", nf)
    if m: return "n" + str(min(len(m.group(1)), 3))
    if isinstance(v, float) and not float(v).is_integer(): return "n2"
    return "n0"


def generic_table(s, hr, r0, r1, c0, c1, title=None, tid=None, total_words=("합계", "총합", "소계", "전체 건수", "계"), fold=False, sub=None):
    """머리글 hr행, 데이터 r0~r1행, c0~c1열의 단순 표. 표시 형식은 엑셀 셀 형식을 따른다."""
    c0, c1 = s.ci(c0), s.ci(c1)
    cols, keys = [], []
    for c in range(c0, c1 + 1):
        if c in s.hc: continue
        h = s.t(hr, c)
        if h is None:
            # 머리글이 빈 열은 데이터가 있을 때만(병합 머리글의 나머지 칸)
            if not any(s.v(r, c) is not None for r in range(r0, r1 + 1)): continue
            h = ""
        keys.append(c); cols.append(col(CL(c), h.replace("\n", " "), "text"))
    rows, foot = [], []
    for r in s.rows(r0, r1):
        vals = {}
        for c, cd in zip(keys, cols):
            x = s.v(r, c)
            if x is None: continue
            vals[cd["k"]] = x
            f = nf2f(s.ws.cell(r, c).number_format, x)
            if f and cd["f"] == "text": cd["f"] = f
        if not vals: continue
        first = str(vals.get(cols[0]["k"], "")).strip()
        row = {"c": vals}
        if any(first == w or first.startswith(w + " ") or first.startswith(w + "(") for w in total_words):
            foot.append(row)
        else:
            rows.append(row)
    allr = rows + foot
    for cd in cols:
        vals = [r["c"].get(cd["k"]) for r in allr if r["c"].get(cd["k"]) is not None]
        if cd["l"].strip() in ("연도", "No", "#", "번호") or (vals and all(isinstance(v, int) and 1990 <= v <= 2100 for v in vals) and "연도" in cd["l"]):
            cd["f"] = "int"
        strs = [v for v in vals if isinstance(v, str)]
        if cd is not cols[0] and strs and sum(len(v) for v in strs) / len(strs) > 36:
            cd["d"] = 1   # 긴 설명은 펼쳐서 보기
    b = {"t": "table", "id": tid or f"g{hr}_{c0}", "cols": cols, "rows": rows}
    if len(rows) <= 12 and len([c for c in cols if not c.get("d")]) <= 9: b["compact"] = True   # 작은 표는 휴대폰에서도 표로
    if foot: b["foot"] = foot
    if title: b["title"] = title
    if sub: b["sub"] = sub
    if fold: b["fold"] = True
    return b


def drop_empty_cols(b):
    """값이 하나도 없는 열은 뺀다(머리글만 있는 열)."""
    allrows = [r for sec in b.get("secs", [{"rows": b.get("rows", [])}]) for r in sec["rows"]] + b.get("foot", [])
    used = {k for r in allrows for k, v in r["c"].items() if v not in (None, "", 0)}
    keep = set(b.get("keep", []))
    b["cols"] = [c for c in b["cols"] if c["k"] in used or c["k"] in keep]
    b.pop("keep", None)
    return b


def kpi(l, v, f=None, u=None, s=None, pct=None, tone=None):
    d = {"l": l, "v": v}
    for k, x in (("f", f), ("u", u), ("s", s), ("pct", pct), ("tone", tone)):
        if x is not None: d[k] = x
    return d


MONTHS = [f"{i}월" for i in range(1, 13)]
ASSETS = ["PE", "PC", "RE", "Infra", "기타(혼합자산)", "장외주식 중개"]


def monthly_from_sources(ctx):
    """월별 Cash(현금기준 'N월 부서별 수익') · 발생(월별 실적 C='N월'의 K 합) — 대시보드 시트 수식과 같은 계산, 1월~기준월."""
    wb = ctx.get("wb")
    if not wb or "2026 현금기준 수익" not in wb.sheetnames or "2026년 월별 실적" not in wb.sheetnames: return None
    c, m = Sh(wb["2026 현금기준 수익"]), Sh(wb["2026년 월별 실적"])
    cash, acc = {}, {}
    for r in range(1, c.maxr + 1):
        x = re.match(r"^(\d{1,2})월 부서별 수익", c.t(r, 1) or "")
        if x: cash[int(x.group(1))] = (c.n(r, 11) or 0) / 1e8
    for r in range(6, min(m.maxr, 76) + 1):
        x = re.match(r"^(\d{1,2})월$", m.t(r, 3) or "")
        if x: acc[int(x.group(1))] = acc.get(int(x.group(1)), 0) + (m.n(r, 11) or 0) / 1e8
    try: last = int((ctx.get("asof") or "")[5:7])
    except ValueError: last = 12
    ms = list(range(1, max(1, last) + 1))
    return {"cats": [f"{i}월" for i in ms], "cash": [round(cash.get(i, 0), 4) for i in ms], "acc": [round(acc.get(i, 0), 4) for i in ms]}


# ── 대시보드(Demo) → 요약 ─────────────────────────────────────────────────────

def v_demo(s, ctx):
    blocks = []
    # 지표 카드(5~9행)
    UNIT = [("Cash", "억원"), ("발생", "억원"), ("판매금액", "조원"), ("건수", "건"), ("시딩", "억원")]
    items = []
    lab_row = s.find(lambda x: "PA 수수료수익" in x, 1, 10)
    if lab_row:
        r = lab_row[0]
        for c in range(1, s.maxc + 1):
            lab = s.t(r, c)
            if not lab: continue
            lab = lab.strip()
            unit = next((u for k, u in UNIT if k in lab), "")
            items.append(kpi(lab, s.n(r + 1, c), "n2" if unit != "건" else "n0", unit, s.t(r + 2, c), s.n(r + 3, c)) | {"note": s.t(r + 4, c) or ""})
    blocks.append({"t": "kpis", "id": "cards", "big": True, "items": items})

    def panel(prefix):
        p = s.find(lambda x: x.strip().startswith(prefix))
        return p

    # 월별·연도별 수익(Cash·발생) — 차트용 표(AN열 부근)
    def series_table(first_label_pred):
        hit = s.find(lambda x: x.strip() in ("월", "연도"), 1, s.maxr, 30, s.maxc)
        return hit

    two = []
    yr = s.find(lambda x: x.strip() == "연도", 1, 40, 20)
    if yr:
        r, c = yr
        cats, cash, acc = [], [], []
        for rr in range(r + 1, r + 8):
            y = s.v(rr, c)
            if y is None or not re.match(r"^\d{4}$", str(y)): break
            cats.append(str(y)); cash.append(s.n(rr, c + 1) or 0); acc.append(s.n(rr, c + 2) or 0)
        if cats:
            two.append({"t": "col", "id": "yr", "title": "연도별 수익", "sub": "억원 · Cash vs 발생", "cats": cats,
                        "series": [{"n": "Cash", "v": cash}, {"n": "발생", "v": acc}], "f": "eok1"})
    mo = s.find(lambda x: x.strip() == "월", 1, 40, 20)
    full = monthly_from_sources(ctx)
    if full:
        two.insert(0, {"t": "col", "id": "mo", "title": "월별 수익", "sub": f"억원 · Cash vs 발생 · {full['cats'][0]}~{full['cats'][-1]}", "cats": full["cats"],
                       "series": [{"n": "Cash", "v": full["cash"]}, {"n": "발생", "v": full["acc"]}], "f": "eok1", "wide": True})
        mo = None
    if mo:
        r, c = mo
        cats, cash, acc = [], [], []
        for rr in range(r + 1, r + 14):
            m = s.t(rr, c)
            if not m or not re.match(r"^\d{1,2}월$", m): break
            cats.append(m); cash.append(s.n(rr, c + 1) or 0); acc.append(s.n(rr, c + 2) or 0)
        if cats:
            two.insert(0, {"t": "col", "id": "mo", "title": "월별 수익", "sub": "억원 · Cash vs 발생", "cats": cats,
                           "series": [{"n": "Cash", "v": cash}, {"n": "발생", "v": acc}], "f": "eok1", "wide": True})
    if two: blocks.append({"t": "row", "blocks": two, "ratio": "2:1" if len(two) == 2 else None})

    # 연도별 자산군별 수익(Cash) — 누적 막대 + 표
    p = panel("연도별 자산군별 수익")
    if p:
        r, c = p
        hdr = r + 1
        years = []
        for cc in range(c + 1, c + 8):
            y = s.t(hdr, cc)
            if y and re.match(r"^\d{4}$", y): years.append((cc, y))
        series, tot = [], None
        for rr in range(hdr + 1, hdr + 12):
            name = s.t(rr, c)
            if not name: break
            vals = [s.n(rr, cc) or 0 for cc, _ in years]
            if name.strip() == "합계": tot = vals; break
            series.append({"n": name.strip(), "v": vals})
        if years and series:
            blocks.append({"t": "col", "id": "asset", "title": "연도별 자산군별 수익 (Cash)", "sub": "억원",
                           "cats": [y for _, y in years], "series": series, "stack": True, "f": "eok1", "tot": tot})

    # 작은 표들: 자산군별 종합(2026) · RFI/RFP · 시딩 현황 · HF 시딩손익
    small = []
    for prefix, nxt in (("자산군별 종합", "RFI"), ("RFI / RFP", "해외대체 시딩"), ("해외대체 시딩 현황", "Top 5")):
        p = panel(prefix); q = s.find(lambda x, n=nxt: x.strip().startswith(n), p[0] if p else 1, p[0] if p else 1, (p[1] + 1) if p else 1) if p else None
        if not p: continue
        r, c = p
        c1 = (q[1] - 1) if q else c + 6
        rr = r + 2
        while rr <= s.maxr and s.v(rr, c) is not None: rr += 1
        title = s.t(r, c).split("  ")[0].strip()
        sub = " ".join(s.t(r, c).split()[len(title.split()):]).strip() or None
        b = generic_table(s, r + 1, r + 2, rr - 1, c, c1, title=title, tid="p" + str(c), sub=sub)
        small.append(b)
    if small: blocks.append({"t": "row", "blocks": small})

    # Top 5 (발생 GP · 발생 LP · Cash GP)
    tops = []
    for (r, c) in [p for p in [s.find(lambda x: x.strip().startswith("Top 5"), 1, 30, cc, cc) for cc in range(1, s.maxc + 1)] if p]:
        title = s.t(r, c)
        unit = title.split("  ")[-1].strip() if "  " in title else ""
        name = title.split("  ")[0].strip()
        # 머리글(#, 운용사/기관, 값) 다음 행부터 5개
        hdr = r + 1
        lab_c = next((cc for cc in range(c, c + 6) if (s.t(hdr, cc) or "").startswith("운용사")), c + 1)
        val_c = next((cc for cc in range(lab_c + 1, lab_c + 6) if s.t(hdr, cc)), lab_c + 2)
        items = []
        for rr in range(hdr + 1, hdr + 6):
            l, v = s.t(rr, lab_c), s.n(rr, val_c)
            if l is None: break
            items.append({"l": l, "v": v or 0})
        if items:
            f = "eok1" if "억" in unit else "n0"
            basis, _, u2 = unit.partition("·")
            tops.append({"t": "bars", "id": f"top{c}", "title": f"{name} ({basis.strip()})" if u2 else name, "sub": (u2 or unit).strip(), "items": items, "f": f, "rank": True})
    if tops: blocks.append({"t": "row", "blocks": tops})

    p = panel("Hedge Fund 시딩손익")
    if p:
        r, c = p
        hdr = r + 1
        rr = hdr + 1
        last = hdr
        while rr <= s.maxr and rr < hdr + 20:
            if (s.t(rr, c) or "").startswith(("*", "※")): break
            if s.v(rr, c) is not None: last = rr
            rr += 1
        tot_c = next((cc for cc in range(c, c + 20) if (s.t(hdr, cc) or "").strip() == "총합"), None)
        c1 = tot_c or c
        if not tot_c:
            for cc in range(c, c + 14):
                if s.t(hdr, cc): c1 = cc
        title = s.t(r, c).split("  ")[0].strip()
        b = generic_table(s, hdr, hdr + 1, last, c, c1, title=title, tid="hf", sub="억원",
                          total_words=("총합", "PBS+헤지"))
        b["compact"] = True
        b["foot"] = [x for x in b.get("foot", [])]
        notes = [s.t(x, c) for x in range(last + 1, last + 5) if (s.t(x, c) or "").strip().startswith(("*", "※"))]
        if notes: b["notes"] = [n.strip() for n in notes]
        blocks.append(b)

    # 각주
    notes = []
    for r in s.rows(1):
        for c in range(1, s.maxc + 1):
            x = s.t(r, c)
            if x and x.strip().startswith("※"): notes.append(x.strip())
    if notes: blocks.append({"t": "notes", "items": notes})
    return blocks


# ── 검증 ──────────────────────────────────────────────────────────────────────

def v_check(s, ctx):
    h = s.find(lambda x: x.strip() == "검증 항목")
    if not h: raise ValueError("검증 머리글 없음")
    r, c = h
    rows, ok, n = [], 0, 0
    rr = r + 1
    while rr <= s.maxr and s.v(rr, c) is not None:
        res = s.v(rr, c + 1)
        if isinstance(res, bool):
            n += 1; ok += res
        rows.append({"c": {"sh": s.t(rr, c - 1), "it": s.t(rr, c), "ok": res}, "st": "ok" if res is True else ("bad" if res is False else None)})
        rr += 1
    blocks = [{"t": "kpis", "id": "ck", "items": [kpi("정합성 검증", ok, "n0", f"/ {n}", "전체 일치" if ok == n else f"{n - ok}건 확인 필요", tone="ok" if ok == n else "bad")]}]
    blocks.append({"t": "table", "id": "ck", "title": "검증 항목", "cols": [col("sh", "시트", "tag"), col("it", "검증 항목"), col("ok", "결과", "bool")],
                   "rows": rows, "card": {"title": "it", "chips": ["sh", "ok"]}, "filters": ["sh"]})
    ip = s.find(lambda x: x.strip() == "입력 확인", rr)
    if ip:
        items = []
        for x in s.rows(ip[0] + 1):
            a, b = s.t(x, ip[1]), s.t(x, ip[1] + 1)
            if a is None and b is None: break
            items.append(f"{a} — {b}" if a and b else (a or b))
        if items: blocks.append({"t": "notes", "title": "입력 확인", "items": items})
    return blocks


# ── 2026 현금기준 수익 ────────────────────────────────────────────────────────

def v_cash(s, ctx):
    H = {s.t(1, c): c for c in range(1, s.maxc + 1) if s.t(1, c)}
    need = ["입금결의일", "수익인식일", "운용사명", "펀드명", "보수 유형", "전략", "글로벌상품영업부"]
    for k in need:
        if k not in H: raise ValueError(f"머리글 '{k}' 없음")
    cA, cB, cC, cD, cE, cF, cK = (H[k] for k in need)
    cH = H.get("입금 금액(원)"); cL = H.get("금융상품영업부"); cM = H.get("2026년 발생분 수익인식"); cN = H.get("비고")
    cI = H.get("기관"); cJ = H.get("RM")
    secs, cur, tot = [], [], None
    months = []
    for r in s.rows(2):
        a = s.t(r, cA) or ""
        m = re.match(r"^(\d{1,2})월 부서별 수익", a)
        if m:
            mv = s.n(r, cK) or 0
            months.append((int(m.group(1)), mv))
            sec = {"h": f"{m.group(1)}월", "rows": cur, "foot": [{"l": a, "c": {"k": mv}}]}
            if cL and s.n(r, cL): sec["foot"][0]["c"]["l"] = s.n(r, cL)
            sec["s"] = f"{len(cur)}건" if cur else "없음"
            secs.append(sec); cur = []
            continue
        if a.startswith("부서별 연간 총 합계"):
            tot = {"l": a, "c": {"k": s.n(r, cK), "m": s.n(r, cM) if cM else None}}
            break
        gp, amt = s.t(r, cC), s.n(r, cK)
        if gp is None and amt in (None, 0): continue
        typ = s.t(r, cE) or ""
        st = "환차손익" if "환차" in typ else ("미수금" if s.v(r, cA) is None else "수취")
        row = {"c": {"a": s.v(r, cA), "b": s.v(r, cB), "gp": gp, "fd": s.t(r, cD), "ty": typ or None, "sr": s.t(r, cF),
                     "k": amt, "h": s.n(r, cH) if cH else None, "l": s.n(r, cL) if cL else None, "m": s.n(r, cM) if cM else None,
                     "n": s.t(r, cN) if cN else None, "i": s.t(r, cI) if cI else None, "j": s.t(r, cJ) if cJ else None, "st": st}}
        row["c"] = {k: v for k, v in row["c"].items() if v is not None}
        cur.append(row)
    ytot = (tot or {}).get("c", {}).get("k") or sum(v for _, v in months)
    allrows = [r for sec in secs for r in sec["rows"]]
    # 받지 못하게 되어 마이너스로 되돌린 미수금은 원래 행과 함께 '상계'
    for neg in [r for r in allrows if r["c"]["st"] == "미수금" and (r["c"].get("k") or 0) < 0]:
        orig = next((r for r in allrows if r is not neg and r["c"]["st"] == "미수금" and r["c"].get("gp") == neg["c"].get("gp")
                     and r["c"].get("fd") == neg["c"].get("fd") and abs((r["c"].get("k") or 0) + neg["c"]["k"]) < 1), None)
        if orig: orig["c"]["st"] = neg["c"]["st"] = "상계"
    mi = [r for r in allrows if r["c"]["st"] == "미수금"]
    fx = [r for r in allrows if r["c"]["st"] == "환차손익"]
    blocks = [{"t": "kpis", "id": "k", "items": [
        kpi("연간 수익 합계", ytot / 1e8, "n2", "억원", f"{len(allrows)}건 · 글로벌상품영업부"),
        kpi("미수금", sum(r["c"].get("k", 0) for r in mi) / 1e8, "n2", "억원", f"{len(mi)}건 · 입금결의일 없음", tone="warn"),
        kpi("환차손익", sum(r["c"].get("k", 0) for r in fx) / 1e8, "n2", "억원", f"{len(fx)}건"),
        kpi("월평균", ytot / max(1, len([1 for _, v in months if v])) / 1e8, "n2", "억원", "수익 있는 달 기준"),
    ]}]
    blocks.append({"t": "col", "id": "m", "title": "월별 수익", "sub": "억원 · 월별 부서별 수익", "cats": [f"{m}월" for m, _ in months],
                   "series": [{"n": "수익", "v": [v / 1e8 for _, v in months]}], "f": "eok1"})
    cols = [col("b", "수익인식일", "date"), col("a", "입금결의일", "date"), col("gp", "운용사"), col("fd", "펀드"),
            col("ty", "보수 유형", "tag"), col("sr", "전략", "tag"), col("k", "수익(원)", "won", sum=1),
            col("st", "구분", "tag", tone={"수취": "ok", "미수금": "warn", "환차손익": "info", "상계": "muted"}),
            col("h", "입금 금액(원)", "won", d=1), col("l", "금융상품영업부", "won", d=1), col("m", "2026년 발생분 수익인식", "won", d=1),
            col("i", "기관", d=1), col("j", "RM", d=1), col("n", "비고")]
    b = {"t": "table", "id": "cash", "title": "입금·수익 내역", "sub": "월별 · 단위 원", "cols": cols, "secs": secs,
         "card": {"title": "gp", "sub": ["fd", "ty"], "amt": "k", "meta": ["b"], "chips": ["st", "sr"]},
         "filters": ["st", "sr", "ty"], "keep": ["k"]}
    if tot: b["foot"] = [tot]
    blocks.append(drop_empty_cols(b))
    return blocks


# ── 2026년 월별 실적(발생기준) ───────────────────────────────────────────────

def v_monthly(s, ctx):
    h = s.find(lambda x: x.strip() == "월별", 1, 15)
    if not h: raise ValueError("머리글 '월별' 없음")
    hr, cm = h
    H = {}
    for c in range(cm, cm + 14):
        t = (s.t(hr, c) or "").replace("\n", "")
        H[t] = c
    def hc(*keys):
        for k in keys:
            for t, c in H.items():
                if t.startswith(k): return c
        raise ValueError(f"머리글 {keys} 없음")
    cGP, cFD, cLP, cCY = hc("운용사"), hc("펀드명"), hc("기관명"), hc("통화")
    cAM, cUS, cFU, cFK, cCA, cRT, cNT = hc("총 약정금액(USD"), hc("총 약정금액(USD"), hc("발생 수수료(USD"), hc("발생 수수료(KRW"), hc("Cash"), hc("수수료율"), hc("비고")
    cAM = hc("총 약정금액")
    secs, cur_m, funds, foot = [], None, [], []
    grand = []

    def flush():
        nonlocal funds
        if cur_m is None: return
        secs.append({"h": cur_m, "rows": funds, "foot": foot_m[:]})
        funds = []

    foot_m = []
    fund = None
    for r in s.rows(hr + 1):
        m = s.t(r, cm)
        lab = s.t(r, cGP) or ""
        if (s.t(r, cm) or "").startswith(("총 계", "신규펀드")):
            k = s.t(r, cm)
            if "USD" in k: grand.append({"l": k, "c": {"us": s.n(r, cUS), "fu": s.n(r, cFU)}})
            else: grand.append({"l": k, "c": {"us_e": s.n(r, cUS), "fk": (s.n(r, cFK) or 0) * 1e8 or None, "ca": (s.n(r, cCA) or 0) * 1e8 or None,
                                               "fu_e": s.n(r, cFU) if "신규" in k else None}})
            continue
        if (s.t(r, cm + 1) or "").startswith("2026년 Retainer") or (s.t(r, cm) or "").startswith("2026년 Retainer"):
            break
        if lab.startswith("합계(단위"):
            if fund: funds.append(fund); fund = None
            if "USD" in lab: foot_m.append({"l": "합계 (USD)", "c": {"us": s.n(r, cUS), "fu": s.n(r, cFU)}})
            else:
                foot_m.append({"l": "합계 (억원)", "c": {"fk": (s.n(r, cFK) or 0) * 1e8 or None, "ca": (s.n(r, cCA) or 0) * 1e8 or None}})
                # 억원 합계가 그 달의 끝
                if m: cur_m = m
                flush(); foot_m = []; cur_m = None
            continue
        if not m or not lab: continue
        if cur_m is None: cur_m = m
        if m != cur_m:
            if fund: funds.append(fund); fund = None
            flush(); foot_m = []; cur_m = m
        fd = s.t(r, cFD)
        lp = {"lp": s.t(r, cLP), "cy": s.t(r, cCY), "am": s.n(r, cAM), "us": s.n(r, cUS), "fu": s.n(r, cFU), "rt": s.n(r, cRT) if s.n(r, cRT) is not None else s.t(r, cRT), "nt": s.t(r, cNT)}
        fk, ca = s.n(r, cFK), s.n(r, cCA)
        if fund and fund["_k"] == (m, lab, fd):
            fund["_lp"].append(lp)
            fund["fk"] += fk or 0; fund["ca"] += ca or 0
        else:
            if fund: funds.append(fund)
            fund = {"_k": (m, lab, fd), "gp": lab, "fd": fd, "_lp": [lp], "fk": fk or 0, "ca": ca or 0}
    if fund: funds.append(fund)
    flush()

    out_secs = []
    for sec in secs:
        rows = []
        for f in sec["rows"]:
            lps = f["_lp"]
            cys = sorted({x["cy"] for x in lps if x["cy"]})
            rts = [x["rt"] for x in lps if x["rt"] is not None]
            nts = sorted({x["nt"] for x in lps if x["nt"]})
            names = [x["lp"] for x in lps if x["lp"]]
            row = {"c": {"gp": f["gp"], "fd": f["fd"], "lp": " · ".join(names) if len(names) <= 3 else f"{' · '.join(names[:3])} 외 {len(names) - 3}",
                         "n": len(names), "cy": "/".join(cys) or None,
                         "us": sum(x["us"] or 0 for x in lps) or None, "fu": sum(x["fu"] or 0 for x in lps) or None,
                         "fk": f["fk"] or None, "ca": f["ca"] or None,
                         "rt": (rts[0] if len(set(map(str, rts))) == 1 else f"{min(r for r in rts if isinstance(r, (int, float))):.2%}~{max(r for r in rts if isinstance(r, (int, float))):.2%}" if all(isinstance(r, (int, float)) for r in rts) else " / ".join(map(str, rts))) if rts else None,
                         "nt": " · ".join(nts) or None}}
            row["c"] = {k: v for k, v in row["c"].items() if v is not None}
            row["x"] = [{"h": f"기관별 ({len(lps)})", "cols": [col("lp", "기관"), col("cy", "통화"), col("am", "약정금액", "n0"), col("us", "USD 환산", "usd"),
                                                              col("fu", "발생(USD)", "usd"), col("rt", "수수료율", "pct2"), col("nt", "비고")],
                         "rows": [{k: v for k, v in x.items() if v is not None} for x in lps]}]
            rows.append(row)
        fk = next((x["c"].get("fk") for x in sec["foot"] if "fk" in x["c"]), None)
        ca = next((x["c"].get("ca") for x in sec["foot"] if "ca" in x["c"]), None)
        sub = " · ".join(t for t in [f"발생 {fk / 1e8:.2f}억" if fk else None, f"Cash {ca / 1e8:.2f}억" if ca else None] if t) or "없음"
        out_secs.append({"h": sec["h"], "s": sub, "rows": rows, "foot": [x for x in sec["foot"] if any(v for v in x["c"].values())]})

    cols = [col("gp", "운용사"), col("fd", "펀드"), col("lp", "기관"), col("n", "기관 수", "n0", d=1), col("cy", "통화", "tag"),
            col("us", "약정(USD 환산)", "usd", sum=1), col("fu", "발생 수수료(USD)", "usd", sum=1), col("fk", "발생(억원)", "wk", sum=1),
            col("ca", "Cash 수취(억원)", "wk", sum=1), col("rt", "수수료율", "pct2"), col("nt", "비고", "tag")]
    gu = next((g for g in grand if g["l"].startswith("총 계") and "USD" in g["l"]), None)
    ge = next((g for g in grand if g["l"].startswith("총 계") and "억" in g["l"]), None)
    nu = next((g for g in grand if g["l"].startswith("신규") and "USD" in g["l"]), None)
    blocks = []
    if gu or ge:
        blocks.append({"t": "kpis", "id": "k", "items": [x for x in [
            kpi("발생 수수료", (ge["c"].get("fk") or 0) / 1e8, "n2", "억원", f"USD {gu['c'].get('fu', 0):,.2f}" if gu else None) if ge else None,
            kpi("Cash 수취분", (ge["c"].get("ca") or 0) / 1e8, "n2", "억원", "발생분 중 2026 수취") if ge else None,
            kpi("약정(USD 환산)", (gu["c"].get("us") or 0) / 1e6, "n0", "USD M", "판매금액") if gu else None,
            kpi("신규펀드 기준", (nu["c"].get("us") or 0) / 1e6, "n0", "USD M", f"발생 USD {nu['c'].get('fu', 0):,.2f}") if nu else None,
        ] if x]})
    foot = [{"l": g["l"], "c": {k: v for k, v in g["c"].items() if k in ("us", "fu", "fk", "ca") and v}} for g in grand if g["l"].startswith("총 계")]
    blocks.append({"t": "table", "id": "mon", "title": "월별 발생 실적", "sub": "펀드별 묶음 · 눌러서 기관별 보기", "cols": cols, "secs": out_secs,
                   "card": {"title": "fd", "sub": ["gp", "lp"], "amt": "fk", "meta": ["fu"], "chips": ["cy", "nt"]},
                   "filters": ["gp"], "foot": [f for f in foot if f["c"]]})
    # Retainer Fee 목록
    rt = s.find(lambda x: x.strip().startswith("2026년 Retainer"))
    if rt:
        r, c = rt
        rr = r + 2
        while rr <= s.maxr and s.v(rr, c) is not None: rr += 1
        blocks.append(generic_table(s, r + 1, r + 2, rr - 1, c, c + 4, title="2026년 Retainer Fee 목록", tid="ret"))
    # 자동 반영 영역(내용이 있을 때만)
    au = s.find(lambda x: "신규 약정 자동 반영" in x)
    if au:
        r, c = au
        hdr = r + 1
        H2 = [(cc, s.t(hdr, cc)) for cc in range(c, c + 13) if s.t(hdr, cc)]
        rows = []
        for rr in s.rows(hdr + 1):
            vals = {CL(cc): s.v(rr, cc) for cc, _ in H2 if s.v(rr, cc) not in (None, 0)}
            if not vals: continue
            rows.append({"c": vals})
        if rows:
            blocks.append({"t": "table", "id": "auto", "title": "신규 약정 자동 반영", "cols": [col(CL(cc), t) for cc, t in H2], "rows": rows})
    return blocks


# ── (총정리) 연도별 CF ───────────────────────────────────────────────────────

def v_cf(s, ctx):
    yh = None
    for r in range(1, 12):
        hits = [(c, s.t(r, c)) for c in range(1, s.maxc + 1) if re.match(r"^\d{4}년$", s.t(r, c) or "")]
        if len(hits) >= 2: yh = r; years = hits; break
    if not yh: raise ValueError("연도 머리글 없음")
    mh, th = yh + 1, yh + 2   # 월 머리글, 보수유형/통화/금액
    gpc = next(c for c in range(1, 6) if (s.t(mh, c) or "") == "GP")
    fdc = gpc + 1
    # 상태 범례(1행): 미수금 인식 · 수취 완료 · 진행중 → 그 칸 배경색
    legend = {}
    for r in range(1, yh):
        for c in range(1, 40):
            t = (s.t(r, c) or "").strip()
            if t in ("미수금 인식", "수취 완료", "진행중"):
                f = s.fill(r, c)
                if f: legend[f] = t
    # 적용 환율 안내
    notes = []
    for r in range(1, yh):
        for c in range(1, 60):
            t = s.t(r, c)
            if t and t.strip().startswith("환율 업데이트") and t.strip() not in notes: notes.append(t.strip())
    months = []   # (year, month, c_type)
    for (yc, ylab), nxt in zip(years, years[1:] + [(s.maxc + 1, None)]):
        y = ylab[:4]
        for c in range(yc, nxt[0]):
            m = re.match(r"^(\d{1,2})월$", s.t(mh, c) or "")
            if m: months.append((y, int(m.group(1)), c))
    pays, sect, gp = [], None, None
    totals_krw, totals_usd, mon_krw = {}, {}, {}
    for r in s.rows(th + 1):
        b, cfd = s.mv(r, gpc), s.t(r, fdc)
        lab = " ".join(str(x) for x in (s.t(r, gpc), s.t(r, fdc), s.t(r, fdc + 1)) if x)
        if "연 합계(KRW" in lab.replace(" ", "") or "연합계(KRW" in lab.replace(" ", ""):
            for (yc, ylab) in years:
                for c in range(yc, yc + 36):
                    v = s.n(r, c)
                    if v is not None: totals_krw[ylab[:4]] = v; break
            continue
        if "연합계(USD" in lab.replace(" ", ""):
            for (yc, ylab) in years:
                for c in range(yc, yc + 36):
                    v = s.n(r, c)
                    if v is not None: totals_usd[ylab[:4]] = v; break
            continue
        if "총합계(KRW" in lab.replace(" ", ""):
            for (y, m, c) in months:
                v = next((s.n(r, cc) for cc in range(c, c + 3) if s.n(r, cc) is not None), None)
                if v: mon_krw[(y, m)] = v
            continue
        if "합계" in lab: continue
        rowvals = [(y, m, c) for (y, m, c) in months if any(s.v(r, cc) is not None for cc in range(c, c + 3))]
        if b and not cfd and not rowvals:
            sect = str(b).split("(")[0].strip() if "(" in str(b) and not str(b).startswith("비상장") else str(b).strip()
            continue
        if not cfd and not b: continue
        gp = b or gp
        for (y, m, c) in rowvals:
            ty, cy, am = s.t(r, c), s.t(r, c + 1), s.v(r, c + 2)
            amn = num(am)
            if amn is None and ty is None: continue
            st = legend.get(s.fill(r, c + 2)) or legend.get(s.fill(r, c))
            row = {"y": y, "m": m, "sec": sect, "gp": gp, "fd": cfd, "ty": ty if amn is not None else None, "cy": cy, "am": amn,
                   "st": st or ("예상" if amn is not None else None), "nt": None if amn is not None else ty}
            pays.append({k: v for k, v in row.items() if v is not None})
    ys = [y[:4] for _, y in years]
    cur_y = (ctx.get("asof") or "")[:4]
    secs = []
    for y in ys:
        for m in range(1, 13):
            rr = [p for p in pays if p["y"] == y and p["m"] == m]
            if not rr: continue
            byc = {}
            for p in rr:
                if p.get("am") is not None: byc[p.get("cy", "")] = byc.get(p.get("cy", ""), 0) + p["am"]
            sub = " · ".join(f"{k} {v:,.0f}" for k, v in byc.items())
            if mon_krw.get((y, m)): sub += f" · 원화 {mon_krw[(y, m)] / 1e8:.2f}억"
            secs.append({"h": f"{y}년 {m}월", "p": y, "s": sub, "rows": [{"c": {k: v for k, v in p.items() if k not in ("y", "m")}} for p in rr]})
    blocks = []
    if totals_krw:
        cy, ny = cur_y, str(int(cur_y) + 1) if cur_y else None
        ks = []
        for y in (cy, ny):
            if y in totals_krw:
                ks.append(kpi(f"{y}년 예상 수수료", totals_krw[y] / 1e8, "n1", "억원", f"USD 환산 {totals_usd[y]:,.0f}" if y in totals_usd else "원화 환산"))
        unpaid = [p for p in pays if p.get("st") == "미수금 인식" and p["y"] == cy]
        ks.append(kpi(f"{cy} 미수금 인식", len(unpaid), "n0", "건", "아직 입금 전", tone="warn"))
        ks.append(kpi("Schedule 등록", len({(p.get('gp'), p.get('fd')) for p in pays}), "n0", "개 펀드", f"{ys[0]}~{ys[-1]}년"))
        blocks.append({"t": "kpis", "id": "k", "items": ks})
        blocks.append({"t": "bars", "id": "yr", "title": "연도별 예상 수수료", "sub": "억원 · 원화 환산 합계", "f": "eok1",
                       "items": [{"l": y, "v": totals_krw[y] / 1e8, "hi": 1 if y in (cy, str(int(cy) + 1)) else 0} for y in ys if y in totals_krw]})
    tone = {"수취 완료": "ok", "미수금 인식": "warn", "진행중": "info", "예상": "muted"}
    b = {"t": "table", "id": "cf", "title": "월별 수취 일정", "sub": "전체 또는 연도를 골라 보기 · 금액은 펀드 통화",
         "cols": [col("sec", "구분", "tag"), col("gp", "운용사"), col("fd", "펀드"), col("ty", "보수 유형", "tag"),
                  col("am", "금액", "amt", ck="cy", sum=0), col("st", "상태", "tag", tone=tone), col("nt", "메모")],
         "secs": secs, "pick": {"l": "연도", "opts": ["전체"] + ys, "def": "전체"},
         "card": {"title": "fd", "sub": ["gp", "ty"], "amt": "am", "chips": ["st", "sec"]}, "filters": ["st", "sec"]}
    blocks.append(b)
    if notes: blocks.append({"t": "notes", "items": ["원화 환산은 엑셀의 적용 환율 기준 · " + " / ".join(notes)]})
    return blocks


# ── 약정내역(2022~현재) (예전 이름 약정내역&수수료) · KPI보고용 ─────────────────────────────────────────────

def v_commit(s, ctx, kpi_sheet=False):
    h = s.find(lambda x: x.strip() == "운용사(GP)", 1, 30)
    if not h: raise ValueError("머리글 '운용사(GP)' 없음")
    hr, cB = h
    H = {}
    for c in range(cB, cB + 40):
        t = (s.t(hr, c) or "").replace("\n", "")
        if t and t not in H: H[t] = c
    def hc(k):
        for t, c in H.items():
            if t.startswith(k): return c
        return None
    cols_map = [("gp", "운용사(GP)"), ("ac", "자산군"), ("it", "투자유형"), ("is", "투자전략"), ("cd", "금융투자협회 코드"), ("fs", "금감원 보고여부"),
                ("fr", "금감원 보고리소스"), ("fn", "펀드명"), ("ab", "펀드명 약칭"), ("ym", "약정연월"), ("lp", "기관명"), ("vi", "국내재간접"), ("cy", "약정통화"), ("am", "총약정금액")]
    C = {k: hc(t) for k, t in cols_map}
    if not C["lp"] or not C["fn"]: raise ValueError("기관명·펀드명 열 없음")
    # 연도 블록: 머리글 행의 2026년/2025… → 그 아래 행의 USD기준 환산·수수료·수수료율
    yrs = []
    c = (C["am"] or cB) + 1
    while c < cB + 40:
        t = (s.t(hr, c) or "")
        m = re.match(r"^(\d{4})", t)
        if m and (not yrs or yrs[-1][0] != m.group(1)):
            yrs.append((m.group(1), c))
        c += 1
    if not yrs: raise ValueError("연도 열 없음")
    # 상태 범례
    legend = {}
    for r in range(1, hr):
        for c in range(1, 20):
            t = (s.t(r, c) or "").strip()
            if t in ("진행중, 수취진행중", "수취완료", "청구예정 or 확인중") or t.startswith("KPI 보고 사용분"):
                f = s.fill(r, c - 1)
                if f: legend[f] = "진행중" if t.startswith("진행중") else ("청구예정·확인중" if t.startswith("청구") else ("KPI 보고 사용분" if t.startswith("KPI") else t))
    st_cols = [C["ab"], C["fn"]]
    rows, foot = [], []
    for r in s.rows(hr + 2):
        if (s.t(r, C["ab"]) or "") == "합계" or (s.t(r, C["fn"]) or "") == "합계":
            foot.append({"l": "합계(가능성 있는 기관 포함)", "c": {f"u{y}": s.n(r, c) for y, c in yrs} | {f"f{y}": s.n(r, c + 1) for y, c in yrs}})
            break
        if (s.t(r, 1) or "").startswith("▼"): break
        lp, gp = s.t(r, C["lp"]), s.t(r, C["gp"])
        if not lp and not gp: continue
        c_ = {k: s.v(r, cc) for k, cc in C.items() if cc}
        for y, cc in yrs:
            u, f, rt = s.n(r, cc), s.n(r, cc + 1), s.n(r, cc + 2)
            if u: c_[f"u{y}"] = u
            if f: c_[f"f{y}"] = f
            if rt: c_[f"r{y}"] = rt
        stf = legend.get(s.fill(r, C["ab"] or C["fn"]))
        if kpi_sheet:
            c_["kp"] = "KPI 보고 사용분" if stf == "KPI 보고 사용분" else "그 외"
            if stf and stf != "KPI 보고 사용분": c_["st"] = stf
            # 연도 칸 색 = 그 해 수취 상태
            for y, cc in yrs:
                f2 = legend.get(s.fill(r, cc + 1)) or legend.get(s.fill(r, cc))
                if f2 and f2 != "KPI 보고 사용분": c_[f"s{y}"] = f2
        elif stf and stf != "KPI 보고 사용분":
            c_["st"] = stf
        if not c_.get("ab") and c_.get("fn"): c_["ab"] = c_["fn"]
        if isinstance(c_.get("ym"), str) and re.match(r"^\d{4}-\d{2}-\d{2}", c_["ym"]): c_["ym"] = c_["ym"][:7]
        rows.append({"c": {k: v for k, v in c_.items() if v is not None}})
    ylist = [y for y, _ in yrs]
    pick_cols = {y: [f"u{y}", f"f{y}", f"r{y}"] + ([f"s{y}"] if kpi_sheet else []) for y in ylist}
    cols = [col("ab", "펀드(약칭)"), col("lp", "기관명"), col("gp", "운용사"), col("ac", "자산군", "tag"), col("cy", "통화", "tag", d=1),
            col("am", "총약정금액", "amt", ck="cy", d=1), col("ym", "약정연월", d=1)]
    if kpi_sheet: cols.append(col("kp", "KPI 보고", "tag", tone={"KPI 보고 사용분": "ok", "그 외": "muted"}))
    cols.append(col("st", "상태", "tag", tone={"수취완료": "ok", "진행중": "info", "청구예정·확인중": "warn"}))
    for y in ylist:
        cols += [col(f"u{y}", f"{y} USD 환산", "usd", sum=1), col(f"f{y}", f"{y} 수수료(USD)", "usd", sum=1), col(f"r{y}", f"{y} 수수료율", "pct2")]
        if kpi_sheet: cols.append(col(f"s{y}", f"{y} 상태", "tag", tone={"수취완료": "ok", "진행중": "info", "청구예정·확인중": "warn"}))
    cols += [col("fn", "펀드명(전체)", d=1), col("it", "투자유형", d=1), col("is", "투자전략", d=1), col("vi", "국내재간접 운용사", d=1),
             col("cd", "협회 코드", d=1), col("fs", "금감원 보고", d=1), col("fr", "보고 리소스", d=1)]
    cur_y = (ctx.get("asof") or "")[:4]
    b = {"t": "table", "id": "cm", "title": "기관별 약정내역", "sub": "전체 · 연도를 고르면 그 해 약정·수수료가 있는 건만",
         "cols": cols, "rows": rows, "foot": foot,
         "pick": {"l": "연도", "opts": ["전체"] + ylist, "def": "전체", "cols": {"전체": []} | pick_cols, "need": "u|f"},
         "card": {"title": "ab", "sub": ["lp", "gp"], "amt": "@u", "meta": ["@f"], "chips": (["kp"] if kpi_sheet else []) + ["st", "ac"]},
         "filters": ["ac"] + (["kp"] if kpi_sheet else []) + ["st", "gp"]}
    blocks = []
    # 연도별 합계 카드(엑셀 합계 행)
    if foot:
        fc = foot[0]["c"]
        blocks.append({"t": "kpis", "id": "k", "items": [kpi(f"{y} 약정", (fc.get(f"u{y}") or 0) / 1e6, "n0", "USD M", f"수수료 USD {fc.get(f'f{y}') or 0:,.2f}") for y in ylist[:3]]
                       + [kpi("등록 건수", len(rows), "n0", "건", f"{len({r['c'].get('ab') or r['c'].get('fn') for r in rows})}개 펀드")]})
    if kpi_sheet:
        tg = s.find(lambda x: x.strip() == "해외대체펀드 판매규모 목표", 1, 10)
        if tg:
            r, c = tg
            rr = r + 1
            while s.v(rr, c - 1) is not None: rr += 1
            blocks.append(generic_table(s, r, r + 1, rr - 1, c - 1, c + 2, title="연도별 KPI 목표", tid="tg"))
    blocks.append(b)
    return blocks


# ── KPI 실적 요약(문서형: 번호 붙은 절마다 표·문장) ───────────────────────────

def v_kpi(s, ctx):
    """연도별로 정리(사용자 요청): 연도별 한눈에(차트·표) → 연도 단추(지표 카드·제출 근거·그 해 PA·판매규모 목록) → 산출 기준.
    엑셀 구조가 달라 연도별로 묶지 못하면 예전처럼 절 순서대로 보여준다."""
    secs = kpi_sections(s)
    sub = s.t(2, 1) or s.t(2, 2)
    try:
        return kpi_by_year(secs, sub)
    except Exception as e:  # noqa: BLE001
        print(f"  경고 — KPI 실적 요약 연도별 정리 실패({e}) → 절 순서대로 표시")
    blocks = [{"t": "notes", "items": [sub]}] if sub else []
    for n, head, b in secs:
        if b["t"] == "table" and n >= 4:
            b["fold"] = True; b["sub"] = f"{len(b['rows'])}건"
        blocks.append(b)
    return blocks


def kpi_by_year(secs, sub):
    def ck(b, *keys):
        for c in b["cols"]:
            lab = c["l"].replace(" ", "")
            if all(k in lab for k in keys): return c["k"]
        return None
    def need(b, *keys):
        k = ck(b, *keys)
        if not k: raise ValueError(f"'{b.get('title')}' 에 {'·'.join(keys)} 열 없음")
        return k
    tables = [(n, hd, b) for n, hd, b in secs if b["t"] == "table"]
    s1 = next(b for n, hd, b in tables if ck(b, "연도") and ck(b, "판매규모", "목표"))
    K = {"y": need(s1, "연도"), "tg": need(s1, "판매규모", "목표"), "ku": ck(s1, "KPI보고", "USD"), "kj": need(s1, "KPI보고", "조원"),
         "kr": need(s1, "달성률", "KPI"), "cu": ck(s1, "약정실적", "USD"), "cj": need(s1, "약정실적", "조원"), "cr": ck(s1, "달성률", "약정실적"),
         "pt": need(s1, "PA", "목표"), "pa": need(s1, "PA", "실적"), "pr": ck(s1, "PA", "달성률"), "nt": ck(s1, "비고")}
    s2 = next((b for n, hd, b in tables if b is not s1 and ck(b, "연도") and ck(b, "수익", "실적")), None)
    R = {"y": need(s2, "연도"), "tg": ck(s2, "수익", "목표"), "v": need(s2, "수익", "실적"), "r": ck(s2, "달성률"), "nt": ck(s2, "근거")} if s2 else {}
    yrs = {}
    for r in s1["rows"]:
        y = r["c"].get(K["y"])
        if isinstance(y, int): yrs[y] = {"k": r["c"]}
    if not yrs: raise ValueError("연도 행 없음")
    for r in (s2["rows"] if s2 else []):
        y = r["c"].get(R["y"])
        if y in yrs: yrs[y]["r"] = r["c"]
    # 그 해 절(제목의 첫 'YYYY년')과 나머지(산출 기준 등)
    per, common = {y: [] for y in yrs}, []
    for n, hd, b in secs:
        if b is s1 or b is s2: continue
        m = re.search(r"(20\d\d)년", hd)
        if m and int(m.group(1)) in per and b["t"] == "table":
            # 절 번호는 남긴다(산출 기준 문장이 '아래 9번'처럼 가리킴). 연도는 단추에 있으니 제목에서 뺀다
            b = dict(b, title=hd.replace(f"{m.group(1)}년 ", "", 1), fold=True, sub=f"{len(b['rows'])}건")
            # 휴대폰 카드: 번호 대신 상대방·기관을 제목으로
            t_ = ck(b, "계약상대방") or ck(b, "기관")
            if t_:
                b["card"] = {"title": t_, "sub": [k for k in (ck(b, "운용사"), ck(b, "관련펀드") or ck(b, "펀드")) if k],
                             "meta": [k for k in (ck(b, "체결일") or ck(b, "약정월"), ck(b, "계약종류")) if k],
                             **({"amt": ck(b, "USD환산") or ck(b, "약정금액")} if (ck(b, "USD환산") or ck(b, "약정금액")) else {})}
            per[int(m.group(1))].append(b)
        else:
            common.append(b)

    def f2(v): return f"{v:,.2f}" if isinstance(v, (int, float)) else str(v)
    def pc(v): return f"{v * 100:.1f}%" if isinstance(v, (int, float)) else "-"
    def tone(v): return None if not isinstance(v, (int, float)) else ("ok" if v >= 1 else "warn")
    items = []
    for y in sorted(yrs, reverse=True):
        k, rv = yrs[y]["k"], yrs[y].get("r") or {}
        g = lambda key: k.get(K[key]) if K.get(key) else None
        cards = [kpi("판매규모 (KPI 보고)", g("kj"), "n2", "조원",
                     s=" · ".join(x for x in [f"목표 {f2(g('tg'))}조원", f"달성률 {pc(g('kr'))}", f"USD {g('ku'):,.2f}M" if isinstance(g("ku"), (int, float)) else ""] if x),
                     pct=g("kr"), tone=tone(g("kr"))),
                 kpi("약정 실적", g("cj"), "n2", "조원",
                     s=" · ".join(x for x in [f"USD {g('cu'):,.2f}M" if isinstance(g("cu"), (int, float)) else "", f"목표 대비 {pc(g('cr'))}" if g("cr") is not None else ""] if x) or None),
                 kpi("신규 PA", g("pa"), "n0", "건", s=f"목표 {g('pt')}건 · 달성률 {pc(g('pr'))}", pct=g("pr"), tone=tone(g("pr")))]
        if rv:
            rt, rr = rv.get(R.get("tg")) if R.get("tg") else None, rv.get(R.get("r")) if R.get("r") else None
            cards.append(kpi("수익 (현금기준)", rv.get(R["v"]), "n2", "억원",
                             s=(f"목표 {f2(rt)}억원 · 달성률 {pc(rr)}" if isinstance(rt, (int, float)) else (f"목표 {rt}" if rt else None)),
                             pct=rr if isinstance(rr, (int, float)) else None, tone=tone(rr)))
        blocks = [{"t": "kpis", "id": f"k{y}", "items": cards}]
        why = [x for x in [g("nt"), ("수익: " + str(rv.get(R["nt"]))) if rv and R.get("nt") and rv.get(R["nt"]) else None] if x]
        if why: blocks.append({"t": "notes", "title": "제출 근거", "items": why})
        blocks += per[y]
        items.append({"k": str(y), "l": f"{y}년", "blocks": blocks})

    ys = sorted(yrs)
    gk = lambda y, key: yrs[y]["k"].get(K[key]) if K.get(key) else None
    out = [{"t": "notes", "items": [sub]}] if sub else []
    out.append({"t": "row", "blocks": [
        {"t": "col", "id": "ysale", "title": "판매규모", "sub": "조원 · 목표 vs KPI 보고 vs 약정 실적", "cats": [str(y) for y in ys], "f": "n2",
         "series": [{"n": "목표", "v": [gk(y, "tg") or 0 for y in ys]}, {"n": "KPI 보고", "v": [gk(y, "kj") or 0 for y in ys]},
                    {"n": "약정 실적", "v": [gk(y, "cj") or 0 for y in ys]}]},
        {"t": "col", "id": "ypa", "title": "신규 PA", "sub": "건 · 목표 vs 실적", "cats": [str(y) for y in ys], "f": "n0",
         "series": [{"n": "목표", "v": [gk(y, "pt") or 0 for y in ys]}, {"n": "실적", "v": [gk(y, "pa") or 0 for y in ys]}]}]})
    rows = []
    for y in sorted(yrs, reverse=True):
        c = {"y": y, "tg": gk(y, "tg"), "kj": gk(y, "kj"), "kr": gk(y, "kr"), "cj": gk(y, "cj"), "pt": gk(y, "pt"), "pa": gk(y, "pa"), "pr": gk(y, "pr")}
        rv = yrs[y].get("r")
        if rv and isinstance(rv.get(R["v"]), (int, float)): c["rv"] = rv[R["v"]]
        rows.append({"c": {a: b for a, b in c.items() if b is not None}})
    out.append({"t": "table", "id": "yall", "title": "연도별 한눈에", "sub": "판매규모 조원 · PA 건 · 수익 억원(현금기준)", "compact": True, "rows": rows,
                "cols": [col("y", "연도", "int"), col("tg", "판매 목표", "n2"), col("kj", "KPI 보고", "n2"), col("kr", "달성률", "pct"),
                         col("cj", "약정 실적", "n2"), col("pt", "PA 목표", "n0"), col("pa", "PA 실적", "n0"), col("pr", "PA 달성률", "pct"),
                         col("rv", "수익", "n2")],
                "card": {"title": "y", "meta": ["kj", "kr", "pa"]}})
    out.append({"t": "tabs", "id": "yr", "title": "연도별 상세", "items": items, "sel": "전체", "all": True})   # 앱이 '전체'(모든 연도 차례로) 단추를 맨 앞에 붙인다
    out += common
    return out


def kpi_sections(s):
    """번호 붙은 절(1. 2. …)을 차례대로 [(번호, 제목, 블록)]."""
    secs = []
    r = 3
    while r <= s.maxr:
        t = s.t(r, 1) or s.t(r, 2)
        if not t or not re.match(r"^\d+\.\s", t.strip()):
            r += 1; continue
        head = t.strip()
        c0 = 1 if s.t(r, 1) else 2
        nxt = r + 1
        while nxt <= s.maxr and s.empty(nxt, 1, 15): nxt += 1
        # 표인지(머리글 3칸 이상) 문장인지
        filled = [c for c in range(1, 16) if s.v(nxt, c) is not None]
        end = nxt
        while end + 1 <= s.maxr and not s.empty(end + 1, 1, 15) and not re.match(r"^\d+\.\s", (s.t(end + 1, 1) or s.t(end + 1, 2) or "").strip()):
            end += 1
        m = re.match(r"^(\d+)\.", head)
        if len(filled) >= 3:
            c1 = max(c for c in range(1, 16) if any(s.v(x, c) is not None for x in range(nxt, end + 1)))
            b = generic_table(s, nxt, nxt + 1, end, min(filled), c1, title=head, tid=f"s{m.group(1)}")
            # 표 아래 ※ 줄은 각주로
            notes = [row for row in b["rows"] if str(next(iter(row["c"].values()), "")).startswith("※")]
            if notes:
                b["rows"] = [x for x in b["rows"] if x not in notes]
                b["notes"] = [" ".join(str(v) for v in x["c"].values()) for x in notes]
        else:
            items = [" ".join(str(s.v(x, c)) for c in range(1, 16) if s.v(x, c) is not None) for x in range(nxt, end + 1)]
            b = {"t": "notes", "title": head, "items": [i for i in items if i]}
        secs.append((int(m.group(1)), head, b))
        r = end + 1
    return secs


# ── 2026년 계약서 ────────────────────────────────────────────────────────────

def v_contract(s, ctx):
    h = s.find(lambda x: x.strip() == "계약 상대방", 1, 10)
    if not h: raise ValueError("머리글 '계약 상대방' 없음")
    hr, cC = h
    cB = cC - 1
    H = {}
    for c in range(cB, cB + 10):
        if c in s.hc: continue
        t = (s.t(hr, c) or "").replace("\n", " ")
        H[c] = t
    keys = {"번호": "no", "계약 상대방": "cp", "체결현황": "st", "전략": "sr", "관련 펀드": "fd", "계약 날짜": "dt", "계약 종류": "ty", "Fee": "fe", "메모": "mm"}
    cmap = {}
    for c, t in H.items():
        for k, v in keys.items():
            if t.startswith(k) and v not in cmap.values(): cmap[c] = v
    rows = []
    for r in s.rows(hr + 1):
        if s.v(r, cC) is None and s.v(r, cB) is None:
            if s.empty(r, cB, cB + 9): break
            continue
        c_ = {v: s.v(r, c) for c, v in cmap.items()}
        if c_.get("fe") == 0: c_["fe"] = None
        rows.append({"c": {k: v for k, v in c_.items() if v is not None}})
    # 집계(체결완료(KPI 관련O)…)
    cnt = {}
    for r in range(hr, hr + 8):
        for c in range(cB + 10, cB + 25):
            t = s.t(r, c)
            if t and (t.startswith("체결완료") or t in ("진행중", "협의중")) and s.n(r, c + 1) is not None:
                cnt[t] = s.n(r, c + 1)
    tone = {"체결완료(KPI 관련O)": "ok", "체결완료(KPI 관련X)": "muted", "진행중": "info", "협의중": "warn"}
    blocks = []
    if cnt:
        blocks.append({"t": "kpis", "id": "k", "items": [kpi(k, v, "n0", "건", tone=tone.get(k)) for k, v in cnt.items()]})
    # 자산군 × 상태
    mx = s.find(lambda x: x.strip() == "체결완료", hr, hr + 2, cB + 10, cB + 20)
    if mx:
        r, c = mx
        rr = r + 1
        while s.v(rr, c - 1) is not None: rr += 1
        blocks.append(generic_table(s, r, r + 1, rr - 1, c - 1, c + 2, title="자산군별 현황", tid="mx", total_words=("계",)))
    blocks.append({"t": "table", "id": "ct", "title": "계약 목록", "sub": f"{len(rows)}건",
                   "cols": [col("no", "No", "n0", d=0), col("cp", "계약 상대방"), col("st", "체결현황", "tag", tone=tone), col("sr", "전략", "tag"),
                            col("fd", "관련 펀드"), col("dt", "계약일", "date"), col("ty", "계약 종류"), col("fe", "Fee"), col("mm", "메모")],
                   "rows": rows, "card": {"title": "cp", "sub": ["fd", "ty"], "meta": ["dt"], "chips": ["st", "sr"]}, "filters": ["st", "sr"]})
    return blocks


# ── 2026년 주요 마케팅 펀드 리스트 ───────────────────────────────────────────

def v_marketing(s, ctx):
    h = s.find(lambda x: x.strip() == "GP", 1, 10, 1, 4)
    if not h: raise ValueError("머리글 'GP' 없음")
    hr, cB = h
    H = {(s.t(hr, c) or "").replace("\n", "").strip(): c for c in range(cB, cB + 30) if s.t(hr, c)}
    mcols = [H.get(m) or H.get(m + " ") for m in MONTHS]
    mcols = [c for c in mcols if c]
    def hc(*ks):
        for k in ks:
            for t, c in H.items():
                if t.startswith(k): return c
        return None
    cAC, cFD, cCY, cKD = hc("Asset"), hc("Fund"), hc("통화"), hc("구분")
    cBP, cSM, cFU, cFE, cST, cRC, cUR = hc("Fee Rate"), hc("판매금액"), hc("2026 발생수익(USD"), hc("2026 발생수익(억"), hc("상태"), hc("2026 인식"), hc("미인식")
    secs, cur, secname, foot = [], [], "주요 펀드", []
    allfoot = []
    r = hr + 1
    rows_iter = list(s.rows(hr + 1))
    i = 0
    while i < len(rows_iter):
        r = rows_iter[i]
        b = s.t(r, cB) or ""
        kd = s.t(r, cKD) or ""
        if b.startswith("▼"):
            if cur or foot: secs.append({"h": secname, "rows": cur, "foot": foot}); cur, foot = [], []
            secname = "기타 펀드" if "기타" in b else b.strip("▼ ").split("—")[0].strip()
            i += 1; continue
        if b.endswith("소계") or b == "합계":
            # 로드쇼 행 + 약정 행
            ro = {"rs": [s.n(r, c) or 0 for c in mcols]} if kd == "로드쇼" else {}
            fr = {"fe": s.n(r, cBP), "sm": s.n(r, cSM), "fu": s.n(r, cFU), "fk": s.n(r, cFE), "rc": s.n(r, cRC), "ur": s.n(r, cUR)}
            nr = rows_iter[i + 1] if i + 1 < len(rows_iter) else None
            cm = [s.n(nr, c) or 0 for c in mcols] if nr and (s.t(nr, cKD) or "").startswith("약정") else None
            row = {"l": b, "c": {k: v for k, v in fr.items() if v is not None} | {"mo": {"rs": ro.get("rs"), "cm": cm}}}
            if b == "합계": allfoot.append(row)
            else: foot.append(row)
            i += 2 if cm is not None else 1; continue
        if (b.startswith("※")): i += 1; continue
        if kd == "로드쇼" and s.t(r, cFD):
            nr = rows_iter[i + 1] if i + 1 < len(rows_iter) else None
            cm = [s.n(nr, c) or 0 for c in mcols] if nr and (s.t(nr, cKD) or "") == "약정" else [0] * len(mcols)
            fe = s.v(r, cBP)
            row = {"gp": b, "ac": s.t(r, cAC), "fd": s.t(r, cFD), "cy": s.t(r, cCY), "fe": fe,
                   "sm": s.n(r, cSM), "fu": s.n(r, cFU), "fk": s.n(r, cFE), "st": s.t(r, cST), "rc": s.n(r, cRC), "ur": s.n(r, cUR),
                   "mo": {"rs": [s.n(r, c) or 0 for c in mcols], "cm": cm},
                   "nrs": sum(s.n(r, c) or 0 for c in mcols)}
            cur.append({"c": {k: v for k, v in row.items() if v not in (None, "")}})
            i += 2 if (nr and (s.t(nr, cKD) or "") == "약정") else 1; continue
        i += 1
    if cur or foot: secs.append({"h": secname, "rows": cur, "foot": foot})
    for sec in secs: sec["s"] = f"{len(sec['rows'])}개 펀드"
    notes = [s.t(r, cB) for r in s.rows(1) if (s.t(r, cB) or "").startswith("※")]
    cols = [col("gp", "GP"), col("fd", "Fund Name"), col("ac", "자산군", "tag"), col("cy", "통화", "tag"),
            col("mo", "월별 로드쇼·약정", "months"), col("nrs", "로드쇼 횟수", "n0", sum=1, d=1), col("fe", "Fee(bp)", "n1"),
            col("sm", "판매(mil)", "n1", sum=1), col("fu", "2026 발생(USD)", "usd", sum=1, d=1), col("fk", "발생(억)", "eok", sum=1),
            col("rc", "2026 인식(억)", "wk", sum=1), col("ur", "미인식(억)", "eok", sum=1), col("st", "상태", "tag")]
    tot = allfoot[0]["c"] if allfoot else {}
    blocks = [{"t": "kpis", "id": "k", "items": [
        kpi("판매금액", (tot.get("sm") or 0), "n0", "USD M", "펀드 통화 mil 합계"),
        kpi("2026 발생", tot.get("fk") or 0, "n2", "억원", f"USD {tot.get('fu') or 0:,.2f}"),
        kpi("2026 인식", (tot.get("rc") or 0) / 1e8, "n2", "억원", "Cash+미수금"),
        kpi("미인식", tot.get("ur") or 0, "n2", "억원", "발생 − 인식", tone="warn"),
        kpi("로드쇼", sum(tot.get("mo", {}).get("rs") or [0]), "n0", "회", f"{sum(len(x['rows']) for x in secs)}개 펀드"),
    ]}]
    blocks.append({"t": "table", "id": "mk", "title": "펀드 리스트", "sub": "월별 칸: 점 = 로드쇼, 숫자 = 약정(펀드통화 mil)", "cols": cols, "secs": secs,
                   "foot": allfoot, "card": {"title": "fd", "sub": ["gp", "ac"], "amt": "fk", "meta": ["sm"], "chips": ["st", "cy"], "wide": "mo"},
                   "filters": ["ac", "st"], "mlabels": [m.replace("월", "") for m in MONTHS[:len(mcols)]]})
    if notes: blocks.append({"t": "notes", "items": notes})
    return blocks


# ── 2026 RFP·RFI ─────────────────────────────────────────────────────────────

def v_rfp(s, ctx):
    h = s.find(lambda x: x.strip() == "실시 LP 기관", 1, 30)
    if not h: raise ValueError("머리글 '실시 LP 기관' 없음")
    hr, cD = h
    H = {}
    for c in range(cD - 2, cD + 14):
        t = (s.t(hr, c) or "").replace("\n", " ").strip()
        if t: H[t] = c
    keys = [("No", "no"), ("구분", "kd"), ("실시 LP 기관", "lp"), ("LP 담당부서", "dp"), ("자산군", "ac"), ("세부전략", "sr"), ("모집 요건", "rq"),
            ("제출 기한", "dl"), ("요일", "wd"), ("시간", "tm"), ("LP 배포직원", "lpp"), ("KB 배포직원", "kb"), ("기타", "et"), ("제출기관", "sb"), ("선정", "sel")]
    cmap = {H[t]: k for t, k in keys if t in H}
    rows = []
    for r in s.rows(hr + 1):
        if s.empty(r, cD - 2, cD + 13): continue
        c_ = {}
        for c, k in cmap.items():
            x = s.v(r, c)
            if k == "dl": x = serial_date(x)
            if isinstance(x, str): x = x.replace("\r", "")
            c_[k] = x
        if c_.get("lp"): c_["lp1"] = re.sub(r"\s*\n\s*", " ", str(c_["lp"]))
        rows.append({"c": {k: v for k, v in c_.items() if v not in (None, "-")}})
    blocks = []
    ag = s.find(lambda x: x.strip() == "자산군별 집계", 1, hr)
    kd = {}
    for r in rows: kd[r["c"].get("kd")] = kd.get(r["c"].get("kd"), 0) + 1
    blocks.append({"t": "kpis", "id": "k", "items": [kpi("전체", len(rows), "n0", "건")] + [kpi(k, v, "n0", "건") for k, v in sorted(kd.items(), key=lambda x: str(x[0])) if k]
                   + [kpi("선정·결과 기록", len([r for r in rows if r["c"].get("sel")]), "n0", "건", tone="ok")]})
    if ag:
        r, c = ag
        blocks.append(generic_table(s, r + 1, r + 2, scan_end(s, r + 2, c), c, c + 3, title="자산군별 집계", tid="ag", total_words=("전체 건수",)))
        nt = s.t(r, c + 4) or s.t(r, c + 5)
        if nt: blocks[-1]["notes"] = [nt]
    blocks.append({"t": "table", "id": "rf", "title": "RFP·RFI 목록", "sub": "제출 기한 순 · 눌러서 요건·제출기관 보기",
                   "cols": [col("no", "No", "n0"), col("kd", "구분", "tag", tone={"RFP": "info"}), col("lp1", "실시 LP 기관"), col("dp", "LP 담당부서"),
                            col("ac", "자산군", "tag"), col("sr", "세부전략"), col("dl", "제출 기한", "date"), col("wd", "요일", d=1), col("tm", "시간", d=1),
                            col("kb", "KB 배포직원"), col("lpp", "LP 배포직원", d=1), col("rq", "모집 요건", "long", d=1), col("sb", "제출기관", "long", d=1),
                            col("sel", "선정", "long"), col("et", "기타", "long", d=1)],
                   "rows": rows, "card": {"title": "lp1", "sub": ["dp", "sr"], "meta": ["dl"], "chips": ["kd", "ac"]}, "filters": ["kd", "ac", "kb"]})
    return blocks


# ── 2026 로드쇼·세미나 ──────────────────────────────────────────────────────

def v_roadshow(s, ctx):
    h = s.find(lambda x: x.strip() == "행사내용", 1, 60)
    if not h: raise ValueError("머리글 '행사내용' 없음")
    hr, cE = h
    cB = cE - 3
    secs = {}
    for r in s.rows(hr + 1):
        m, per, gp, kd = s.v(r, cB), s.t(r, cB + 1), s.t(r, cB + 2), s.t(r, cB + 3)
        if not gp: continue
        secs.setdefault(m, []).append({"c": {k: v for k, v in {"m": m, "pd": per, "gp": gp, "kd": kd}.items() if v is not None}})
    blocks = []
    mh = s.find(lambda x: x.strip() == "월", 1, hr - 1)
    if mh:
        r, c = mh
        labs = [s.t(r, c + i) for i in range(1, 4)]
        cats, ser = [], {l: [] for l in labs if l and l != "합계"}
        tot = None
        for rr in range(r + 1, r + 15):
            mm = s.v(rr, c)
            if mm == "합계" or mm is None:
                if mm == "합계": tot = {labs[i - 1]: s.n(rr, c + i) for i in range(1, 4)}
                break
            cats.append(f"{mm}월")
            for i, l in enumerate(labs, 1):
                if l in ser: ser[l].append(s.n(rr, c + i) or 0)
        if tot:
            blocks.append({"t": "kpis", "id": "k", "items": [kpi(k, v, "n0", "회") for k, v in tot.items() if v is not None]})
        blocks.append({"t": "col", "id": "m", "title": "월별 행사", "sub": "회", "cats": cats, "series": [{"n": k, "v": v} for k, v in ser.items()], "stack": True, "f": "n0"})
    src = s.find(lambda x: x.strip().startswith("출처"), 1, 5)
    out = [{"h": f"{m}월", "s": f"{len(v)}건", "rows": v} for m, v in secs.items()]
    blocks.append({"t": "table", "id": "rs", "title": "행사 일정", "cols": [col("pd", "기간"), col("gp", "GP"), col("kd", "행사", "tag", tone={"세미나": "info"})],
                   "secs": out, "card": {"title": "gp", "sub": ["pd"], "chips": ["kd"]}, "filters": ["kd"]})
    if src: blocks.append({"t": "notes", "items": [s.t(*src)]})
    return blocks


# ── 국내 LP별 · GP별 · 자산군별 ─────────────────────────────────────────────

def year_table(s, hr, cname, years_c, stop_words=("합계", "검증")):
    rows = []
    for r in s.rows(hr + 1):
        n = s.t(r, cname)
        if n is None:
            if s.empty(r, cname, years_c[-1][1]): break
            continue
        if n in stop_words: continue
        rows.append({"c": {"nm": n} | {f"y{y}": s.n(r, c) for y, c in years_c if s.n(r, c)}})
    return rows


def ranking(rows, ys, f, title, sub, tid, n=10):
    # 연도 단추: '전체'(모든 연도 합)를 맨 앞·기본값으로, 그 뒤에 연도별(사용자 요청 2026-11-12)
    tot = sorted([{"l": r["c"]["nm"], "v": sum(r["c"].get(f"y{y}") or 0 for y in ys)} for r in rows], key=lambda x: -x["v"])
    sets = {"전체": [x for x in tot if x["v"] > 0][:n]}
    for y in ys:
        it = sorted([{"l": r["c"]["nm"], "v": r["c"].get(f"y{y}") or 0} for r in rows], key=lambda x: -x["v"])
        sets[y] = [x for x in it if x["v"] > 0][:n]
    return {"t": "bars", "id": tid, "title": title, "sub": sub, "f": f, "sets": sets, "def": "전체", "rank": True}


def v_lp(s, ctx):
    h = s.find(lambda x: x.strip() == "기관명", 1, 15, 1, 4)
    if not h: raise ValueError("머리글 '기관명' 없음")
    hr, c = h
    ys = [(s.t(hr, cc)[:4], cc) for cc in range(c + 1, c + 8) if re.match(r"^\d{4}", s.t(hr, cc) or "")]
    rows = year_table(s, hr, c, ys)
    for r in rows:
        note = s.t(next(x for x in s.rows(hr + 1) if s.t(x, c) == r["c"]["nm"]), ys[-1][1] + 1)
        if note: r["c"]["nt"] = note
    tot_r = next((x for x in range(1, hr) if s.t(x, c) == "합계"), None)
    foot = [{"l": "합계", "c": {f"y{y}": s.n(tot_r, cc) for y, cc in ys}}] if tot_r else []
    yl = [y for y, _ in ys]
    blocks = [{"t": "kpis", "id": "k", "items": [kpi(f"{y} 발생 수수료", (foot[0]["c"].get(f"y{y}") or 0) / 1e3 if foot else 0, "n0", "USD천",
                                                   f"기관 {len([r for r in rows if r['c'].get(f'y{y}')])}곳") for y in yl[-3:]]},
              ranking(rows, yl, "usdk", "연도별 수익 기여 Top 10", "USD천 · 발생기준", "rk")]
    cols = [col("nm", "기관명")] + [col(f"y{y}", f"{y}년", "usd", sum=1) for y in yl] + [col("nt", "비고")]
    blocks.append(drop_empty_cols({"t": "table", "id": "lp", "title": "기관별 수익 기여", "sub": "USD · 발생기준", "cols": cols, "rows": rows, "foot": foot,
                                   "sort": {"k": f"y{yl[-1]}", "d": -1}, "card": {"title": "nm", "amt": f"y{yl[-1]}", "meta": [f"y{yl[-2]}"] if len(yl) > 1 else []}}))
    return blocks


def v_gp(s, ctx):
    hs = []
    for c in range(1, 20):
        if (s.t(3, c) or s.t(2, c) or "") == "운용사": hs.append(c)
    h = [c for c in range(1, 20) if s.t(3, c) == "운용사"]
    if len(h) < 2: raise ValueError("운용사 머리글 2개 없음")
    hr = 3
    cc, ca = h[0], h[1]
    ys_c = [(s.t(hr, x)[:4], x) for x in range(cc + 1, cc + 6) if re.match(r"^\d{4}", s.t(hr, x) or "")]
    ys_a = [(s.t(hr, x)[:4], x) for x in range(ca + 1, ca + 6) if re.match(r"^\d{4}", s.t(hr, x) or "")]
    cash = {r["c"]["nm"]: r for r in year_table(s, hr, cc, ys_c)}
    accr = {r["c"]["nm"]: r for r in year_table(s, hr, ca, ys_a)}
    names = list(dict.fromkeys(list(cash) + list(accr)))
    rows = []
    for n in names:
        c_ = {"nm": n}
        for y, _ in ys_c:
            v = cash.get(n, {"c": {}})["c"].get(f"y{y}")
            if v: c_[f"c{y}"] = v
        for y, _ in ys_a:
            v = accr.get(n, {"c": {}})["c"].get(f"y{y}")
            if v: c_[f"a{y}"] = v
        rows.append({"c": c_})
    tr = next((x for x in range(1, 12) if s.t(x, cc) == "합계"), None)
    foot = [{"l": "합계", "c": ({f"c{y}": s.n(tr, x) for y, x in ys_c} | {f"a{y}": s.n(tr, ca + (x - cc)) for y, x in ys_c})}] if tr else []
    yl = [y for y, _ in ys_c]
    blocks = [{"t": "kpis", "id": "k", "items": [kpi(f"{y} Cash", (foot[0]["c"].get(f"c{y}") or 0) / 1e8 if foot else 0, "n2", "억원",
                                                   f"발생 USD {(foot[0]['c'].get(f'a{y}') or 0):,.2f}" if foot else None) for y in yl[-3:]]}]
    rc = [{"c": {"nm": r["c"]["nm"]} | {f"y{y}": r["c"].get(f"c{y}") for y in yl}} for r in rows]
    ra = [{"c": {"nm": r["c"]["nm"]} | {f"y{y}": r["c"].get(f"a{y}") for y in yl}} for r in rows]
    rk1 = ranking(rc, yl, "eok1", "Cash 수익 Top 10", "억원", "rc")
    for k in rk1["sets"]:
        for it in rk1["sets"][k]: it["v"] = it["v"] / 1e8
    rk2 = ranking(ra, yl, "usdk", "발생 수익 Top 10", "USD천", "ra")
    blocks.append({"t": "row", "blocks": [rk1, rk2]})
    cols = [col("nm", "운용사")] + [col(f"c{y}", f"{y} Cash(억원)", "wk", sum=1) for y in yl] + [col(f"a{y}", f"{y} 발생(USD)", "usd", sum=1) for y in yl]
    blocks.append({"t": "table", "id": "gp", "title": "운용사별 수익", "sub": "Cash = 현금기준(억원) · 발생 = 발생기준(USD)", "cols": cols, "rows": rows, "foot": foot,
                   "pick": {"l": "기준", "opts": ["Cash", "발생"], "def": "Cash", "cols": {"Cash": [f"c{y}" for y in yl], "발생": [f"a{y}" for y in yl]}, "only": True},
                   "sort": {"k": f"c{yl[-1]}", "d": -1}, "card": {"title": "nm", "amt": "@last", "meta": ["@prev"]}})
    return blocks


def v_asset(s, ctx):
    blocks = []
    tables = []
    for prefix, f, tid in (("자산군별 수익(Cash", "wk", "c"), ("자산군별 수익(발생", "usd", "a"), ("자산군별 약정금액", "n1", "m"), ("자산군별 PA계약", "n0", "p")):
        p = s.find(lambda x, pf=prefix: x.strip().startswith(pf), 1, 6)
        if not p: continue
        r, c = p
        hr = next(x for x in range(r + 1, r + 4) if s.t(x, c) == "구분")
        ys, x = [], c + 1
        while re.match(r"^\d{4}", s.t(hr, x) or ""):   # 붙어 있는 연도 열만(옆 표의 연도는 제외)
            ys.append((s.t(hr, x)[:4], x)); x += 1
        extra = [(s.t(hr, x), x)] if (s.t(hr, x) or "").startswith(("합계", "자산군별 합계")) else []
        rows, foot = [], []
        for rr in range(hr + 1, hr + 16):
            n = s.t(rr, c)
            if n is None or n == "검증": break
            vals = {"nm": n} | {f"y{y}": s.n(rr, x) for y, x in ys if s.n(rr, x) is not None} | {f"e{i}": s.n(rr, x) for i, (_, x) in enumerate(extra) if s.n(rr, x) is not None}
            if n.startswith(("합계", "연도별 합계", "1년 평균", "합계(원)")): foot.append({"l": n, "c": vals})
            else: rows.append({"c": vals})
        title = s.t(r, c).replace("\n", " ") + (" · 억원" if f == "wk" else "")
        cols = [col("nm", "구분")] + [col(f"y{y}", f"{y}년", f, sum=1 if tid != "m" else 0) for y, _ in ys] + [col(f"e{i}", t, f) for i, (t, _) in enumerate(extra)]
        tables.append({"t": "table", "id": tid, "title": title, "cols": cols, "rows": rows, "foot": foot, "compact": True, "_ys": [y for y, _ in ys]})
    cash = next((t for t in tables if t["id"] == "c"), None)
    if cash:
        ys = cash["_ys"]
        series = [{"n": r["c"]["nm"], "v": [(r["c"].get(f"y{y}") or 0) / 1e8 for y in ys]} for r in cash["rows"]]
        tot = [sum(x["v"][i] for x in series) for i in range(len(ys))]
        blocks.append({"t": "col", "id": "st", "title": "자산군별 수익 (Cash)", "sub": "억원 · 연도별 누적", "cats": ys, "series": series, "stack": True, "f": "eok1", "tot": tot})
    for t in tables: t.pop("_ys", None)
    blocks.append({"t": "row", "blocks": tables[:2]})
    blocks.append({"t": "row", "blocks": tables[2:]})
    p = s.find(lambda x: x.strip().startswith("2026 Cash 기준"), 10)
    if p:
        r, c = p
        rr = r + 1
        while s.v(rr, c) is not None: rr += 1
        b = generic_table(s, r, r + 1, rr - 1, c, c + 1, title=f"2026 Cash 기준 ({s.t(r, c + 1) or ''})".replace(" ()", ""), tid="c26")
        b["cols"][1]["f"] = "won"
        blocks.append(b)
    return blocks


# ── 해외대체 시딩 관리판 ────────────────────────────────────────────────────

def v_seed(s, ctx):
    h = s.find(lambda x: x.strip() == "No", 1, 10, 1, 4)
    if not h: raise ValueError("머리글 'No' 없음")
    hr, cB = h
    H = {}
    for c in range(cB, s.maxc + 1):
        t = (s.t(hr, c) or "").replace("\n", "")
        if t: H.setdefault(t, c)
    def hc(k):
        for t, c in H.items():
            if t.startswith(k): return c
        return None
    calls = [c for t, c in H.items() if re.match(r"^\d+차 캐피탈콜", t)]
    repays = [c for t, c in H.items() if re.match(r"^\d+차 원본상환", t)]
    dists = [c for t, c in H.items() if re.match(r"^\d+차 이익분배", t)]
    F = {k: hc(t) for k, t in [("fd", "재간접 펀드명"), ("ac", "자산군"), ("sr", "세부전략"), ("tg", "투자대상"), ("ob", "#5113"), ("dr", "누적인출금액"),
                               ("ap", "심사 승인금액"), ("ud", "미인출 금액"), ("bu", "소진율"), ("ct", "투자계약서상"), ("cd", "누적 이익분배"),
                               ("td", "총 분배금"), ("nav", "NAV"), ("irr", "XIRR"), ("mul", "Multiple"), ("moic", "MOIC"), ("dpi", "DPI"),
                               ("memo", "비고(펀드의 투자전략)"), ("aud", "감사부"), ("fss", "260423"), ("fxc", "환산통화"), ("cf", "약정금액(외화)"), ("ck", "약정금액(원화")]}
    starts = [r for r in s.rows(hr + 1) if isinstance(s.v(r, cB), int) and s.v(r, F["fd"]) is not None]
    rows = []
    for i, r in enumerate(starts):
        end = (starts[i + 1] - 1) if i + 1 < len(starts) else r + 4
        sub_rows = [x for x in range(r + 1, end + 1) if x <= s.maxr]
        date_row = next((x for x in sub_rows if any(isinstance(s.ws.cell(x, c).value, datetime.datetime) for c in calls[:3] + repays[:1] + dists[:1])), None)
        fx_row = next((x for x in sub_rows if x != date_row and any(s.n(x, c) is not None for c in calls[:3])), None)
        g = lambda k: s.v(r, F[k]) if F.get(k) else None
        c_ = {"no": s.v(r, cB), "fd": g("fd"), "ac": g("ac"), "sr": g("sr"), "tg": g("tg"), "dr": num(g("dr")), "ud": num(g("ud")), "bu": num(g("bu")),
              "cd": num(g("cd")), "td": num(g("td")), "nav": num(g("nav")), "irr": num(g("irr")), "moic": num(g("moic")), "dpi": num(g("dpi")),
              "mul": num(g("mul")), "ck": num(g("ck")), "cf": num(g("cf")), "fxc": g("fxc")}
        if F.get("ap"): c_["apc"], c_["ap"] = s.v(r, F["ap"]), s.n(r, F["ap"] + 1)
        if F.get("ct"): c_["ctc"], c_["ctv"] = s.v(r, F["ct"]), s.n(r, F["ct"] + 1)
        c_["cfx"] = f"{(c_.get('fxc') or '').strip()} {c_['cf']:,.0f}".strip() if c_.get("cf") else None
        # 외화로 관리하는 펀드(심사 승인 통화 USD·EUR): 시트의 인출·분배 금액이 외화 → 억원 열은 대시보드 환율로 환산, 외화 금액은 따로 보관
        cur = str(c_.get("apc") or "KRW").strip().upper()
        rate = (ctx.get("fx") or {}).get(cur) if cur != "KRW" else None
        # 시트 소진율(인출 ÷ 심사 승인금액)이 외화 금액끼리 맞아떨어질 때만 외화 펀드로 본다(원화로 적은 펀드는 그대로)
        if rate and not (c_.get("dr") and c_.get("ap") and c_.get("bu") is not None and abs(c_["dr"] / c_["ap"] - c_["bu"]) < 0.005): rate = None
        if rate:
            for k in ("dr", "td", "cd", "ud"):
                if c_.get(k) is not None: c_[k + "_fx"] = c_[k]; c_[k] = c_[k] * rate
            c_["drfx"] = f"{cur} {c_['dr_fx']:,.2f}" if c_.get("dr_fx") is not None else None
        if isinstance(c_.get("tg"), str): c_["tg1"] = c_["tg"].split("\n")[0]
        def series(cs, label):
            out = []
            for k, c in enumerate(cs, 1):
                a = s.n(r, c)
                if a is None: continue
                d = s.v(date_row, c) if date_row else None
                fxa = s.n(fx_row, c) if fx_row else None
                out.append({"k": f"{k}차", "d": d, "a": a, "fx": fxa})
            return out
        cl, rp, ds = series(calls, "캐피탈콜"), series(repays, "원본상환"), series(dists, "이익분배")
        c_["ncall"] = len(cl)
        c_["last"] = max([x["d"] for x in cl + rp + ds if isinstance(x.get("d"), str)] or [None]) if (cl or rp or ds) else None
        x = []
        fxlab = "외화" if fx_row else None
        for lab, arr in (("캐피탈콜", cl), ("원본상환", rp), ("이익분배", ds)):
            if not arr: continue
            if rate:
                cols = [col("k", "차수"), col("d", "일자", "date"), col("a", f"금액({cur})", "n2")]
                head = f"{lab} {len(arr)}회 · {cur} {sum(a['a'] for a in arr):,.2f}"
            else:
                cols = [col("k", "차수"), col("d", "일자", "date"), col("a", "금액(원)", "won")]
                head = f"{lab} {len(arr)}회 · {sum(a['a'] for a in arr):,.0f}원"
            if any(a.get("fx") for a in arr): cols.append(col("fx", "외화", "n2"))
            x.append({"h": head, "cols": cols, "rows": [{k: v for k, v in a.items() if v is not None} for a in arr]})
        memo = [t for t in (g("memo"), g("aud"), g("fss")) if t]
        if memo: x.append({"h": "메모", "text": "\n\n".join(str(t) for t in memo)})
        rows.append({"c": {k: v for k, v in c_.items() if v not in (None, "")}, "x": x})
    # 자산군 요약(아래쪽 '요약' 표) · 2026 누적수익
    blocks = []
    sm = s.find(lambda x: x.strip().startswith("요약"), starts[-1] if starts else 1)
    tot_ck = sum(r["c"].get("ck") or 0 for r in rows)
    ytd = s.find(lambda x: x.strip().startswith("2026년 누적수익"))
    kp = [kpi("시딩 펀드", len(rows), "n0", "개"), kpi("약정금액(원화 환산)", tot_ck / 1e8, "n1", "억원"),
          kpi("누적 인출", sum(r["c"].get("dr") or 0 for r in rows) / 1e8, "n1", "억원",
              f"소진율 {sum(r['c'].get('dr') or 0 for r in rows) / tot_ck:.1%}" if tot_ck else None),
          kpi("NAV 합계", sum(r["c"].get("nav") or 0 for r in rows) / 1e8, "n1", "억원"),
          kpi("누적 분배", sum(r["c"].get("td") or 0 for r in rows) / 1e8, "n1", "억원")]
    if ytd:
        r, c = ytd
        kp.append(kpi("2026년 누적수익", (s.n(r, c + 2) or 0) / 1e8, "n2", "억원", f"{s.v(r, c + 1)} 기준", tone="ok"))
    blocks.append({"t": "kpis", "id": "k", "items": kp})
    cols = [col("no", "No", "n0"), col("fd", "펀드명"), col("ac", "자산군", "tag"), col("sr", "세부전략", d=1), col("tg1", "투자대상"),
            col("ck", "약정(억원)", "wk", sum=1), col("cfx", "약정(외화)", d=1), col("dr", "누적 인출(억원)", "wk", sum=1), col("drfx", "누적 인출(외화)", d=1), col("bu", "소진율", "bar"),
            col("ncall", "콜 횟수", "n0", d=1), col("td", "총 분배(억원)", "wk", sum=1), col("nav", "NAV(억원)", "wk", sum=1), col("irr", "XIRR", "pct"),
            col("moic", "MOIC", "x2"), col("dpi", "DPI", "x2"), col("mul", "Multiple", "x2", d=1), col("last", "최근 거래일", "date", d=1),
            col("ud", "미인출(부외부채)", "n0", d=1)]
    blocks.append({"t": "table", "id": "sd", "title": "펀드별 현황", "sub": "눌러서 캐피탈콜·분배 내역 보기 · NAV·수익률은 엑셀 기준일 값", "cols": cols, "rows": rows,
                   "card": {"title": "fd", "sub": ["ac", "sr"], "amt": "nav", "bar": "bu", "stats": ["ck", "dr", "td", "irr", "moic", "dpi"]},
                   "filters": ["ac"]})
    if sm:
        r, c = sm
        hr2 = r + 1
        rr = hr2 + 1
        while s.v(rr, c) is not None: rr += 1
        b = generic_table(s, hr2, hr2 + 1, rr - 1, c, c + 2, title="자산군별 요약", tid="sm")
        for cd in b["cols"]:
            if "원" in cd["l"]: cd["f"] = "won"
        t = s.t(r, c)
        if t and "(" in t: b["sub"] = t[t.index("(") + 1:].rstrip(")")
        blocks.append(b)
    return blocks


# ── 등록 ────────────────────────────────────────────────────────────────────

# ── 약정 이력: 2010~2021 약정 · 약정 통계 · 기관별 약정 ─────────────────────────

ST_TONE = {"운용 중": "ok", "운용 중 추정": "info", "확인 필요": "warn", "청산 진행": "muted", "청산": "muted", "청산 추정": "muted", "양도": "muted"}
FS_TONE = {"O": "ok", "X": "warn", "확인 필요": "info", "O(잔고 0·청산)": "muted", "X(청산)": "muted", "X(청산 진행)": "muted",
           "X(양도)": "muted", "X(보고 생략)": "muted"}


def v_hist(s, ctx):
    """약정내역(2010~2021): 약정연도별 묶음 · 상태/금감원 보고 필터 · 펼치면 근거·보수 조건."""
    h = s.find(lambda x: x.strip() == "운용사(GP)", 1, 20, 1, 4)
    if not h: raise ValueError("머리글 '운용사(GP)' 없음")
    hr, cB = h
    H = {}
    for c in range(cB, min(s.maxc, cB + 40) + 1):
        for rr in (hr, hr + 1):
            t = (s.t(rr, c) or "").replace("\n", "")
            if t and t not in H and not t.startswith("참고"): H[t] = c
    def hc(k):
        return next((c for t, c in H.items() if t.startswith(k)), None)
    spec = [("ab", "펀드명 약칭", "펀드(약칭)", "text", 0), ("lp", "기관명", "기관명", "text", 0), ("gp", "운용사(GP)", "운용사", "text", 0),
            ("ac", "자산군", "자산군", "tag", 0), ("yr", "약정연도", "약정연도", "int", 0), ("cy", "약정통화", "통화", "tag", 1),
            ("am", "총약정금액", "총약정금액", "amt", 0), ("st", "펀드 상태", "펀드 상태", "tag", 0), ("fs", "금감원 보고", "금감원 보고", "tag", 0),
            ("fn", "펀드명/비상장", "펀드명(전체)", "text", 1), ("it", "투자유형", "투자유형", "text", 1), ("is", "투자전략", "투자전략", "text", 1),
            ("cd", "금융투자협회", "협회 코드", "text", 1), ("ym", "약정연월", "약정연월", "text", 1), ("q", "약정 시기", "약정 시기(원문)", "text", 1),
            ("vi", "국내재간접", "국내재간접 운용사", "text", 1), ("ow", "미배분 공동약정", "미배분 공동약정", "amt", 1),
            ("sb", "상태 근거", "상태 근거", "text", 1), ("so", "근거 출처", "근거 출처", "text", 1), ("on", "원문 기관명", "원문 기관명", "text", 1),
            ("vb", "금액 근거", "금액 근거", "text", 1), ("xc", "A·B 크로스체크", "A·B 크로스체크", "text", 1), ("fe", "보수 조건", "보수 조건", "text", 1),
            ("fr", "잔여 보수", "잔여 보수", "text", 1), ("tm", "펀드 기간", "펀드 기간", "text", 1), ("mm", "메모", "메모", "text", 1)]
    C = {k: hc(t) for k, t, *_ in spec}
    if not C["lp"] or not C["am"]: raise ValueError("기관명·총약정금액 열 없음")
    by = {}
    for r in s.rows(hr + 2):
        lp, gp = s.t(r, C["lp"]), s.t(r, C["gp"])
        if not lp and not gp: continue
        c_ = {k: s.v(r, cc) for k, cc in C.items() if cc and s.v(r, cc) is not None}
        if isinstance(c_.get("ym"), str) and re.match(r"^\d{4}-\d{2}-\d{2}", c_["ym"]): c_["ym"] = c_["ym"][:7]
        if not c_.get("ab") and c_.get("fn"): c_["ab"] = c_["fn"]
        y = c_.get("yr")
        by.setdefault(y, []).append({"c": c_})
    rows = [r for v in by.values() for r in v]
    secs = []
    for y in sorted(by, key=lambda x: -(x if isinstance(x, int) else 0)):
        rs = by[y]
        usd = sum(r["c"].get("am") or 0 for r in rs if r["c"].get("cy") == "USD")
        eur = sum(r["c"].get("am") or 0 for r in rs if r["c"].get("cy") == "EUR")
        sub = f"{len(rs)}건 · USD {usd / 1e6:,.2f}M" + (f" · EUR {eur / 1e6:,.2f}M" if eur else "")
        secs.append({"h": f"{y}년" if isinstance(y, int) else str(y or "연도 미기재"), "s": sub, "rows": rs})
    cnt = lambda k, pred: len([r for r in rows if pred(r["c"].get(k))])
    usd = sum(r["c"].get("am") or 0 for r in rows if r["c"].get("cy") == "USD")
    eur = sum(r["c"].get("am") or 0 for r in rows if r["c"].get("cy") == "EUR")
    nr = cnt("fs", lambda v: isinstance(v, str) and (v.startswith("X(") or v.startswith("O(")))
    blocks = [{"t": "kpis", "id": "k", "items": [
        kpi("약정 건수", len(rows), "n0", "건", f"{len({r['c'].get('ab') for r in rows})}개 펀드 · {len({r['c'].get('lp') for r in rows})}개 기관"),
        kpi("USD 약정", usd / 1e6, "n1", "USD M", f"EUR {eur / 1e6:,.2f}M 별도"),
        kpi("금감원 보고 중", cnt("fs", lambda v: v == "O"), "n0", "건", "보고 여부 O", tone="ok"),
        kpi("미보고", cnt("fs", lambda v: v == "X"), "n0", "건", "보고 여부 X", tone="warn"),
        kpi("보고 대상 아님", nr, "n0", "건", "청산·청산 진행·양도·보고 생략"),
    ]}]
    notes = [s.t(r, cB) for r in range(1, hr) if (s.t(r, cB) or "") and r > 3]
    if notes: blocks.append({"t": "notes", "items": notes})
    cols = []
    for k, _, l, f, d in spec:
        if not C.get(k): continue
        kw = {}
        if f == "amt": kw["ck"] = "cy"
        if k == "st": kw["tone"] = ST_TONE
        if k == "fs": kw["tone"] = FS_TONE
        if d: kw["d"] = 1
        cols.append(col(k, l, f, **kw))
    blocks.append(drop_empty_cols({"t": "table", "id": "hi", "title": "기관별 약정내역 (2010~2021)", "sub": "약정연도별 · 눌러서 상태 근거·보수 조건",
                                   "cols": cols, "secs": secs,
                                   "card": {"title": "ab", "sub": ["lp", "gp"], "amt": "am", "meta": ["yr"], "chips": ["st", "fs", "ac"]},
                                   "filters": ["st", "fs", "ac", "gp"]}))
    return blocks


def stat_table(s, h1, levels, r_end, title, tid, sub=None, c0=2, c1=None, fold=False):
    """약정 통계 절 표. 2단 머리글(시트별 묶음 + 약정 건수·USD 환산)은 '합계'만 기본 열, 시트별 값은 펼침.
    '#,##0.0,,' 형식(백만 단위 표시)은 값을 백만으로 나눠 USD M 으로."""
    c1 = c1 or min(s.maxc, 16)
    defs = []
    for c in range(c0, c1 + 1):
        if c in s.hc: continue
        g = s.mv(h1, c); t = s.v(h1 + 1, c) if levels == 2 else None
        g = str(g).replace("\n", " ").strip() if g is not None else ""
        t = str(t).replace("\n", " ").strip() if t is not None else ""
        if not g and not t: continue
        if levels == 2 and g and t and (h1 + 1, c) not in s.anchor:
            if g.startswith("2010~2021"): defs.append((c, f"2010~21 {t}", 1))
            elif g.startswith("2022~"): defs.append((c, f"2022~ {t}", 1))
            else: defs.append((c, t, 0))
        elif levels == 2 and g and t:
            defs.append((c, t if g.startswith("합계") else (g if g == t else t), 0))
        else:
            defs.append((c, g or t, 0))
    rows, foot, fmt = [], [], {}
    for r in range(h1 + levels, r_end + 1):
        if r in s.hr: continue
        vals = {}
        for i, (c, lab, d) in enumerate(defs):
            x = s.v(r, c)
            if x is None: continue
            nf = s.ws.cell(r, c).number_format or ""
            if i == 0: x = str(x)
            elif isinstance(x, (int, float)) and not isinstance(x, bool):
                if ",," in nf: x = x / 1e6; fmt.setdefault(c, "n1")
                elif "%" in nf: fmt.setdefault(c, "pct")
                else: fmt.setdefault(c, nf2f(nf, x) or "n0")
            vals[CL(c)] = x
        if not vals:
            if rows or foot: break
            continue
        first = str(vals.get(CL(defs[0][0]), ""))
        (foot if first.startswith(("합계", "총계")) else rows).append({"c": vals})
    cols = []
    for i, (c, lab, d) in enumerate(defs):
        f = fmt.get(c, "text")
        nums = [r["c"][CL(c)] for r in rows + foot if isinstance(r["c"].get(CL(c)), (int, float))]
        if i and nums and all(float(v).is_integer() and 1990 <= v <= 2100 for v in nums) and f in ("n0", "text"): f = "int"
        cd = col(CL(c), lab, f)
        if d: cd["d"] = 1
        cols.append(cd)
    b = {"t": "table", "id": tid, "title": title, "cols": cols, "rows": rows}
    if foot: b["foot"] = foot
    if sub: b["sub"] = sub
    if fold: b["fold"] = True
    if len(rows) <= 12 and len([c for c in cols if not c.get("d")]) <= 9: b["compact"] = True
    return drop_empty_cols(b)


def v_stats(s, ctx):
    """약정 통계(2010~현재): 요약 카드 → 연도별 차트 → 기관·운용사 순위 → 절별 표."""
    heads = [(r, s.t(r, 2)) for r in range(1, s.maxr + 1) if re.match(r"^\d+\. ", s.t(r, 2) or "")]
    if len(heads) < 5: raise ValueError("번호 붙은 절(1. 2. …) 없음")
    def sec(n):
        for i, (r, t) in enumerate(heads):
            if t.startswith(f"{n}. "):
                end = heads[i + 1][0] - 1 if i + 1 < len(heads) else s.maxr
                return r, t, end
        return None
    def hdr_row(r0, end, first):
        return next((r for r in range(r0 + 1, end + 1) if (s.t(r, 2) or "").replace("\n", " ").strip() == first), None)
    def note(r0): return s.t(r0 + 1, 2)
    blocks = []
    intro = s.t(3, 2)
    rate = s.n(4, 3)
    # 1. 요약
    r0, t1, e1 = sec(1)
    h = hdr_row(r0, e1, "구분")
    t = stat_table(s, h, 1, e1, t1[3:], "s1", note(r0))
    tot = (t.get("foot") or [{}])[0].get("c", {})
    parts = {r["c"].get("B"): r["c"] for r in t["rows"]}
    a, b_ = parts.get("2010~2021 시트", {}), parts.get("2022~현재 시트", {})
    if tot:
        blocks.append({"t": "kpis", "id": "k", "items": [
            kpi("약정 건수", tot.get("C"), "n0", "건", f"2010~21 {a.get('C', 0):,.0f} · 2022~ {b_.get('C', 0):,.0f}"),
            kpi("총 약정 (USD 환산)", tot.get("I"), "n1", "USD M", f"운용 중 USD {tot.get('J') or 0:,.2f}M"),
            kpi("펀드 · 기관", tot.get("D"), "n0", "개 펀드", f"기관 {tot.get('E') or 0:,.0f}곳"),
            kpi("금감원 보고 중", tot.get("K"), "n0", "건", "보고 여부 O", tone="ok"),
            kpi("미보고", tot.get("L"), "n0", "건", "청산·양도·보고 생략 제외", tone="warn"),
        ]})
    nt = [x for x in [intro, f"EUR→USD 환산율 {rate:.4f} (약정내역(2022~현재) 시트 환율)" if rate else None] if x]
    if nt: blocks.append({"t": "notes", "items": nt})
    # 2. 연도별 차트
    x2 = sec(2)
    if x2:
        r0, tt, e = x2
        h = hdr_row(r0, e, "약정연도")
        t2 = stat_table(s, h, 2, e, tt[3:], "s2", note(r0))
        yr = [r for r in t2["rows"] if re.match(r"^\d{4}$", r["c"].get("B", ""))]
        if yr:
            blocks.append({"t": "col", "id": "yc", "title": "연도별 약정", "sub": "USD M · 2010~2021 시트 + 2022~현재 시트", "cats": [r["c"]["B"] for r in yr],
                           "series": [{"n": "2010~2021", "v": [r["c"].get("D") or 0 for r in yr]}, {"n": "2022~현재", "v": [r["c"].get("F") or 0 for r in yr]}],
                           "stack": True, "f": "n1", "tot": [r["c"].get("H") or 0 for r in yr], "wide": True})
        t2["sub"] = (t2.get("sub") or "") and "USD M · " + t2["sub"]
        t2["fold"] = True
        later = [t2]
    else:
        later = []
    # 5·6. 기관별·운용사별 순위 + 표
    tabs = []
    for n, first, tid, lab in ((5, "기관명", "s5", "기관"), (6, "운용사(GP)", "s6", "운용사")):
        x = sec(n)
        if not x: continue
        r0, tt, e = x
        h = hdr_row(r0, e, first)
        tb = stat_table(s, h, 2, e, tt[3:], tid, "USD M · " + (note(r0) or ""))
        it = sorted([{"l": r["c"].get("B"), "v": r["c"].get("H") or 0} for r in tb["rows"]], key=lambda z: -z["v"])
        tb.update({"sort": {"k": "H", "d": -1}, "card": {"title": "B", "amt": "H", "meta": ["G", "I"]}})
        tb.pop("compact", None)
        tabs.append((lab, {"t": "bars", "id": f"r{n}", "title": f"{lab}별 약정 Top 15", "sub": "USD M · 2010~현재 (USD 환산)", "f": "n1",
                           "sets": {"전체": [z for z in it if z["v"] > 0][:15]}, "def": "전체", "rank": True}, tb))
    if tabs:
        blocks.append({"t": "row", "blocks": [x[1] for x in tabs]})
    # 3·7·8 작은 표
    small = []
    for n, first, tid in ((3, "자산군", "s3"), (7, "펀드 상태", "s7"), (8, "금감원 보고 여부", "s8")):
        x = sec(n)
        if not x: continue
        r0, tt, e = x
        h = hdr_row(r0, e, first)
        if h: small.append(stat_table(s, h, 2, e, tt[3:], tid, "USD M · " + (note(r0) or "")))
    for i in range(0, len(small), 2):
        blocks.append({"t": "row", "blocks": small[i:i + 2]} if len(small[i:i + 2]) > 1 else small[i])
    blocks += [x[2] for x in tabs]
    blocks += later
    # 4. 자산군 × 투자전략
    x = sec(4)
    if x:
        r0, tt, e = x
        h = hdr_row(r0, e, "자산군")
        if h: blocks.append(stat_table(s, h, 2, e, tt[3:], "s4", "USD M · " + (note(r0) or ""), fold=True))
    # 9~12: 목록·확인 사항(펼쳐서 보기)
    for n, first in ((9, "펀드명"), (10, "원문 표기(A·B)"), (11, "펀드명"), (12, "구분")):
        x = sec(n)
        if not x: continue
        r0, tt, e = x
        h = hdr_row(r0, e, first)
        if not h: continue
        rr = h + 1
        while rr <= e and not s.empty(rr, 2, 14): rr += 1
        b = generic_table(s, h, h + 1, rr - 1, 2, 14, title=tt[tt.index(" ") + 1:], tid=f"s{n}", sub=note(r0), fold=n != 12)
        blocks.append(drop_empty_cols(b))
    return blocks


def v_orgs(s, ctx):
    """기관별 약정(2010~현재): 기관마다 묶음(회색 요약 행 = 묶음 머리) · 기관 순위."""
    h = s.find(lambda x: x.strip() == "기관명", 1, 15, 1, 4)
    if not h: raise ValueError("머리글 '기관명' 없음")
    hr, cB = h
    H = {(s.t(hr, c) or "").replace("\n", ""): c for c in range(1, min(s.maxc, 20) + 1) if s.t(hr, c)}
    def hc(k): return next((c for t, c in H.items() if t.startswith(k)), None)
    C = {"no": hc("No"), "nm": hc("기관명"), "yr": hc("약정연도"), "gp": hc("운용사"), "fn": hc("펀드명/"), "ab": hc("펀드명 약칭"), "ac": hc("자산군"),
         "is": hc("투자전략"), "cy": hc("약정통화"), "am": hc("총약정금액"), "us": hc("USD기준"), "st": hc("펀드 상태"), "fs": hc("금감원 보고"), "nt": hc("비고")}
    if not C["nm"] or not C["us"]: raise ValueError("기관명·USD기준 환산 열 없음")
    secs, foot, cur = [], [], None
    for r in s.rows(hr + 1):
        nm = s.t(r, C["nm"])
        if nm is None: continue
        no = s.v(r, C["no"]) if C["no"] else None
        if nm.startswith(("합계", "미배분", "총계", "약정 통계")):
            foot.append({"l": nm, "c": {"us": s.n(r, C["us"])}})
            continue
        if no is not None:
            cur = {"h": f"{no}. {nm}", "nm": nm, "us": s.n(r, C["us"]) or 0, "rows": [],
                   "s": " · ".join(x for x in [s.t(r, C["yr"]), f"USD {(s.n(r, C['us']) or 0) / 1e6:,.2f}M", s.t(r, C["nt"])] if x)}
            secs.append(cur)
            continue
        if cur is None: continue
        c_ = {k: s.v(r, cc) for k, cc in C.items() if cc and k != "no" and s.v(r, cc) is not None}
        if c_.get("nm") == cur["nm"]: c_.pop("nm")
        if c_.get("yr") is not None: c_["yr"] = str(c_["yr"])
        cur["rows"].append({"c": c_})
    if not secs: raise ValueError("기관 묶음 없음")
    n_rows = sum(len(x["rows"]) for x in secs)
    tot = next((f["c"]["us"] for f in foot if f["l"].startswith("총계")), None)
    diff = next((f["c"]["us"] for f in foot if f["l"].startswith("약정 통계")), None)
    blocks = [{"t": "kpis", "id": "k", "items": [x for x in [
        kpi("기관 수", len(secs), "n0", "곳", "기관명 통일 기준"),
        kpi("약정 건수", n_rows, "n0", "건", "약정 1건 1행"),
        kpi("총계 (USD 환산)", (tot or 0) / 1e6, "n1", "USD M", "미배분 공동약정 포함") if tot is not None else None,
        kpi("약정 통계와 차이", diff or 0, "n0", "USD", "0이면 일치", tone="ok" if not diff else "bad") if diff is not None else None,
    ] if x]}]
    nts = [s.t(r, cB) for r in range(2, hr) if s.t(r, cB) and r > 2]
    if nts: blocks.append({"t": "notes", "items": nts})
    it = sorted([{"l": x["nm"], "v": x["us"] / 1e6} for x in secs], key=lambda z: -z["v"])
    blocks.append({"t": "bars", "id": "rk", "title": "기관별 약정 Top 15", "sub": "USD M · 2010~현재", "f": "n1", "sets": {"전체": it[:15]}, "def": "전체", "rank": True})
    cols = [col("ab", "펀드(약칭)"), col("nm", "기관(표기)"), col("yr", "약정연도"), col("gp", "운용사"), col("ac", "자산군", "tag"),
            col("cy", "통화", "tag", d=1), col("am", "총약정금액", "amt", ck="cy"), col("us", "USD 환산", "usd", sum=1),
            col("st", "펀드 상태", "tag", tone=ST_TONE), col("fs", "금감원 보고", "tag", tone=FS_TONE),
            col("fn", "펀드명(전체)", d=1), col("is", "투자전략", d=1), col("nt", "비고", d=1)]
    for x in secs:
        x.pop("nm"); x.pop("us")
    blocks.append(drop_empty_cols({"t": "table", "id": "og", "title": "기관별 약정 목록", "sub": "기관마다 묶음 · 약정연도 순", "cols": cols, "secs": secs,
                                   "foot": [f for f in foot if f["c"].get("us") is not None and not f["l"].startswith("약정 통계")],
                                   "card": {"title": "ab", "sub": ["gp", "nm"], "amt": "us", "meta": ["yr"], "chips": ["st", "fs", "ac"]},
                                   "filters": ["st", "fs", "ac"], "keep": ["us"]}))
    return blocks


# ── 이력(숨긴 시트 → 앱 '정리 화면'만) ─────────────────────────────────────────
# 사용자 요청(2026-11-12): 엑셀에서 숨긴 지난 연도 시트(현금 수취 2018~2025, 계약서 2023~2025)도 앱에서 볼 수 있게 정리.
# 연도마다 시트 하나씩이 아니라 '수익 이력' · 'PA 계약 이력' 쪽 하나씩으로 묶는다(원본 격자 없음 — 엑셀에서 보기).
# 시트마다 머리글이 다르다(2018~19: 펀드명·부서·금액 / 2020~21: 금액 + 부서명으로 당부서·RM 구분 /
# 2022~: 당부서 칸·RM 부서 칸에 나눠 적음). 머리글 이름으로 칸을 찾고, 비어 있는 일자·펀드명은 바로 위 줄을 이어받는다.
CASH_YEAR = re.compile(r"^(20\d\d)$")
OWN_DEPT = re.compile(r"해외금상|국제금상|해외금융상품|국제금융상품|Global|글로벌")


def _hdr(ws):
    return {str(ws.cell(1, c).value).strip(): c for c in range(1, ws.max_column + 1) if ws.cell(1, c).value is not None}


def _pick(H, *names, rx=None, not_rx=None):
    for n in names:
        if n in H: return H[n]
    if rx:
        for k, c in H.items():
            if re.search(rx, k) and not (not_rx and re.search(not_rx, k)): return c
    return None


def _ymd(v):
    if isinstance(v, (int, float)) and 19000101 <= v <= 21001231:
        v = int(v); return f"{v // 10000:04d}-{v // 100 % 100:02d}-{v % 100:02d}"
    if isinstance(v, str):
        m = re.search(r"(20\d\d)[.\-/]?(\d\d)[.\-/]?(\d\d)", v)
        if m: return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
        return None
    v = clean(v)
    return v if isinstance(v, str) and re.match(r"\d{4}-\d\d-\d\d", v) else None


def _fee_kind(t):
    t = t or ""
    if "판매" in t: return "판매"
    if "관리" in t: return "관리"
    return "그 외" if t else None


# 수익 이력 '많이 받은 곳'용 운용사 묶음(사용자 요청 2026-11-12: 같은 운용사가 펀드명별로 쪼개지면 안 됨).
# 2022년까지 시트엔 운용사 칸이 없어 펀드명·송금인 표기로 운용사를 찾는다. 위에서부터 처음 맞는 규칙.
GP_RULES = [
    (r"BIDF|BREF|BSREF|BSREP|BPREP|BGTF|BIF\s*III|BCP\s*V\b|Brookfield|BROOKFIELD", "Brookfield"),
    (r"PCS|Permira|PERMIRA", "Permira"),
    (r"EICF|EIVF|Exeter|Exter", "EQT Exeter"),
    (r"EQT", "EQT"),
    (r"AREOF|EPEP|^ARES|^Ares", "Ares"),
    (r"Landmark|LANDMARK|LREP", "Landmark"),
    (r"^GIP", "GIP"),
    (r"Barings?\b|BARINGS|Baring", "Barings"),
    (r"BSP", "BSP"),
    (r"BDS|Bridge|BRIDGE", "Bridge"),
    (r"USAA", "USAA"),
    (r"Goldman|GOLDMAN|Vintage|REIP|WSSS|GSAM|GS credit|Peters\s*Hill", "Goldman Sachs"),
    (r"Greystar|GREYSTAR", "Greystar"),
    (r"Golden\s*Tree|GOLDEN TREE|Distressed Fund III", "Golden Tree"),
    (r"[Cc]ar[Vv]al|CARVAL", "CarVal"),
    (r"Coller|COLLER", "Coller"),
    (r"Carlyle|CARLYLE|CP\s*VIII|CAP\s*V\b|CAPG|CEMOF|CICF", "Carlyle"),
    (r"COF\s*IV|Blackstone|BLACKSTONE", "Blackstone"),
    (r"Pomona|POMONA", "Pomona"),
    (r"Pantheon|PANTHEON", "Pantheon"),
    (r"Capital Dynamics", "Capital Dynamics"),
    (r"SCP\s*III|[Ss]tep[Ss]tone|STEPSTONE", "StepStone"),
    (r"Oaktree|OAKTREE", "Oaktree"),
    (r"Canyon|CANYON", "Canyon"),
    (r"홍콩|KB\s*Hong\s*Kong|KB HongKong", "KB홍콩법인"),
    (r"^SLA|Silver\s*lake|Silverlake", "Silverlake"),
    (r"Leucadia|LEUCADIA", "Leucadia"),
    (r"Genstar", "Genstar"),
    (r"Brightwood", "Brightwood"),
    (r"Centerbridge|^Center$", "Centerbridge"),
    (r"Madison|MADISON|MDCP", "Madison Dearborn"),
    (r"PCCP|CORE-PLUS|Core-Plus", "PCCP"),
    (r"Siris|SIRIS", "Siris"),
    (r"Green\s*[Oo]ak|GREENOAK", "GreenOak"),
    (r"COPA|Platon", "Campbell Lutyens(Project)"),
    (r"Hancock", "John Hancock"),
    (r"Northgate", "Northgate"),
    (r"ARCLIGHT|ArcLight", "ArcLight"),
    (r"JP Morgan|^jp$", "JP Morgan"),
    (r"^APAX$|^Apax$", "Apax"),
    (r"^Cip$|^CIP$", "CIP"),
    (r"^Pimco$|^PIMCO$", "PIMCO"),
    (r"^TDAM$|^TD$", "TD"),
    (r"^Blackrock$", "BlackRock"),
]


def gp_name(x):
    for src in (x.get("gp"), x.get("fd")):
        if not src: continue
        t = str(src).strip()
        for rx, name in GP_RULES:
            if re.search(rx, t): return name
        if x.get("gp"): return t
    return str(x.get("fd") or "-").strip()


def cash_history_rows(wb):
    """연도 시트(2018, 2019 …) → {연도: {rows, tot, own, oth, chk}}. chk = 시트에 적힌 합계와 대조 결과."""
    out, warn = {}, []
    for name in wb.sheetnames:
        m = CASH_YEAR.match(name)
        if not m: continue
        y = int(m.group(1)); ws = wb[name]; H = _hdr(ws)
        cD = _pick(H, "입금결의일", "입금 일자", "날짜") or 1
        cR = H.get("수익인식일")
        cG = H.get("운용사명"); cF = H.get("펀드명"); cT = H.get("보수 유형"); cP = H.get("부서")
        cI = H.get("기관"); cM = _pick(H, "RM", "RM (Multi상품솔루션부)", "영업직원"); cN = H.get("비고")
        cA = H.get("금액")                                                     # 2018~2021: 줄마다 금액 + 부서명
        cO = _pick(H, rx=r"^(Global|글로벌).*(수익|부)$", not_rx=r"총액") if not cA else None   # 2022~: 당부서 칸
        cX = _pick(H, rx=r"^(Multi.*수익|금융상품영업부)$", not_rx=r"총액") if not cA else None   # RM 부서 칸
        if not cF or not (cA or cO):
            warn.append(f"{name}: 머리글(펀드명·금액) 못 찾음"); continue
        split = y >= 2020
        rows, prev = [], {}
        lab_own = lab_oth = 0.0; has_lab = False; ytot = None
        sub_own = sub_oth = 0.0; has_sub = False
        c_sub_o = _pick(H, rx=r"^(해외금융상품부|국제금융상품영업부) 수익$") if cA else None
        c_sub_x = _pick(H, rx=r"^(기관영업본부|액티브영업본부) 수익$") if cA else None
        for r in range(2, ws.max_row + 1):
            a = ws.cell(r, 1).value
            at = str(a or "").strip()
            if re.match(r"^\d{1,2}월 부서별 수익", at):
                has_lab = True
                lab_own += num(ws.cell(r, cO).value) or 0 if cO else 0
                lab_oth += num(ws.cell(r, cX).value) or 0 if cX else 0
                continue
            if "연간 총 합계" in at:
                ytot = (num(ws.cell(r, cO).value) or 0) + (num(ws.cell(r, cX).value) or 0) if cO else None
                break
            labs = [str(ws.cell(r, c).value or "").strip() for c in range(1, 9)]
            if "총계" in labs:                                                 # 2019: 맨 아래 총계(총액 칸)
                g = _pick(H, "총액")
                if g: ytot = num(ws.cell(r, g).value)
                break
            if any(re.fullmatch(r"연?\s*합\s*계", x) for x in labs):            # 2022 '연 합계'(일부 달만 더한 수식) — 대조에 안 씀
                continue
            if c_sub_o:
                for cc, acc in ((c_sub_o, "o"), (c_sub_x, "x")):
                    v = num(ws.cell(r, cc).value) if cc else None
                    if v is not None:
                        has_sub = True
                        if acc == "o": sub_own += v
                        else: sub_oth += v
            if cA:
                k = num(ws.cell(r, cA).value); own = oth = None
            else:
                own = num(ws.cell(r, cO).value); oth = num(ws.cell(r, cX).value) if cX else None
                k = (own or 0) + (oth or 0) if (own is not None or oth is not None) else None
            def g(c, key, inherit=True):
                v = clean(ws.cell(r, c).value) if c else None
                if isinstance(v, str): v = re.sub(r"\s+", " ", v)
                if v is None and inherit: v = prev.get(key)
                return v
            dval = ws.cell(r, cD).value
            d = _ymd(dval)
            if k is None or k == 0:
                if d or clean(ws.cell(r, cF).value): prev.update({k2: v2 for k2, v2 in (("d", d), ("fd", g(cF, "fd", False))) if v2})
                continue
            row = {"y": str(y)}
            if cR:                                                             # 2025~: 수익인식일 기준, 입금결의일 없으면 미수금
                row["d"] = _ymd(ws.cell(r, cR).value) or prev.get("d")
                row["dp_"] = d
                if d is None: row["st"] = "미수금"
            else:
                row["d"] = d or prev.get("d")
            row["gp"] = g(cG, "gp") if cG else None
            row["fd"] = g(cF, "fd")
            row["ty"] = g(cT, "ty") if cT else None
            dept = g(cP, "dp") if cP else None
            if not isinstance(dept, str): dept = None                        # 부서 칸에 숫자가 잘못 들어간 줄
            row["dp"] = dept
            if split:
                if cA: row["sd"] = "글로벌상품영업부" if OWN_DEPT.search(str(dept or "")) else "RM 부서 배분"
                else: row["sd"] = "글로벌상품영업부" if own and not oth else ("RM 부서 배분" if oth and not own else "글로벌상품영업부 + RM")
            else:
                row["sd"] = "부서 구분 전"
            row["i"] = g(cI, "i", False) if cI else None
            row["rm"] = g(cM, "rm", False) if cM else None
            row["n"] = g(cN, "n", False) if cN else None
            row["k"] = k
            if row["ty"] and "환차" in str(row["ty"]): row["st"] = "환차손익"
            row["fk"] = "환차손익" if row.get("st") == "환차손익" else _fee_kind(row["ty"])
            if not cA:
                row["ko"], row["kx"] = own, oth
            prev.update({kk: row[kk] for kk in ("d", "gp", "fd", "ty", "dp") if row.get(kk) is not None})
            rows.append({k2: v2 for k2, v2 in row.items() if v2 is not None})
        tot = sum(x["k"] for x in rows)
        if cA:
            own_s = sum(x["k"] for x in rows if x["sd"] == "글로벌상품영업부"); oth_s = tot - own_s
        else:
            own_s = sum(x.get("ko") or 0 for x in rows); oth_s = sum(x.get("kx") or 0 for x in rows)
        chk = []
        if ytot is not None: chk.append(("연간 총 합계" if cO else "총계", ytot, tot))
        if has_lab: chk.append(("월별 부서별 수익 합", lab_own + lab_oth, tot))
        if has_sub: chk.append(("월별 부서 수익 칸 합", sub_own + sub_oth, tot))
        for lab, a_, b_ in chk:                                                # 원 단위 반올림 차이(2021 1원)는 넘어간다
            if abs(a_ - b_) > 5: warn.append(f"{name}: {lab} {a_:,.0f} ≠ 줄 합계 {b_:,.0f} (차이 {b_ - a_:,.0f})")
        out[y] = {"rows": rows, "tot": tot, "own": own_s, "oth": oth_s, "split": split,
                  "chk": [(lab, round(a_), round(b_)) for lab, a_, b_ in chk],
                  "dept": list(dict.fromkeys(x["dp"] for x in rows if isinstance(x.get("dp"), str) and x["sd"] == "글로벌상품영업부"))}
    return out, warn


def v_cash_history(wb, ctx):
    data, warn = cash_history_rows(wb)
    if not data: raise ValueError("연도 시트(2018 …) 없음")
    ys = sorted(data)
    tot = sum(data[y]["tot"] for y in ys)
    best = max(ys, key=lambda y: data[y]["tot"])
    last = ys[-1]
    blocks = [{"t": "kpis", "id": "k", "items": [
        kpi(f"{ys[0]}~{last} 누적 수익", tot / 1e8, "n1", "억원", f"{sum(len(data[y]['rows']) for y in ys):,}건 · 부서 배분 전 합계"),
        kpi("연평균", tot / len(ys) / 1e8, "n1", "억원", f"{len(ys)}개 연도"),
        kpi("가장 많이 받은 해", data[best]["tot"] / 1e8, "n1", "억원", f"{best}년"),
        kpi(f"{last} 수익", data[last]["tot"] / 1e8, "n1", "억원", f"글로벌상품영업부 {data[last]['own'] / 1e8:,.2f}억 · RM 배분 {data[last]['oth'] / 1e8:,.2f}억"),
    ]}]
    # 2026(진행 중): '2026 현금기준 수익' 시트의 월별 부서별 수익
    cur = None
    if "2026 현금기준 수익" in wb.sheetnames:
        c = wb["2026 현금기준 수익"]; H = _hdr(c)
        kO, kX = H.get("글로벌상품영업부"), H.get("금융상품영업부")
        o = x = 0.0; last_m = None
        for r in range(2, c.max_row + 1):
            mm = re.match(r"^(\d{1,2})월 부서별 수익", str(c.cell(r, 1).value or ""))
            if mm and kO:
                vo, vx = num(c.cell(r, kO).value) or 0, (num(c.cell(r, kX).value) or 0) if kX else 0
                o += vo; x += vx
                if vo or vx: last_m = int(mm.group(1))
        if o or x: cur = {"y": "2026", "own": o, "oth": x, "m": last_m}
    cats = [str(y) for y in ys] + (["2026"] if cur else [])
    s_own = [data[y]["own"] / 1e8 if data[y]["split"] else 0 for y in ys] + ([cur["own"] / 1e8] if cur else [])
    s_oth = [data[y]["oth"] / 1e8 if data[y]["split"] else 0 for y in ys] + ([cur["oth"] / 1e8] if cur else [])
    s_pre = [0 if data[y]["split"] else data[y]["tot"] / 1e8 for y in ys] + ([0] if cur else [])
    series = [{"n": "글로벌상품영업부", "v": s_own}, {"n": "RM 부서 배분", "v": s_oth}]
    if any(s_pre): series.insert(0, {"n": "부서 구분 전", "v": s_pre})
    blocks.append({"t": "col", "id": "yr", "title": "연도별 수익 (현금기준)", "sub": "억원 · 부서 배분 전 합계" + (f" · 2026은 1~{cur['m']}월" if cur and cur["m"] else ""),
                   "cats": cats, "series": series, "stack": True, "f": "eok1"})
    # 연도별 요약 표
    yrows = []
    for y in reversed(ys):
        d = data[y]; rs = d["rows"]
        fk = {}
        for x in rs:
            kd = _fee_kind(x.get("ty"))
            if kd: fk[kd] = fk.get(kd, 0) + x["k"]
        top = {}
        for x in rs:
            nm = gp_name(x)
            top[nm] = top.get(nm, 0) + x["k"]
        t3 = " · ".join(n for n, _ in sorted(top.items(), key=lambda z: -z[1])[:3])
        yrows.append({"c": {k2: v2 for k2, v2 in {
            "y": str(y), "t": d["tot"], "o": d["own"] if d["split"] else None, "x": d["oth"] if d["split"] else None,
            "pa": fk.get("판매"), "mg": fk.get("관리"), "et": fk.get("그 외"), "n": len(rs),
            "dn": " → ".join(d["dept"]) if d["split"] else "1부·2부 등 (영업부서별 배분)", "tp": t3}.items() if v2 is not None}})
    if cur:
        yrows.insert(0, {"c": {"y": f"2026 (~{cur['m']}월)", "t": cur["own"] + cur["oth"], "o": cur["own"], "x": cur["oth"],
                               "dn": "글로벌상품영업부 · '수익 (현금기준)' 쪽"}, "st": "now"})
    blocks.append({"t": "table", "id": "ys", "title": "연도별 요약", "sub": "단위 원 · 판매·관리는 보수 유형이 적힌 해(2021~)만", "compact": True,
                   "cols": [col("y", "연도"), col("t", "수익 합계", "won"), col("o", "글로벌상품영업부", "won"), col("x", "RM 부서 배분", "won"),
                            col("pa", "판매", "won"), col("mg", "관리", "won"), col("et", "그 외", "won"), col("n", "건수", "n0"),
                            col("tp", "많이 받은 곳 (상위 3)", d=1), col("dn", "당시 부서명", d=1)],
                   "rows": yrows})
    # 많이 받은 곳(연도별 상위 10)
    allt = {}
    for y in ys:
        for x in data[y]["rows"]:
            nm = gp_name(x)
            allt[nm] = allt.get(nm, 0) + x["k"]
    sets = {"전체": [{"l": n, "v": v / 1e8} for n, v in sorted(allt.items(), key=lambda z: -z[1]) if v > 0][:10]}   # '전체'(누적)가 맨 앞·기본값
    for y in reversed(ys):                                                     # 그 뒤로 최근 연도부터
        top = {}
        for x in data[y]["rows"]:
            nm = gp_name(x)
            top[nm] = top.get(nm, 0) + x["k"]
        sets[f"{y}년"] = [{"l": n, "v": v / 1e8} for n, v in sorted(top.items(), key=lambda z: -z[1]) if v > 0][:10]   # '2025' 같은 숫자 키는 JS가 오름차순으로 돌려서 '년'을 붙인다
    blocks.append({"t": "bars", "id": "top", "title": "많이 받은 곳 (상위 10)", "sub": f"억원 · 운용사 기준(2022년까지는 펀드명으로 운용사를 찾아 묶음) · 전체 = {ys[0]}~{last} 누적",
                   "f": "eok1", "sets": sets, "def": "전체", "rank": True})
    # 입금 내역(연도별 묶음, 최근 연도 먼저)
    secs = []
    for y in reversed(ys):
        d = data[y]
        rs = [{"c": dict(x)} for x in d["rows"]]
        secs.append({"h": f"{y}년", "s": f"{len(rs)}건 · {d['tot'] / 1e8:,.2f}억원", "rows": rs,
                     "foot": [{"l": f"{y}년 합계", "c": {"k": d["tot"]}}]})
    cols = [col("d", "일자", "date"), col("gp", "운용사"), col("fd", "펀드"), col("ty", "보수 유형", "tag"),
            col("sd", "구분", "tag", tone={"글로벌상품영업부": "ok", "RM 부서 배분": "info", "부서 구분 전": "muted"}),
            col("k", "금액(원)", "won", sum=1), col("i", "기관"), col("rm", "RM·영업직원"), col("dp", "부서(당시)", d=1),
            col("st", "상태", "tag", tone={"미수금": "warn", "환차손익": "info"}, d=1), col("fk", "보수 구분", d=1), col("dp_", "입금결의일", "date", d=1),
            col("ko", "글로벌상품영업부 몫", "won", d=1), col("kx", "RM 부서 몫", "won", d=1), col("y", "연도", d=1), col("n", "비고", d=1)]
    blocks.append(drop_empty_cols({"t": "table", "id": "hist", "title": "입금 내역", "sub": "연도별 묶음 · 최근 연도 먼저 · 단위 원 · 눌러서 부서·비고 보기",
                                   "cols": cols, "secs": secs,
                                   "card": {"title": "fd", "sub": ["gp", "i"], "amt": "k", "meta": ["d"], "chips": ["ty", "sd"]},
                                   "filters": ["y", "fk", "sd"], "keep": ["k"]}))
    nt = ["금액은 부서 배분 전 합계(글로벌상품영업부 몫 + RM 부서 배분). 2018~2019 시트는 영업부서(1부·2부 등)별로만 나뉘어 있어 부서 구분 없이 합계만 보입니다.",
          "부서명 변천: 해외금융상품부(2020) → 국제금융상품영업부(2021) → Global솔루션영업부(2022~23) → 글로벌투자솔루션부(2024) → 글로벌상품영업부(2025~)."]
    if warn: nt += ["시트 합계와 다른 곳: " + " / ".join(warn)]
    blocks.append({"t": "notes", "id": "nt", "items": nt})
    return blocks


CONTRACT_YEAR = re.compile(r"^(20\d\d) 계약서$")


def _ct_group(t, pa=None):
    """pa: 엑셀 자동 필터(계약 종류)로 보이는 줄이면 True — 그 시트는 필터가 '판매·PA 계약' 기준(사용자 분류)."""
    t = (t or "").lower()
    if pa is True: return "판매·PA 계약"
    if pa is None and re.search(r"distribution agreement|placement agent|solicitation|marketing agreement|coverage agreement|sub-?distribut", t): return "판매·PA 계약"
    if re.search(r"nda|non ?disclosure|confidential", t): return "NDA·비밀유지"
    if re.search(r"terminat", t): return "Termination"
    if "투자계약" in t or "약정서" in t: return "국내 투자계약"
    return "그 외" if t else None


def v_contract_history(wb, ctx):
    ys = sorted(int(m.group(1)) for n in wb.sheetnames if (m := CONTRACT_YEAR.match(n)))
    if not ys: raise ValueError("연도 계약서 시트 없음")
    secs, cnt = [], {}
    for y in reversed(ys):
        s = Sh(wb[f"{y} 계약서"])
        h = s.find(lambda x: x.strip() == "계약 상대방", 1, 10)
        if not h: raise ValueError(f"{y} 계약서: 머리글 '계약 상대방' 없음")
        hr, cC = h
        H = {}
        for c in range(cC - 1, cC + 9):
            t = (s.t(hr, c) or "").replace("\n", " ")
            for k, v in (("번호", "no"), ("계약 상대방", "cp"), ("관련 펀드", "fd"), ("전략", "sr"), ("계약 종류", "ty"), ("계약 날짜", "dt"), ("Fee", "fe"), ("메모", "mm"), ("체결현황", "st")):
                if t.startswith(k) and v not in H.values(): H[c] = v
        rows = []
        ws_ = wb[f"{y} 계약서"]
        flt = bool(ws_.auto_filter and ws_.auto_filter.filterColumn)          # 엑셀에 계약 종류 필터가 걸려 있으면 보이는 줄 = 판매·PA
        for r in range(hr + 1, s.maxr + 1):                                   # 필터로 숨은 줄도 모두(앱은 구분 칩으로 거른다)
            no, cp = s.v(r, cC - 1), s.v(r, cC)
            if no is None and cp is None:
                if s.empty(r, cC - 1, cC + 6): break
                continue
            if no is None: continue                                         # 번호 없는 줄 = 입력 도움 목록
            c_ = {v: s.v(r, c) for c, v in H.items()}
            if c_.get("fe") in (0, "N/A", "-"): c_.pop("fe")
            if c_.get("dt") in ("N/A",): c_["dt"] = None
            c_["y"] = str(y); c_["g"] = _ct_group(c_.get("ty"), (r not in s.hr) if flt else None)
            rows.append({"c": {k: v for k, v in c_.items() if v is not None}})
        for x in rows:
            g = x["c"].get("g") or "그 외"
            cnt.setdefault(g, {}); cnt[g][str(y)] = cnt[g].get(str(y), 0) + 1
        secs.append({"h": f"{y}년", "s": f"{len(rows)}건", "rows": rows})
    blocks = [{"t": "kpis", "id": "k", "items": [kpi(f"{sec['h'][:4]} 계약", len(sec["rows"]), "n0", "건",
                                                     f"판매·PA {sum(1 for r in sec['rows'] if r['c'].get('g') == '판매·PA 계약')}건") for sec in secs]}]
    order = ["판매·PA 계약", "NDA·비밀유지", "Termination", "국내 투자계약", "그 외"]
    blocks.append({"t": "col", "id": "yc", "title": "연도별 계약 건수", "sub": "건 · 계약 종류별", "cats": [str(y) for y in ys], "stack": True, "f": "n0",
                   "series": [{"n": g, "v": [cnt.get(g, {}).get(str(y), 0) for y in ys]} for g in order if g in cnt]})
    blocks.append(drop_empty_cols({"t": "table", "id": "cth", "title": "계약 목록", "sub": "연도별 묶음 · 최근 연도 먼저",
                                   "cols": [col("no", "No", "n0"), col("cp", "계약 상대방"), col("g", "구분", "tag"), col("sr", "전략", "tag"),
                                            col("fd", "관련 펀드"), col("dt", "계약일", "date"), col("ty", "계약 종류"), col("fe", "Fee"),
                                            col("mm", "메모", d=1), col("y", "연도", d=1)],
                                   "secs": secs, "card": {"title": "cp", "sub": ["fd", "ty"], "meta": ["dt"], "chips": ["g", "sr"]},
                                   "filters": ["y", "g", "sr"]}))
    blocks.append({"t": "notes", "id": "nt", "items": ["올해 계약은 'PA 계약 현황' 쪽. '판매·PA 계약'은 엑셀 시트의 계약 종류 필터(Distribution·Placement Agent Agreement 등)에 들어가는 계약, 나머지는 NDA·투자계약서 등."]})
    return blocks


# 앱에만 있는 쪽(엑셀 시트 하나에 대응하지 않음): (이름, 만드는 함수). dash_extract.py 가 sheets 에 붙인다.
HISTORY = [("수익 이력 (2018~)", v_cash_history), ("PA 계약 이력 (2023~)", v_contract_history)]


def build_history(wb, ctx):
    out, warn = [], []
    for name, fn in HISTORY:
        try:
            out.append((name, fn(wb, ctx)))
        except Exception as e:
            import traceback
            warn.append(f"{name}: {type(e).__name__}: {e}\n{traceback.format_exc(limit=3)}")
    return out, warn


BUILDERS = {
    "대시보드(Demo)": v_demo,
    "검증": v_check,
    "2026 현금기준 수익": v_cash,
    "2026년 월별 실적": v_monthly,
    "(총정리) 연도별 CF": v_cf,
    "약정내역(2022~현재)": lambda s, c: v_commit(s, c, False),
    "약정내역&수수료": lambda s, c: v_commit(s, c, False),   # 예전 이름(2026-11-09 전 파일)
    "KPI 실적 요약": v_kpi,
    "KPI보고용": lambda s, c: v_commit(s, c, True),
    "약정내역(2010~2021)": v_hist,
    "약정 통계": v_stats,
    "기관별 약정(2010~현재)": v_orgs,
    "2026년 계약서": v_contract,
    "2026년 주요 마케팅 펀드 리스트": v_marketing,
    "2026 RFP·RFI": v_rfp,
    "2026 로드쇼·세미나": v_roadshow,
    "(발생기준) 국내 LP별": v_lp,
    "(현금기준, 발생기준) GP별": v_gp,
    "(현금기준, 발생기준, 계약건) 자산군별": v_asset,
    "해외대체 시딩 관리판_금액, 수익률": v_seed,
}


def build_views(wb, names, ctx):
    """시트 이름 → 블록 목록. 실패한 시트는 빠지고 경고를 돌려준다."""
    out, warn = {}, []
    for n in names:
        fn = BUILDERS.get(n)
        if not fn or n not in wb.sheetnames: continue
        try:
            out[n] = fn(Sh(wb[n]), ctx)
        except Exception as e:   # 한 시트가 실패해도 나머지는 만든다(그 시트는 원본 격자로)
            import traceback
            warn.append(f"{n}: {type(e).__name__}: {e}\n{traceback.format_exc(limit=3)}")
    # 요약(대시보드 시트)에 PA Fee 연도별 예상 · KPI 목표 대비 실적을 덧붙인다
    demo = out.get("대시보드(Demo)")
    if demo is not None:
        extra = []
        fee = next((b for b in out.get("(총정리) 연도별 CF", []) if b.get("t") == "bars" and b.get("id") == "yr"), None)
        if fee: extra.append(dict(fee, title="PA Fee 연도별 예상", sub="억원 · PA Fee Schedule"))
        kp = ctx.get("kpi") or []
        if kp:
            cur = (ctx.get("asof") or "")[:4]
            rows = [{"c": {"y": str(k["y"]), "st": k.get("saleTgt"), "sk": k.get("saleKpi"), "sr": k.get("saleRate"),
                           "pt": k.get("paTgt"), "pa": k.get("pa"), "pr": k.get("paRate")}, "st": "now" if str(k["y"]) == cur else None} for k in kp]
            extra.append({"t": "table", "id": "kpi", "title": "KPI 목표 대비 실적", "sub": "판매규모 조원 · 신규 PA 건", "compact": True,
                          "cols": [col("y", "연도"), col("st", "판매 목표", "n1"), col("sk", "KPI 실적", "n2"), col("sr", "달성률", "pct"),
                                   col("pt", "PA 목표", "n0"), col("pa", "PA 실적", "n0"), col("pr", "달성률", "pct0")], "rows": rows})
        if extra:
            i = next((k for k, b in enumerate(demo) if b.get("t") == "row"), 1) + 1
            demo.insert(i, {"t": "row", "blocks": extra})
    return out, warn
