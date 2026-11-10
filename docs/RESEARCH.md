# 리서치 탭 — 리포트 정리 형식과 만드는 법

앱 '리서치' 탭은 구독 리포트(예: Preqin 분기 리포트)를 자산군별로 정리해 보여주고, 자산군마다 A4 1쪽 PDF 를 받을 수 있게 한다.
데이터는 암호문 `research.enc.json` 하나(미팅노트 DB와 같은 비밀번호·salt). 평문(리포트 PDF·요약 JSON·만든 PDF)은 저장소에 두지 않는다.

## 정리 원칙
- **숫자는 리포트 본문에 글자로 나온 것만.** 차트 그림에서 눈대중으로 읽은 값은 쓰지 않는다(차트에 값 표시가 없으면 본문 수치로만 차트를 그린다).
- **리포트 내용과 당부서 해석을 구분한다.** `sections`·`outlook` = 리포트 내용, `insights` = 'KB GIS 시사점'(화면·PDF 에 '당부서의 해석'이라고 표시).
- 문장을 그대로 옮기지 않고 요약한다(구독자 전용 자료). 그림·표를 복제하지 않는다. `notice` 에 내부용·외부 배포 금지를 적는다.
- 시사점에서 전략 수요판을 언급할 때는 날짜를 박지 않는다(화면의 '국내 LP 수요'는 그때그때 다시 센다. PDF 에는 만든 날 기준 집계가 실린다).
- 원문자(①②…)는 PDF 글꼴에 없으니 쓰지 않는다(`1.`·`1)`).

## research.src.json 형식
```json
{ "kind": "research", "v": 1, "title": "Preqin 분기 리포트", "period": "2026년 3분기", "periodKey": "2026Q3",
  "source": "출처 한 줄", "notice": "내부 참고용 … 외부 배포 금지 …",
  "reports": [ {
    "id": "pe", "name": "사모주식", "short": "PE", "en": "Private Equity",      // en 은 PDF 파일 이름에 쓴다(영문만)
    "headline": "한 줄 요약",
    "kpis": [ { "l": "Q3 자금모집", "v": "$219bn", "s": "보조 설명", "tone": "ok|warn" } ],   // 자산군 6개(3×2), 종합 5개
    "charts": [ { "title": "자금모집", "sub": "$bn", "cats": ["Q3 2025", "Q3 2026"], "v": [159, 219], "f": "n0|n1" } ],   // 막대 2~4개, 최대 3개
    "table": { "title": "…", "sub": "…", "cols": ["…"], "rows": [["…"]] },   // 종합 쪽에만
    "sections": [ { "h": "자금모집", "items": ["…"] } ],   // 3~5개
    "outlook": ["리포트의 전망 1~2줄"],
    "insights": ["KB GIS 시사점 3~4줄"],
    "strats": ["PE Buyout", "PE Secondary"]   // 이 자산군에 해당하는 전략 수요판 전략 이름(app.js STRATS). 종합은 []
  } ] }
```
첫 리포트는 `id: "all"`(종합)로 두고, 그 뒤에 자산군을 둔다.

## 만드는 순서 ("리서치 업데이트")
1. 리포트를 읽는다(`pdftotext -layout`). 본문 수치를 정리해 `<SP>/research.src.json` 작성.
2. `node scripts/vault.mjs decrypt data.enc.json <SP>/data.json` (전략 수요판 집계용)
3. Pretendard 글꼴(PDF 용): `cd <SP>/font && npm pack @fontsource/pretendard && tar xzf *.tgz` → `<SP>/font/package/files`
4. `node scripts/research_build.mjs <SP>/research.src.json <SP>/research.json --data <SP>/data.json --font-dir <SP>/font/package/files`
   - 리포트마다 '1쪽 · 글자 배율'이 찍힌다. 한 쪽에 안 들어가면 실패 — 항목을 줄인다. `RESEARCH_KEEP_PDF=<폴더>` 를 주면 PDF 파일도 남겨 눈으로 확인할 수 있다.
5. `node scripts/vault.mjs encrypt <SP>/research.json research.enc.json --salt-from data.enc.json`
6. `git status` 로 `research.enc.json` 만 바뀌었는지 확인 → 커밋(`research: 리서치 YYYY Qn 반영`, 수치·내용 쓰지 말 것) → push. 평문 삭제.

## PDF 받기
- PDF 는 미리 만들어 암호문 안에 base64 로 넣어 둔다(기기·글꼴과 상관없이 같은 A4 1쪽).
- 브라우저(PC·휴대폰): Blob 으로 내려받기. 파일 이름은 영문(`KB_GIS_Research_<분기>_<en>.pdf`) — 한글 이름은 일부 환경에서 `download` 로 바뀐다.
- 안드로이드 앱(WebView): 스스로 내려받지 못하므로 `window.KBApp.savePdf(이름, base64)` 로 앱에 넘겨 '다운로드' 폴더에 저장한다
  (`android/…/MainActivity.java`, 안드로이드 9 이하는 인쇄 화면의 'PDF로 저장'). 이 기능이 없는 옛 APK 에서는 새 버전 설치 안내가 나온다.
