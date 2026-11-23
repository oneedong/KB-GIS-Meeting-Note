#!/usr/bin/env node
// 월말 대시보드 보관(사용자 요청 2026-11-23: '월말일 기준으로 각각 대시보드 볼 수 있게').
//
//   node scripts/dash_hist.mjs                         dash.enc.json → dash-hist/<그 달>.enc.json
//   node scripts/dash_hist.mjs <SP>/dash-2026-10.enc.json   지난 달을 따로 만든 암호문을 보관(엑셀 기준일을 월말로 다시 계산한 것)
//   node scripts/dash_hist.mjs --force <파일>           같은 달에 더 늦은 기준일이 있어도 바꾼다(잘못 만든 달 고칠 때)
//
// - 암호문을 바이트 그대로 dash-hist/YYYY-MM.enc.json 으로 복사한다 — git 은 같은 내용을 한 번만 저장하므로 저장소가 커지지 않는다.
// - 달은 암호문 겉의 asof(vault.mjs 가 대시보드에 붙이는 기준일, 없으면 generatedAt 날짜). 비밀번호가 필요 없다.
// - 같은 달에 이미 있으면 기준일이 같거나 늦을 때만 바꾼다 → 그 달 마지막 업데이트 = 그 달 월말 대시보드.
// - dash-hist/index.json 에는 달·기준일·만든 시각만(데이터 없음). 앱은 이 목록으로 '기준' 고르기를 만든다.
// - GitHub Actions(.github/workflows/dash-hist.yml)가 dash.enc.json 이 바뀔 때마다 돌린다 — 매일 대시보드 업데이트에서 따로 할 일 없음.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'dash-hist'), IDX = join(DIR, 'index.json');
const args = process.argv.slice(2);
const force = args.includes('--force');
const files = args.filter((a) => a !== '--force');
if (!files.length) files.push(join(ROOT, 'dash.enc.json'));

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const envOf = (f) => {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  if (!j.ct || !j.iv || !j.salt || j.sheets || j.summary) throw new Error(`${f} 는 암호문(vault.mjs encrypt) 형식이 아닙니다`);
  const asof = DAY.test(String(j.asof || '')) ? j.asof : String(j.generatedAt || '').slice(0, 10);
  if (!DAY.test(asof)) throw new Error(`${f} 에서 기준일을 찾지 못했습니다(asof·generatedAt 없음)`);
  return { asof, gen: String(j.generatedAt || ''), salt: j.salt };
};

const idx = existsSync(IDX) ? JSON.parse(readFileSync(IDX, 'utf8')) : { v: 1, months: [] };
const byM = new Map((idx.months || []).map((x) => [x.m, x]));
let changed = 0;
for (const f0 of files) {
  const f = resolve(f0), e = envOf(f), m = e.asof.slice(0, 7), out = join(DIR, `${m}.enc.json`);
  const prev = byM.get(m);
  const base = existsSync(join(ROOT, 'data.enc.json')) ? JSON.parse(readFileSync(join(ROOT, 'data.enc.json'), 'utf8')).salt : null;
  if (base && e.salt !== base) { console.error(`${f0}: 미팅노트(data.enc.json)와 salt 가 다릅니다 — 앱에서 열 수 없어 보관하지 않습니다(--salt-from data.enc.json 으로 암호화)`); process.exitCode = 1; continue; }
  if (prev && !force && prev.asof > e.asof) { console.log(`${m}: 이미 더 늦은 기준일 ${prev.asof} 보관 — ${e.asof} 는 건너뜀`); continue; }
  const bytes = readFileSync(f);
  if (existsSync(out) && readFileSync(out).equals(bytes) && prev && prev.asof === e.asof) { console.log(`${m}: 그대로(기준일 ${e.asof})`); continue; }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(out, bytes);
  byM.set(m, { m, asof: e.asof, gen: e.gen });
  changed++;
  console.log(`${m}: 보관 ← ${f0} (기준일 ${e.asof}${prev ? `, 이전 ${prev.asof}` : ''})`);
}
if (changed) {
  const months = [...byM.values()].sort((a, b) => (a.m < b.m ? 1 : -1));
  writeFileSync(IDX, JSON.stringify({ v: 1, months }, null, 1) + '\n');
  console.log(`index.json — ${months.map((x) => `${x.m}(${x.asof})`).join(' · ')}`);
}
