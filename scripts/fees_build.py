"""외화 수수료 원장(CSV) → 앱 대시보드 탭의 '수수료 원장' 묶음(쪽 6개) 데이터.

원장은 claude.ai Project 'Back Office 업무연동'의 문서 `claude/외화수수료_원장_2017-2026.csv`
(대화 '수수료 내역 증빙 자료'에서 부가세 영세율 신고자료·회계부 총괄표·입금결의서·송금명세·인보이스를 대조해 만든 것).
이 스크립트는 원장 글자·숫자를 고치지 않고 묶고 더하기만 한다(분류·운용사 묶음은 아래 규칙으로 붙이는 화면용 칸).

  python3 scripts/fees_build.py <원장.csv> <SP>/fees.json [--notes <원장 메모.json>] [--dash <SP>/dash.json]
  python3 scripts/fees_build.py --from <SP>/fees_prev.json <SP>/fees.json --dash <SP>/dash.json   ← 대시보드 엑셀만 바뀌었을 때
  node scripts/vault.mjs encrypt <SP>/fees.json fees.enc.json --salt-from data.enc.json

출력 형식(kind "fees"): dash.json 과 같은 시트 객체 목록. 앱(dash.js)이 대시보드 데이터를 열 때 fees.enc.json 도 열어
'실적·KPI' 묶음 바로 뒤에 '수수료 원장' 묶음으로 붙인다(대시보드 엑셀 매일 갱신과 따로 — 엑셀을 다시 뽑아도 사라지지 않음).
블록 형식은 scripts/dash_views.py 머리 주석과 같다.

--notes: 화면에 덧붙일 설명(공개 저장소라 기관명·금액이 든 설명은 코드에 두지 않고 이 파일로 넘긴다 — Project 문서
`claude/외화수수료_원장_앱메모.json`). 형식: {"period": {"2019-2기 예정": "…"}, "periodNotes": [...], "checkNotes": [...], "summaryNotes": [...],
  "recon": {"2019-2기 예정": {"st": "대사 완료", "nt": "…", "bs": "회계부 총괄표", "rk": 원, "ru": USD, "re": EUR, "dk": 원 차이, "du": USD 차이, "de": EUR 차이}},
  "xcheck": {"sched": [{v, nm, bs, cy, tt, n, g, ga, gp, ds, mm}], "kpi": [{fd, lp, kp, iv, v}], "inv": [{y, n, mx, ms, mc, nt}], "dup": [{no, ds}], "plan": [...], "other": [...]}}
  recon 이 있으면 '신고기간별 대사' 쪽에 대사 상태·차이 칸, xcheck 가 있으면 '크로스체크' 쪽(7번째)을 붙인다. 둘 다 없으면 예전처럼 6쪽.
  xcheck.cmx·hix(약정내역 ↔ 원장 펀드별: v·gp·ab·am·nlp·rt·ex·rc·df·nt·lps[{lp,am,rt,fee,st}]) · xcheck.hist(수익 이력 ↔ 원장: stat·big·only_l·only_h·fx_left·date).

약정 연결(2026-11-18, 사용자 요청: 연도별 펀드·입금마다 어떤 LP·약정금액·수수료율·수수료인지 모든 쪽에서): 원장 CSV 의 선택 열
  '약정 연결'(대시보드 표 id|운용사|펀드 약칭|기관 — ' ; '로 여러 개, cm = 약정내역(2022~현재) · hi = 약정내역(2010~2021))·'약정 연결 방식'·'약정 펀드'·'약정 LP'·
  '약정금액'·'수수료율·보수 조건'·'약정내역 수수료'·'약정 연결 메모'. --dash(복호화한 dash.json)를 주면 금액·율·수수료를 그 엑셀 값으로 다시 채운다
  (엑셀을 고친 뒤 다시 돌리면 그대로 반영). 못 찾은 연결은 CSV 값 그대로 + '대시보드에서 못 찾음' 표시. 입금 원장·운용사별·정기수수료·신고기간·확인 필요·
  크로스체크 쪽에 관련 LP·약정금액·수수료율 칸과 '약정내역 연결' 펼침 표, '펀드별 약정·입금' 쪽(펀드마다 기관별 약정 × 원장 입금)을 붙인다.
  fees.json 의 src(원장 행·메모)를 남겨 --from 으로 대시보드만 바꿔 다시 만들 수 있다(평문은 스크래치패드에만, 저장소엔 암호문뿐).
"""
import csv, datetime, json, re, sys
from collections import Counter, defaultdict

GROUP = "수수료 원장"
COLS = ["NO", "연도", "기간", "입금(결의)일", "부서(당시)", "구분", "펀드·내용", "거래처(송금인)", "통화", "외화금액(결의·신고)",
        "원화금액(결의금액)", "적용환율", "실입금 외화(차이 시)", "인보이스 No.", "산정근거·LP", "출처", "자료", "비고",
        "회계부 신고 원화(차이 시)", "정기수수료 그룹"]
OPT = ["약정 연결", "약정 연결 방식", "약정 펀드", "약정 LP", "약정금액", "수수료율·보수 조건", "약정내역 수수료", "약정 연결 메모"]   # 없어도 됨

# 영세율 신고기간: 1기 예정 1~3월 · 1기 확정 4~6월 · 2기 예정 7~9월 · 2기 확정 10~12월
PERIODS = [("1기 예정", "1~3월"), ("1기 확정", "4~6월"), ("2기 예정", "7~9월"), ("2기 확정", "10~12월")]

# ── 화면용 분류(원장 '구분' + '정기수수료 그룹') ─────────────────────────────────
CAT_ORDER = ["판매 (PA 등)", "관리·모니터링", "중개·수탁·대리인", "용역·기타", "미확인"]
CAT_TONE = {"판매 (PA 등)": "info", "관리·모니터링": "ok", "중개·수탁·대리인": "muted", "용역·기타": "muted", "미확인": "warn"}
MGMT = {"Monitoring", "Maintenance", "Admin", "Trailer", "Trailing", "Annual", "Ongoing service", "Retainer", "Consulting",
        "Monitoring·Maintenance", "Maintenance(추정)"}
OTC = {"중개", "Custody", "상임대리인"}


def category(r):
    g, t = r["정기수수료 그룹"], r["구분"]
    if "미확인" in t: return "미확인"
    if t in OTC: return "중개·수탁·대리인"
    if g or t in MGMT: return "관리·모니터링"
    if t.startswith("기타") or t == "Event": return "용역·기타"
    return "판매 (PA 등)"


# ── 운용사 묶음: 펀드·내용에서 가장 앞에 나오는 이름(같으면 위 규칙) → 없으면 거래처(송금인) ──────────
GP_RULES = [
    (r"Brookfield|\bBREF\b|\bBSREF\b|\bBSREP\b|\bBPREP\b|\bBIDF\b|\bBIF III\b|\bBCP V\b", "Brookfield"),
    (r"Permira|\bPCS\b", "Permira"), (r"Genstar", "Genstar"),
    (r"EQT Exeter|\bExeter\b|\bEICF\b|\bEIVF\b", "EQT Exeter"), (r"\bEQT\b", "EQT"),
    (r"\bAREOF\b|\bEPEP\b|\bAres\b", "Ares"), (r"Landmark|\bLREP\b", "Landmark"),
    (r"Global Infrastructure Partners|\bGIP\b", "GIP"), (r"Barings?|\bEPLF\b", "Barings"),
    (r"\bBSP\b|Benefit Street", "BSP (Benefit Street)"), (r"Centerbridge", "Centerbridge"), (r"\bBridge\b|\bBDS\b", "Bridge"),
    (r"\bUSAA\b", "USAA"), (r"Goldman|\bGSPCC\b|West Street|Vintage VIII|\bREIP\b", "Goldman Sachs"),
    (r"Greystar", "Greystar"), (r"Golden ?Tree", "GoldenTree"), (r"\bCVF\b|CarVal", "CarVal"),
    (r"Coller", "Coller"), (r"Carlyle|\bCEMOF\b|\bCAP V\b|\bCP VIII\b|\bCAPG\b|\bCICF\b", "Carlyle"),
    (r"Blackstone|\bGSO\b|\bBREP\b|\bBCP IX\b|\bESDF\b|\bBGREEN\b|Strategic Partners", "Blackstone"),
    (r"Pomona", "Pomona"), (r"Pantheon", "Pantheon"), (r"Capital Dynamics", "Capital Dynamics"),
    (r"StepStone|Step Stone|\bSCP III\b", "StepStone"), (r"Oaktree", "Oaktree"), (r"Canyon", "Canyon"),
    (r"홍콩법인|Hong Kong", "KB증권 홍콩법인"), (r"Silver ?Lake|\bSLP\b|\bSLA\b", "Silver Lake"),
    (r"Leucadia|Jefferies|\bJDLF\b|\bJFIN\b", "Jefferies (Leucadia)"), (r"Madison Dearborn|\bMDCP\b", "Madison Dearborn"),
    (r"\bPCCP\b|Nuveen", "PCCP"), (r"Siris", "Siris"), (r"GreenOak", "GreenOak"),
    (r"Project Copa|Project Platon|Campbell Lutyens", "Campbell Lutyens"), (r"John Hancock", "John Hancock"),
    (r"Northgate", "Northgate"), (r"Arc ?Light", "ArcLight"), (r"JP ?Morgan", "JP Morgan"), (r"\bApax\b", "Apax"),
    (r"Copenhagen", "Copenhagen Infrastructure"), (r"\bPIMCO\b", "PIMCO"), (r"TD Greystone|TD Asset", "TD Asset Management"),
    (r"BlackRock", "BlackRock"), (r"Mercer", "Mercer"), (r"Kartesia", "Kartesia"), (r"\bDIF\b", "DIF (CVC)"),
    (r"Gemcorp", "Gemcorp"), (r"Partners Group", "Partners Group"), (r"\bOHA\b|Oak Hill", "Oak Hill (OHA)"), (r"Apollo", "Apollo"),
    (r"Energy Capital|\bECP\b", "Energy Capital Partners"), (r"Savills", "DRC Savills"), (r"Lombard Odier|\bLO SECONDARY", "Lombard Odier"),
    (r"Galdana", "Galdana Ventures"), (r"Meritech", "Meritech"), (r"Greenstone", "Greenstone"), (r"Brinley", "Brinley Partners"),
    (r"\bBBAM\b", "BBAM"), (r"\bICG\b", "ICG"), (r"Colchis", "Colchis"), (r"\bGAM\b", "GAM"), (r"Knighthead", "Knighthead"),
    (r"Novus", "Novus Capital"), (r"T-C H-T", "T-C H-T Venture"), (r"Brentwood", "Brentwood"), (r"Brightwood", "Brightwood"),
]
GP_RX = [(re.compile(rx, re.I), name) for rx, name in GP_RULES]


def gp_of(r):
    for text in (r["펀드·내용"], r["거래처(송금인)"]):
        best = None
        for i, (rx, name) in enumerate(GP_RX):
            m = rx.search(text or "")
            if m and (best is None or m.start() < best[0]): best = (m.start(), i, name)
        if best: return best[2]
    t = re.sub(r"\s*\(.*$", "", (r["거래처(송금인)"] or "").strip()).strip(" ,")
    return t or "(송금인 미기재)"


def num(s):
    s = (s or "").replace(",", "").strip()
    if not s: return None
    v = float(s)
    return int(v) if v.is_integer() and abs(v) > 1000 else v


def period_of(d):
    y, m = int(d[:4]), int(d[5:7])
    return f"{y}-{1 if m <= 6 else 2}기 {'예정' if m in (1, 2, 3, 7, 8, 9) else '확정'}"


def load(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        rd = csv.DictReader(f)
        miss = [c for c in COLS if c not in rd.fieldnames]
        if miss: sys.exit(f"원장 열이 없음: {miss}")
        rows = list(rd)
    for r in rows:
        for k in OPT: r[k] = r.get(k) or ""
    errs = []
    for i, r in enumerate(rows, 1):
        if int(r["NO"]) != i: errs.append(f"NO {r['NO']}: 번호가 {i} 이어야 함")
        d = r["입금(결의)일"]
        if not re.fullmatch(r"20\d\d-\d\d-\d\d", d): errs.append(f"NO {i}: 날짜 형식 {d!r}")
        elif period_of(d) != r["기간"]: errs.append(f"NO {i}: 기간 {r['기간']} ≠ 날짜 {d}")
        if r["통화"] not in ("USD", "EUR"): errs.append(f"NO {i}: 통화 {r['통화']!r}")
        a, k, t = num(r["외화금액(결의·신고)"]), num(r["원화금액(결의금액)"]), num(r["적용환율"])
        if a is None or k is None or t is None: errs.append(f"NO {i}: 금액·환율 빈칸"); continue
        if abs(a * t - k) > max(2, abs(k) * 1e-6): errs.append(f"NO {i}: 외화 × 환율({a * t:,.0f}) ≠ 원화({k:,})")
    if errs: sys.exit("원장 확인 필요:\n  " + "\n  ".join(errs[:30]))
    return rows


# ── 약정 연결(대시보드 엑셀 약정내역) ─────────────────────────────────────
EURK = 1990 / 1810      # 약정내역 시트 수수료 칸의 EUR → USD 환산(율이 있는데 약정이 0인 'Annual Fee' 행만 되돌릴 때 씀)


def dash_commit(path):
    """복호화한 dash.json → {'cm|운용사|약칭|기관': [행 c, ...]} (cm = 약정내역(2022~현재), hi = 약정내역(2010~2021))"""
    d = json.load(open(path, encoding="utf-8"))
    out = {}

    def walk(bs):
        for b in bs:
            if b.get("t") == "row": walk(b.get("blocks", []))
            elif b.get("t") == "tabs":
                for x in b.get("items", []): walk(x.get("blocks", []))
            elif b.get("t") == "table" and b.get("id") in ("cm", "hi"):
                for sec in (b.get("secs") or [{"rows": b.get("rows", [])}]):
                    for r in sec["rows"]:
                        c = r["c"]
                        out.setdefault(ckey(b["id"], c.get("gp"), c.get("ab"), c.get("lp")), []).append(c)
    for s in d.get("sheets", []): walk(s.get("view") or [])
    return out, d.get("source"), d.get("asof")


def ckey(src, gp, ab, lp): return "|".join([src, gp or "", (ab or "").replace("\n", " "), lp or ""])


def isnum(v): return isinstance(v, (int, float)) and not isinstance(v, bool)


def mtxt(cy, am):
    if not isnum(am): return f"{cy} {am}".strip() if am else (cy or "")
    v = am / 1e6
    s = f"{v:,.0f}" if abs(v - round(v)) < 1e-9 else f"{v:,.3f}".rstrip("0").rstrip(".")
    return f"{cy} {s}M"


def pct(r): return f"{r * 100:.3f}".rstrip("0").rstrip(".") + "%"


def clean(t): return re.sub(r"\s+", " ", re.sub(r"\s*\n\s*", " · ", t or "").replace("- ", "")).strip(" ·")


def cinfo(src, c, fd=""):
    """약정내역 한 행 → 화면용 {lp, fd, yr, am, rt, fee, st, f{연도}: 원금액 수수료}"""
    cy, am = c.get("cy") or "", c.get("am")
    out = {"lp": c.get("lp") or "", "fd": fd, "am": mtxt(cy, am), "st": c.get("st") or "", "cy": cy, "amv": am if isnum(am) else None}
    if src == "cm":
        fees, rates = [], []
        for y in range(2015, 2036):
            f, r = c.get(f"f{y}"), c.get(f"r{y}")
            if not isnum(f) or not f: continue
            if cy == "EUR": nat = am * r if (isnum(am) and am and isnum(r) and r) else (f / EURK if isnum(r) and r else f)
            else: nat = f
            out[f"f{y}"] = round(nat, 2)
            fees.append(f"{y} {cy} {nat:,.2f}".replace(".00", ""))
            if isnum(r) and r: rates.append(pct(r))
        out.update(yr=c.get("ym") or "", rt=" · ".join(dict.fromkeys(rates)) or ("정액" if fees else ""), fee=" · ".join(fees))
    else:
        fr = clean(c.get("fr"))
        out.update(yr=str(c.get("yr") or "") + (f" ({c['ym']})" if c.get("ym") else ""), rt=clean(c.get("fe")), fee=("잔여: " + fr) if fr else "")
    return out


def link_rows(r, DX):
    """원장 행의 '약정 연결' → 약정내역 행 목록(대시보드 값 우선) · 못 찾은 연결 수"""
    keys = [k.strip() for k in (r.get("약정 연결") or "").split(" ; ") if k.strip()]
    out, miss = [], 0
    for k in keys:
        src, gp, ab, lp = (k.split("|") + ["", "", "", ""])[:4]
        cs = DX.get(k) if DX else None
        if cs: out.append(cinfo(src, cs[0], ab))
        else:
            miss += 1 if DX else 0
            out.append({"lp": lp, "fd": ab, "yr": "", "am": "", "rt": "", "fee": "", "st": "", "cy": "", "amv": None})
    return out, miss


def sum_cy(cs):
    by = defaultdict(float)
    for c in cs:
        if c.get("amv"): by[c["cy"]] += c["amv"]
    return " · ".join(mtxt(cy, v) for cy, v in by.items())


def fee_sum(cs):
    by = defaultdict(float)
    for c in cs:
        for k, v in c.items():
            if re.fullmatch(r"f20\d\d", k): by[(k[1:], c["cy"])] += v
    return " · ".join(f"{y} {cy} {v:,.2f}".replace(".00", "") for (y, cy), v in sorted(by.items()))


def kpi(l, v, f=None, u=None, s=None, tone=None):
    d = {"l": l, "v": v}
    for k, x in (("f", f), ("u", u), ("s", s), ("tone", tone)):
        if x is not None: d[k] = x
    return d


def col(k, l, f="text", **kw):
    d = {"k": k, "l": l, "f": f}
    d.update({a: b for a, b in kw.items() if b is not None})
    return d


def eok(v): return round(v / 1e8, 4)


def fx_text(by):  # {"USD": x, "EUR": y} → 'USD 1,234.56 · EUR 7.00'
    return " · ".join(f"{c} {v:,.2f}" for c, v in sorted(by.items(), key=lambda z: z[0] != "USD") if v)


def build(rows, source, notes=None, DX=None, dsrc=None):
    N = notes or {}
    PN = N.get("period", {})
    RC = N.get("recon", {})          # 신고기간별 대사(대사 기준·원화/외화 차이·상태) — 앱메모
    R = []
    for r in rows:
        x = {"no": int(r["NO"]), "y": int(r["연도"]), "pr": r["기간"], "d": r["입금(결의)일"], "dp": r["부서(당시)"], "ty": r["구분"],
             "fd": r["펀드·내용"], "pay": r["거래처(송금인)"], "cy": r["통화"], "fx": num(r["외화금액(결의·신고)"]),
             "k": num(r["원화금액(결의금액)"]), "rt": num(r["적용환율"]), "net": num(r["실입금 외화(차이 시)"]),
             "inv": r["인보이스 No."], "bs": r["산정근거·LP"], "ev": r["출처"], "src": r["자료"], "nt": r["비고"],
             "acc": num(r["회계부 신고 원화(차이 시)"]), "gr": r["정기수수료 그룹"]}
        x["cl"], x["gp"] = category(r), gp_of(r)
        cs, miss = link_rows(r, DX)
        x["fk"] = list(dict.fromkeys("|".join(k.strip().split("|")[:3]) for k in (r.get("약정 연결") or "").split(" ; ") if k.strip()))
        x["cms"], x["lm"] = cs, r.get("약정 연결 방식") or ""
        lpn = list(dict.fromkeys(c["lp"] for c in cs if c["lp"]))
        x["lp"] = ((" · ".join(lpn) if len(lpn) <= 6 else " · ".join(lpn[:5]) + f" 외 {len(lpn) - 5}곳") + (" (펀드 전체)" if x["lm"] == "펀드 전체" and len(lpn) > 1 else "")) if lpn else ""
        x["cfd"] = r.get("약정 펀드") or ""
        if DX and cs and not miss:
            x["cam"] = sum_cy(cs); x["crt"] = " · ".join(dict.fromkeys(c["rt"] for c in cs if c["rt"]))[:200]; x["cfe"] = fee_sum(cs)
        else:
            x["cam"], x["crt"], x["cfe"] = r.get("약정금액") or "", r.get("수수료율·보수 조건") or "", r.get("약정내역 수수료") or ""
        x["cnt"] = (r.get("약정 연결 메모") or "") + (" / 대시보드 약정내역에서 못 찾은 연결 %d개(엑셀 표기가 바뀐 듯 — CSV 값 그대로)" % miss if miss else "")
        if not cs and x["lm"] == "약정 없음": x["cnt"] = x["cnt"] or "약정과 무관(중개·retainer·trailer·번역 등)"
        R.append(x)
    first, last = R[0]["d"], max(x["d"] for x in R)
    years = sorted({x["y"] for x in R})
    tot = sum(x["k"] for x in R)
    by_cy = defaultdict(float)
    for x in R: by_cy[x["cy"]] += x["fx"]
    gen = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime("%Y-%m-%d %H:%M")

    def lrow(x):  # 입금 원장 한 줄(칸 이름은 아래 LCOLS)
        c = {k: x[k] for k in ("no", "d", "pr", "cl", "ty", "fd", "gp", "cy", "fx", "rt", "k", "inv", "bs", "pay", "net", "dp", "src", "ev", "nt", "acc", "gr",
                               "lp", "cam", "crt", "cfe", "cfd", "cnt", "lm")
             if x.get(k) not in (None, "")}
        c["rt"], c["y"] = round(x["rt"], 2), str(x["y"])
        out = {"c": c}
        if x["cms"]: out["x"] = [cmx_table(x["cms"])]
        if re.search(r"\[(확인 필요|추정)\]", x["nt"]) or "미확인" in x["ty"]: out["st"] = "bad"
        return out

    CMC = [col("lp", "기관"), col("fd", "펀드(약칭)"), col("yr", "약정연도·연월"), col("am", "약정금액"), col("rt", "수수료율·보수 조건"),
           col("fee", "약정내역 수수료(연도별, 외화)"), col("st", "상태")]

    def cmx_table(cs, h=None):
        return {"h": h or f"약정내역 연결 {len(cs)}행 — 대시보드 엑셀" + (f" ({dsrc})" if dsrc else ""), "cols": CMC,
                "rows": [{k: c.get(k, "") for k in ("lp", "fd", "yr", "am", "rt", "fee", "st")} for c in cs[:40]]}

    LCOLS = [col("d", "입금일", "date"), col("fd", "펀드·내용"), col("gp", "운용사·거래처"), col("fx", "외화", "amt2", sumc=1),
             col("k", "원화(결의금액)", "won", sum=1), col("lp", "관련 LP"), col("cam", "약정금액"), col("crt", "수수료율"),
             col("ty", "보수 유형", "tag"), col("cl", "분류", "tag", tone=CAT_TONE),
             col("rt", "적용환율", "n2", d=1), col("pr", "신고기간", d=1), col("y", "연도", d=1),
             col("inv", "인보이스", d=1), col("bs", "산정근거·LP", d=1), col("pay", "송금인(원장 표기)", d=1),
             col("net", "실입금 외화(차이 시)", "amt2", d=1), col("dp", "부서(당시)", d=1), col("src", "자료", d=1),
             col("ev", "출처(파일·쪽)", d=1), col("nt", "비고", d=1), col("acc", "회계부 신고 원화(차이 시)", "won", d=1),
             col("gr", "정기수수료 그룹", d=1), col("cfd", "약정 펀드(약정내역 약칭)", d=1), col("cfe", "약정내역 수수료(연도별)", d=1),
             col("cnt", "약정 연결 메모", d=1), col("lm", "약정 연결 방식", d=1), col("no", "원장 NO", "int", d=1)]
    CARD = {"title": "fd", "sub": ["gp", "lp"], "amt": "k", "meta": ["d", "fx", "cam", "crt"], "chips": ["cl", "ty"]}

    sheets = []
    # ── 1. 요약 ───────────────────────────────────────────────────────────────
    ysum = {y: [x for x in R if x["y"] == y] for y in years}
    cur_y = years[-1]; lm = int(last[5:7])
    cur = sum(x["k"] for x in ysum[cur_y])
    prev_same = sum(x["k"] for x in ysum.get(cur_y - 1, []) if int(x["d"][5:7]) <= lm)
    groups = defaultdict(list)
    for x in R:
        if x["gr"]: groups[x["gr"]].append(x)
    flags = [x for x in R if re.search(r"\[(확인 필요|추정)\]", x["nt"]) or "미확인" in x["ty"] or "미첨부" in x["ty"] or "?" in (x["inv"] + x["bs"])]
    ev_n = sum(1 for x in R if "증빙" in x["src"])
    g_now = sum(1 for g in groups.values() if max(z["y"] for z in g) == cur_y)
    v1 = [{"t": "kpis", "id": "k", "items": [
        kpi("누적 수령액 (원화)", eok(tot), "eok", "억원", f"{len(R)}건 · {first} ~ {last}"),
        kpi("외화 합계", round(by_cy["USD"] / 1e6, 4), "n2", "USD M", f"EUR {by_cy['EUR'] / 1e6:,.2f}M"),
        kpi(f"{cur_y}년 (1~{lm}월)", eok(cur), "eok", "억원",
            f"{len(ysum[cur_y])}건 · {cur_y - 1}년 같은 기간 {prev_same / 1e8:,.2f}억" if prev_same else f"{len(ysum[cur_y])}건"),
        kpi("정기 수수료", len(groups), "n0", "개 그룹", f"{cur_y}년 입금 {g_now}개 · '정기수수료 연도별' 쪽"),
        kpi("증빙 대조", ev_n, "n0", f"/{len(R)}건", "결의서·송금명세·인보이스 중 하나 이상"),
        kpi("확인 필요", len(flags), "n0", "건", "추정·미확인·인보이스 애매 — '확인 필요' 쪽", tone="warn" if flags else None),
    ] + ([kpi("약정 연결", sum(1 for x in R if x["cms"]), "n0", f"/{len(R)}건",
              f"기관까지 {sum(1 for x in R if x['cms'] and x['lm'] in ('기관', '금액'))} · 펀드 전체 {sum(1 for x in R if x['lm'] == '펀드 전체')} · 약정과 무관 {sum(1 for x in R if not x['cms'])} — 대시보드 엑셀 약정내역")]
         if any(x["cms"] for x in R) else [])}]
    v1.append({"t": "col", "id": "yr", "title": "연도별 수령액", "sub": f"억원 · 원화 결의금액 · {years[0]}은 {int(first[5:7])}월부터, {cur_y}은 {lm}월까지",
               "cats": [str(y) for y in years], "stack": True, "f": "eok",
               "series": [{"n": c, "v": [eok(sum(x["k"] for x in ysum[y] if x["cl"] == c)) for y in years]}
                          for c in CAT_ORDER if any(x["cl"] == c for x in R)]})
    yrows = []
    for y in reversed(years):
        rs = ysum[y]; byc = defaultdict(float); top = Counter()
        for x in rs: byc[x["cy"]] += x["fx"]; top[x["gp"]] += x["k"]
        c = {"y": f"{y}" + (f" (~{lm}월)" if y == cur_y else "") + (f" ({int(first[5:7])}월~)" if y == years[0] else ""),
             "n": len(rs), "k": sum(x["k"] for x in rs),
             "usd": byc.get("USD") or None, "eur": byc.get("EUR") or None,
             "tp": " · ".join(n for n, _ in top.most_common(3)), "dp": " · ".join(dict.fromkeys(x["dp"] for x in rs))}
        for i, cn in enumerate(CAT_ORDER):
            v = sum(x["k"] for x in rs if x["cl"] == cn)
            if v: c[f"c{i}"] = v
        yrows.append({"c": c})
    v1.append({"t": "table", "id": "ys", "title": "연도별 요약", "sub": "단위 원 · 외화는 결의(신고) 외화", "compact": True,
               "cols": [col("y", "연도"), col("n", "건수", "n0"), col("k", "원화 합계", "won")]
                       + [col(f"c{i}", cn, "won") for i, cn in enumerate(CAT_ORDER) if any(x["cl"] == cn for x in R)]
                       + [col("usd", "USD", "usd2"), col("eur", "EUR", "m2"), col("tp", "많이 받은 곳 (상위 3)", d=1), col("dp", "당시 부서명", d=1)],
               "rows": yrows})
    allt = Counter()
    for x in R: allt[x["gp"]] += x["k"]
    sets = {"전체": [{"l": n, "v": eok(v)} for n, v in allt.most_common(15)]}
    for y in reversed(years):
        t = Counter()
        for x in ysum[y]: t[x["gp"]] += x["k"]
        sets[f"{y}년"] = [{"l": n, "v": eok(v)} for n, v in t.most_common(10)]
    v1.extend([
        {"t": "bars", "id": "top", "title": "운용사별 누적 (상위)", "sub": f"억원 · 전체 = {first[:7]}~{last[:7]} 상위 15 · 연도는 상위 10",
         "f": "eok", "sets": sets, "def": "전체", "rank": True},
        {"t": "bars", "id": "cat", "title": "분류별 누적", "sub": "억원 · 원장 '구분' + 정기수수료 그룹으로 나눔", "f": "eok", "rank": True,
         "items": [{"l": c, "v": eok(sum(x["k"] for x in R if x["cl"] == c))} for c in CAT_ORDER if any(x["cl"] == c for x in R)]},
    ])
    trows = []
    for t in sorted({x["ty"] for x in R}, key=lambda t: -sum(x["k"] for x in R if x["ty"] == t)):
        rs = [x for x in R if x["ty"] == t]; cc = Counter(x["cl"] for x in rs)
        trows.append({"c": {"t": t, "cl": " · ".join(f"{c} {n}" if len(cc) > 1 else c for c, n in cc.most_common()), "n": len(rs),
                            "k": sum(x["k"] for x in rs), "p": sum(x["k"] for x in rs) / tot, "fd": rs[0]["d"], "ld": max(x["d"] for x in rs)}})
    v1.append({"t": "table", "id": "ty", "title": "보수 유형별", "sub": "원장 '구분' 그대로 · 원화 많은 순 · 분류가 둘 이상이면 건수 함께 · 단위 원",
               "cols": [col("t", "보수 유형"), col("cl", "분류"), col("n", "건수", "n0"), col("k", "원화 합계", "won"),
                        col("p", "비중", "pct"), col("fd", "첫 입금", "date"), col("ld", "마지막 입금", "date")], "rows": trows})
    drows = []
    for dname in dict.fromkeys(x["dp"] for x in R):
        rs = [x for x in R if x["dp"] == dname]
        drows.append({"c": {"dp": dname, "fd": rs[0]["d"], "ld": rs[-1]["d"], "n": len(rs), "k": sum(x["k"] for x in rs)}})
    v1.append({"t": "table", "id": "dp", "title": "부서명 변천 (원장 '부서(당시)')", "sub": "금융상품영업1·2부·금융상품영업부 → … → 글로벌상품영업부는 같은 부서 · 단위 원", "compact": True,
               "cols": [col("dp", "부서(당시)"), col("fd", "첫 입금", "date"), col("ld", "마지막 입금", "date"), col("n", "건수", "n0"), col("k", "원화 합계", "won")],
               "rows": drows})
    acc_rows = [x for x in R if x["acc"] is not None]
    v1.append({"t": "notes", "id": "nt", "items": [
        f"원장: Project 'Back Office 업무연동' 문서 {source} — 부가세 영세율 신고자료·회계부 영세율 총괄표·입금결의서·송금명세·인보이스를 대조해 정리한 외화 수수료 입금 {len(R)}건({first} ~ {last}).",
        f"원화는 회사 시스템 결의금액 기준. 회계부 신고액과 다른 {len(acc_rows)}건은 원장 금액이 회계부보다 {sum(x['k'] - x['acc'] for x in acc_rows):+,}원(송금수수료 전 청구액으로 신고한 건 등) — '확인 필요' 쪽 표.",
        "외화 수수료만 담는다 — 원화 수익·RM 부서 배분까지 들어간 부서 수익 전체는 '수익 이력 (2018~)'·'수익 (현금기준)' 쪽.",
        f"{last[:7]} 이후 입금은 아직 원장에 없다(다음 영세율 신고자료가 나오면 추가) — 그 사이 입금은 '수익 (현금기준)' 쪽.",
        *N.get("summaryNotes", []),
        "분류(화면용): 중개·Custody·상임대리인 = 중개·수탁·대리인 / 정기수수료 그룹이 있거나 Monitoring·Maintenance·Admin·Trailer·Retainer 등 = 관리·모니터링 / 번역비·리서치·행사 = 용역·기타 / 그 밖(PA·Distribution·Success fee 등) = 판매. 운용사는 펀드·내용에 처음 나온 이름으로 묶음(없으면 송금인).",
    ]})
    sheets.append({"name": "수수료 원장 요약", "short": "원장 요약", "view": v1})

    # ── 2. 입금 원장 ─────────────────────────────────────────────────────────
    secs = []
    for y in reversed(years):
        rs = sorted(ysum[y], key=lambda x: (x["d"], x["no"]), reverse=True)
        secs.append({"h": f"{y}년", "s": f"{len(rs)}건 · {sum(x['k'] for x in rs) / 1e8:,.2f}억원 · {fx_text({c: sum(x['fx'] for x in rs if x['cy'] == c) for c in ('USD', 'EUR')})}",
                     "p": str(y), "rows": [lrow(x) for x in rs]})
    nlk = sum(1 for x in R if x["cms"])
    v2 = [{"t": "table", "id": "led", "title": "입금 원장", "sub": f"최근 입금부터 · 단위 원 · 관련 LP·약정금액·수수료율 = 대시보드 엑셀 약정내역({nlk}/{len(R)}건 연결) · "
                                                               "눌러서 약정내역 기관별 행·인보이스·산정근거·출처·비고 보기 · 빨간 줄 = 추정·미확인",
           "cols": LCOLS, "secs": secs, "secsum": 1, "card": CARD,
           "filters": ["y", "cl", "cy", "gp", "ty", "pr", "lm", "src"]}]
    sheets.append({"name": f"외화 수수료 입금 원장 ({years[0]}~)", "short": "입금 원장", "view": v2})

    # ── 3. 운용사별 ─────────────────────────────────────────────────────────
    XC = [col("d", "입금일", "date"), col("ty", "보수 유형"), col("fd", "펀드·내용"), col("lp", "관련 LP"), col("crt", "수수료율"), col("fx", "외화", "amt2"), col("k", "원화", "won")]
    XK = ("d", "ty", "fd", "lp", "crt", "fx", "k", "cy")

    def uniq_cms(rs):
        seen, out = set(), []
        for x in rs:
            for c in x["cms"]:
                k = (c["fd"], c["lp"], c["am"])
                if k not in seen: seen.add(k); out.append(c)
        return out
    grows = []
    for g, _ in allt.most_common():
        rs = sorted([x for x in R if x["gp"] == g], key=lambda x: x["d"])
        byc = defaultdict(float)
        for x in rs: byc[x["cy"]] += x["fx"]
        c = {"gp": g, "n": len(rs), "k": sum(x["k"] for x in rs), "fx": fx_text(byc), "fd": rs[0]["d"], "ld": rs[-1]["d"],
             "ty": " · ".join(t for t, _ in Counter(x["ty"] for x in rs).most_common(4)),
             "cl": Counter(x["cl"] for x in rs).most_common(1)[0][0],
             "rg": " · ".join(sorted({x["gr"] for x in rs if x["gr"]})) or None,
             "fds": " / ".join(dict.fromkeys(re.sub(r"\s*\(.*?\)\s*$", "", x["fd"]) for x in rs))[:600]}
        for y in years:
            v = sum(x["k"] for x in rs if x["y"] == y)
            if v: c[f"y{y}"] = v
        cms = uniq_cms(rs)
        if cms:
            c["nlp"] = len({m["lp"] for m in cms if m["lp"]}); c["cam"] = sum_cy(cms) or None
            c["cfds"] = " · ".join(dict.fromkeys(m["fd"] for m in cms if m["fd"]))
        xs = [{"h": f"입금 {len(rs)}건", "cols": XC, "rows": [{k: x.get(k, "") for k in XK} for x in reversed(rs)]}]
        if cms: xs.append(cmx_table(cms, f"약정 {len(cms)}행 — 대시보드 엑셀 약정내역(이 운용사 입금에 연결된 펀드)"))
        grows.append({"c": {k: v for k, v in c.items() if v not in (None, "")}, "x": xs})
    v3 = [{"t": "table", "id": "gps", "title": "운용사·거래처별", "sub": f"{len(grows)}곳 · 원화 많은 순 · 눌러서 입금 건 전체(관련 LP·수수료율)와 약정내역 기관별 행 보기 · 단위 원",
           "filters": ["cl"],
           "cols": [col("gp", "운용사·거래처"), col("cl", "주 분류", "tag", tone=CAT_TONE), col("n", "건수", "n0"), col("k", "원화 합계", "won", sum=1),
                    col("fx", "외화 합계"), col("nlp", "약정 기관 수", "n0"), col("cam", "약정 합계"), col("fd", "첫 입금", "date"), col("ld", "마지막 입금", "date"),
                    col("cfds", "약정 펀드(약칭)", d=1), col("ty", "보수 유형", d=1),
                    col("rg", "정기수수료 그룹", d=1), col("fds", "펀드·내용", d=1)]
                   + [col(f"y{y}", f"{y}년", "won", d=1) for y in reversed(years)],
           "card": {"title": "gp", "amt": "k", "sub": ["fx", "cam"], "meta": ["n", "nlp", "ld"], "chips": ["cl"]},
           "rows": grows}]
    sheets.append({"name": "외화 수수료 운용사별", "short": "운용사별", "view": v3})

    # ── 3-2. 펀드별 약정·입금 (대시보드 엑셀 약정내역 × 원장) ───────────────────
    XCK = N.get("xcheck") or {}
    VJ = {}
    for z in (XCK.get("cmx") or []) + (XCK.get("hix") or []): VJ[(z.get("gp"), z.get("ab"))] = z
    FI = defaultdict(list)                       # (표, 운용사, 약칭) → 약정내역 행
    for k, cs in (DX or {}).items():
        src, gp, ab, lp = (k.split("|") + ["", "", "", ""])[:4]
        for c0 in cs: FI[(src, gp, ab)].append(cinfo(src, c0, ab))
    BYF = defaultdict(list)
    for x in R:
        for fk in x["fk"]: BYF[tuple(fk.split("|"))].append(x)
    fkeys = list(BYF) + [k for k in FI if k not in BYF and any(c.get("fee") for c in FI[k]) and k[0] == "cm"]
    frows = []
    for fk in fkeys:
        src, gp, ab = fk
        rs = sorted(BYF.get(fk, []), key=lambda x: x["d"])
        jv = VJ.get((gp, ab)) or {}
        cs = FI.get(fk) or [dict(lp=z.get("lp", ""), fd=ab, yr=str(z.get("yr") or ""), am=z.get("am", ""), rt=z.get("rt", ""), fee=z.get("fee", ""), st=z.get("st", ""),
                                  cy="", amv=None) for z in jv.get("lps", [])]
        byc, byg = defaultdict(float), defaultdict(float)
        for x in rs: (byg if x["gr"] else byc)[x["cy"]] += x["fx"]
        c = {"fd": ab or "(펀드 미기재)", "gp": gp, "sh": "2022~" if src == "cm" else "2010~21", "nlp": len({z["lp"] for z in cs if z["lp"]}) or None,
             "am": sum_cy(cs) or jv.get("am") or None, "rt": " · ".join(dict.fromkeys(z["rt"] for z in cs if z["rt"]))[:220] or None,
             "fee": fee_sum(cs) or None, "rc": fx_text(byc) or None, "rg": fx_text(byg) or None, "n": len(rs) or None, "ld": rs[-1]["d"] if rs else None,
             "k": sum(x["k"] for x in rs) or None, "v": jv.get("v"), "nt": jv.get("nt") or None, "df": jv.get("df") or None}
        for y in years:
            v = sum(x["k"] for x in rs if x["y"] == y)
            if v: c[f"y{y}"] = v
        xs = []
        if cs: xs.append(cmx_table(cs, f"기관별 약정 {len(cs)}행 — 대시보드 엑셀 약정내역" + ("(2022~현재)" if src == "cm" else "(2010~2021)")))
        if rs: xs.append({"h": f"원장 입금 {len(rs)}건", "cols": XC, "rows": [{k: x.get(k, "") for k in XK} for x in reversed(rs)]})
        frows.append({"c": {k: v for k, v in c.items() if v not in (None, "")}, "x": xs, **({"st": "bad"} if str(jv.get("v", "")).startswith(("원장이", "원장 입금 없음", "약정내역 수수료 없음", "확인 필요")) else {})})
    frows.sort(key=lambda r: (-(r["c"].get("k") or 0), r["c"]["fd"]))
    VT2 = {"일치": "ok", "일치(통화 다름)": "ok", "일치(기관 표기 다름)": "ok", "일치(송금인 표기 다름)": "ok", "일치(약정 행 기준)": "ok",
           "청구 예정·진행 중": "muted", "일부 입금": "info", "정리": "muted"}
    if frows:
        vc2 = Counter(r["c"].get("v") for r in frows if r["c"].get("v"))
        v32 = [{"t": "kpis", "id": "k", "items": [
                   kpi("약정 펀드", len(frows), "n0", "개", f"원장 입금이 연결된 {sum(1 for r in frows if r['c'].get('n'))}개 + 입금 전(청구 예정)"),
                   kpi("원장 ↔ 약정내역 일치", sum(v for k, v in vc2.items() if str(k).startswith("일치")), "n0", "개", "펀드별 수수료 합계가 같음(통화·기관 표기만 다른 것 포함)", tone="ok"),
                   kpi("진행 중·분할·정리", sum(v for k, v in vc2.items() if k in ("청구 예정·진행 중", "일부 입금", "정리")), "n0", "개", "청구 예정·분할 일부 입금·놓친 것으로 정리"),
                   kpi("확인", sum(v for k, v in vc2.items() if not str(k).startswith("일치") and k not in ("청구 예정·진행 중", "일부 입금", "정리")), "n0", "개",
                       "원장이 많음·적음·약정내역 수수료 칸 없음·보수 조건과 다름", tone="warn")]},
               {"t": "table", "id": "fnd", "title": "펀드별 약정·입금", "sub": f"대시보드 엑셀 약정내역(기관·약정금액·수수료율·연도별 수수료) × 원장 입금 · 원장 입금 많은 순 · 눌러서 기관별 약정 행과 입금 건 보기 · 단위 원"
                                                                              + (f" · 약정내역 = {dsrc}" if dsrc else ""),
                "filters": ["v", "sh", "gp"],
                "cols": [col("fd", "펀드(약칭)"), col("gp", "운용사"), col("v", "판정", "tag", tone=VT2), col("nlp", "기관 수", "n0"), col("am", "약정 합계"),
                         col("rt", "수수료율·보수 조건"), col("fee", "약정내역 수수료(연도별)"), col("rc", "원장 입금(판매 등, 외화)"), col("rg", "원장 정기분(외화)"),
                         col("k", "원장 입금 원화(전체)", "won", sum=1),
                         col("n", "입금 건수", "n0", d=1), col("ld", "마지막 입금", "date", d=1), col("df", "원장 − 약정내역", d=1), col("sh", "약정 시트", d=1), col("nt", "대조 메모", d=1)]
                        + [col(f"y{y}", f"{y}년 입금(원)", "won", d=1) for y in reversed(years)],
                "card": {"title": "fd", "sub": ["gp", "am"], "amt": "k", "chips": ["v", "sh"], "meta": ["nlp", "rt", "rc"]},
                "rows": frows},
               {"t": "notes", "id": "nt", "items": [
                   "약정내역 수수료 = 기관별 약정 × 수수료율(EUR 약정은 EUR 금액 — 엑셀 시트의 USD 환산 칸이 아님). 2010~2021 약정은 수수료가 '보수 조건'·'잔여 보수' 글자.",
                   "원장 입금(판매 등) = 그 펀드로 연결된 입금 중 정기수수료 그룹이 아닌 것, 정기분 = maintenance·monitoring 등 정기수수료 그룹. 판정은 판매 등 기준('크로스체크' 쪽). 원화는 둘 다 합친 금액.",
                   "입금 → 약정 연결: 산정근거·펀드 이름에 나온 기관(또는 약정 합계)으로 기관까지, 못 찾으면 펀드 전체. 대시보드 엑셀을 고친 뒤 다시 반영하면 금액·율·수수료가 따라 바뀜."]}]
        sheets.append({"name": "펀드별 약정·입금", "short": "펀드별 약정·입금", "view": v32})

    # ── 4. 정기수수료 연도별 ─────────────────────────────────────────────────
    ST = ["입금 중", "작년 연말 입금분", "올해 아직 없음", "끊김", "1회"]
    TONE4 = {"입금 중": "ok", "작년 연말 입금분": "info", "올해 아직 없음": "warn", "끊김": "bad", "1회": "muted"}
    bys = defaultdict(list)
    for g, rs in groups.items():
        rs = sorted(rs, key=lambda x: x["d"])
        ly = max(x["y"] for x in rs); months = Counter(int(x["d"][5:7]) for x in rs)
        if len(rs) == 1: s = "1회"
        elif ly == cur_y: s = "입금 중"
        elif ly == cur_y - 1 and all(int(x["d"][5:7]) > lm for x in rs if x["y"] == ly): s = "작년 연말 입금분"
        elif ly == cur_y - 1: s = "올해 아직 없음"
        else: s = "끊김"
        cys = Counter(x["cy"] for x in rs)
        cms = uniq_cms(rs)
        c = {"g": g, "st": s, "cy": cys.most_common(1)[0][0], "n": len(rs), "fd": rs[0]["d"], "ld": rs[-1]["d"],
             "lp": " · ".join(dict.fromkeys(m["lp"] for m in cms if m["lp"]))[:120] or None, "crt": " · ".join(dict.fromkeys(m["rt"] for m in cms if m["rt"]))[:200] or None,
             "cam": sum_cy(cms) or None,
             "mo": "·".join(f"{m}월" for m, _ in sorted(months.items(), key=lambda z: (-z[1], z[0]))[:3]),
             "k": sum(x["k"] for x in rs), "gp": rs[0]["gp"]}
        if len(cys) > 1: c["cy"] = "/".join(cys)
        for y in years:
            v = sum(x["fx"] for x in rs if x["y"] == y)
            if v: c[f"y{y}"] = round(v, 2)
        bys[s].append({"c": c, "st": "bad" if s in ("끊김",) else None,
                       "x": [{"h": f"입금 {len(rs)}건", "cols": XC, "rows": [{k: x.get(k, "") for k in XK} for x in reversed(rs)]}]
                            + ([cmx_table(cms, f"약정 {len(cms)}행 — 대시보드 엑셀 약정내역(보수 조건·잔여 보수)")] if cms else [])})
    rsecs = []
    SH = {"입금 중": f"{cur_y}년 입금", "작년 연말 입금분": f"{cur_y - 1}년엔 {lm + 1}~12월에 들어옴 — 원장은 {cur_y}년 {lm}월까지",
          "올해 아직 없음": f"{cur_y - 1}년엔 있었고 {cur_y}년 {lm}월까지 없음", "끊김": f"{cur_y - 2}년 이전이 마지막 — 계약 종료인지 미수인지 확인", "1회": "한 번만 들어온 그룹"}
    for s in ST:
        if not bys.get(s): continue
        rr = sorted(bys[s], key=lambda r: r["c"]["ld"], reverse=True)
        for r in rr:
            if r["st"] is None: r.pop("st")
        rsecs.append({"h": f"{s}", "s": f"{len(rr)}개 · {SH[s]}", "rows": rr})
    v4 = [{"t": "kpis", "id": "k", "items": [kpi(s, len(bys.get(s, [])), "n0", "개", SH[s], tone=("warn" if s in ("끊김", "올해 아직 없음") and bys.get(s) else None))
                                            for s in ST if bys.get(s)]},
          {"t": "table", "id": "rec", "title": "정기수수료 그룹별 연도별 입금", "sub": f"연도 칸 = 그 해 입금 외화 합계(빈 칸 = 입금 없음) · {years[-1] - 6}년 이전 연도·입금 건은 눌러서 보기",
           "cols": [col("g", "정기수수료 그룹"), col("st", "상태", "tag", tone=TONE4), col("cy", "통화", "tag"), col("lp", "관련 LP"), col("crt", "보수 조건(약정내역)", d=1), col("cam", "약정금액", d=1)]
                   + [col(f"y{y}", str(y), "m2", d=(1 if y < years[-1] - 6 else None)) for y in years]
                   + [col("ld", "마지막 입금", "date"), col("mo", "주로 들어온 달", d=1), col("n", "횟수", "n0", d=1), col("k", "원화 누적", "won", d=1),
                      col("fd", "첫 입금", "date", d=1), col("gp", "운용사", d=1)],
           "card": {"title": "g", "sub": ["lp", "ld"], "chips": ["st", "cy"], "stats": [f"y{y}" for y in years[-4:]]},
           "secs": rsecs},
          {"t": "notes", "id": "nt", "items": [
              f"상태는 원장 마지막 입금일({last}) 기준 계산: {cur_y}년에 들어왔으면 '입금 중', {cur_y - 1}년이 마지막이고 그 해엔 {lm + 1}~12월에만 들어온 그룹은 '작년 연말 입금분', "
              f"그 밖에 {cur_y - 1}년이 마지막이면 '올해 아직 없음', {cur_y - 2}년 이전이 마지막이면 '끊김'.",
              "그룹 이름·묶음은 원장 '정기수수료 그룹' 칸 그대로(Brookfield 펀드들 등은 여러 펀드 maintenance 합계).",
              f"{lm + 1}월 이후 실제 입금 여부는 '수익 (현금기준)' 쪽에서 확인."]}]
    sheets.append({"name": "정기수수료 연도별", "short": "정기수수료 연도별", "view": v4})

    # ── 5. 영세율 신고기간별 대사 ─────────────────────────────────────────────
    per = defaultdict(list)
    for x in R: per[x["pr"]].append(x)
    psecs = []
    idre = re.compile(r"\b([0-9a-f]{8}|u\d\d_\d[eh]|upload\d\d|2_글로벌상품영업부_2025년_2기확정)\b")
    for y in reversed(range(years[0], cur_y + 1)):
        prs = []
        for nm, mo in reversed(PERIODS):
            key = f"{y}-{nm}"; rs = per.get(key, [])
            c = {"p": key, "mo": mo, "n": len(rs)}
            if rs:
                byc = defaultdict(float)
                for x in rs: byc[x["cy"]] += x["fx"]
                c.update({"k": sum(x["k"] for x in rs), "usd": byc.get("USD") or None, "eur": byc.get("EUR") or None,
                          "src": " · ".join(f"{s} {n}" for s, n in Counter(x["src"] for x in rs).most_common()),
                          "ev": f"{sum(1 for x in rs if '증빙' in x['src'])}/{len(rs)}",
                          "files": " · ".join(dict.fromkeys(m.group(1) for x in rs for m in idre.finditer(x["ev"]))),
                          "st": "증빙 있음" if all("증빙" in x["src"] for x in rs) else "일부 증빙 없음"})
                if (y, nm) == (int(last[:4]), period_of(last)[5:]) and lm % 3: c["st"] = "진행 중"
            else:
                c["st"] = "자료 없음"
            if key in PN: c["nt"] = PN[key]
            rc = RC.get(key)
            if rc:
                c["rs"] = rc.get("st")
                for k_ in ("bs", "rk", "dk", "du", "de"):
                    if rc.get(k_) is not None: c[k_] = rc[k_]
                if rc.get("nt"): c["rn"] = rc["nt"]
            if key > period_of(last) and not rs:
                c["st"] = "신고 전"; c.setdefault("nt", "아직 신고 전 — 그 사이 입금은 '수익 (현금기준)' 쪽")
            r = {"c": {k: v for k, v in c.items() if v not in (None, "")}}
            if rs: r["x"] = [{"h": f"입금 {len(rs)}건 — 관련 LP·수수료율은 대시보드 엑셀 약정내역", "cols": XC, "rows": [{k: x.get(k, "") for k in XK} for x in sorted(rs, key=lambda z: z["d"])]}]
            if c["st"] in ("자료 없음",): r["st"] = "bad"
            prs.append(r)
        psecs.append({"h": f"{y}년", "s": f"{sum(len(per.get(f'{y}-{nm}', [])) for nm, _ in PERIODS)}건", "rows": prs})
    allp = [f"{y}-{nm}" for y in range(years[0], cur_y + 1) for nm, _ in PERIODS]
    allp = allp[:allp.index(period_of(last)) + 1]                      # 원장 마지막 입금이 든 기간까지(그 뒤는 신고 전)
    empt = [p for p in allp if not per.get(p)]
    RT = {"대사 완료": "ok", "대사 불가": "warn", "자료 없음": "bad", "해당 없음": "muted", "진행 중": "muted"}
    rdone = sum(1 for p in allp if RC.get(p, {}).get("st") == "대사 완료")
    v5 = [{"t": "kpis", "id": "k", "items": [
        kpi("신고기간", len(allp) - len(empt), "n0", f"/{len(allp)}개", f"{allp[0]} ~ {allp[-1]} 중 원장 건이 있는 기간"),
        kpi("건 없는 기간", len(empt), "n0", "개", " · ".join(empt) or "없음", tone="warn" if empt else None),
        kpi("증빙 대조", ev_n, "n0", f"/{len(R)}건", "회계부 총괄표·엑셀만 있는 건 제외"),
    ] + ([kpi("신고 대사", rdone, "n0", f"/{len(allp)}개", "회계부 총괄표·엑셀 신고자료와 원화·외화 대조 — 차이는 '대사 비고'", tone="ok" if rdone else None)] if RC else [])},
          {"t": "table", "id": "per", "title": "부가세 영세율 신고기간별", "sub": "1기 예정 1~3월 · 1기 확정 4~6월 · 2기 예정 7~9월 · 2기 확정 10~12월 · 단위 원 · 눌러서 그 기간 입금 건(관련 LP·수수료율) 보기",
           "cols": [col("p", "신고기간"), col("mo", "입금월"), col("st", "상태", "tag", tone={"증빙 있음": "ok", "일부 증빙 없음": "info", "자료 없음": "bad", "신고 전": "muted", "진행 중": "muted"}),
                    col("n", "건수", "n0"), col("k", "원화 합계", "won", sum=1), col("usd", "USD", "usd2"), col("eur", "EUR", "m2"),
                    col("ev", "증빙 있는 건"), col("src", "자료 구성", d=1), col("files", "원본 파일(업로드 ID)", d=1), col("nt", "비고", d=1)]
                   + ([col("rs", "대사", "tag", tone=RT), col("dk", "원화 차이", "won"), col("du", "USD 차이", "m2", d=1), col("de", "EUR 차이", "m2", d=1),
                       col("rk", "대사 기준 원화", "won", d=1), col("bs", "대사 기준", d=1), col("rn", "대사 비고", d=1)] if RC else []),
           "card": {"title": "p", "amt": "k", "sub": ["mo"], "chips": ["st"] + (["rs"] if RC else []), "meta": ["n", "ev"]},
           "secs": psecs},
          {"t": "notes", "id": "nt", "items": [
              "자료 구성: 회계부 = 회계부 영세율 총괄표(전 부서 자료에서 우리 부서 행만), 엑셀 = 부서 영세율 신고자료 엑셀, 증빙 = 입금결의서·송금명세·SWIFT·인보이스 PDF.",
              "원본 파일 이름이 깨진 업로드는 업로드 ID 앞 8자리로 적었다(출처 칸의 'p12' = 그 파일 12쪽)."] + N.get("periodNotes", [])}]
    sheets.append({"name": "영세율 신고기간별 대사", "short": "신고기간별 대사", "view": v5})

    # ── 6. 확인 필요·정정 ─────────────────────────────────────────────────────
    CK = [
        ("확인 필요", lambda x: "[확인 필요]" in x["nt"]),
        ("추정 값", lambda x: "[추정]" in x["nt"] or "추정" in x["ty"] or re.search(r"추정\)?", x["nt"]) and "[확인 완료]" not in x["nt"]),
        ("증빙 미확인·미첨부", lambda x: "미확인" in x["ty"] or "미첨부" in x["ty"] or x["src"] == "회계부"),
        ("인보이스 매칭 애매", lambda x: "?" in x["inv"] or "또는" in x["inv"] or "?" in x["bs"]),
        ("회계부 신고액과 다른 건", lambda x: x["acc"] is not None),
        ("정정·분리 (회계부 총괄표·이전 원장 표기 바로잡음)", lambda x: re.search(r"\[(정정|분리|확인 완료)\]", x["nt"])),
    ]
    csecs = []
    for h_, fn in CK:
        rs = [x for x in R if fn(x)]
        if not rs: continue
        rr = []
        for x in rs:
            c = {k: x[k] for k in ("d", "fd", "gp", "cy", "fx", "k", "nt", "inv", "ev", "pr", "no", "lp", "cam", "crt") if x.get(k) not in (None, "")}
            if x["acc"] is not None: c.update({"acc": x["acc"], "df": x["k"] - x["acc"]})
            rr.append({"c": c, **({"x": [cmx_table(x["cms"])]} if x["cms"] else {})})
        sub = f"{len(rs)}건"
        if h_.startswith("회계부"): sub += f" · 차이 합계 {sum(x['k'] - x['acc'] for x in rs):+,}원"
        csecs.append({"h": h_, "s": sub, "rows": rr})
    v6 = [{"t": "kpis", "id": "k", "items": [kpi(s["h"].split(" (")[0], len(s["rows"]), "n0", "건", s["s"].split(" · ", 1)[1] if " · " in s["s"] else None,
                                                tone="warn" if i < 4 else None) for i, s in enumerate(csecs)]},
          {"t": "table", "id": "chk", "title": "확인 필요·정정 내역", "sub": "한 건이 여러 묶음에 들어갈 수 있음 · 단위 원",
           "cols": [col("d", "입금일", "date"), col("fd", "펀드·내용"), col("gp", "운용사·거래처"), col("fx", "외화", "amt2"), col("k", "원화(결의금액)", "won"),
                    col("acc", "회계부 신고 원화", "won"), col("df", "차이", "won"), col("nt", "내용 (원장 비고)"),
                    col("lp", "관련 LP", d=1), col("cam", "약정금액", d=1), col("crt", "수수료율", d=1),
                    col("inv", "인보이스", d=1), col("pr", "신고기간", d=1), col("ev", "출처", d=1), col("no", "원장 NO", "int", d=1)],
           "card": {"title": "fd", "amt": "k", "sub": ["gp", "d"], "wide": "nt"},
           "secs": csecs},
          {"t": "notes", "id": "nt", "items": N.get("checkNotes", []) + ["끊긴 정기 수수료는 '정기수수료 연도별' 쪽의 '끊김'·'올해 아직 없음' 묶음."]}]
    sheets.append({"name": "수수료 원장 확인 필요", "short": "확인 필요·정정", "view": v6})

    # ── 7. 크로스체크 (앱메모 xcheck — 기관명·금액이 있어 코드에 두지 않음) ─────────────────
    XC = N.get("xcheck")
    if XC:
        SCH, KP, IV = XC.get("sched", []), XC.get("kpi", []), XC.get("inv", [])
        CMXL, HIXL, HST = XC.get("cmx", []), XC.get("hix", []), XC.get("hist") or {}
        VT = {"확인 필요": "warn", "정리": "muted", "진행 중": "info", "완료": "ok"}
        vc = Counter(s["v"] for s in SCH)
        kv = lambda k: "일치" if str(k.get("v", "")).startswith("일치") else "차이"
        kc = Counter(kv(k) for k in KP)
        cc = Counter(z["v"] for z in CMXL + HIXL)
        c_ok = sum(v for k, v in cc.items() if k.startswith("일치")); c_ip = sum(v for k, v in cc.items() if k in ("청구 예정·진행 중", "일부 입금", "정리"))
        hs = HST.get("stat") or {}
        v7 = [{"t": "kpis", "id": "k", "items": [
            kpi("분할 일정 대조", len(SCH), "n0", "건", " · ".join(f"{k} {vc[k]}" for k in VT if vc.get(k)), tone="warn" if vc.get("확인 필요") else None)]
            + ([kpi("약정내역 대조", len(CMXL) + len(HIXL), "n0", "펀드", f"일치 {c_ok} · 진행 중·분할·정리 {c_ip} · 확인 {len(CMXL) + len(HIXL) - c_ok - c_ip}",
                    tone="warn" if len(CMXL) + len(HIXL) - c_ok - c_ip else None)] if CMXL or HIXL else [])
            + ([kpi("약정내역(KPI) 대조", len(KP), "n0", "건", f"일치 {kc['일치']} · 차이 {kc['차이']}", tone="warn" if kc.get("차이") else None)] if KP else [])
            + ([kpi("수익 이력 대조", HST.get("n_l", 0) - len(HST.get("only_l", [])), "n0", f"/{HST.get('n_l', 0)}건",
                    f"원장에만 {len(HST.get('only_l', []))} · 수익 이력에만 {len(HST.get('only_h', []))} · 금액 크게 다름 {hs.get('금액 차이(큼)', 0)}",
                    tone="warn" if HST.get("only_l") or HST.get("only_h") else None)] if HST else [])
            + [
            kpi("인보이스 빈 번호", sum(i.get("mc", 0) for i in IV if i.get("ms")), "n0", "개", "원장(입금)에 없는 번호 — 원화 청구·취소·미수 확인"),
        ]}]
        secs7 = []
        for vk in VT:
            rs = [s for s in SCH if s.get("v") == vk]
            if not rs: continue
            rows7 = []
            for s in rs:
                c = dict(s, n=f"{s.get('n')}회", g=f"{s.get('g')}회")
                rows7.append({"c": {k: v for k, v in c.items() if v not in (None, "")}})
            secs7.append({"h": vk, "s": f"{len(rs)}건", "rows": rows7})
        v7.append({"t": "table", "id": "sch", "title": "계약·인보이스 분할 일정 대조",
                   "sub": "인보이스의 총액·분할 횟수로 받을 금액을 세우고 원장 입금과 맞춤 · 금액은 청구 기준(송금수수료 차감 전) · 눌러서 계약 근거·입금일·메모",
                   "cols": [col("v", "판단", "tag", tone=VT), col("nm", "펀드 · LP"), col("cy", "통화", "tag"), col("tt", "총액", "m2"), col("n", "분할"),
                            col("g", "받은 횟수"), col("ga", "받은 금액", "m2"), col("gp", "총액 − 받은 금액", "m2"),
                            col("bs", "계약 근거", d=1), col("ds", "입금일", d=1), col("mm", "메모", d=1)],
                   "card": {"title": "nm", "sub": ["bs"], "chips": ["v", "cy"], "meta": ["g", "gp"]}, "secs": secs7})
        if CMXL or HIXL:
            VTX = {"일치": "ok", "일치(통화 다름)": "ok", "일치(기관 표기 다름)": "ok", "일치(송금인 표기 다름)": "ok", "일치(약정 행 기준)": "ok",
                   "청구 예정·진행 중": "muted", "일부 입금": "info", "정리": "muted"}
            def zrow(z):
                c = {"v": z.get("v"), "fd": z.get("ab") or "(펀드 미기재)", "gp": z.get("gp"), "sh": z.get("sh"), "am": z.get("am"), "nlp": z.get("nlp"),
                     "rt": z.get("rt") or z.get("fe"), "ex": z.get("ex"), "rc": z.get("rc") or z.get("pa"), "df": z.get("df"), "gr": z.get("gr"), "ds": z.get("ds"),
                     "yr": z.get("yr"), "nt": z.get("nt")}
                r_ = {"c": {k: v for k, v in c.items() if v not in (None, "")}}
                if z.get("lps"):
                    r_["x"] = [{"h": f"기관별 약정 {len(z['lps'])}행 — 대시보드 엑셀 약정내역", "cols": CMC,
                                "rows": [{"lp": q.get("lp", ""), "fd": z.get("ab", ""), "yr": str(q.get("yr") or ""), "am": q.get("am", ""), "rt": q.get("rt", ""),
                                          "fee": q.get("fee", ""), "st": q.get("st", "")} for q in z["lps"]]}]
                if not str(z.get("v", "")).startswith("일치") and z.get("v") not in VTX: r_["st"] = "bad"
                return r_
            ORDX = lambda z: (0 if not str(z.get("v")).startswith("일치") and z.get("v") not in VTX else (1 if z.get("v") in ("청구 예정·진행 중", "일부 입금", "정리") else 2), z.get("gp") or "", z.get("ab") or "")
            secsx = []
            if CMXL: secsx.append({"h": "약정내역(2022~현재)", "s": f"{len(CMXL)}개 펀드 · 수수료 = 약정 × 율(EUR은 EUR)", "rows": [zrow(z) for z in sorted(CMXL, key=ORDX)]})
            if HIXL: secsx.append({"h": "약정내역(2010~2021)", "s": f"{len(HIXL)}개 펀드 · 보수 조건·잔여 보수 글자와 원장 판매분·정기분", "rows": [zrow(z) for z in sorted(HIXL, key=ORDX)]})
            v7.append({"t": "table", "id": "cmx", "title": "약정내역 ↔ 원장 (펀드별)",
                       "sub": "대시보드 엑셀 약정내역의 기관별 약정·수수료율·수수료와 원장 입금 합계 · 빨간 줄 = 확인(원장이 많음·적음·약정내역 수수료 칸 없음·보수 조건과 다름) · 눌러서 기관별 약정 행",
                       "filters": ["v", "sh"],
                       "cols": [col("v", "판정", "tag", tone=VTX), col("fd", "펀드(약칭)"), col("gp", "운용사"), col("am", "약정 합계"), col("ex", "약정내역 수수료"),
                                col("rc", "원장 입금(판매분)"), col("df", "원장 − 약정내역"), col("nt", "대조 메모"), col("nlp", "기관 수", "n0", d=1), col("rt", "수수료율·보수 조건", d=1),
                                col("gr", "원장 정기분(연도별)", d=1), col("ds", "입금일", d=1), col("yr", "약정연도", d=1), col("sh", "약정 시트", d=1)],
                       "card": {"title": "fd", "sub": ["gp", "am"], "chips": ["v"], "meta": ["ex", "rc"], "wide": "nt"}, "secs": secsx})
        if HST:
            hrows = []
            for b in sorted(HST.get("big", []), key=lambda b: -abs(b.get("df", 0))):
                hrows.append({"c": {"t": "금액 크게 다름" if b.get("v") == "금액 차이(큼)" else "금액 다름", "d": b["ld"], "fd": b["fd"], "fx": f"{b['cy']} {b['fx']:,.2f}",
                                    "lk": b["lk"], "hk": b["hk"], "df": b["df"], "hd": b["hd"], "nt": b.get("nt") or None}, **({"st": "bad"} if b.get("v") == "금액 차이(큼)" else {})})
            for z in HST.get("only_l", []):
                hrows.append({"c": {"t": "원장에만", "d": z["d"], "fd": z["fd"], "fx": f"{z['cy']} {z['fx']:,.2f}", "lk": z["k"], "nt": z.get("nt") or None}, **({"st": "bad"} if z["k"] > 1e7 else {})})
            for z in HST.get("only_h", []):
                hrows.append({"c": {"t": "수익 이력에만", "fd": z["fd"] + (f" ({z['i']})" if z.get("i") else ""), "hk": z["k"], "hd": z["d"] + (f" → {z['dp']}" if z.get("dp") else ""),
                                    "nt": z.get("nt") or None}, **({"st": "bad"} if z["k"] > 1e7 else {})})
            for z in HST.get("fx_left", []):
                hrows.append({"c": {"t": "환차손익 짝 없음", "fd": z["fd"], "hk": z["k"], "hd": z["d"] + (f" → {z['dp']}" if z.get("dp") else ""), "nt": z.get("nt") or None}})
            for z in HST.get("date", []):
                hrows.append({"c": {"t": "일자만 다름", "d": z["ld"], "fd": z["fd"], "lk": z["lk"], "hk": z["lk"], "df": 0, "hd": z["hd"]}})
            hs_txt = " · ".join(f"{k} {v}" for k, v in sorted(hs.items(), key=lambda kv: -kv[1]))
            v7.append({"t": "table", "id": "hst", "title": "대시보드 수익 이력(현금기준 2018~2025) ↔ 원장",
                       "sub": f"원장 {HST.get('n_l', 0)}건 · 수익 이력 입금 {HST.get('n_h', 0)}건 + 환차손익 {HST.get('n_fx', 0)}건 · 짝: {hs_txt} · 아래는 짝이 없거나 금액·일자가 다른 것 · 수익 이력 = 부서 배분 전 합계",
                       "filters": ["t"],
                       "cols": [col("t", "구분", "tag", tone={"금액 크게 다름": "warn", "원장에만": "warn", "수익 이력에만": "warn", "금액 다름": "info", "환차손익 짝 없음": "info", "일자만 다름": "muted"}),
                                col("d", "원장 입금일", "date"), col("fd", "펀드·내용"), col("lk", "원장 원화", "won"), col("hk", "수익 이력 원화", "won"), col("df", "차이", "won"),
                                col("hd", "수익 이력 일자"), col("nt", "내용"), col("fx", "외화", d=1)],
                       "card": {"title": "fd", "sub": ["d", "hd"], "chips": ["t"], "meta": ["lk", "hk", "df"], "wide": "nt"}, "rows": hrows})
        if KP:
            v7.append({"t": "table", "id": "kp", "title": "약정내역(부서 KPI 제출 약정) ↔ 원장 산정근거", "sub": "차이 건은 대시보드 엑셀 「약정내역」 금액 확인 — 수수료는 인보이스 기준으로 받음",
                       "cols": [col("vs", "판단", "tag", tone={"일치": "ok", "차이": "warn"}), col("fd", "펀드"), col("lp", "LP"), col("kp", "KPI 제출 약정"),
                                col("iv", "원장(인보이스) 약정"), col("v", "내용", d=1)],
                       "card": {"title": "fd", "sub": ["lp"], "chips": ["vs"], "meta": ["kp", "iv"]},
                       "rows": [{"c": {k: v for k, v in dict(k, vs=kv(k)).items() if v not in (None, "")}} for k in KP]})
        if IV:
            v7.append({"t": "table", "id": "inv", "title": "인보이스 번호 — 원장(입금)에 없는 번호", "sub": "원화 청구·취소·미수(미입금) 중 무엇인지 부서 인보이스 대장에서 확인", "compact": True,
                       "cols": [col("y", "연도"), col("n", "원장 번호 수", "n0"), col("mx", "최대 번호", "n0"), col("ms", "원장에 없는 번호"), col("nt", "메모", d=1)],
                       "rows": [{"c": {k: (str(v) if k == "y" else v) for k, v in i.items() if v not in (None, "")}} for i in IV]})
        dup = [f"{d['no']}: {d['ds']}" for d in XC.get("dup", [])]
        v7.append({"t": "notes", "id": "nt", "items": XC.get("plan", []) + XC.get("other", []) + (["같은 인보이스 번호로 다른 날 입금: " + " / ".join(dup)] if dup else [])})
        sheets.append({"name": "수수료 원장 크로스체크", "short": "크로스체크", "view": v7})

    for s in sheets:
        s.update(group=GROUP, asofl=f"원장 {first} ~ {last}", cols=[], rows=[], rh=[], hs=0, hdr=0)
    return {"kind": "fees", "v": 1, "generatedAt": gen, "source": source, "asof": last, "range": [first, last],
            "n": len(R), "krw": tot, "dash": dsrc, "sheets": sheets,
            "src": {"rows": rows, "notes": N, "name": source}}, R


def check(rows):
    """--from 으로 읽은 행도 CSV 와 같은 검증(NO·기간·외화×환율=원화)"""
    import io
    buf = io.StringIO(); w = csv.DictWriter(buf, fieldnames=COLS + OPT, extrasaction="ignore"); w.writeheader(); w.writerows(rows)
    tmp = "/tmp/_fees_from.csv"
    open(tmp, "w", encoding="utf-8-sig").write(buf.getvalue())
    return load(tmp)


def main():
    args = sys.argv[1:]
    notes, DX, dsrc, prev = None, None, None, None
    if "--notes" in args:
        i = args.index("--notes"); notes = json.load(open(args[i + 1], encoding="utf-8")); del args[i:i + 2]
    if "--dash" in args:
        i = args.index("--dash"); DX, ds, da = dash_commit(args[i + 1]); dsrc = f"{ds} · {da} 기준" if ds else None; del args[i:i + 2]
    if "--from" in args:
        i = args.index("--from"); prev = json.load(open(args[i + 1], encoding="utf-8")); del args[i:i + 2]
    if prev:
        if len(args) != 1 or "src" not in prev: sys.exit("--from <이전 fees.json(src 포함)> <새 fees.json> [--dash dash.json]")
        out = args[0]; rows = check(prev["src"]["rows"]); name = prev["src"]["name"]; notes = notes or prev["src"].get("notes")
    else:
        if len(args) != 2: sys.exit(__doc__)
        src, out = args
        rows = load(src)
        name = re.sub(r"^.*/", "", src)
    D, R = build(rows, name, notes, DX, dsrc)
    json.dump(D, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    yrs = Counter()
    for x in R: yrs[x["y"]] += x["k"]
    print(f"fees.json → {out}  {D['n']}건 · {D['range'][0]} ~ {D['range'][1]} · 원화 {D['krw']:,}원 · 쪽 {len(D['sheets'])}개")
    print("  연도별 " + " · ".join(f"{y} {v / 1e8:,.2f}억" for y, v in sorted(yrs.items())))
    gp = Counter(x["gp"] for x in R)
    print(f"  운용사·거래처 {len(gp)}곳 · 분류 " + " · ".join(f"{c} {sum(1 for x in R if x['cl'] == c)}" for c in CAT_ORDER))
    fb = sorted({x["gp"] for x in R if not any(rx.search(x["fd"]) or rx.search(x["pay"]) for rx, _ in GP_RX)})
    if fb: print("  규칙 밖(송금인 이름 그대로): " + " · ".join(fb))
    lk = [x for x in R if x["cms"]]
    if lk or DX:
        miss = sum(1 for x in R if "못 찾은 연결" in x["cnt"])
        print(f"  약정 연결 {len(lk)}/{len(R)}건 · 대시보드 약정내역 {'있음 — ' + dsrc if dsrc else '없음(CSV 값)'}" + (f" · 대시보드에서 못 찾은 행 {miss}건" if miss else ""))


if __name__ == "__main__":
    main()
