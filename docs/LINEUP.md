# 라인업 탭 — 데이터 형식과 갱신 순서

해외대체 펀드 라인업 엑셀(`KB_Securities_Offshore_Fund_Line-Up_YYMM.xlsx`, 고객 제공용)의 메인 시트 'Fund Line-up (전체 라인업)'을
휴대폰·PC에서 자산군·모집 상태·검색으로 찾아보는 읽기 전용 화면이다.
데이터는 암호문 `lineup.enc.json` 하나(미팅노트와 같은 비밀번호·salt). 평문(엑셀·lineup.json)은 스크래치패드에만.

## 갱신 순서 ("라인업 업데이트해서 앱에 반영해줘")
1. 엑셀을 먼저 최신화한다(사용자 스킬 `kb-fund-lineup-update`: IM 우선·셀 단위 출처·불확실 값 공란·독립 재검증·맑은 고딕).
   펀드를 고치면 R열 '최종 수정일'도 그날로 바꾼다 — 앱의 '최근 수정' 단추가 이 날짜로 이번에 바뀐 펀드를 고른다.
2. `python3 scripts/lineup_build.py <라인업.xlsx> <SP>/lineup.json`
   — 번호 연속·자산군·상태 값·최종 수정일 형식('YY.MM.DD)·기준일(B3 '기준일: YYYY.MM.DD')을 확인하고 어긋나면 멈춘다.
3. `node scripts/vault.mjs encrypt <SP>/lineup.json lineup.enc.json --salt-from data.enc.json`
4. `git status` 로 lineup.enc.json 만 → 커밋(`lineup: 라인업 MM/DD 기준`, 펀드명·수치 쓰지 말 것) → push. 평문 삭제.

## 형식 (`lineup.json`, kind "lineup")
```
{ "kind": "lineup", "v": 1, "generatedAt": "YYYY-MM-DD HH:MM", "asof": "YYYY-MM-DD", "title": "B2 제목", "source": "엑셀 파일 이름",
  "acs": ["Private Equity", "Private Credit", "Real Estate", "Infrastructure", "Aviation", "Multi-Asset"],   // 펀드가 있는 자산군만, 엑셀 순서
  "notice": ["※ …"],                                                                                      // 표 아래 각주
  "funds": [{ "no", "fund", "note?", "gp", "ac", "type", "strategy", "target", "geo", "structure", "size", "ret",
              "status", "timeline", "overview", "details", "track", "lastmod": "'YY.MM.DD", "lm": "YYYY-MM-DD" }] }
```
- 셀 글자는 그대로(빈 칸은 '-'). 펀드명 셀의 둘째 줄이 '※ …'·'舊 …'이면 `note`, 그 밖의 줄바꿈은 공백으로 이어 붙인다.
- 상태 값: 모집 중 / 상시 모집 / 모집 예정 / 모집 완료 / '-'.

## 화면 (`lineup.js`·`lineup.css`)
- 지표 카드(전체·모집 중·상시 모집·모집 완료, `Dash.blocks`) → 검색(여러 단어 모두 포함, `<mark>` 표시)·상태 선택·'최근 수정'(가장 최근 수정일에서 6일 안 — 지난주 갱신분은 빠짐)
  → 자산군 단추 → 자산군별 목록. PC 는 표 한 줄 = 펀드 하나, 휴대폰은 카드. 누르면 투자유형·대상·지역·구조·개요·비고·주요 실적·수정일이 펼쳐진다.
- 고른 자산군은 이 기기에 기억(`kbnote-lac`). 점검용 가상 데이터: `tests/lineup-fixture.json`(가상만).
