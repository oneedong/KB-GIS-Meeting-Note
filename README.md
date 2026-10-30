# KB GIS · LP 미팅노트 (휴대폰 앱)

글로벌상품영업부 LP 미팅노트 DB를 휴대폰에서 앱처럼 여는 **읽기 전용 사본**입니다.
KB GIS 앱(`KB-GIS-App`)과 같은 방식으로 GitHub Pages에서 빌드 없이 배포되고, 홈 화면에 설치해 씁니다.

- 앱 주소: **https://oneedong.github.io/KB-GIS-Meeting-Note/**
- 원본(추가·수정): claude.ai 아티팩트 "GIS LP 미팅노트 DB" — 소유자 전용
- 화면: 미팅노트 · 기관 · 전략 수요판 · 인물/조직도 · 약어 사전 (아티팩트 화면과 같음)

## 데이터 보호

이 저장소와 앱 주소는 **공개**입니다. 그래서 미팅노트 데이터는 암호문(`data.enc.json`)으로만 올립니다.

- AES-256-GCM 암호화, 키는 비밀번호에서 PBKDF2-SHA256(600,000회)로 만듭니다.
- 비밀번호는 저장소·앱 어디에도 없습니다. 처음 열 때 한 번 입력하면, "이 기기에서 기억하기"를 켠 경우
  만들어진 키만 그 기기 안(IndexedDB, 내보낼 수 없는 형태)에 남습니다.
- 헤더의 자물쇠(잠그기)를 누르면 기기에 남은 키를 지우고 다시 비밀번호를 묻습니다.
- 평문 `data.json`, 엑셀 백업, 아티팩트 내보내기 폴더는 `.gitignore`로 막아 두었습니다. **평문은 절대 커밋하지 마세요.**
- 검색엔진 수집 차단(`noindex`)도 걸어 두었습니다.

## 휴대폰에 설치

**아이폰(사파리)**: 앱 주소 열기 → 공유 버튼 → "홈 화면에 추가" → 홈 화면의 "GIS 미팅노트" 실행 → 비밀번호 입력

**안드로이드(크롬)**: 앱 주소 열기 → ⋮ 메뉴 → "앱 설치"(또는 "홈 화면에 추가") → 실행 → 비밀번호 입력

한 번 열면 오프라인에서도 마지막으로 받은 사본이 열립니다. 새 사본이 올라오면 다음 실행 때 자동으로 바뀝니다.

## 사본 갱신 (아티팩트 → 앱)

Claude Code 세션에서 "미팅노트 앱 사본 갱신해줘"라고 하면 됩니다. 순서는 `CLAUDE.md`에 적어 두었습니다.

직접 할 때:

```bash
# 1) 아티팩트 저장소 내보내기(<폴더>/meetings·orgs·people/*.json) → 평문 data.json (저장소 밖에 둘 것)
node scripts/build-data.mjs <내보내기 폴더> /tmp/data.json

# 2) 암호화 (비밀번호는 입력창에서, 또는 MEETING_DB_PASSWORD 환경변수)
node scripts/encrypt.mjs /tmp/data.json data.enc.json

# 3) 확인 후 암호문만 커밋
node scripts/encrypt.mjs --check data.enc.json
git add data.enc.json && git commit -m "data: 미팅노트 사본 갱신" && git push
```

같은 비밀번호로 다시 암호화하면 휴대폰에 기억된 키가 그대로 맞아서 다시 입력할 필요가 없습니다.
비밀번호를 바꾸면 모든 기기에서 새 비밀번호를 한 번 넣어야 합니다.

## 파일 구성

| 파일 | 내용 |
|---|---|
| `index.html` · `app.css` · `app.js` | 화면 (아티팩트 페이지 원본에서 저장 기능을 빼고 읽기 전용으로) |
| `vault.js` | 암호문 열기·비밀번호 화면·기기 키 기억/잠그기 |
| `data.enc.json` | 암호화된 미팅노트 사본 |
| `sw.js` · `manifest.webmanifest` · `icons/` | 홈 화면 설치·오프라인 |
| `scripts/build-data.mjs` | 아티팩트 내보내기 → 평문 data.json |
| `scripts/encrypt.mjs` | data.json → data.enc.json, `--check`로 확인 |
| `scripts/gen-icons.mjs` | 앱 아이콘 생성 |
| `tests/smoke.mjs` | 가상 데이터(`tests/fixture.json`)로 브라우저 점검 — 실제 데이터·비밀번호는 쓰지 않음 |
