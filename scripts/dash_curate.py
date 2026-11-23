"""대시보드 화면 다듬기 — dash_views.py 가 만든 정리 화면에서 '엑셀 작업 기록'을 빼고 시트 순서·묶음·이름을 정한다.

사용자 요청(2026-11-10): 금감원 보고 여부·시트 간 중복 정리·확인 사항·분류/기관명 통일표 같은 작업 기록은 앱에서 없애고,
의미 있는 화면만 남긴다. 탭(시트 목록)도 읽기 좋게 묶고 이름을 짧게.

dash_extract.py 가 마지막에 curate(data) 를 부른다. 이미 만든 dash.json 에도 그대로 쓸 수 있다(엑셀 없이):
  python3 scripts/dash_curate.py <SP>/dash.json
규칙은 블록 제목·열 이름(정규식)으로 찾으므로, 엑셀 시트가 조금 바뀌어도 그대로 맞는다. 못 찾으면 그냥 지나간다.
"""
import json, re, sys

# 앱 왼쪽 시트 목록: (묶음, [(시트 이름 정규식, 짧은 이름)]) 순서대로. 여기에 없는 시트는 원래 묶음·이름으로 맨 뒤에.
LAYOUT = [
    ("대시보드", [(r"^대시보드\(Demo\)$", "대시보드 시트")]),
    ("실적·KPI", [(r"^KPI 실적 요약$", "KPI 실적 요약"), (r"현금기준 수익$", "수익 (현금기준)"),
                (r"월별 실적$", "월별 실적 (발생)"), (r"연도별 CF", "PA Fee 일정"), (r"^수익 이력", "수익 이력 (2018~)")]),
    ("영업 현황", [(r"계약서$", "PA 계약 현황"), (r"^PA 계약 이력", "PA 계약 이력 (2023~)"), (r"마케팅 펀드", "마케팅 펀드"),
                (r"RFP", "RFP·RFI"), (r"로드쇼", "로드쇼·세미나")]),
    ("약정", [(r"^약정 통계", "약정 현황 (2010~)"), (r"^기관별 약정", "기관별 약정"),
             (r"^약정내역\(2022|^약정내역&수수료$", "약정내역 (2022~)"), (r"^약정내역\(2010", "약정내역 (2010~21)")]),
    ("분석", [(r"국내 LP별", "LP별 수익"), (r"GP별", "GP별 수익"), (r"자산군별", "자산군별 실적")]),
    ("시딩", [(r"시딩 관리판(_금액|$)", "시딩 관리판"), (r"시딩 관리판_기타정보", "시딩 심사부·기타정보")]),
]
# 앱에서 뺄 시트: 검증(요약의 검증 표시로 충분 — 어긋날 때만 보임), KPI보고용(약정내역 2022~ 와 같은 목록 + KPI 실적 요약과 겹침)
HIDE = [r"^검증$", r"^KPI보고용$"]

# 어느 시트에서든 뺄 블록(제목)·열·지표 카드·안내 문장
DROP_BLOCK = re.compile(r"금감원|펀드 상태별|펀드별 분류|^기관명 통일|시트에서 뺀|시트 확인 사항")
DROP_COL = re.compile(r"금감원|^20\d\d~\d* ?(약정 건수|USD 환산)$|^순위$|함께 집계한 표기|상태 근거|근거 출처|원문 기관명|금액 근거|크로스체크|협회 코드|약정 시기\(원문\)")
DROP_KPI = re.compile(r"금감원|미보고|보고 대상 아님|통계와 차이")
DROP_NOTE = re.compile(r"일치해야 함|→ 검증")


def _walk(blocks):
    for b in blocks:
        if b.get("t") == "row": yield from _walk(b["blocks"])
        elif b.get("t") == "tabs":
            for it in b["items"]: yield from _walk(it["blocks"])
        else: yield b


def _drop_cols(b):
    gone = {c["k"] for c in b["cols"] if DROP_COL.search(c["l"])}
    if not gone: return
    b["cols"] = [c for c in b["cols"] if c["k"] not in gone]
    for sec in b.get("secs") or [{"rows": b.get("rows") or []}]:
        for r in sec["rows"]:
            for k in gone: r["c"].pop(k, None)
        for f in sec.get("foot") or []:
            for k in gone: f.get("c", {}).pop(k, None)
    for f in b.get("foot") or []:
        for k in gone: f.get("c", {}).pop(k, None)
    for key in ("filters",):
        if b.get(key): b[key] = [k for k in b[key] if k not in gone]
    cd = b.get("card")
    if cd:
        for k in ("sub", "meta", "chips", "stats"):
            if cd.get(k): cd[k] = [x for x in cd[k] if x not in gone]
        for k in ("title", "amt", "bar", "wide"):
            if cd.get(k) in gone: cd.pop(k)
    so = b.get("sort")
    if (isinstance(so, str) and so in gone) or (isinstance(so, dict) and so.get("k") in gone): b.pop("sort")


def _clean_blocks(blocks):
    out = []
    for b in blocks:
        t = b.get("t")
        if t == "row":
            inner = _clean_blocks(b["blocks"])
            if len(inner) > 1: out.append(dict(b, blocks=inner))
            else: out += inner
            continue
        if t == "tabs":
            for it in b["items"]: it["blocks"] = _clean_blocks(it["blocks"])
            out.append(b); continue
        if b.get("title") and DROP_BLOCK.search(b["title"]): continue
        if t == "kpis":
            b["items"] = [k for k in b["items"] if not DROP_KPI.search(k.get("l", ""))]
            if not b["items"]: continue
        if t == "notes":
            b["items"] = [x for x in b["items"] if not DROP_NOTE.search(x)]
            if not b["items"]: continue
        if t == "table": _drop_cols(b)
        out.append(b)
    return out


def _sheet_rules(s):
    """시트별: 출처·작성 방법 설명(제목 없는 안내 문장)과 겹치는 블록을 빼고, 설명이 긴 부제는 단위만."""
    name, v = s["name"], s.get("view") or []
    if re.match(r"^약정 통계|^기관별 약정|^약정내역\(2010", name):
        v = [b for b in v if not (b.get("t") == "notes" and not b.get("title"))]          # 출처·작성 메모
        for b in _walk(v):
            if b.get("t") == "kpis":
                for k in b["items"]:
                    if re.search(r"20\d\d~\d* \d+ · 20\d\d~|기관명 통일 기준|1건 1행|미배분 공동약정", k.get("s", "")): k.pop("s", None)
            if b.get("t") in ("table", "bars", "col") and b.get("sub", "").startswith("USD M"):
                b["sub"] = "USD M" + (" · PC = Private Debt" if "Private Debt" in b["sub"] else "") + (" · 큰 순" if "큰 순" in b["sub"] or b.get("t") == "bars" else "")
            if b.get("t") == "table" and b.get("title"):
                b["title"] = re.sub(r"\s*\((기관명 통일 집계|2010~2021)\)$", "", b["title"]).replace(" — 2010~현재", " (2010~현재)")
            if b.get("t") == "table" and "상태 근거" in b.get("sub", ""):
                b["sub"] = "약정연도별 · 눌러서 보수 조건·펀드 기간"
            if b.get("t") == "table":
                for sec in b.get("secs") or []:       # 묶음 요약의 '2010~2021 5건 · 2022~현재 15건'(출처 시트별 건수)
                    if isinstance(sec.get("s"), str): sec["s"] = re.sub(r"\s*·\s*20\d\d~(20\d\d|현재) \d+건", "", sec["s"])
                for f in b.get("foot") or []:          # '총계 (= 약정 통계 1번 합계)' → '총계'
                    if f.get("l"): f["l"] = re.sub(r"\s*\(=[^)]*\)", "", f["l"])
            # 연도별 약정 차트: 출처 시트(2010~2021/2022~현재)로 나눈 두 계열 → 한 계열
            if b.get("t") == "col" and len(b.get("series") or []) == 2 and all(re.match(r"^20\d\d~", x["n"]) for x in b["series"]):
                a, c = b["series"]
                b["series"] = [{"n": "약정", "v": [(x or 0) + (y or 0) for x, y in zip(a["v"], c["v"])]}]
                b.pop("stack", None)
        if name.startswith("약정 통계"):
            # 연도별 표(USD·억원 함께)는 펼쳐서 연도별 약정 차트 바로 아래로, 자산군 × 투자전략은 접기
            for b in _walk(v):
                if b.get("t") == "table" and re.match(r"^자산군 × 투자전략", b.get("title", "")) and not b.get("fold"):
                    b["fold"] = True; b["sub"] = (b.get("sub", "") + f" · {len(b.get('rows') or [])}행").strip(" ·")
            yt = next((b for b in v if b.get("t") == "table" and re.match(r"^연도별", b.get("title", ""))), None)
            ci = next((i for i, b in enumerate(v) if b.get("t") == "col"), None)
            if yt is not None:
                # 표 안의 작업 기록 줄: 설명 문장, 값이 0인 '차이' 줄. 연도 없는 약정은 합계가 맞도록 '연도 미기재'로 남김
                k0, keep = yt["cols"][0]["k"], []
                for r in yt.get("rows") or []:
                    first = str(r["c"].get(k0, ""))
                    if re.search(r"=|차이", first) and not any(isinstance(x, (int, float)) and x for x in r["c"].values()): continue
                    if first.startswith("연도 칸 미기재"): r["c"][k0] = "연도 미기재"
                    keep.append(r)
                yt["rows"] = keep
            if yt is not None and ci is not None:
                yt.pop("fold", None); yt["sub"] = re.sub(r"\s*·\s*\d+행$", "", yt.get("sub", ""))
                v = [b for b in v if b is not yt]
                v.insert(ci + 1, yt)
        if name.startswith("기관별 약정"):
            v = [b for b in v if b.get("t") != "bars"]                                     # 약정 현황의 Top 15 와 같음
    s["view"] = v


# ── 억원 함께 표기(사용자 요청 2026-11-10) ───────────────────────────────
# 달러 금액(약정·발생 수수료 등)에 단위 표시 cu 를 붙이면 앱(dash.js)이 기준일 매매기준율(fx.usd)로 억원을 함께 보여준다.
#   cu: "M" = USD 백만(USD M), "K" = USD 천, "1" = USD. 이미 원·억원인 값과 시점별 환율을 따로 쓰는 시트(KPI 실적 요약·시딩)는 제외.
KRW_SKIP = re.compile(r"^KPI 실적 요약$|시딩")
NOT_AMOUNT = re.compile(r"건수|수$|비중|bp|율|횟수|^No$|개수|순위")


def _col_unit(c, sub, title=""):
    f, l = c.get("f"), c.get("l", "")
    if f in ("usd", "usd2", "usdk"): return "1"
    if f not in ("n0", "n1", "n2", "n3") or NOT_AMOUNT.search(l): return None
    if re.search(r"\(USD M\)", title): return "M"                      # '자산군별 약정금액(USD M)' 처럼 제목에 단위
    if sub.startswith("USD M") and re.search(r"USD|환산|약정", l): return "M"
    if re.search(r"약정\s*:\s*USD M", sub) and l == "약정": return "M"
    if re.search(r"\(USD\)|USD 기준|USD 환산", l): return "1"
    return None


def _krw_text(s, fx):
    """'USD 5,519,460' · 'USD 19,731.9M' · 'EUR 1,093.0M' 뒤에 '(≈ N억)'."""
    def rep(m):
        rate = (fx or {}).get(m.group(1).lower())
        if not rate: return m.group(0)
        e = float(m.group(2).replace(",", "")) * (1e6 if m.group(3) else 1) * rate / 1e8
        return f"{m.group(1)} {m.group(2)}{m.group(3)} (≈ {e:,.2f}억)"          # 이미 붙은 '(≈ …억)'은 새로 계산해 바꾼다(두 번 돌려도 같게)
    return re.sub(r"\b(USD|EUR) (\d[\d,]*(?:\.\d+)?)(M?)(?![\d,.])(?: \(≈ [\d,.]+억\))?", rep, s)


def _mark_krw(d):
    fx = d.get("fx") or {}
    for s in d["sheets"]:
        if KRW_SKIP.search(s["name"]): continue
        for b in _walk(s.get("view") or []):
            t, sub = b.get("t"), b.get("sub") or ""
            if t == "kpis":
                for k in b["items"]:
                    if isinstance(k.get("v"), (int, float)) and k.get("u") in ("USD M", "USD천"): k["cu"] = "M" if k["u"] == "USD M" else "K"
                    if k.get("s"): k["s"] = _krw_text(k["s"], fx)
            elif t in ("bars", "col"):
                if b.get("f") == "usdk": b["cu"] = "1"
                elif sub.startswith("USD M"): b["cu"] = "M"
                elif sub.startswith("USD천"): b["cu"] = "K"
            elif t == "table":
                for c in b["cols"]:
                    u = _col_unit(c, sub, b.get("title") or "")
                    if u: c["cu"] = u


# ── 해외대체 시딩: 약정 = 심사 승인금액(사용자 확인 2026-11-10) ─────────────────
# 시트 맨 오른쪽 '약정금액(외화)·(원화환산)' 열은 6개 펀드에서 심사 승인금액과 달라(원화로 승인받은 펀드를 USD 로 적는 등),
# 앱의 약정은 심사 승인금액으로 계산한다. 원화 승인은 그대로, USD·EUR 승인은 기준일 매매기준율(fx)로 원화 환산.
# 바꾸는 곳: 시딩 관리판(지표 카드·펀드별 현황·자산군별 요약), 요약의 '해외대체 시딩 현황'.
def _seed_by_approval(d):
    fx = {k.upper(): v for k, v in (d.get("fx") or {}).items() if isinstance(v, (int, float))}
    seed = next((s for s in d["sheets"] if re.search(r"시딩 관리판(_금액|$)", s["name"])), None)
    t = seed and next((b for b in _walk(seed.get("view") or []) if b.get("t") == "table" and b.get("id") == "sd"), None)
    if not t: return
    by, n = {}, 0
    for r in t["rows"]:
        c = r["c"]; ap, cur = c.get("ap"), str(c.get("apc") or "KRW").strip().upper()
        rate = 1 if cur in ("KRW", "원", "₩") else fx.get(cur)
        if not isinstance(ap, (int, float)) or not rate: continue        # 승인금액이 없으면 시트 값 그대로
        c["ck"] = ap * rate
        c.pop("cf", None)
        if cur in ("KRW", "원", "₩"): c.pop("cfx", None)
        else: c["cfx"] = f"{cur} {ap:,.2f}"
        a = c.get("ac") or "기타"; by.setdefault(a, [0, 0.0]); by[a][0] += 1; by[a][1] += c["ck"]; n += 1
    if not n: return
    for x in t["cols"]:
        if x["k"] == "cfx": x["l"] = "승인(외화)"
    if "심사 승인" not in t.get("sub", ""): t["sub"] = "약정 = 심사 승인금액(외화 승인은 기준일 환율로 원화 환산) · " + t.get("sub", "")
    tot = sum(v[1] for v in by.values()); dr = sum(r["c"].get("dr") or 0 for r in t["rows"])
    for b in _walk(seed["view"]):
        if b.get("t") == "kpis":
            for k in b["items"]:
                if k.get("l", "").startswith("약정금액"): k.update(v=tot / 1e8, s="심사 승인금액 기준")
                if k.get("l") == "누적 인출" and tot: k["s"] = f"소진율 {dr / tot:.1%}"
        if b.get("t") == "table" and b.get("id") == "sm":                 # 자산군별 요약(원)
            ka, kn, kv = b["cols"][0]["k"], b["cols"][1]["k"], b["cols"][-1]["k"]
            for r in b.get("rows") or []:
                if r["c"].get(ka) in by: r["c"][kn], r["c"][kv] = by[r["c"][ka]][0], by[r["c"][ka]][1]
            for f in b.get("foot") or []: f["c"][kv] = tot
    demo = next((s for s in d["sheets"] if s["name"] == "대시보드(Demo)"), None)
    for b in _walk((demo or {}).get("view") or []):
        if b.get("t") == "table" and str(b.get("title", "")).startswith("해외대체 시딩"):   # 요약 표(억원)
            ka, kn, kv = b["cols"][0]["k"], b["cols"][1]["k"], b["cols"][-1]["k"]
            for r in b.get("rows") or []:
                if r["c"].get(ka) in by: r["c"][kn], r["c"][kv] = by[r["c"][ka]][0], by[r["c"][ka]][1] / 1e8
            for f in b.get("foot") or []: f["c"][kv] = tot / 1e8
            if "심사 승인" not in b.get("sub", ""): b["sub"] = (b.get("sub", "") + " · 심사 승인금액 기준").strip(" ·")


# ── 금액은 소수점 둘째 자리까지(사용자 요청 2026-11-13: Fee·약정금액 등) ─────────────
# 수수료·약정·수익·NAV 같은 금액 칸의 표시 형식을 2자리로 바꾼다. 건수·비율·원(₩) 단위 금액(소수 없음)은 그대로.
#   usd → usd2, usdk → usdk2, amt → amt2, eok1 → eok, 금액인 n0·n1·n2 → m2 (app dash.js 의 fmt 형식, 금액이 0 이면 '-')
F2 = {"usd": "usd2", "usdk": "usdk2", "amt": "amt2", "eok1": "eok"}
MONEY_LABEL = re.compile(r"약정|수수료|Fee|금액|Cash|발생|판매|투자금액|NAV|분배|인출|수익|USD|EUR|억|조원|mil|^Q\d$|^\d{1,2}월$|총합")
NOT_MONEY = re.compile(r"KRW|원\)|부외부채|건수|횟수|개수|^No$|순위|비중|율$")
MONEY_UNIT = re.compile(r"^(USD M|USD천|USD|EUR M|억원|조원)$")


def _f2(f, money):
    if f in F2: return F2[f]
    if money and f in ("n0", "n1", "n2"): return "m2"          # 0 은 '-'(사용자 요청 2026-11-15: 판매(mil) 0.00 → -)
    return f


def _money_decimals(d):
    for s in d["sheets"]:
        for b in _walk(s.get("view") or []):
            t = b.get("t")
            if t == "table":
                for c in b["cols"]:
                    l = c.get("l", "")
                    money = bool(c.get("cu")) or l == "Fee(bp)" or (MONEY_LABEL.search(l) and not NOT_MONEY.search(l))
                    c["f"] = _f2(c.get("f"), money)
            elif t == "kpis":
                for k in b["items"]:
                    if isinstance(k.get("v"), (int, float)) and k.get("f"):
                        k["f"] = _f2(k["f"], bool(k.get("cu")) or bool(MONEY_UNIT.match(str(k.get("u") or ""))))
            elif t in ("bars", "col") and b.get("f"):
                b["f"] = _f2(b["f"], bool(b.get("cu")) or bool(re.match(r"(USD|억원|조원)", b.get("sub") or "")))


# ── 기관별 약정금액·수수료는 항상 보이게(사용자 요청 2026-11-17) ─────────────────
# '약정내역(2022~)'(표 cm): '전체'에서도 총약정금액과 수수료 합계(2022~, 연도별 f{YYYY} 합)를 보인다(연도를 고르면 그 해 USD 환산·수수료·수수료율).
# '기관별 약정'(표 og): 약정 행마다 수수료 합계(cm 의 같은 펀드·운용사·기관 표기 행을 더함), 기관 묶음 머리에 약정·수수료 합계.
# '약정 현황'의 기관별 표: 기관마다 수수료 합계 열. '약정내역(2010~21)'(표 hi): 보수 조건을 펼치지 않아도 보이게.
# 기관 표기는 괄호 밖·안을 각각 맞춘다(KPOST ↔ KPOST(보험과)) — 앱 기관 상세(app.js dzOf)와 같은 규칙. 두 번 돌려도 같다.
FEE_L = "수수료 합계(USD, 2022~)"

def _nk(x): return re.sub(r"\s+", "", str(x if x is not None else "")).lower()
def _keys(x):
    x = str(x if x is not None else "").strip(); k = [_nk(x)]
    m = re.match(r"^(.+?)\s*\(([^)]+)\)$", x)
    if m: k += [_nk(m.group(1)), _nk(m.group(2))]
    return {y for y in k if y}

def _keys_lp(x):
    """약정내역의 기관 표기: 괄호 밖·안 + 부서·계정 꼬리를 뗀 이름('KB증권 PI' → KB증권, '삼성증권PI' → 삼성증권, 3글자 이상만)."""
    k = _keys(x); x = str(x if x is not None else "").strip()
    for y in (x.split()[0] if x.split() else "", re.sub(r"[A-Z]{2,}$", "", x)):
        if len(_nk(y)) >= 3: k.add(_nk(y))
    return k

def _table(d, tid=None, title=None, sheet=None):
    for s in d["sheets"]:
        if sheet and not re.search(sheet, s["name"]): continue
        for b in _walk(s.get("view") or []):
            if b.get("t") == "table" and (tid is None or b.get("id") == tid) and (title is None or re.search(title, b.get("title") or "")): return b
    return None

def _add_col(b, col, after):
    b["cols"] = [c for c in b["cols"] if c["k"] != col["k"]]
    i = next((n + 1 for n, c in enumerate(b["cols"]) if c["k"] == after), len(b["cols"]))
    b["cols"].insert(i, col)

def _cm_by_fund(cm):
    """약정내역(2022~)을 펀드(약칭+운용사)별 묶음으로(사용자 요청 2026-11-17: 각 펀드별로 나열·펀드별 합계).
    묶음 순서 = 엑셀에서 그 펀드가 처음 나온 순서, 묶음 안은 엑셀 순서. 합계 줄은 앱이 보이는 행으로 그때그때 계산(secsum)."""
    rows = cm.pop("rows", None) or [r for sec in cm.get("secs") or [] for r in sec["rows"]]
    secs, by = [], {}
    for r in rows:
        c = r["c"]; k = (_nk(c.get("ab") or c.get("fn")), _nk(c.get("gp")))
        if k not in by:
            ab = c.get("ab") or c.get("fn") or "(펀드 미기재)"
            sub = " · ".join(str(x) for x in (c.get("gp"), c.get("fn") if c.get("fn") and _nk(c.get("fn")) != _nk(ab) else None) if x)
            by[k] = {"h": str(ab), "s": sub, "rows": []}; secs.append(by[k])
        by[k]["rows"].append(r)
    cm["secs"], cm["secsum"] = secs, 1
    for c in cm["cols"]:
        if c["k"] == "am": c["sumc"] = 1                                   # 총약정금액은 통화별로 더한다

def _org_fees(d):
    cm = _table(d, "cm")
    if not cm: return
    _cm_by_fund(cm)
    cmrows = [r for sec in cm["secs"] for r in sec["rows"]]
    fy = [c["k"] for c in cm["cols"] if re.match(r"^f\d{4}$", c["k"])]
    fee = lambda c: sum(v for v in (c.get(k) for k in fy) if isinstance(v, (int, float)))
    for c in cm["cols"]:
        if c["k"] == "am": c.pop("d", None)                               # 총약정금액(통화 함께)은 늘 보인다
    for r in cmrows:
        r["c"]["ft"] = fee(r["c"])                                        # 없으면 0 → 앱에 '-'(빈칸 대신)
    _add_col(cm, {"k": "ft", "l": FEE_L, "f": "usd", "sum": 1}, "am")
    if cm.get("pick") and isinstance(cm["pick"].get("cols"), dict): cm["pick"]["cols"]["전체"] = ["ft"]
    for f in cm.get("foot") or []:
        f["c"].pop("ft", None); t = fee(f["c"])
        if t: f["c"]["ft"] = t
    cm["sub"] = "펀드별 묶음·합계 · 전체 = 총약정금액·수수료 합계(2022~) · 연도를 고르면 그 해 USD 환산·수수료·수수료율"
    rows = [(r["c"], _keys(r["c"].get("lp")), fee(r["c"])) for r in cmrows]
    rows2 = [(x, _keys_lp(x.get("lp")), f) for x, _, f in rows]   # 바로 안 맞을 때만 쓰는 넓힌 표기

    og = _table(d, "og")
    if og:
        # 기관별 약정 행 ↔ 약정내역 행(2022~ cm · 2010~21 hi): 같은 펀드·운용사, 기관 표기는 바로 맞는 것 먼저 그다음 넓힌 표기.
        # 붙은 행으로 수수료 합계(fe)·수수료 상태(fs = cm 상태: 수취완료·진행중·청구예정 등)·원장 연결 키(r.lk — 수수료 원장 '약정 연결'과 같은 꼴,
        # 앱 dash.js linkLedger 가 원장 입금을 붙인다. 사용자 요청 2026-11-19: 기관별 약정에서도 fee 를 받았는지)
        hi = _table(d, "hi")
        hrows = [r["c"] for sec in (hi.get("secs") or [{"rows": hi.get("rows") or []}]) for r in sec["rows"]] if hi else []
        H1 = [(c, _keys(c.get("lp")), 0) for c in hrows]; H2 = [(c, _keys_lp(c.get("lp")), 0) for c in hrows]
        ckey = lambda t, c: "|".join([t, c.get("gp") or "", str(c.get("ab") or "").replace("\n", " "), c.get("lp") or ""])
        used, hused, tot = set(), set(), 0
        for sec in og.get("secs") or []:
            lk = _keys(re.sub(r"^\d+\.\s*", "", str(sec.get("h") or "")))
            st = 0
            att = {id(r): [] for r in sec["rows"]}
            for r in sec["rows"]:
                r["c"]["fe"] = 0; r["c"].pop("fs", None); r.pop("lk", None)
            for t, pairs, us in (("cm", (rows, rows2), used), ("hi", (H1, H2), hused)):
                for R in pairs:
                    for r in sec["rows"]:
                        c = r["c"]
                        for i, (x, k, f) in enumerate(R):
                            if i in us or _nk(x.get("ab")) != _nk(c.get("ab")) or _nk(x.get("gp")) != _nk(c.get("gp")) or not (k & lk): continue
                            us.add(i); att[id(r)].append((t, x, f))
            for r in sec["rows"]:
                c, a = r["c"], att[id(r)]
                v = sum(f for t, x, f in a if t == "cm" and f)
                if v: c["fe"] = v; st += v
                fs = list(dict.fromkeys(str(x.get("st")) for t, x, f in a if t == "cm" and x.get("st")))
                if fs: c["fs"] = " · ".join(fs)
                if a: r["lk"] = [ckey(t, x) for t, x, f in a]
            tot += st
            sv = re.sub(r" · 수수료 USD [\d,.]+(?: \(≈ [\d,.]+억\))?", "", str(sec.get("s") or ""))
            sec["s"] = (sv + (f" · 수수료 USD {st:,.2f}" if st else "")).strip(" ·")
        _add_col(og, {"k": "fe", "l": FEE_L, "f": "usd", "sum": 1}, "us")
        _add_col(og, {"k": "fs", "l": "수수료 상태", "f": "tag", "tone": {"수취완료": "ok", "진행중": "info", "청구예정·확인중": "warn"}}, "fe")
        for f in og.get("foot") or []:
            f["c"].pop("fe", None)
        if og.get("foot") and tot: og["foot"][0]["c"]["fe"] = tot
        cd = og.get("card")
        if cd and "fe" not in (cd.get("meta") or []): cd["meta"] = list(cd.get("meta") or []) + ["fe"]
        if cd and "fs" not in (cd.get("chips") or []): cd["chips"] = ["fs"] + list(cd.get("chips") or [])
        miss = sum(f for i, (x, k, f) in enumerate(rows) if f and i not in used and not any(i2 in used and x2 is x for i2, (x2, _, _) in enumerate(rows2)))
        if miss: og["notes"] = [n for n in (og.get("notes") or []) if not n.startswith("수수료 합계는")] + [
            f"수수료 합계는 약정내역(2022~)의 같은 펀드·운용사·기관 행을 더한 값. 약정 목록에 없는 건(진행·청구예정 등) 수수료 USD {miss:,.2f}는 약정내역(2022~)에서."]

    st5 = _table(d, None, r"^기관별", r"^약정 통계")
    if st5:
        kc = st5["cols"][0]["k"]; ak = next((c["k"] for c in st5["cols"] if re.search(r"USD|환산", c.get("l", ""))), None)
        for r in st5.get("rows") or []:
            c = r["c"]; c.pop("FE", None); lk = _keys(c.get(kc))
            v = sum(f for x, k, f in rows2 if f and (k & lk))
            c["FE"] = v
        _add_col(st5, {"k": "FE", "l": FEE_L, "f": "usd", "sum": 1}, ak or kc)
        cd = st5.get("card")
        if cd and "FE" not in (cd.get("meta") or []): cd["meta"] = list(cd.get("meta") or []) + ["FE"]

    hi = _table(d, "hi")
    if hi:
        for c in hi["cols"]:
            if c["k"] == "fe": c.pop("d", None)                           # 보수 조건(2010~21 은 금액 대신 조건 글)
        if any(c["k"] == "fe" for c in hi["cols"]) and hi.get("card") and not hi["card"].get("wide"): hi["card"]["wide"] = "fe"   # 휴대폰 카드에도 한 줄 전체로

def _compact_demo(d):
    """요약 쪽을 PC 에서 덜 넓게(사용자 요청 2026-11-23: '압축해서'): 혼자 한 줄을 다 차지하던
    '연도별 자산군별 수익' 차트와 'Hedge Fund 시딩손익' 표를 한 줄에 나란히."""
    demo = next((s for s in d["sheets"] if s["name"] == "대시보드(Demo)"), None)
    v = (demo or {}).get("view") or []
    ia = next((i for i, b in enumerate(v) if b.get("t") == "col" and b.get("id") == "asset"), None)
    ih = next((i for i, b in enumerate(v) if b.get("t") == "table" and b.get("id") == "hf"), None)
    if ia is None or ih is None: return
    hf = v.pop(ih); ia = next(i for i, b in enumerate(v) if b.get("id") == "asset")
    v[ia] = {"t": "row", "blocks": [v[ia], hf]}


def curate(d):
    """dash.json(dict)을 제자리에서 다듬는다. 두 번 돌려도 결과가 같다."""
    sheets = [s for s in d["sheets"] if not any(re.search(p, s["name"]) for p in HIDE)]
    for s in sheets:
        if s.get("view"):
            s["view"] = _clean_blocks(s["view"])
            _sheet_rules(s)
    d["sheets"] = sheets
    _seed_by_approval(d)
    _org_fees(d)
    _mark_krw(d)
    _money_decimals(d)
    _compact_demo(d)
    ordered, used = [], set()
    for grp, items in LAYOUT:
        for pat, short in items:
            for s in sheets:
                if id(s) not in used and re.search(pat, s["name"]):
                    s["group"], s["short"] = grp, short
                    ordered.append(s); used.add(id(s))
    ordered += [s for s in sheets if id(s) not in used]
    d["sheets"] = ordered
    d["curated"] = 1
    return d


if __name__ == "__main__":
    p = sys.argv[1]
    d = json.load(open(p, encoding="utf-8"))
    curate(d)
    json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    for s in d["sheets"]:
        print(f"  [{s['group']}] {s['short']}  ←  {s['name']} · 블록 {len(s.get('view') or [])}")
