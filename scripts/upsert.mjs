#!/usr/bin/env node
// 평문 DB(data.json)에 새 미팅·인물·기관 레코드를 넣거나 고친다. 규칙은 docs/CONVERT.md.
//
//   node scripts/upsert.mjs <평문 data.json> <patch.json> [--dry-run]
//
// patch.json 형식 (셋 다 선택):
//   { "meetings": [ {id, date, org, …전체 필드} ],          id 같으면 덮어쓰기(준 필드만), 없으면 추가
//     "people":   [ {name, org, title, note, lastSeen, …} ],  id 없으면 org|name 으로 찾음. 빈 연락처만 채우고
//                                                           note·source 는 덧붙이고, 더 최근 lastSeen 이면 직급 갱신
//     "orgs":     [ {id 또는 name, …바꿀 필드, signals:{전략:{s,note,date}}} ],  aliases 는 합치고 signals 는 전략별로 덮어쓰기
//     "delete":   { "meetings": [id…], "people": [id…], "orgs": [id…] } }
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const STRATS = ["PE Buyout","PE Secondary","Co-invest","Growth/VC","PD/DL","Opp Credit/SS","Credit Secondary","인프라 Debt","인프라 Equity","인프라 Secondary","부동산 Debt","부동산 Equity","항공기","Open-end/BDC","헤지펀드","ABF/CLO/구조화","GP Financing"];
const TYPES = ["연기금","공제회","보험","운용사","은행","증권","캐피탈","저축은행","기타","GP","내부"];
const CATS = ["LP","GP","시장정보","내부"];
const STATES = ["약정","진행","관심","보류","불가"];
const M_FIELDS = ["id","date","org","orgType","dept","category","attendees","kbAttendees","assets","body","nextAction","tags","flags","source"];

const [dataPath, patchPath, flag] = process.argv.slice(2);
if (!dataPath || !patchPath) { console.error('사용법: node scripts/upsert.mjs <평문 data.json> <patch.json> [--dry-run]'); process.exit(2); }
const db = JSON.parse(readFileSync(resolve(dataPath), 'utf8'));
const patch = JSON.parse(readFileSync(resolve(patchPath), 'utf8'));
const now = new Date().toISOString();
const errors = [], warns = [], log = [];
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

// ── 삭제 ──
for (const col of ['meetings', 'people', 'orgs']) {
  for (const id of patch.delete?.[col] || []) {
    const i = db[col].findIndex((x) => x.id === id);
    if (i < 0) errors.push(`삭제할 ${col} ${id} 없음`); else { db[col].splice(i, 1); log.push(`삭제 ${col} ${id}`); }
  }
}

// ── 기관 ──
const orgByName = () => {
  const m = new Map();
  for (const o of db.orgs) { m.set(o.name, o); for (const a of o.aliases || []) if (!m.has(a)) m.set(a, o); }
  return m;
};
for (const p of patch.orgs || []) {
  let o = p.id ? db.orgs.find((x) => x.id === p.id) : orgByName().get(p.name);
  if (p.type && !TYPES.includes(p.type)) errors.push(`기관 ${p.name || p.id}: type "${p.type}"`);
  for (const [k, v] of Object.entries(p.signals || {})) {
    if (!STRATS.includes(k)) errors.push(`기관 ${p.name || p.id}: 전략 키 "${k}"`);
    if (v && !STATES.includes(v.s)) errors.push(`기관 ${p.name || p.id}: 시그널 "${v.s}"`);
  }
  if (!o) {
    if (!p.name || !p.type) { errors.push(`새 기관은 name·type 필요: ${JSON.stringify(p).slice(0, 80)}`); continue; }
    o = { id: p.id || 'o-' + createHash('sha1').update(p.name).digest('hex').slice(0, 8), name: p.name, type: p.type, aliases: [], summary: '', prefs: '', ticket: '', process: '', hr: '', signals: {}, basis: '', createdAt: now };
    db.orgs.push(o); log.push(`기관 추가 ${o.name}`);
  } else log.push(`기관 수정 ${o.name}`);
  const { signals, aliases, id, ...rest } = p;
  Object.assign(o, rest);
  if (aliases) o.aliases = [...new Set([...(o.aliases || []), ...aliases])];
  if (signals) { o.signals = { ...(o.signals || {}) }; for (const [k, v] of Object.entries(signals)) { if (v === null) delete o.signals[k]; else o.signals[k] = v; } }
  o.updatedAt = now;
}

// ── 미팅 ──
const known = orgByName();
for (const p of patch.meetings || []) {
  if (!p.id) { errors.push(`미팅 id 없음: ${p.date} ${p.org}`); continue; }
  let m = db.meetings.find((x) => x.id === p.id);
  if (!m) {
    const miss = M_FIELDS.filter((k) => !(k in p));
    if (miss.length) { errors.push(`미팅 ${p.id}: 필드 누락 ${miss.join(',')}`); continue; }
    m = { truncated: false, truncAt: '', createdAt: now };
    db.meetings.push(m); log.push(`미팅 추가 ${p.id}`);
  } else log.push(`미팅 수정 ${p.id}`);
  Object.assign(m, p, { updatedAt: now });
  if (!isDate(m.date)) errors.push(`미팅 ${m.id}: date "${m.date}"`);
  if (!CATS.includes(m.category)) errors.push(`미팅 ${m.id}: category "${m.category}"`);
  if (!TYPES.includes(m.orgType)) errors.push(`미팅 ${m.id}: orgType "${m.orgType}"`);
  const bad = (m.assets || []).filter((a) => !STRATS.includes(a));
  if (bad.length) errors.push(`미팅 ${m.id}: 전략 키 ${bad.join(',')}`);
  const canon = known.get(m.org);
  if (canon && canon.name !== m.org) { warns.push(`미팅 ${m.id}: 기관 "${m.org}" → 표준명 "${canon.name}"`); m.org = canon.name; }
  if (m.category !== '내부' && !canon) warns.push(`미팅 ${m.id}: 기관 "${m.org}" 프로필 없음 → orgs 에 추가하거나 aliases 에 넣기`);
  const dup = db.meetings.filter((x) => x !== m && x.date === m.date && x.org === m.org);
  if (dup.length) warns.push(`미팅 ${m.id}: 같은 날·같은 기관 기존 레코드 ${dup.map((x) => x.id).join(',')} — 중복인지 확인`);
}
db.meetings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

// ── 인물 ──
for (const p of patch.people || []) {
  if (!p.name || !p.org) { errors.push(`인물 name·org 필요: ${JSON.stringify(p).slice(0, 80)}`); continue; }
  const org = known.get(p.org)?.name || p.org;
  const id = p.id || 'p-' + createHash('sha1').update(`${org}|${p.name}`).digest('hex').slice(0, 10);
  let q = db.people.find((x) => x.id === id) || db.people.find((x) => x.org === org && x.name === p.name);
  if (!q) {
    q = { id, name: p.name, org, dept: '', team: '', role: '', title: '', ext: '', phone: '', mobile: '', email: '', note: '', lastSeen: '', source: '', createdAt: now };
    db.people.push(q); log.push(`인물 추가 ${org} ${p.name}`);
  } else log.push(`인물 수정 ${org} ${p.name}`);
  for (const f of ['dept', 'team', 'role', 'ext', 'phone', 'mobile', 'email']) if (p[f]) q[f] = p[f];
  if (p.title && (!q.title || (p.lastSeen || '') >= (q.lastSeen || ''))) q.title = p.title;
  if (p.note && !(q.note || '').includes(p.note)) q.note = ((q.note || '') + ' / ' + p.note).replace(/^ \/ /, '');
  if ((p.lastSeen || '') > (q.lastSeen || '')) q.lastSeen = p.lastSeen;
  if (p.source && !(q.source || '').includes(p.source)) q.source = ((q.source || '') + '; ' + p.source).replace(/^; /, '');
  q.updatedAt = now;
}

db.generatedAt = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
log.forEach((l) => console.log('  ' + l));
warns.forEach((w) => console.log('경고  ' + w));
if (errors.length) { errors.forEach((e) => console.error('오류  ' + e)); console.error('오류가 있어 저장하지 않았습니다.'); process.exit(1); }
console.log(`미팅 ${db.meetings.length} · 기관 ${db.orgs.length} · 인물 ${db.people.length} (${db.generatedAt})`);
if (flag === '--dry-run') console.log('(dry-run — 저장 안 함)');
else writeFileSync(resolve(dataPath), JSON.stringify(db, null, 1) + '\n');
