# KB-GIS-Meeting-Note — Claude 작업 메모

KB GIS Meeting Note: 글로벌상품영업부 LP·GP 미팅노트 DB 앱. 공개 저장소 + GitHub Pages(main 브랜치 루트, 빌드 없음).
**데이터 원본은 이 저장소의 암호문 `data.enc.json`** 이다(2026-10-30 claude.ai 아티팩트 DB에서 옮겨 온 뒤로 아티팩트는 쓰지 않음).
**DB는 2026년 미팅만 담는다(사용자 요청).** 2026-11-02 카톡 원문(2025-11-28~2026-10-27)으로 기존 미팅 223건에 `raw`(원문)를
붙였다(정리본은 그대로, `legacyBody`). 2025-12 원문은 넣지 않는다. 아티팩트에서 직접 입력한 4건(10/20·21·28·29)은 카톡 원문이 없다.
카톡 직급 약어: TJ=팀장, BJ=부장, CJ=차장, GJ=과장(검색 `SYN`에도 있음).
앱 탭(2026-11-10 순서): 미팅노트·대시보드(엑셀 대시보드, `dash.enc.json`)·기관·인물·조직도·전략 수요판·리서치(구독 리포트 정리, `research.enc.json`).
자매 앱: KB GIS Market(`oneedong/KB-GIS-App`).

## 절대 규칙
- 평문 데이터(복호화한 data.json, patch.json, 사용자가 준 미팅노트 원문 txt 등)는 저장소 밖(스크래치패드)에만 두고 커밋하지 않는다.
  저장소에 들어가는 데이터는 암호문 `data.enc.json`·`dash.enc.json`·`research.enc.json` 셋뿐. 커밋 전 `git status`로 확인.
  (`.gitignore`·CI 가 data/dash/patch/posts/research .json·txt·eml·zip·엑셀·csv·pdf 를 막는다. 사용자가 준 리포트 PDF 도 평문이다)
- 비밀번호를 파일·커밋·코드·로그·커밋 메시지에 남기지 않는다. 환경변수 `MEETING_DB_PASSWORD`로만 넘긴다
  (환경 설정에 있으면 그대로, 없으면 사용자에게 묻는다).
- `tests/fixture.json`·`tests/dash-fixture.json`·`tests/research-fixture.json`은 가상 데이터만.
- **원문은 그대로, 앞에는 요약정리(사용자 요청).** 원문 메시지는 `raw`에 한 글자도 고치지 않고(앱 '원문' 탭).
  `body`는 먼저 보이는 요약정리 — 기존 미팅처럼 섹션으로 나눈 요약(2026-11-05부터 새 미팅도). 원문에 없는 사실·숫자·해석 금지,
  숫자·고유명사·영문 용어는 원문 그대로. 화면은 요약정리를 섹션 순서대로 보여주고 강조를 덧붙이지 않는다.

## "미팅노트 업데이트해줘" (사용자가 txt 파일·텍스트를 줌)
1. `node scripts/vault.mjs decrypt data.enc.json <SP>/data.json` (`<SP>` = 스크래치패드)
2. `docs/CONVERT.md`를 읽는다. `<SP>/data.json`의 `ref.convertSpec`은 기관 약칭표·게시자 표기·이름 충돌 참고용
   (요약정리 형식은 CONVERT.md 가 우선).
   카톡 내보내기(txt)면 먼저 `node scripts/kakao.mjs <txt> <SP>/data.json <SP>/posts.json --from 2026-01-01` — 게시물로 묶고 이미 DB 원문에 있는 것은
   `in-db`로 표시한다. `new-note?`만 검토(대화·행정·파일은 뺀다). 이어 보낸 메시지는 이미 한 게시물로 묶여 있다.
3. 텍스트를 레코드로 바꿔 `<SP>/patch.json` 작성(`meetings`·`people`·`orgs`, 고칠 땐 기존 id 그대로). 미팅마다 `raw`에 원문 그대로,
   `body`는 섹션 요약정리. 여러 메시지로 나눠 올린 한 미팅(1/4~4/4)은 한 레코드로.
   이미 DB에 있는 미팅(같은 날·같은 기관)인지 먼저 확인 — 카톡 내보내기는 이전 내용과 겹치는 경우가 많다.
4. `node scripts/upsert.mjs <SP>/data.json <SP>/patch.json --dry-run` → 오류·경고 확인 → `--dry-run` 빼고 실행
   ("요약정리에 원문에 없는 숫자" 오류는 숫자를 원문대로 고쳐서 해결. `--allow-edits`는 사용자가 직접 고쳐 달라고 한 때만)
5. `node scripts/vault.mjs encrypt <SP>/data.json data.enc.json` (같은 비밀번호면 salt 유지 → 휴대폰 재입력 없음)
6. `git add data.enc.json` → 커밋(`data: 미팅노트 N건 추가 (MM/DD 기관…)`, 내용 요약에 민감정보 쓰지 말 것) → push
7. 사용자에게 추가·수정 목록과 flags(이름 확인·날짜 확인·원문 잘림)를 알려준다. 평문 파일 삭제.

## "대시보드 업데이트" (대시보드 엑셀 xlsm 을 고칠 때마다 같이)
앱 '대시보드' 탭 = 엑셀의 보이는 시트 전부. 시트마다 '정리 화면'(지표 카드·차트·표/카드 목록, 사용자 요청: 엑셀 디자인 그대로가 아니라
읽기 좋게)과 '엑셀 원본'(서식 그대로 격자)을 오간다. '요약' = 대시보드(Demo) 시트의 정리 화면. 데이터는 암호문 `dash.enc.json` 하나.
1. 엑셀은 최신 결과물(사용자가 고친 파일 포함)을 기준으로 고친다. 고친 xlsm 이 확정되면
   `python3 scripts/dash_extract.py <xlsm> <SP>/dash.json` (LibreOffice·openpyxl 필요. 출력의 시트 수·검증 n/n·'정리 화면 블록 N개' 확인.
   '경고 — 정리 화면을 만들지 못해…'가 나오면 그 시트 구조가 바뀐 것 → `scripts/dash_views.py`의 해당 `v_…` 함수를 고친다)
2. `node scripts/vault.mjs encrypt <SP>/dash.json dash.enc.json --salt-from data.enc.json`
   (반드시 `--salt-from` — 미팅노트와 같은 비밀번호·salt 여야 앱이 기억된 키로 연다. 비밀번호가 다르면 스크립트가 멈춘다)
3. `git status`로 dash.enc.json 만 올라가는지 확인 → 커밋(`dash: 대시보드 MM/DD 기준`, 숫자·기관명 쓰지 말 것) → push. 평문 dash.json 삭제.
- 2022년~ 약정 시트 이름은 '약정내역(2022~현재)'(2026-11-09, 예전 '약정내역&수수료' — 코드는 두 이름 다 받음). 약정 통계의 펀드 수·기관 수는 수식(13행 확인 칸).
- 엑셀에만 두고 앱에는 아직 안 올리는 시트는 `dash_extract.py`의 `EXCEL_ONLY`(지금은 없음).
- '약정 이력' 시트(2026-11-09 추가): 약정 통계(`v_stats` — 절 번호로 찾음, '#,##0.0,,' 칸은 USD M)·기관별 약정(`v_orgs` — 회색 요약 행 = 묶음 머리)·약정내역(2010~2021)(`v_hist` — 약정연도별 묶음).
- **앱 화면 다듬기 `scripts/dash_curate.py`(사용자 요청 2026-11-10: 엑셀 작업 기록은 앱에서 없애고 의미 있는 화면만)** — `dash_extract.py` 마지막에 자동 실행.
  빼는 것: 금감원 보고 여부(카드·표·열), 펀드 상태별 표, 펀드별 분류·기관명 통일표, 시트 간 중복 정리·확인 사항, 출처·작성 메모,
  출처 시트별(2010~21/2022~) 열·건수, 순위·함께 집계한 표기·근거/출처/크로스체크/협회코드 열, '…와 일치해야 함 → 검증' 문장. 숨기는 시트: 검증·KPI보고용.
  시트 목록 묶음·순서·짧은 이름은 `LAYOUT`(실적·KPI / 영업 현황 / 약정 / 분석 / 시딩). 새 시트가 LAYOUT 에 없으면 원래 묶음으로 맨 뒤.
  엑셀 없이 이미 만든 dash.json 에도: `python3 scripts/dash_curate.py <SP>/dash.json`. 엑셀에 이런 작업 기록 블록이 새로 생기면 규칙(DROP_…)에 더한다.
- 달러 금액은 억원을 함께 표기(사용자 요청 2026-11-10): `dash_curate._mark_krw` 가 단위 표시 `cu`(M=USD 백만·K=USD 천·1=USD)를 카드·막대·차트·표 열에 붙이고,
  앱이 기준일 매매기준율(fx.usd)로 억원을 값 아래에 보인다(쪽 맨 위에 환율 안내). 카드 문장 'USD 5,519,460' 뒤엔 '(≈ 74.8억)'을 데이터에 덧붙임(두 번 돌려도 한 번만).
  KPI 실적 요약·시딩은 시점별 환율·원화를 따로 쓰므로 제외. 약정 현황의 연도별 표는 펼쳐서 차트 아래(설명·차이 0 줄은 빼고 연도 없는 약정은 '연도 미기재').
- 해외대체 시딩의 약정 = **심사 승인금액**(사용자 확인 2026-11-10). 시트 맨 오른쪽 '약정금액(외화)·(원화환산)' 열은 일부 펀드에서 승인금액과 달라 쓰지 않는다 —
  `dash_curate._seed_by_approval`: 원화 승인은 그대로, USD·EUR 승인은 기준일 fx 로 환산해 시딩 관리판(카드·펀드별 약정·자산군별 요약)과 요약의 '해외대체 시딩 현황'을 다시 계산.
- 요약의 '검증 n/n' 표시는 어긋날 때만 보인다. 휴대폰 대시보드는 시트를 묶음별 선택 상자로 고른다(PC·태블릿은 왼쪽 목록).
- 새 시트가 생기면 `dash_extract.py`의 `GROUPS`·`SHORT`에 넣고(없으면 '기타'), `dash_views.py`에 `v_…` 함수를 만들어 `BUILDERS`에 등록
  (없으면 원본 격자만). 블록 형식(kpis·col·bars·table·notes·row·tabs, 표시 형식 f)은 `dash_views.py` 머리 주석. 머리글 고정이 어색한 화면 배치 시트는 `NOFREEZE`.
- **이력 쪽(앱에만, 사용자 요청 2026-11-12)**: 엑셀에서 숨긴 지난 연도 시트도 앱에서 보이게 — `dash_views.HISTORY`
  '수익 이력 (2018~)'(연도 시트 2018~2025: 연도별 수익·부서 몫·판매/관리·많이 받은 곳·입금 내역 800건, 시트 합계와 대조해 어긋나면 notes 에 표시)
  · 'PA 계약 이력 (2023~)'(연도 계약서 시트, 엑셀 계약 종류 필터로 보이는 줄 = 판매·PA 계약). 원본 격자 없이 정리 화면만.
  2018~2025 현금 수취 시트는 사용자가 준 '…261105.xlsx'에서 2018~2022를 대시보드에 숨김 시트로 붙인 것(2026-11-12 v3). 새 연도 시트도 이름이 'YYYY'면 자동 포함.
- 요약의 월별 수익(Cash·발생)은 엑셀 대시보드 시트 표가 아니라 원본 시트(현금기준 'N월 부서별 수익' K, 월별 실적 C='N월' K 합)에서 1월~기준월로 다시 계산한다.
- 점검용 가상 대시보드는 `tests/dash-fixture.json`(가상 데이터만).
- 'KPI 실적 요약'은 연도별로 정리(사용자 요청, `dash_views.kpi_by_year`): 연도별 한눈에(차트·표) → 연도 단추(`tabs` 블록: 그 해 지표 카드·제출 근거·
  그 해 PA·판매규모 목록) → 산출 기준. 표 제목의 'YYYY년'으로 연도를 나눈다. 절 번호(4.~11.)는 산출 기준 문장이 가리키므로 남긴다.
  엑셀 구조가 달라 묶지 못하면 경고 후 예전처럼 절 순서대로.

## "리서치 업데이트" (사용자가 리포트 PDF 를 줌 — Preqin 분기 리포트 등)
앱 '리서치' 탭 = 자산군별 정리(지표 카드·작은 차트·분기 동향·Preqin의 시각·KB GIS 시사점·국내 LP 수요) + 자산군마다 A4 1쪽 PDF 받기.
형식·원칙·순서는 `docs/RESEARCH.md`. 요점:
- 숫자는 리포트 **본문에 글자로 나온 것만**(차트 그림에서 읽지 않는다). 리포트 내용(`sections`·`outlook`)과 당부서 해석(`insights`)을 구분.
- 구독자 전용 자료 — 문장·그림을 그대로 옮기지 않고 요약, `notice` 에 내부용·외부 배포 금지. 평문(리포트·요약·PDF)은 스크래치패드에만.
- `node scripts/research_build.mjs <SP>/research.src.json <SP>/research.json --data <SP>/data.json --font-dir <Pretendard>` → 리포트마다 '1쪽' 확인
  → `node scripts/vault.mjs encrypt <SP>/research.json research.enc.json --salt-from data.enc.json` → 커밋(`research: …`, 수치 쓰지 말 것) → push.
- 화면은 `research.js`·`research.css`(지표 카드는 `Dash.blocks`, 차트는 작은 SVG 막대). '국내 LP 수요'는 `O`(기관 시그널)에서 그때그때 세고, 누르면 전략 수요판으로.
- PDF 받기: 브라우저는 Blob 내려받기(파일 이름 영문), 안드로이드 앱은 `window.KBApp.savePdf`(→ 다운로드 폴더). 2026-11-10 첫 반영: Preqin Q3 2026 5종.

## 화면 수정
- `app.js`/`app.css`는 아티팩트 페이지(lp_meeting_db.html) 원본에서 저장 기능·약어 사전을 뺀 것. KB 노랑·회색 토큰.
- 화면 모드: 기본 라이트, 헤더 버튼으로 다크(`localStorage` `kbnote-theme`, `<html data-theme>`). 색을 바꾸면 두 모드 다 확인.
- 읽기 기능: 목록은 월 구분 + 미리보기(시사점 → 첫 줄, 검색 중엔 검색어가 든 문장). 상세 요약정리는 `bodyHtml`로 섹션·줄 순서 그대로
  (`-->` 줄도 제자리), raw가 있으면 '요약정리 | 원문' 탭(항상 요약정리 먼저 — 사용자 요청, 목록 미리보기도 요약정리 기준)
  원문 탭은 카톡 머리(날짜·시각·'이름 :') 대신 올린 사람 이름만(`rawParts`, 사용자 요청 — 저장된 raw 는 그대로, 이름 표기는 source 의 게시자에서 맞춤),, 다음 액션(별도 필드)은 위에, 검색어 `<mark>`, 이전/다음 미팅. 휴대폰 상세는 `history.pushState` 로 안드로이드 뒤로가기가 목록으로.
  글자 크기 `kbnote-fs`(m·l·xl, `.page` zoom), 새 소식 `kbnote-seen`(지난번 본 뒤 createdAt/updatedAt 이 더 새 것).
- 검색(`terms`/`hits`): 여러 단어는 모두 포함, 각 단어는 기관 aliases(교공→한국교직원공제회)와 `SYN` 한·영 묶음으로 넓힘.
  `SYN`은 공개 코드라 일반 GP명·업계 용어만(고객·인물 이름 금지). 새 약칭은 DB의 orgs.aliases 에 넣으면 검색에 바로 반영.
- 화면 파일을 바꾸면 `sw.js`의 `CACHE` 버전을 올린다.
- `index.html`에 보안 정책(CSP): 스크립트는 사이트 파일+인라인 2개(해시), 통신은 같은 사이트로만(`connect-src 'self'` — 푼 데이터가 밖으로 못 나감).
  인라인 `<script>`를 고치거나 외부 주소를 더하면 `node scripts/csp.mjs`(점검은 `--check`, smoke 에 포함).
- 새 버전 배포는 앱을 내렸을 때(다른 앱·홈) 새로 연다 — 읽는 도중에 갑자기 다시 열리지 않게.
- PC 에서 미팅노트·기관·인물 탭은 고른 것이 없으면 목록 맨 위 항목을 오른쪽에 바로 보여준다(빈 칸 대신). 휴대폰은 목록부터.
- 긴 목록 이동(2026-11-10 점검: 휴대폰 미팅 목록 ≈ 화면 35장): 건수 줄의 '월 이동'(`#mJump`·`jumpFill`, 두 달 이상일 때만), 900px 넘게 내려가면 '맨 위로'(`#topBtn`),
  현재 탭을 다시 누르면 상세 닫기 → 맨 위, 탭을 오가도 보던 자리 유지(`tabY`). 휴대폰은 월·기관 구분줄(`.mhead`)이 헤더 아래에 붙는다 —
  `--stick`(헤더 아래 끝, app.js `setStick`) + `.list{overflow:clip}`(hidden/auto 면 안 붙음). 글자 크게(zoom)에서는 top 을 1.1·1.22 로 나눈다.
- 손가락 화면(`@media (max-width:760px),(pointer:coarse)`): 누르는 대상 36px 이상, 헤더 단추 40px. 연한 글자 `--muted`는 라이트 #6E665B(작은 글자 대비 4.5:1 이상).
  휴대폰 미팅 상세의 참석자는 한 묶음에 한 줄씩(이름 + 소개).
- 대시보드 표: 가로로 열이 더 있으면 오른쪽 끝을 흐리게(`hintX`, 끝까지 넘기면 사라짐). 휴대폰 도구줄은 `.tb-2>*{flex:none}`(정렬 상자가 눌리지 않게),
  소계·합계 카드의 월별 칸은 한 줄 전체 폭(반 칸이면 큰 글자에서 화면 밖으로 넘침), 요약의 시트 바로가기는 2열·기준 연도 지표.
- 아이콘: `node scripts/gen-icons.mjs note icons` (Market 아이콘은 `market`).
- 점검: `node tests/smoke.mjs` (Playwright, 가상 데이터).

## 안드로이드 APK
- `android/`: 웹앱 주소를 전체 화면 WebView로 여는 앱(패키지 `io.github.oneedong.kbgis.meetingnote`). DB 갱신과 무관.
  웹앱이 부르는 다리 `window.KBApp`(version·savePdf): 리서치 PDF 를 다운로드 폴더에 저장(API 29+ MediaStore, 그 아래는 인쇄 화면의 'PDF로 저장').
  자바를 고치면 여기서 컴파일 점검 가능: Maven 의 `org.robolectric:android-all`(API 34) jar 를 받아 `javac --release 11 -classpath <jar>`.
- 이 세션 컨테이너에서는 Android SDK(dl.google.com)를 받을 수 없어 로컬 빌드 불가. `android/**`를 push하면
  GitHub Actions가 빌드해 Release `android`에 올린다. 실패 시 로그는 `gh release view android-build-log`의 본문.
- 러너는 `ubuntu-24.04` 고정(`ubuntu-latest`=26.04 는 Playwright 1.56 미지원).
- 서명 키: 저장소 Secret `APK_SIGNING_PASSWORD`(사용자가 GitHub 설정에서 직접 넣음, Claude 는 값을 모름)가 있으면 고정 키.
  첫 빌드 때 키를 만들어 그 값으로 암호화해 사전 릴리스 `android-signing`에 보관 → 이후 새 APK 가 기존 앱 위에 설치된다.
  Secret 이 없으면 임시 키(기존 앱 삭제 후 설치). 키가 보관된 뒤 Secret 이 없거나 다르면 빌드가 멈춘다. `android-signing` 릴리스는 지우지 않는다.
  워크플로 파일만 고칠 때는 커밋 메시지에 `[skip ci]`(빌드 없이). 다시 빌드: `gh workflow run android.yml`. 앱 소스는 꼭 필요할 때만 바꾼다.
- 아이콘: `node scripts/gen-icons.mjs note android/res --android`.
