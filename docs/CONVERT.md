# 미팅노트 텍스트 → DB 레코드 변환 규칙

사용자가 미팅노트 txt 파일(카톡 GIS_미팅노트방 내보내기 등)이나 메모 텍스트를 주면 이 규칙으로 레코드를 만들어
`scripts/upsert.mjs`로 DB에 넣는다. 순서는 `CLAUDE.md`.

이 문서는 공개 저장소에 있으므로 일반 규칙만 둔다. **기관 약칭 해석표·KB 게시자 표기·알려진 이름 충돌**처럼
고객·인물이 드러나는 표는 암호화된 DB 안 `ref.convertSpec`에 있다. 복호화한 뒤 반드시 함께 읽는다.
기관명은 DB `orgs[].name`·`orgs[].aliases`로 맞춘다.

## 미팅 레코드 (meetings) — 모든 필드 필수
| 필드 | 규칙 |
|---|---|
| `id` | `YYYYMMDD-<ascii-slug>` 고유. slug는 기관 id(orgs의 id, 예: 공제회 약칭 영문)에 부서 꼬리 붙이기(`-re`, `-infra`, `-corp`). 같은 날 같은 기관 2건이면 `-2` |
| `date` | 텍스트에 적힌 미팅일. 없으면 게시일. 불확실하면 flags `날짜 확인: …` |
| `org` | 표준 기관명(orgs의 name). 처음 보는 기관이면 patch의 `orgs`에 새 기관도 추가 |
| `orgType` | 연기금·공제회·보험·운용사·은행·증권·캐피탈·저축은행·기타·GP·내부 |
| `dept` | 상대 부서·팀(알면) |
| `category` | LP·GP·시장정보·내부. KB증권 운용부서(발행어음·헤지 등)와의 미팅은 LP |
| `attendees` | 상대측 참석자, 줄마다 `이름 직급 - 한줄 소개`. 직급 약어는 풀어 쓴다 |
| `kbAttendees` | 게시자 또는 명시된 KB 참석자(예: `홍길동 차장`) |
| `assets` | 아래 전략 키만 |
| `body` | 아래 메모 양식 |
| `nextAction` | 원문에 명시된 다음 액션만, 없으면 `""` |
| `tags` | 짧은 키워드 8개 이하(GP명, 이슈, `인사이동`, `재간접`, `RFP` 등) |
| `flags` | `원문 잘림`, `내부용`, `날짜 확인: …`, `이름 확인: …`, `추정: …` |
| `source` | `카톡 GIS_미팅노트방 · YYYY-MM-DD 게시 · <게시자>` 또는 `직접 입력 · YYYY-MM-DD` |
| `truncated`·`truncAt` | 원문이 잘려 끝나면 true와 잘린 지점 문장 |

## body 메모 양식
- LP: `*조직/인사 및 운용 규모` → `*최근 투자현황/계획` (내용 없는 섹션은 뺀다)
- GP: `*운용사/펀드 현황` → `*논의 내용`
- 시장정보·내부: `*내용`
- 섹션 아래 줄은 모두 `- `로 시작. `--> ` 줄은 원문에 명시된 Next Step·결론·시사점이 있을 때만(새 해석 추가 금지)
- 문체: 개조식 음슴체(~함/~임/~음). 수치·통화는 원문 그대로(USD 50m, 1,000억원)
- 실무 영어 용어는 영어 그대로: Direct Lending, Buyout, Secondary, Co-invest, Re-up, Final/First Closing,
  Capital Call, Unlevered/Levered, Open-end, BDC, Opportunistic Credit, Special Situations, Value-add, Core+,
  LPAC, SMA, FoF, IC, RFP/RFI, Equalization fee, GP Financing
- 사실 추가·창작 금지. 축약만 풀고 문장만 다듬는다
- 원문이 잘려 끝나면 마지막 줄 뒤에 `- (원문 잘림 — 카톡 '전체보기'로 확인 필요)` + flags `원문 잘림` + truncated
- 동료가 바로 덧붙인 보충은 같은 레코드 body에 `- (홍길동 과장 보충) …`로 합친다
- 여러 기관을 한 메시지로 묶은 시장정보는 기관별로 레코드를 나눈다(category 시장정보)
- 빼는 것: 초대·퇴장, 삭제된 메시지, 파일 공유만 있는 메시지(GP 미팅 자료는 `첨부: 파일명` 레코드로), 행정 대화
- `외부공유x`·`내부용`·`내부 참고용` 표시 → flags `내부용`

## 직급 약어
TJ=팀장, BJ=부장, CJ=차장, GJ=과장, DL=대리, MNG=매니저, Pro/프로=프로, JM=전무(추정 → flags `추정: JM=전무`),
수석·선임·책임은 그대로.

## 일반 용어 약어
블펀=블라인드 펀드, 코인베=Co-invest, 리업=Re-up, 투심=투자심의, SS=Special Situations, Opp=Opportunistic Credit,
DL=Direct Lending, PD=Private Debt, OE=Open-end, Subline=Subscription Line, SRT=Significant Risk Transfer,
WAL=가중평균만기, PA=Placement Agent, AMC=국내 재간접 운용사

## 전략 키 (assets · signals 공통, 17개)
`PE Buyout` `PE Secondary` `Co-invest` `Growth/VC` `PD/DL` `Opp Credit/SS` `Credit Secondary` `인프라 Debt`
`인프라 Equity` `인프라 Secondary` `부동산 Debt` `부동산 Equity` `항공기` `Open-end/BDC` `헤지펀드` `ABF/CLO/구조화` `GP Financing`

## 인물 (people)
- 미팅에 나온 외부 인물(KB 직원 제외)을 patch `people`에 넣는다: `name`, `org`(표준명), `dept`, `title`, `note`(원문 근거 한 줄),
  `lastSeen`(미팅일), `source`(`미팅노트 YYYY-MM-DD`)
- 이미 있는 사람이면 upsert가 합친다(빈 연락처만 채움, note·source 덧붙임, 더 최근이면 직급 갱신)
- 인사 정보(이동·승진·휴직)는 note에. 기존 표기와 이름이 다르면 flags `이름 확인: …`

## 기관 시그널 (orgs.signals)
- 미팅에서 전략별 의향이 분명히 나오면 patch `orgs`에 `signals: {전략: {s, note, date}}`로 갱신
- s: `약정`(올해 약정 완료) · `진행`(실사·심의·선정 중) · `관심`(검토 의향) · `보류`(일시 중단) · `불가`(규정·방침상 어려움)
- note는 짧게(예: `유럽 DL 확대`), date는 미팅일. 추정이면 갱신하지 않는다
- 새 약칭이 나오면 그 기관 `aliases`에 추가
