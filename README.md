# KB GIS Meeting Note

글로벌상품영업부 LP·GP 미팅노트 DB를 휴대폰에서 앱처럼 여는 웹앱입니다.
자매 앱 **KB GIS Market**(`KB-GIS-App`)과 같은 방식으로 GitHub Pages에서 빌드 없이 배포되고, 홈 화면에 설치해 씁니다.

- 앱 주소: **https://oneedong.github.io/KB-GIS-Meeting-Note/**
- 설치 링크(공유용): **https://oneedong.github.io/KB-GIS-Meeting-Note/install.html** — 아이폰·안드로이드·PC·카카오톡을 알아서 구분해 설치 방법을 보여주고, PC에서는 QR 코드를 띄운다
- 화면: 미팅노트 · 기관 · 전략 수요판 · 인물/조직도 (읽기 전용)
- 업데이트: Claude에게 미팅노트 txt 파일이나 텍스트를 주고 "미팅노트 업데이트해줘" → DB에 반영해 다시 배포

## 데이터 보호

이 저장소와 앱 주소는 **공개**입니다. 그래서 미팅노트 데이터는 암호문(`data.enc.json`)으로만 올립니다.

- AES-256-GCM 암호화, 키는 비밀번호에서 PBKDF2-SHA256(600,000회)로 만듭니다.
- 비밀번호는 저장소·앱 어디에도 없습니다. 처음 열 때 한 번 입력하고 "이 기기에서 기억하기"를 켜 두면,
  만들어진 키만 그 기기 안(IndexedDB, 내보낼 수 없는 형태)에 남습니다.
- 헤더의 자물쇠(잠그기)를 누르면 기기에 남은 키를 지우고 다시 비밀번호를 묻습니다.
- 평문 파일(`data.json`, 엑셀, 내보내기 폴더)은 `.gitignore`로 막고, push 때마다 GitHub Actions가 한 번 더 확인합니다.
- 검색엔진 수집 차단(`noindex`)도 걸어 두었습니다.

## 휴대폰에 설치

설치 링크(`install.html`)를 휴대폰에서 열면 기기에 맞는 안내가 나옵니다. 카카오톡으로 받은 링크는 자동으로 사파리·크롬으로 넘깁니다(카카오톡 안에서는 설치 불가).

**아이폰(사파리)**: 앱 주소 열기 → 공유 버튼 → "홈 화면에 추가" → 홈 화면의 "KB GIS Meeting Note" 실행 → 비밀번호 입력

**안드로이드(크롬)**: 앱 주소 열기 → ⋮ 메뉴 → "앱 설치"(또는 "홈 화면에 추가") → 실행 → 비밀번호 입력

한 번 열면 오프라인에서도 마지막으로 받은 DB가 열립니다. 새로 배포되면 다음 실행 때 자동으로 바뀝니다.

## 직접 업데이트할 때

```bash
node scripts/vault.mjs decrypt data.enc.json /tmp/data.json            # 평문은 저장소 밖에
node scripts/upsert.mjs /tmp/data.json /tmp/patch.json --dry-run       # 레코드 규칙: docs/CONVERT.md
node scripts/upsert.mjs /tmp/data.json /tmp/patch.json
node scripts/vault.mjs encrypt /tmp/data.json data.enc.json
git add data.enc.json && git commit -m "data: 미팅노트 갱신" && git push
```

비밀번호는 입력창에서 받거나 `MEETING_DB_PASSWORD` 환경변수로 넘깁니다. 같은 비밀번호로 다시 암호화하면
휴대폰에 기억된 키가 그대로 맞아서 다시 입력할 필요가 없습니다.

## 파일 구성

| 파일 | 내용 |
|---|---|
| `index.html` · `app.css` · `app.js` | 화면 (KB 노랑·회색) |
| `vault.js` | 암호문 열기·비밀번호 화면·기기 키 기억/잠그기 |
| `data.enc.json` | 암호화된 미팅노트 DB (원본) |
| `sw.js` · `manifest.webmanifest` · `icons/` | 홈 화면 설치·오프라인 |
| `install.html` | 설치 안내(기기별 안내·QR·안드로이드 설치 버튼) |
| `scripts/vault.mjs` | 암호화·복호화·확인 |
| `scripts/upsert.mjs` | 새 미팅·인물·기관 레코드 넣기/고치기(검증 포함) |
| `docs/CONVERT.md` | 미팅노트 텍스트 → 레코드 변환 규칙 |
| `scripts/gen-icons.mjs` | 앱 아이콘(KB GIS Market / Meeting Note 한 쌍) 생성 |
| `tests/smoke.mjs` | 가상 데이터(`tests/fixture.json`)로 브라우저 점검 — 실제 데이터·비밀번호는 쓰지 않음 |
