"""외화 수수료 원장(CSV) → 앱 대시보드 탭의 '수수료 원장' 묶음(쪽 6개) 데이터.

원장은 claude.ai Project 'Back Office 업무연동'의 문서 `claude/외화수수료_원장_2017-2026.csv`
(대화 '수수료 내역 증빙 자료'에서 부가세 영세율 신고자료·회계부 총괄표·입금결의서·송금명세·인보이스를 대조해 만든 것).
이 스크립트는 원장 글자·숫자를 고치지 않고 묶고 더하기만 한다(분류·운용사 묶음은 아래 규칙으로 붙이는 화면용 칸).

  python3 scripts/fees_build.py <원장.csv> <SP>/fees.json [--notes <원장 메모.json>]
  node scripts/vault.mjs encrypt <SP>/fees.json fees.enc.json --salt-from data.enc.json

출력 형식(kind "fees"): dash.json 과 같은 시트 객체 목록. 앱(dash.js)이 대시보드 데이터를 열 때 fees.enc.json 도 열어
'실적·KPI' 묶음 바로 뒤에 '수수료 원장' 묶음으로 붙인다(대시보드 엑셀 매일 갱신과 따로 — 엑셀을 다시 뽑아도 사라지지 않음).
블록 형식은 scripts/dash_views.py 머리 주석과 같다.

--notes: 화면에 덧붙일 설명(공개 저장소라 기관명·금액이 든 설명은 코드에 두지 않고 이 파일로 넘긴다 — Project 문서
`claude/외화수수료_원장_앱메모.json`). 형식: {"period": {"2019-2기 예정": "…"}, "periodNotes": [...], "checkNotes": [...], "summaryNotes": [...],
  "recon": {"2019-2기 예정": {"st": "대사 완료", "nt": "…", "bs": "회계부 총괄표", "rk": 원, "ru": USD, "re": EUR, "dk": 원 차이, "du": USD 차이, "de": EUR 차이}},
  "xcheck": {"sched": [{v, nm, bs, cy, tt, n, g, ga, gp, ds, mm}], "kpi": [{fd, lp, kp, iv, v}], "inv": [{y, n, mx, ms, mc, nt}], "dup": [{no, ds}], "plan": [...], "other": [...]}}
  recon 이 있으면 '신고기간별 대사' 쪽에 대사 상태·차이 칸, xcheck 가 있으면 '크로스체크' 쪽(7번째)을 붙인다. 둘 다 없으면 예전처럼 6쪽.
"""
import csv, datetime, json, re, sys
from collections import Counter, defaultdict

GROUP = "수수료 원장"
COLS = ["NO", "연도", "기간", "입금(결의)일", "부서(당시)", "구분", "펀드·내용", "거래처(송금인)", "통화", "외화금액(결의·신고)",
        "원화금액(결의금액)", "적용환율", "실입금 외화(차이 시)", "인보이스 No.", "산정근거·LP", "출처", "자료", "비고",
        "회계부 신고 원화(차이 시)", "정기수수료 그룹"]

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


def build(rows, source, notes=None):
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
        R.append(x)
    first, last = R[0]["d"], max(x["d"] for x in R)
    years = sorted({x["y"] for x in R})
    tot = sum(x["k"] for x in R)
    by_cy = defaultdict(float)
    for x in R: by_cy[x["cy"]] += x["fx"]
    gen = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime("%Y-%m-%d %H:%M")

    def lrow(x):  # 입금 원장 한 줄(칸 이름은 아래 LCOLS)
        c = {k: x[k] for k in ("no", "d", "pr", "cl", "ty", "fd", "gp", "cy", "fx", "rt", "k", "inv", "bs", "pay", "net", "dp", "src", "ev", "nt", "acc", "gr")
             if x.get(k) not in (None, "")}
        c["rt"], c["y"] = round(x["rt"], 2), str(x["y"])
        out = {"c": c}
        if re.search(r"\[(확인 필요|추정)\]", x["nt"]) or "미확인" in x["ty"]: out["st"] = "bad"
        return out

    LCOLS = [col("d", "입금일", "date"), col("fd", "펀드·내용"), col("gp", "운용사·거래처"), col("fx", "외화", "amt2", sumc=1),
             col("k", "원화(결의금액)", "won", sum=1), col("ty", "보수 유형", "tag"), col("cl", "분류", "tag", tone=CAT_TONE),
             col("rt", "적용환율", "n2", d=1), col("pr", "신고기간", d=1), col("y", "연도", d=1),
             col("inv", "인보이스", d=1), col("bs", "산정근거·LP", d=1), col("pay", "송금인(원장 표기)", d=1),
             col("net", "실입금 외화(차이 시)", "amt2", d=1), col("dp", "부서(당시)", d=1), col("src", "자료", d=1),
             col("ev", "출처(파일·쪽)", d=1), col("nt", "비고", d=1), col("acc", "회계부 신고 원화(차이 시)", "won", d=1),
             col("gr", "정기수수료 그룹", d=1), col("no", "원장 NO", "int", d=1)]
    CARD = {"title": "fd", "sub": ["gp"], "amt": "k", "meta": ["d", "fx"], "chips": ["cl", "ty"]}

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
    ]}]
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
    v2 = [{"t": "table", "id": "led", "title": "입금 원장", "sub": "최근 입금부터 · 단위 원 · 눌러서 인보이스·산정근거·출처(증빙 쪽)·비고 보기 · 빨간 줄 = 추정·미확인",
           "cols": LCOLS, "secs": secs, "secsum": 1, "card": CARD,
           "filters": ["y", "cl", "cy", "gp", "ty", "pr", "src"]}]
    sheets.append({"name": f"외화 수수료 입금 원장 ({years[0]}~)", "short": "입금 원장", "view": v2})

    # ── 3. 운용사별 ─────────────────────────────────────────────────────────
    XC = [col("d", "입금일", "date"), col("ty", "보수 유형"), col("fd", "펀드·내용"), col("fx", "외화", "amt2"), col("k", "원화", "won")]
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
        grows.append({"c": {k: v for k, v in c.items() if v not in (None, "")},
                      "x": [{"h": f"입금 {len(rs)}건", "cols": XC, "rows": [{k: x[k] for k in ("d", "ty", "fd", "fx", "k", "cy")} for x in reversed(rs)]}]})
    v3 = [{"t": "table", "id": "gps", "title": "운용사·거래처별", "sub": f"{len(grows)}곳 · 원화 많은 순 · 눌러서 입금 건 전체 보기 · 단위 원",
           "filters": ["cl"],
           "cols": [col("gp", "운용사·거래처"), col("cl", "주 분류", "tag", tone=CAT_TONE), col("n", "건수", "n0"), col("k", "원화 합계", "won", sum=1),
                    col("fx", "외화 합계"), col("fd", "첫 입금", "date"), col("ld", "마지막 입금", "date"), col("ty", "보수 유형", d=1),
                    col("rg", "정기수수료 그룹", d=1), col("fds", "펀드·내용", d=1)]
                   + [col(f"y{y}", f"{y}년", "won", d=1) for y in reversed(years)],
           "card": {"title": "gp", "amt": "k", "sub": ["fx"], "meta": ["n", "ld"], "chips": ["cl"]},
           "rows": grows}]
    sheets.append({"name": "외화 수수료 운용사별", "short": "운용사별", "view": v3})

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
        c = {"g": g, "st": s, "cy": cys.most_common(1)[0][0], "n": len(rs), "fd": rs[0]["d"], "ld": rs[-1]["d"],
             "mo": "·".join(f"{m}월" for m, _ in sorted(months.items(), key=lambda z: (-z[1], z[0]))[:3]),
             "k": sum(x["k"] for x in rs), "gp": rs[0]["gp"]}
        if len(cys) > 1: c["cy"] = "/".join(cys)
        for y in years:
            v = sum(x["fx"] for x in rs if x["y"] == y)
            if v: c[f"y{y}"] = round(v, 2)
        bys[s].append({"c": c, "st": "bad" if s in ("끊김",) else None,
                       "x": [{"h": f"입금 {len(rs)}건", "cols": XC, "rows": [{k: x[k] for k in ("d", "ty", "fd", "fx", "k", "cy")} for x in reversed(rs)]}]})
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
           "cols": [col("g", "정기수수료 그룹"), col("st", "상태", "tag", tone=TONE4), col("cy", "통화", "tag")]
                   + [col(f"y{y}", str(y), "m2", d=(1 if y < years[-1] - 6 else None)) for y in years]
                   + [col("ld", "마지막 입금", "date"), col("mo", "주로 들어온 달", d=1), col("n", "횟수", "n0", d=1), col("k", "원화 누적", "won", d=1),
                      col("fd", "첫 입금", "date", d=1), col("gp", "운용사", d=1)],
           "card": {"title": "g", "sub": ["ld", "mo"], "chips": ["st", "cy"], "stats": [f"y{y}" for y in years[-4:]]},
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
          {"t": "table", "id": "per", "title": "부가세 영세율 신고기간별", "sub": "1기 예정 1~3월 · 1기 확정 4~6월 · 2기 예정 7~9월 · 2기 확정 10~12월 · 단위 원",
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
            c = {k: x[k] for k in ("d", "fd", "gp", "cy", "fx", "k", "nt", "inv", "ev", "pr", "no") if x.get(k) not in (None, "")}
            if x["acc"] is not None: c.update({"acc": x["acc"], "df": x["k"] - x["acc"]})
            rr.append({"c": c})
        sub = f"{len(rs)}건"
        if h_.startswith("회계부"): sub += f" · 차이 합계 {sum(x['k'] - x['acc'] for x in rs):+,}원"
        csecs.append({"h": h_, "s": sub, "rows": rr})
    v6 = [{"t": "kpis", "id": "k", "items": [kpi(s["h"].split(" (")[0], len(s["rows"]), "n0", "건", s["s"].split(" · ", 1)[1] if " · " in s["s"] else None,
                                                tone="warn" if i < 4 else None) for i, s in enumerate(csecs)]},
          {"t": "table", "id": "chk", "title": "확인 필요·정정 내역", "sub": "한 건이 여러 묶음에 들어갈 수 있음 · 단위 원",
           "cols": [col("d", "입금일", "date"), col("fd", "펀드·내용"), col("gp", "운용사·거래처"), col("fx", "외화", "amt2"), col("k", "원화(결의금액)", "won"),
                    col("acc", "회계부 신고 원화", "won"), col("df", "차이", "won"), col("nt", "내용 (원장 비고)"),
                    col("inv", "인보이스", d=1), col("pr", "신고기간", d=1), col("ev", "출처", d=1), col("no", "원장 NO", "int", d=1)],
           "card": {"title": "fd", "amt": "k", "sub": ["gp", "d"], "wide": "nt"},
           "secs": csecs},
          {"t": "notes", "id": "nt", "items": N.get("checkNotes", []) + ["끊긴 정기 수수료는 '정기수수료 연도별' 쪽의 '끊김'·'올해 아직 없음' 묶음."]}]
    sheets.append({"name": "수수료 원장 확인 필요", "short": "확인 필요·정정", "view": v6})

    # ── 7. 크로스체크 (앱메모 xcheck — 기관명·금액이 있어 코드에 두지 않음) ─────────────────
    XC = N.get("xcheck")
    if XC:
        SCH, KP, IV = XC.get("sched", []), XC.get("kpi", []), XC.get("inv", [])
        VT = {"확인 필요": "warn", "정리": "muted", "진행 중": "info", "완료": "ok"}
        vc = Counter(s["v"] for s in SCH)
        kv = lambda k: "일치" if str(k.get("v", "")).startswith("일치") else "차이"
        kc = Counter(kv(k) for k in KP)
        v7 = [{"t": "kpis", "id": "k", "items": [
            kpi("분할 일정 대조", len(SCH), "n0", "건", " · ".join(f"{k} {vc[k]}" for k in VT if vc.get(k)), tone="warn" if vc.get("확인 필요") else None),
            kpi("약정내역(KPI) 대조", len(KP), "n0", "건", f"일치 {kc['일치']} · 차이 {kc['차이']}", tone="warn" if kc.get("차이") else None),
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
            "n": len(R), "krw": tot, "sheets": sheets}, R


def main():
    args = sys.argv[1:]
    notes = None
    if "--notes" in args:
        i = args.index("--notes"); notes = json.load(open(args[i + 1], encoding="utf-8")); del args[i:i + 2]
    if len(args) != 2: sys.exit(__doc__)
    src, out = args
    rows = load(src)
    name = re.sub(r"^.*/", "", src)
    D, R = build(rows, name, notes)
    json.dump(D, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    yrs = Counter()
    for x in R: yrs[x["y"]] += x["k"]
    print(f"fees.json → {out}  {D['n']}건 · {D['range'][0]} ~ {D['range'][1]} · 원화 {D['krw']:,}원 · 쪽 {len(D['sheets'])}개")
    print("  연도별 " + " · ".join(f"{y} {v / 1e8:,.2f}억" for y, v in sorted(yrs.items())))
    gp = Counter(x["gp"] for x in R)
    print(f"  운용사·거래처 {len(gp)}곳 · 분류 " + " · ".join(f"{c} {sum(1 for x in R if x['cl'] == c)}" for c in CAT_ORDER))
    fb = sorted({x["gp"] for x in R if not any(rx.search(x["fd"]) or rx.search(x["pay"]) for rx, _ in GP_RX)})
    if fb: print("  규칙 밖(송금인 이름 그대로): " + " · ".join(fb))


if __name__ == "__main__":
    main()
