# KB-GIS-Meeting-Note — Claude 작업 메모

공개 저장소 + GitHub Pages(main 브랜치 루트, 빌드 없음). 미팅노트 DB의 휴대폰용 읽기 전용 사본.
원본 데이터는 claude.ai 아티팩트 https://claude.ai/artifact/Anojaa6zj25qQDDS34iW4P 의 저장소(db)
컬렉션 `meetings`·`orgs`·`people`.

## 절대 규칙
- 평문 데이터(data.json, 내보내기 폴더, 엑셀, 미팅 본문·인물 연락처가 든 어떤 파일도)를 커밋하지 않는다.
  저장소에는 암호문 `data.enc.json`만. 평문은 스크래치패드 같은 저장소 밖 임시 폴더에만 둔다.
- 비밀번호를 파일·커밋·코드·로그에 남기지 않는다. 사용자에게 받아 환경변수로만 넘긴다.
- `tests/fixture.json`은 가상 데이터만. 실제 이름·기관 내용을 넣지 않는다.

## "사본 갱신해줘" 순서
1. ArtifactData `list`로 세 컬렉션을 `out_dir`(스크래치패드)에 저장 — `query.limit` 1000.
2. `node scripts/build-data.mjs <out_dir> <스크래치패드>/data.json`
3. 비밀번호를 사용자에게 받아 `MEETING_DB_PASSWORD=… node scripts/encrypt.mjs <스크래치패드>/data.json data.enc.json`
   (환경 설정에 MEETING_DB_PASSWORD가 있으면 그것을 쓴다.) 같은 비밀번호면 salt가 유지되어 기기 재입력 없음.
4. `git status`로 data.enc.json 외 데이터 파일이 없는지 확인 → 커밋·푸시. 평문 파일 삭제.

## 화면 수정
- `app.js`/`app.css`는 아티팩트 페이지(lp_meeting_db.html) 원본을 거의 그대로 둔 것. 아티팩트 쪽 개선을
  옮겨오기 쉽게 차이를 작게 유지한다(차이: 저장소 연결 대신 `Vault.boot(load)`, 읽기 전용, 우드 색).
- 화면 파일을 바꾸면 `sw.js`의 `CACHE` 버전을 올린다.
- 점검: `node tests/smoke.mjs` (Playwright, 가상 데이터).
