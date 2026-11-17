# 운용보고서 탭 — 데이터 형식과 작성 원칙

국내 재간접·멀티에셋 펀드(당부서 판매·관리 펀드)의 **운용보고서를 LP 관점으로 표준화**해 보여준다.
데이터는 암호문 `reports.enc.json` 하나(미팅노트와 같은 비밀번호·salt). 평문(운용보고서 PDF·펀드별 JSON·reports.json)은 스크래치패드에만.

## 갱신 순서 ("운용보고서 업데이트해줘" + PDF)
1. 지금 데이터 풀기: `node scripts/vault.mjs decrypt reports.enc.json <SP>/reports.json` → 펀드별로 나눠 `<SP>/reports-src/<id>.json`
   (`python3 -c` 등으로 `funds[]` 를 파일 하나씩. 새 펀드는 새 파일, 같은 펀드의 새 분기는 **같은 id 를 새 기준일 내용으로 바꾸고** 이전 수치는 이슈자산 `history`·`derived` 에 남긴다)
2. PDF 를 읽어 아래 형식으로 채운다. 표·차트가 그림인 쪽은 쪽 이미지를 보고 읽는다.
3. `node scripts/reports_build.mjs <SP>/reports-src <SP>/reports.json` — 오류(필수 칸·level·trend 값)는 고치고, 경고는 확인
4. `node scripts/vault.mjs encrypt <SP>/reports.json reports.enc.json --salt-from data.enc.json`
5. `git status` 로 reports.enc.json 만 → 커밋(`reports: 운용보고서 MM/DD 기준 …`, 펀드명·수치 쓰지 말 것) → push. 평문 삭제.
6. 사용자에게 **기준일 불일치·가정·수치 확인 사항을 먼저** 알리고, 바뀐 이슈자산(수준·추이)을 짧게.

## 원칙
- 숫자·고유명사·영문 용어는 보고서 그대로. 계산한 값은 끝에 `(산출)`, 계산식은 `derived`.
- **기준일을 늘 함께**: 국내 기준일(`asOf`)과 역외·편입자산 기준일이 다르면 `asOfNote` 에 모두. 다른 자료(GP 리포트 등)로 보강했으면 그 기준일도.
- 보고서에 없는 칸은 `null`(화면에 '미기재') — 추정해서 채우지 않는다. 빠진 공시는 `gaps`, 보고서 안 수치가 서로 안 맞으면 `checks`.
- **이슈자산(`issues`) vs 펀드 단위 이슈(`flags`)**: 특정 자산·차주 한 건이면 issues, 포트폴리오 전체·차입·환헤지·환매·공시 수준이면 flags.
- 수준 `level`: high(손상·Non-accrual·MOIC<1.0x 큰 폭·구조조정 진행) / mid(실적 Plan 하회 지속·평가 급변·워치리스트 상위) / low(참고·GP 워치리스트 단순 편입).
  추이 `trend`: 악화·신규·유지·개선·비교불가(직전 기준일 대비 자산 실적·평가 방향). **분석 판단이며 GP 공식 등급이 아니다**(화면에 명시).
- `gp` = 보고서·GP 자료에 적힌 대응(없으면 null → '보고서상 GP 코멘트 없음'), `question` = LP 가 운용사에 확인할 질문(①②③).
- EQT 'Net Debt vs Plan': Above Plan = 계획보다 차입 10% 이상 적음(양호), Below Plan = 10% 이상 많음 — 라벨을 반대로 읽지 않게 괄호로 풀어 쓴다.
- 운용사·GP 자료에 Confidential 표기가 있어도 내부 앱(암호화)에는 요약을 둔다. 원문 문장·그림을 그대로 옮기지 않는다.

## 형식 (`reports-src/<id>.json`, id = 파일 이름: 영문 소문자·숫자·-)
```
{ "order": 1, "short": "약칭(12자 안팎)", "manager": "국내 운용사", "underlying": "피투자펀드 약칭 | 멀티에셋 N건",
  "fundName": "정식 펀드명", "structure": "feeder|multi", "asOf": "YYYY-MM-DD", "period": "3Q26", "asOfNote": "기준일 차이 설명|null",
  "fileName": "원본 PDF 이름|null", "updatedAt": "YYYY-MM-DD",
  "A": {off, gp, structure, strategy, target, incept, maturity},          // 식별
  "B": {commit, called, deploy, unfunded, recovered},                      // 약정·소진·회수
  "C": {nav, dnav, irr, tvpi, moic, dpi, dist, tnr},                       // 성과
  "D": {cos, firstlien, floating, lev, ebitda, cover, yield, sector},      // 포트폴리오 건전성
  "E": {na, wl}, "F": {redeem}, "G": {issue, resolution}, "H": {hedge, fwd},
  "I": {offFee, domFee}, "J": {person, lpa, org},                           // 부실·유동성·이슈·환헤지·보수·거버넌스
  "holdings": [{name, type, size, terms, asOf, level: ok|watch|concern, status}],   // 편입자산(멀티에셋·자산 카드가 있는 재간접)
  "nonaccrual": [{name, ind, principal, fv, pct, note}],
  "watchlist": [{name, ind, principal, pct, rating: 3|4|5|null, tag}],              // GP 공시 그대로(등급 없으면 null → 'W')
  "issues": [{asset, type: [..], level, trend, exposure, asOf, summary, metrics: [..], history: [{d, t}], gp, question, related}],
  "flags": [{level, title, target, detail, response, question}],
  "gaps": [..], "checks": [..], "derived": [..] }
```
- `issues` 가 비어 있으면 화면이 nonaccrual(중간)·watchlist(참고)·holdings 의 watch/concern 에서 기본값으로 채운다. 명시한 issues 가 있으면 holdings 는 안 옮긴다.
- 펀드를 가로질러 **같은 자산은 한 줄**(이름을 소문자·기호 제거·끝의 Inc/LLC/Ltd/Corp 제거로 맞춤) — 여러 펀드면 '공통'. 같은 차주는 펀드마다 같은 표기로.
- 화면: 맨 위 펀드 줄(전체 | 펀드 하나씩). 전체 = 요약(지표 카드·먼저 볼 것·펀드 카드·주요 이슈자산) / 이슈자산(펀드별 묶음 기본·수준순, 수준·추이·펀드 필터, GP 공시 원장) / 비교표(PC 표, 휴대폰 A~J 접이식) / 공시·확인.
  펀드 하나 = 그 펀드 한 쪽: 부실·Watchlist 줄(E.na·E.wl + Non-accrual·이슈 수준 건수) → 핵심 지표 → 이슈자산 → 펀드 이슈 → 편입자산 → GP 공시 → A~J → 공시 누락·확인, 바로가기 줄·이전/다음 펀드.
- `E.na` 는 '부실자산 있나?'에 한 줄로 답하게: 있으면 건수·자산, 없으면 '없음 — 근거'(Equity 펀드는 원가 하회 자산 수 등).
- 점검용 가상 데이터: `tests/reports-fixture.json`(가상만).
