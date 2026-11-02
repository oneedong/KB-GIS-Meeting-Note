#!/usr/bin/env node
// 카톡 대화 내보내기(txt) → 게시물 목록. 이미 DB 에 원문(raw)으로 들어간 게시물은 표시해 새 것만 고르기 쉽게 한다.
//
//   node scripts/kakao.mjs <카톡.txt> <평문 data.json> <출력 posts.json>
//
// - 메시지: "2026년 4월 16일 오후 4:47, 김현지 차장님 : …" 줄로 시작, 다음 머리 줄 전까지 이어지는 줄 포함(글자 그대로)
// - 게시물: 같은 사람이 10분 안에 이어 보낸 메시지 중, 첫 줄에 날짜·[머리]·'A <> B'·@언급이 없고 -·•·2.·3) 처럼 이어지는 것을 합친다
//   (카톡은 긴 노트를 여러 메시지로 나눠 보내는 경우가 많다)
// - 카톡 내보내기는 한 메시지를 500자에서 자른다 → 495자 이상이면 cut 표시(원문 잘림)
// 출력 파일은 평문이므로 저장소 밖(스크래치패드)에 둔다.
import { readFileSync, writeFileSync } from 'node:fs';

const [src, dbPath, out] = process.argv.slice(2);
if (!src || !dbPath || !out) { console.error('사용법: node scripts/kakao.mjs <카톡.txt> <평문 data.json> <출력 posts.json>'); process.exit(2); }

const text = readFileSync(src, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const HEAD = /^(\d{4})년 (\d{1,2})월 (\d{1,2})일 (오전|오후) (\d{1,2}):(\d{2}), (.+?) : /;
const SYS = /^\d{4}년 \d{1,2}월 \d{1,2}일 (오전|오후) \d{1,2}:\d{2}, (?!.+? : )/;
const DAY = /^\d{4}년 \d{1,2}월 \d{1,2}일 (오전|오후) \d{1,2}:\d{2}$/;
const NEW = /^\s*(\[|#|<|@)|\d{1,2}\/\d{1,2}|\d{2,4}[.\-]\d{1,2}[.\-]\d{1,2}|^\s*\d{1,2}\.\d{1,2}\b|(^|\D)\d{6}(\D|$)|(^|\D)20\d{6}(\D|$)|\d{1,2}월\s?\d{1,2}일|<>/;
const CONT = /^\s*([-•·o※>]|\d{1,2}[.)]|[①-⑩]|\(|→|-->)/;
const pad = (n) => String(n).padStart(2, '0');

const msgs = [];
let cur = null;
for (const ln of text.split('\n').slice(2)) {
  const m = HEAD.exec(ln);
  if (m) {
    const [, y, mo, d, ap, h, mi, who] = m;
    const hh = (Number(h) % 12) + (ap === '오후' ? 12 : 0);
    cur = { ts: `${y}-${pad(mo)}-${pad(d)} ${pad(hh)}:${mi}`, date: `${y}-${pad(mo)}-${pad(d)}`, who, raw: [ln], body: [ln.slice(m[0].length)] };
    msgs.push(cur); continue;
  }
  if (SYS.test(ln) || DAY.test(ln)) { cur = null; continue; }   // 초대·방장 같은 시스템 줄, 날짜 구분 줄
  if (cur) { cur.raw.push(ln); cur.body.push(ln); }
}
for (const m of msgs) {
  while (m.raw.length && !m.raw[m.raw.length - 1].trim()) { m.raw.pop(); m.body.pop(); }
  m.raw = m.raw.join('\n'); m.text = m.body.join('\n').trim(); delete m.body;
}

const minutes = (ts) => Date.parse(ts.replace(' ', 'T') + ':00Z') / 6e4;
const posts = [];
for (const m of msgs) {
  const p = posts[posts.length - 1], first = m.text.split('\n', 1)[0];
  if (p && p.who === m.who && minutes(m.ts) - minutes(p.last) <= 10 && !NEW.test(first) && !m.text.startsWith('파일:')
      && (CONT.test(first) || p.text.length > 200)) {
    p.raw += '\n' + m.raw; p.text += '\n' + m.text; p.last = m.ts; p.cut ||= m.text.length >= 495; continue;
  }
  posts.push({ ts: m.ts, date: m.date, who: m.who, raw: m.raw, text: m.text, last: m.ts, cut: m.text.length >= 495 });
}

// DB 원문과 대조: 게시물 원문이 어느 미팅 raw 에 그대로 들어 있으면 이미 반영된 것
const db = JSON.parse(readFileSync(dbPath, 'utf8'));
const raws = db.meetings.filter((r) => r.raw).map((r) => ({ id: r.id, raw: r.raw }));
const isNote = (p) => !/^파일:|^사진$|^동영상$|^이모티콘$/.test(p.text) && p.text.length >= 60;
for (const p of posts) {
  delete p.last;
  p.inDb = raws.filter((r) => r.raw.includes(p.raw)).map((r) => r.id);
  p.kind = p.inDb.length ? 'in-db' : isNote(p) ? 'new-note?' : 'chat/file';
}
writeFileSync(out, JSON.stringify(posts, null, 1));
const c = (k) => posts.filter((p) => p.kind === k).length;
console.log(`메시지 ${msgs.length} → 게시물 ${posts.length} (${posts[0]?.ts} ~ ${posts[posts.length - 1]?.ts})`);
console.log(`  이미 DB에 있음 ${c('in-db')} · 새 미팅노트 후보 ${c('new-note?')} · 대화·파일 ${c('chat/file')}`);
for (const p of posts.filter((x) => x.kind === 'new-note?'))
  console.log(`  후보 ${p.ts} ${p.who}${p.cut ? ' ✂' : ''} | ${p.text.split('\n', 1)[0].slice(0, 60)}`);
