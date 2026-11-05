"""대시보드 엑셀 → 앱용 '읽기 화면' 데이터(시트별 블록). dash_extract.py 가 불러 쓴다.

엑셀 격자를 그대로 옮기지 않고, 시트마다 내용에 맞는 블록으로 다시 묶는다.
  kpis   지표 카드          table  표(PC)·카드 목록(휴대폰) — 묶음(secs)·필터·정렬·찾기·펼침(x)
  bars   가로 막대(순위)    col    세로 막대(월별·연도별, 여러 계열·누적)    notes  안내 문장
  row    블록 나란히(PC)
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
            kpi("발생 수수료", (ge["c"].get("fk") or 0) / 1e8, "n2", "억원", f"USD {gu['c'].get('fu', 0):,.0f}" if gu else None) if ge else None,
            kpi("Cash 수취분", (ge["c"].get("ca") or 0) / 1e8, "n2", "억원", "발생분 중 2026 수취") if ge else None,
            kpi("약정(USD 환산)", (gu["c"].get("us") or 0) / 1e6, "n0", "USD M", "판매금액") if gu else None,
            kpi("신규펀드 기준", (nu["c"].get("us") or 0) / 1e6, "n0", "USD M", f"발생 USD {nu['c'].get('fu', 0):,.0f}") if nu else None,
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
    b = {"t": "table", "id": "cf", "title": "월별 수취 일정", "sub": "연도를 고르면 그 해 일정 · 금액은 펀드 통화",
         "cols": [col("sec", "구분", "tag"), col("gp", "운용사"), col("fd", "펀드"), col("ty", "보수 유형", "tag"),
                  col("am", "금액", "amt", ck="cy", sum=0), col("st", "상태", "tag", tone=tone), col("nt", "메모")],
         "secs": secs, "pick": {"l": "연도", "opts": ys, "def": cur_y if cur_y in ys else ys[0]},
         "card": {"title": "fd", "sub": ["gp", "ty"], "amt": "am", "chips": ["st", "sec"]}, "filters": ["st", "sec"]}
    blocks.append(b)
    if notes: blocks.append({"t": "notes", "items": ["원화 환산은 엑셀의 적용 환율 기준 · " + " / ".join(notes)]})
    return blocks


# ── 약정내역&수수료 · KPI보고용 ─────────────────────────────────────────────

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
    b = {"t": "table", "id": "cm", "title": "기관별 약정내역", "sub": "연도를 고르면 그 해 약정·수수료가 있는 건만",
         "cols": cols, "rows": rows, "foot": foot,
         "pick": {"l": "연도", "opts": ylist + ["전체"], "def": cur_y if cur_y in ylist else ylist[0], "cols": pick_cols | {"전체": []}, "need": "u|f"},
         "card": {"title": "ab", "sub": ["lp", "gp"], "amt": "@u", "meta": ["@f"], "chips": (["kp"] if kpi_sheet else []) + ["st", "ac"]},
         "filters": ["ac"] + (["kp"] if kpi_sheet else []) + ["st", "gp"]}
    blocks = []
    # 연도별 합계 카드(엑셀 합계 행)
    if foot:
        fc = foot[0]["c"]
        blocks.append({"t": "kpis", "id": "k", "items": [kpi(f"{y} 약정", (fc.get(f"u{y}") or 0) / 1e6, "n0", "USD M", f"수수료 USD {fc.get(f'f{y}') or 0:,.0f}") for y in ylist[:3]]
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
    blocks = []
    title = s.t(1, 1) or s.t(1, 2)
    sub = s.t(2, 1) or s.t(2, 2)
    if sub: blocks.append({"t": "notes", "items": [sub]})
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
        fold = int(m.group(1)) >= 4
        if len(filled) >= 3:
            c1 = max(c for c in range(1, 16) if any(s.v(x, c) is not None for x in range(nxt, end + 1)))
            b = generic_table(s, nxt, nxt + 1, end, min(filled), c1, title=head, tid=f"s{m.group(1)}", fold=fold)
            # 표 아래 ※ 줄은 각주로
            notes = [row for row in b["rows"] if str(next(iter(row["c"].values()), "")).startswith("※")]
            if notes:
                b["rows"] = [x for x in b["rows"] if x not in notes]
                b["notes"] = [" ".join(str(v) for v in x["c"].values()) for x in notes]
            if fold: b["sub"] = f"{len(b['rows'])}건"
            blocks.append(b)
        else:
            items = [" ".join(str(s.v(x, c)) for c in range(1, 16) if s.v(x, c) is not None) for x in range(nxt, end + 1)]
            blocks.append({"t": "notes", "title": head, "items": [i for i in items if i]})
        r = end + 1
    return blocks


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
        kpi("2026 발생", tot.get("fk") or 0, "n2", "억원", f"USD {tot.get('fu') or 0:,.0f}"),
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
    sets = {}
    for y in ys:
        it = sorted([{"l": r["c"]["nm"], "v": r["c"].get(f"y{y}") or 0} for r in rows], key=lambda x: -x["v"])
        sets[y] = [x for x in it if x["v"] > 0][:n]
    return {"t": "bars", "id": tid, "title": title, "sub": sub, "f": f, "sets": sets, "def": ys[-1], "rank": True}


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
                                                   f"발생 USD {(foot[0]['c'].get(f'a{y}') or 0):,.0f}" if foot else None) for y in yl[-3:]]}]
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
            cols = [col("k", "차수"), col("d", "일자", "date"), col("a", "금액(원)", "won")]
            if any(a.get("fx") for a in arr): cols.append(col("fx", "외화", "n2"))
            x.append({"h": f"{lab} {len(arr)}회 · {sum(a['a'] for a in arr):,.0f}원", "cols": cols, "rows": [{k: v for k, v in a.items() if v is not None} for a in arr]})
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
            col("ck", "약정(억원)", "wk", sum=1), col("cfx", "약정(외화)", d=1), col("dr", "누적 인출(억원)", "wk", sum=1), col("bu", "소진율", "bar"),
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

BUILDERS = {
    "대시보드(Demo)": v_demo,
    "검증": v_check,
    "2026 현금기준 수익": v_cash,
    "2026년 월별 실적": v_monthly,
    "(총정리) 연도별 CF": v_cf,
    "약정내역&수수료": lambda s, c: v_commit(s, c, False),
    "KPI 실적 요약": v_kpi,
    "KPI보고용": lambda s, c: v_commit(s, c, True),
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
