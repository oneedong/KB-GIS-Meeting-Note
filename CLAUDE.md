# KB-GIS-Meeting-Note — Claude 작업 메모

KB GIS Meeting Note: 글로벌상품영업부 LP·GP 미팅노트 DB 앱. 공개 저장소 + GitHub Pages(main 브랜치 루트, 빌드 없음).
**데이터 원본은 이 저장소의 암호문 `data.enc.json`** 이다(2026-10-30 claude.ai 아티팩트 DB에서 옮겨 온 뒤로 아티팩트는 쓰지 않음).
**DB는 2026년 미팅만 담는다(사용자 요청).** 2026-11-02 카톡 원문(2025-11-28~2026-10-27)으로 기존 미팅 223건에 `raw`(원문)를
붙였다(정리본은 그대로, `legacyBody`). 2025-12 원문은 넣지 않는다. 아티팩트에서 직접 입력한 4건(10/20·21·28·29)은 카톡 원문이 없다.
카톡 직급 약어: TJ=팀장, BJ=부장, CJ=차장, GJ=과장(검색 `SYN`에도 있음).
앱 탭: 미팅노트·기관·전략 수요판·인물·대시보드(엑셀 대시보드, `dash.enc.json`).
자매 앱: KB GIS Market(`oneedong/KB-GIS-App`).

## 절대 규칙
- 평문 데이터(복호화한 data.json, patch.json, 사용자가 준 미팅노트 원문 txt 등)는 저장소 밖(스크래치패드)에만 두고 커밋하지 않는다.
  저장소에 들어가는 데이터는 암호문 `data.enc.json`·`dash.enc.json` 둘뿐. 커밋 전 `git status`로 확인.
- 비밀번호를 파일·커밋·코드·로그·커밋 메시지에 남기지 않는다. 환경변수 `MEETING_DB_PASSWORD`로만 넘긴다
  (환경 설정에 있으면 그대로, 없으면 사용자에게 묻는다).
- `tests/fixture.json`·`tests/dash-fixture.json`은 가상 데이터만.
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
앱 '대시보드' 탭 = 엑셀의 보이는 시트 전부(요약 카드·차트 + 시트별 표). 데이터는 암호문 `dash.enc.json` 하나.
1. 엑셀은 최신 결과물(사용자가 고친 파일 포함)을 기준으로 고친다. 고친 xlsm 이 확정되면
   `python3 scripts/dash_extract.py <xlsm> <SP>/dash.json` (LibreOffice·openpyxl 필요. 출력의 시트 수·검증 n/n·머리글 행 확인)
2. `node scripts/vault.mjs encrypt <SP>/dash.json dash.enc.json --salt-from data.enc.json`
   (반드시 `--salt-from` — 미팅노트와 같은 비밀번호·salt 여야 앱이 기억된 키로 연다. 비밀번호가 다르면 스크립트가 멈춘다)
3. `git status`로 dash.enc.json 만 올라가는지 확인 → 커밋(`dash: 대시보드 MM/DD 기준`, 숫자·기관명 쓰지 말 것) → push. 평문 dash.json 삭제.
- 새 시트가 생기면 `dash_extract.py`의 `GROUPS`·`SHORT`에 넣는다(없으면 '기타'로 들어감). 머리글 고정이 어색한 화면 배치 시트는 `NOFREEZE`.
- 요약 카드·차트 숫자는 `summary`(대시보드(Demo) 카드, 현금기준 'N월 부서별 수익', KPI 실적 요약, 연도별 CF '연합계(KRW', 검증, 시딩)에서 읽는다.
  엑셀 행 구성이 바뀌어 값이 비면 추출 함수만 고친다.
- 점검용 가상 대시보드는 `tests/dash-fixture.json`(가상 데이터만).

## 화면 수정
- `app.js`/`app.css`는 아티팩트 페이지(lp_meeting_db.html) 원본에서 저장 기능·약어 사전을 뺀 것. KB 노랑·회색 토큰.
- 화면 모드: 기본 라이트, 헤더 버튼으로 다크(`localStorage` `kbnote-theme`, `<html data-theme>`). 색을 바꾸면 두 모드 다 확인.
- 읽기 기능: 목록은 월 구분 + 미리보기(시사점 → 첫 줄, 검색 중엔 검색어가 든 문장). 상세 요약정리는 `bodyHtml`로 섹션·줄 순서 그대로
  (`-->` 줄도 제자리), raw가 있으면 '요약정리 | 원문' 탭(항상 요약정리 먼저 — 사용자 요청, 목록 미리보기도 요약정리 기준), 다음 액션(별도 필드)은 위에, 검색어 `<mark>`, 이전/다음 미팅. 휴대폰 상세는 `history.pushState` 로 안드로이드 뒤로가기가 목록으로.
  글자 크기 `kbnote-fs`(m·l·xl, `.page` zoom), 새 소식 `kbnote-seen`(지난번 본 뒤 createdAt/updatedAt 이 더 새 것).
- 검색(`terms`/`hits`): 여러 단어는 모두 포함, 각 단어는 기관 aliases(교공→한국교직원공제회)와 `SYN` 한·영 묶음으로 넓힘.
  `SYN`은 공개 코드라 일반 GP명·업계 용어만(고객·인물 이름 금지). 새 약칭은 DB의 orgs.aliases 에 넣으면 검색에 바로 반영.
- 화면 파일을 바꾸면 `sw.js`의 `CACHE` 버전을 올린다.
- 아이콘: `node scripts/gen-icons.mjs note icons` (Market 아이콘은 `market`).
- 점검: `node tests/smoke.mjs` (Playwright, 가상 데이터).

## 안드로이드 APK
- `android/`: 웹앱 주소를 전체 화면 WebView로 여는 앱(패키지 `io.github.oneedong.kbgis.meetingnote`). DB 갱신과 무관.
- 이 세션 컨테이너에서는 Android SDK(dl.google.com)를 받을 수 없어 로컬 빌드 불가. `android/**`를 push하면
  GitHub Actions가 빌드해 Release `android`에 올린다. 실패 시 로그는 `gh release view android-build-log`의 본문.
- 서명 키는 빌드마다 새로 생성(공개 저장소라 키를 두지 않음) → 새 APK는 기존 앱 삭제 후 설치. 앱 소스는 꼭 필요할 때만 바꾼다.
- 아이콘: `node scripts/gen-icons.mjs note android/res --android`.
