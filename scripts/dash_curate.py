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
                (r"월별 실적$", "월별 실적 (발생)"), (r"연도별 CF", "PA Fee 일정")]),
    ("영업 현황", [(r"계약서$", "PA 계약 현황"), (r"마케팅 펀드", "마케팅 펀드"), (r"RFP", "RFP·RFI"), (r"로드쇼", "로드쇼·세미나")]),
    ("약정", [(r"^약정 통계", "약정 현황 (2010~)"), (r"^기관별 약정", "기관별 약정"),
             (r"^약정내역\(2022|^약정내역&수수료$", "약정내역 (2022~)"), (r"^약정내역\(2010", "약정내역 (2010~21)")]),
    ("분석", [(r"국내 LP별", "LP별 수익"), (r"GP별", "GP별 수익"), (r"자산군별", "자산군별 실적")]),
    ("시딩", [(r"시딩 관리판", "시딩 관리판")]),
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
            # 연도별 표는 차트와 같은 값 → 접어 두기, 자산군 × 투자전략은 접기
            for b in _walk(v):
                if b.get("t") == "table" and re.match(r"^연도별|^자산군 × 투자전략", b.get("title", "")):
                    b["fold"] = True; b.setdefault("sub", ""); b["sub"] = (b["sub"] + f" · {len(b.get('rows') or [])}행").strip(" ·")
        if name.startswith("기관별 약정"):
            v = [b for b in v if b.get("t") != "bars"]                                     # 약정 현황의 Top 15 와 같음
    s["view"] = v


def curate(d):
    """dash.json(dict)을 제자리에서 다듬는다."""
    sheets = [s for s in d["sheets"] if not any(re.search(p, s["name"]) for p in HIDE)]
    for s in sheets:
        if s.get("view"):
            s["view"] = _clean_blocks(s["view"])
            _sheet_rules(s)
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
