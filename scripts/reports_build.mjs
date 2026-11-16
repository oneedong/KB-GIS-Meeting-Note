#!/usr/bin/env node
// 운용보고서 탭 데이터 만들기 — 펀드별 정리(JSON)를 검사·정리해 앱이 읽는 reports.json 으로 묶는다.
//   node scripts/reports_build.mjs <SP>/reports.src.json <SP>/reports.json
//   node scripts/reports_build.mjs <SP>/reports-src/ <SP>/reports.json      (폴더면 그 안의 *.json 하나하나가 펀드 1개)
// 그다음: node scripts/vault.mjs encrypt <SP>/reports.json reports.enc.json --salt-from data.enc.json
// 형식·작성 원칙은 docs/REPORTS.md. 평문(src·reports.json·운용보고서 PDF)은 스크래치패드에만 둔다.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('사용법: node scripts/reports_build.mjs <src.json|폴더> <reports.json>'); process.exit(2); }

let head = {}, funds = [];
const p = resolve(src);
if (statSync(p).isDirectory()) {
  funds = readdirSync(p).filter((f) => f.endsWith('.json')).sort().map((f) => ({ id: basename(f, '.json'), ...JSON.parse(readFileSync(join(p, f), 'utf8')) }));
} else {
  const j = JSON.parse(readFileSync(p, 'utf8'));
  if (Array.isArray(j)) funds = j; else { ({ funds = [], ...head } = j); }
}

const LV = ['high', 'mid', 'low'], TR = ['악화', '신규', '유지', '개선', '비교불가'], HL = ['ok', 'watch', 'concern'];
const CATS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const errs = [], warns = [];
const arr = (x) => (Array.isArray(x) ? x : []);
const str = (x) => (x == null ? null : String(x).trim() || null);
const ids = new Set();

const clean = funds.map((f, i) => {
  const at = `${f.short || f.id || '#' + (i + 1)}`;
  const e = (m) => errs.push(`${at}: ${m}`), w = (m) => warns.push(`${at}: ${m}`);
  if (!f.id || !/^[a-z0-9][a-z0-9-]*$/.test(f.id)) e(`id 는 영문 소문자·숫자·- 로 (지금 '${f.id ?? ''}')`);
  if (ids.has(f.id)) e(`id 가 겹칩니다 (${f.id})`); ids.add(f.id);
  for (const k of ['short', 'manager', 'fundName', 'period']) if (!str(f[k])) e(`${k} 가 비었습니다`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.asOf || '')) e(`asOf 는 YYYY-MM-DD (지금 '${f.asOf ?? ''}')`);
  if (!['feeder', 'multi'].includes(f.structure)) e(`structure 는 feeder 또는 multi`);
  const o = {
    id: f.id, order: Number.isFinite(+f.order) ? +f.order : i + 1, short: str(f.short), manager: str(f.manager), underlying: str(f.underlying),
    fundName: str(f.fundName), structure: f.structure, asOf: f.asOf, period: str(f.period), asOfNote: str(f.asOfNote),
    fileName: str(f.fileName), updatedAt: str(f.updatedAt || f.addedAt) ? String(f.updatedAt || f.addedAt).slice(0, 10) : null,
  };
  CATS.forEach((c) => { const g = f[c] && typeof f[c] === 'object' ? f[c] : {}; o[c] = Object.fromEntries(Object.entries(g).map(([k, v]) => [k, str(v)])); if (!f[c]) w(`${c} 항목이 없습니다`); });
  o.holdings = arr(f.holdings).map((h, j) => {
    if (!str(h.name)) e(`holdings[${j}] name 이 비었습니다`);
    if (!HL.includes(h.level)) e(`holdings[${j}] level 은 ${HL.join('|')} (지금 '${h.level}')`);
    return { name: str(h.name), type: str(h.type), size: str(h.size), terms: str(h.terms), asOf: str(h.asOf), level: h.level, status: str(h.status) };
  });
  o.nonaccrual = arr(f.nonaccrual).map((n) => ({ name: str(n.name), ind: str(n.ind), principal: str(n.principal), fv: str(n.fv), pct: str(n.pct), note: str(n.note) }));
  o.watchlist = arr(f.watchlist).map((x) => ({ name: str(x.name), ind: str(x.ind), principal: str(x.principal), pct: str(x.pct), rating: x.rating == null || x.rating === '' ? null : Number(x.rating), tag: str(x.tag) }));
  o.issues = arr(f.issues).map((x, j) => {
    if (!str(x.asset)) e(`issues[${j}] asset 이 비었습니다`);
    if (!LV.includes(x.level)) e(`issues[${j}] level 은 ${LV.join('|')} (지금 '${x.level}')`);
    const trend = x.trend || '비교불가';
    if (!TR.includes(trend)) e(`issues[${j}] trend 는 ${TR.join('|')} (지금 '${x.trend}')`);
    if (!str(x.summary)) w(`이슈자산 '${x.asset}' 요약(summary)이 없습니다`);
    return { asset: str(x.asset), type: arr(x.type).map(str).filter(Boolean), level: x.level, trend, exposure: str(x.exposure), asOf: str(x.asOf),
      summary: str(x.summary), metrics: arr(x.metrics).map(str).filter(Boolean), history: arr(x.history).filter((hh) => hh && (hh.d || hh.t)).map((hh) => ({ d: str(hh.d), t: str(hh.t) })),
      gp: str(x.gp), question: str(x.question), related: str(x.related) };
  });
  o.flags = arr(f.flags).map((x, j) => {
    if (!LV.includes(x.level)) e(`flags[${j}] level 은 ${LV.join('|')}`);
    if (!str(x.title)) e(`flags[${j}] title 이 비었습니다`);
    return { level: x.level, title: str(x.title), target: str(x.target), detail: str(x.detail), response: str(x.response), question: str(x.question) };
  });
  for (const k of ['gaps', 'checks', 'derived']) o[k] = arr(f[k]).map(str).filter(Boolean);
  return o;
}).sort((a, b) => a.order - b.order);

// 화면에 'undefined'·'NaN' 이 찍히지 않게
const txt = JSON.stringify(clean);
if (/\bundefined\b|\bNaN\b/.test(txt)) errs.push("'undefined' 또는 'NaN' 글자가 들어 있습니다");
if (!clean.length) errs.push('펀드가 하나도 없습니다');

warns.forEach((m) => console.warn('경고  ' + m));
if (errs.length) { errs.forEach((m) => console.error('오류  ' + m)); process.exit(1); }

const kst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const data = {
  kind: 'reports', title: head.title || '운용보고서', generatedAt: head.generatedAt || kst,
  notice: head.notice || '내부용 — 운용보고서·GP 자료를 LP 관점으로 요약한 것입니다. 외부 배포 금지.',
  funds: clean,
};
writeFileSync(resolve(out), JSON.stringify(data, null, 1) + '\n');
const n = (k) => clean.reduce((a, f) => a + f[k].length, 0);
console.log(`운용보고서 → ${out}  펀드 ${clean.length}개 · 이슈자산 ${n('issues')}건 · 펀드 이슈 ${n('flags')}건 · 편입자산 ${n('holdings')}건 · 기준일 ${[...new Set(clean.map((f) => f.asOf))].sort().join(', ')}`);
