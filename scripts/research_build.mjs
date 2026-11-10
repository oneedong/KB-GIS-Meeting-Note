#!/usr/bin/env node
// 리서치 탭 데이터 만들기 — 자산군별 요약(JSON)에 A4 1쪽 PDF 를 붙여 research.json 을 만든다(이후 vault.mjs 로 암호화).
//
//   node scripts/research_build.mjs <SP>/research.src.json <SP>/research.json [--data <SP>/data.json] [--font-dir <Pretendard woff2 폴더>]
//
// - research.src.json: 리포트를 읽고 정리한 내용(형식은 docs/RESEARCH.md). 구독 리포트 요약이라 평문은 저장소에 두지 않는다.
// - --data: 복호화한 미팅노트 DB. 주면 '전략 수요판' 집계(전략별 진행·관심·약정 기관 수)를 PDF 에 함께 싣는다.
// - PDF 는 Chromium 으로 그린다. 한 쪽을 넘치면 글자 배율을 줄여 맞추고, 끝에 쪽수가 1인지 확인한다(아니면 실패).
// - --font-dir: Pretendard woff2 가 든 폴더(예: npm pack @fontsource/pretendard → package/files). 없으면 시스템 글꼴.
import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const dataPath = opt('--data'), fontDir = opt('--font-dir');
const [srcPath, outPath] = args;
if (!srcPath || !outPath) { console.error('사용법: node scripts/research_build.mjs <research.src.json> <research.json> [--data data.json] [--font-dir dir]'); process.exit(2); }

const R = JSON.parse(readFileSync(resolve(srcPath), 'utf8'));
if (R.kind !== 'research' || !Array.isArray(R.reports) || !R.reports.length) throw new Error('kind:"research" · reports 배열이 필요합니다');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
R.generatedAt = now;

// ── 전략 수요판 집계(선택) ────────────────────────────────────────────
const STATES = ['진행', '관심', '약정'];
if (dataPath) {
  const db = JSON.parse(readFileSync(resolve(dataPath), 'utf8'));
  const orgs = (db.orgs || []).filter((o) => o.signals && Object.keys(o.signals).length);
  const count = (ks) => {
    const rows = ks.map((k) => { const n = { k }; STATES.forEach((s) => { n[s] = orgs.filter((o) => (o.signals[k] || {}).s === s).length; }); return n; });
    const lp = orgs.filter((o) => ks.some((k) => STATES.includes((o.signals[k] || {}).s))).length;
    return { rows, lp };
  };
  const asof = String(db.generatedAt || '').slice(0, 10);
  for (const r of R.reports) if ((r.strats || []).length) r.demand = { asof, ...count(r.strats) };
  const all = R.reports.find((r) => r.id === 'all');
  if (all) all.demand = { asof, groups: R.reports.filter((r) => r.demand && r.id !== 'all').map((r) => ({ k: r.short || r.name, lp: r.demand.lp, ...Object.fromEntries(STATES.map((s) => [s, r.demand.rows.reduce((a, x) => a + x[s], 0)])) })) };
}

// ── A4 1쪽 HTML ───────────────────────────────────────────────────────
const fonts = (() => {
  if (!fontDir || !existsSync(fontDir)) return '';
  const files = readdirSync(fontDir);
  return [400, 500, 600, 700, 800].map((w) => {
    const f = files.find((x) => new RegExp(`-${w}-normal\\.woff2$`).test(x)) || files.find((x) => new RegExp(`${w}.*\\.woff2$`).test(x));
    return f ? `@font-face{font-family:"Pretendard";font-weight:${w};font-style:normal;src:url("${pathToFileURL(join(resolve(fontDir), f)).href}") format("woff2")}` : '';
  }).join('\n');
})();

const CSS = `
${fonts}
@page{size:A4;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:210mm;height:297mm}
body{font-family:"Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic","WenQuanYi Zen Hei",sans-serif;color:#2A2621;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-variant-numeric:tabular-nums;word-break:keep-all;overflow-wrap:anywhere}
.sheet{width:210mm;height:297mm;padding:9mm 11mm 7mm;display:flex;flex-direction:column;overflow:hidden;font-size:calc(8.3pt*var(--k));line-height:1.47}
.top{display:flex;align-items:center;gap:7pt;padding-bottom:5pt;border-bottom:1.6pt solid #2A2621}
.mark{width:19pt;height:19pt;border-radius:5pt;background:#FFBC00;color:#3A342C;font-weight:800;font-size:8.5pt;display:grid;place-items:center}
.top b{font-size:9.5pt;font-weight:700}.top span{margin-left:auto;font-size:8pt;color:#6E665B;font-weight:500}
.ttl{margin-top:calc(7pt*var(--k));display:flex;align-items:baseline;gap:7pt}
.ttl h1{font-size:calc(19pt*var(--k));font-weight:800;letter-spacing:-.01em}.ttl em{font-style:normal;font-size:calc(9.5pt*var(--k));color:#6E665B;font-weight:600}
.hl{margin-top:calc(3pt*var(--k));font-size:calc(10.6pt*var(--k));font-weight:700;line-height:1.38;padding-left:7pt;border-left:3pt solid #FFBC00}
.kp{margin-top:calc(8pt*var(--k));display:grid;grid-template-columns:repeat(var(--kn),1fr);gap:5pt}
.k{border:.7pt solid #DCD7CC;border-top:2.2pt solid #FFBC00;border-radius:4pt;padding:calc(4.5pt*var(--k)) 6pt calc(4pt*var(--k))}
.k.ok{border-top-color:#2F7A4F}.k.warn{border-top-color:#B4532A}
.k .l{font-size:calc(7.3pt*var(--k));color:#6E665B;font-weight:600}.k .v{font-size:calc(14.5pt*var(--k));font-weight:800;line-height:1.2;letter-spacing:-.01em}
.k .s{font-size:calc(6.9pt*var(--k));color:#4A443B;line-height:1.32;margin-top:1pt}
.sheet>*{flex:none}
.body{margin-top:calc(8pt*var(--k));display:flex;flex-direction:column;gap:calc(7pt*var(--k))}
h2{font-size:calc(8.8pt*var(--k));font-weight:800;display:flex;align-items:center;gap:4pt;margin-bottom:calc(1.6pt*var(--k))}
h2::before{content:"";width:5pt;height:5pt;background:#FFBC00;border-radius:1pt;flex:none}
ul{list-style:none}li{position:relative;padding-left:8pt;margin-top:calc(1.5pt*var(--k))}li::before{content:"";position:absolute;left:1pt;top:.62em;width:2.6pt;height:2.6pt;border-radius:50%;background:#8F8676}
.two{display:grid;grid-template-columns:1fr 1fr;gap:calc(7pt*var(--k)) 14pt}
.ch{margin-top:calc(6pt*var(--k));display:grid;grid-template-columns:repeat(var(--cn),1fr);gap:5pt}
.c{border:.7pt solid #DCD7CC;border-radius:4pt;padding:calc(4pt*var(--k)) 7pt 2pt;min-width:0;display:grid;grid-template-columns:auto 1fr;align-items:end;column-gap:6pt}
.c>div{align-self:start}
.c b{display:block;font-size:calc(7.4pt*var(--k));font-weight:700;line-height:1.25}.c small{font-size:calc(6.4pt*var(--k));color:#6E665B}
.c svg{display:block;width:100%;height:calc(40pt*var(--k));justify-self:end}
.out{background:#F1EEE7;border-radius:4pt;padding:calc(5pt*var(--k)) 7pt}
.ins{margin-top:calc(8pt*var(--k));background:#FFF6DC;border:.8pt solid #F0D58A;border-radius:5pt;padding:calc(6pt*var(--k)) 9pt calc(6.5pt*var(--k))}
.ins h2::before{background:#2A2621}.ins li{font-weight:500}.ins li::before{background:#B08900}
.dm{margin-top:calc(6pt*var(--k));display:flex;flex-wrap:wrap;gap:3pt 5pt;align-items:center;font-size:calc(7.3pt*var(--k))}
.dm>b{font-weight:800;margin-right:2pt}.dm span{border:.6pt solid #DCD7CC;border-radius:99pt;padding:.6pt 6pt;background:#fff;white-space:nowrap}.dm span i{font-style:normal;color:#6E665B}
table{width:100%;border-collapse:collapse;font-size:calc(7.9pt*var(--k))}th,td{text-align:left;padding:calc(2.6pt*var(--k)) 5pt;border-bottom:.6pt solid #DCD7CC;vertical-align:top}
th{background:#F1EEE7;font-weight:700;font-size:calc(7.3pt*var(--k));color:#4A443B}td:first-child{font-weight:800;white-space:nowrap}
.ft{margin-top:auto;padding-top:calc(5pt*var(--k));border-top:.6pt solid #DCD7CC;font-size:6.4pt;color:#6E665B;line-height:1.4;display:flex;gap:10pt;justify-content:space-between}
.ft div:last-child{white-space:nowrap;text-align:right}
`;

function bars(c) {
  // 막대 2~4개 — 마지막(최근) 막대는 노랑, 나머지는 회색. 값은 원문에 나온 숫자만.
  const W = 150, H = 62, B = 13, T = 12, n = c.v.length, mx = Math.max(...c.v.map(Math.abs)) || 1;
  const gw = W / n, bw = Math.min(30, gw * 0.5);
  const f = (v) => (c.f === 'n1' ? v.toFixed(1) : String(Math.round(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax meet" role="img" aria-label="${esc(c.title)}"><line x1="0" y1="${H - B}" x2="${W}" y2="${H - B}" stroke="#DCD7CC" stroke-width=".8"/>`;
  c.v.forEach((v, i) => {
    const h = Math.max(1.5, (H - B - T) * Math.abs(v) / mx), x = gw * i + (gw - bw) / 2, y = H - B - h;
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.6" fill="${i === n - 1 ? '#FFBC00' : '#8F8676'}"/>`
      + `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 2.6).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#2A2621">${f(v)}</text>`
      + `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle" font-size="8.4" fill="#6E665B">${esc(c.cats[i])}</text>`;
  });
  return s + '</svg>';
}
const ul = (items) => `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
const sec = (s) => `<section><h2>${esc(s.h)}</h2>${ul(s.items)}</section>`;

function demandHtml(r) {
  const d = r.demand; if (!d) return '';
  if (d.groups) return `<div class="dm"><b>국내 LP 수요(전략 수요판 ${esc(d.asof)})</b>${d.groups.map((g) => `<span>${esc(g.k)} <i>기관</i> ${g.lp} · <i>진행</i> ${g['진행']} · <i>관심</i> ${g['관심']} · <i>약정</i> ${g['약정']}</span>`).join('')}</div>`;
  return `<div class="dm"><b>국내 LP 수요(전략 수요판 ${esc(d.asof)}) — 관심 이상 ${d.lp}개 기관</b>${d.rows.map((x) => `<span>${esc(x.k)} <i>진행</i> ${x['진행']} · <i>관심</i> ${x['관심']} · <i>약정</i> ${x['약정']}</span>`).join('')}</div>`;
}

function pageHtml(r, k) {
  const kn = Math.min((r.kpis || []).length, r.id === 'all' ? 5 : 3) || 1;
  const kpis = (r.kpis || []).map((x) => `<div class="k ${esc(x.tone || '')}"><div class="l">${esc(x.l)}</div><div class="v">${esc(x.v)}</div><div class="s">${esc(x.s || '')}</div></div>`).join('');
  const charts = (r.charts || []).length ? `<div class="ch" style="--cn:${r.charts.length}">${r.charts.map((c) => `<div class="c"><div><b>${esc(c.title)}</b><small>${esc(c.sub || '')}</small></div>${bars(c)}</div>`).join('')}</div>` : '';
  const table = r.table ? `<section><h2>${esc(r.table.title)}</h2><table><thead><tr>${r.table.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${r.table.rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>` : '';
  const outlook = (r.outlook || []).length ? `<section class="out"><h2>Preqin의 시각</h2>${ul(r.outlook)}</section>` : '';
  const secs = r.sections || [];
  const body = `<div class="body">${table}<div class="two">${secs.map(sec).join('')}</div>${outlook}</div>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(R.title)} ${esc(R.period)} — ${esc(r.name)}</title><style>${CSS}</style></head>
<body><div class="sheet" style="--k:${k};--kn:${kn}">
  <div class="top"><div class="mark">KB</div><b>KB GIS 리서치 노트</b><span>${esc(R.title)} · ${esc(R.period)}</span></div>
  <div class="ttl"><h1>${esc(r.name)}</h1><em>${esc(r.en || '')}</em></div>
  <p class="hl">${esc(r.headline || '')}</p>
  <div class="kp">${kpis}</div>
  ${charts}
  ${body}
  <section class="ins"><h2>KB GIS 시사점</h2>${ul(r.insights || [])}${demandHtml(r)}</section>
  <div class="ft"><div>${esc(R.notice || '')}<br>출처: ${esc(R.source || '')}</div><div>글로벌상품영업부 · ${esc(now.slice(0, 10))}</div></div>
</div></body></html>`;
}

// ── PDF 만들기 ────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'research-'));
const browser = await chromium.launch();
const page = await browser.newPage();
const pagesOf = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
try {
  for (const r of R.reports) {
    let k = 1.6, fit = false;
    const file = join(tmp, `${r.id}.html`);
    for (let i = 0; i < 60; i++) {
      writeFileSync(file, pageHtml(r, k.toFixed(3)));
      await page.goto(pathToFileURL(file).href);
      await page.evaluate(() => document.fonts.ready);
      // 넘침 = 시트 내용이 A4 높이를 넘거나, 맨 아래 출처 줄이 아래 여백을 침범할 때
      const over = await page.evaluate(() => { const s = document.querySelector('.sheet'), f = document.querySelector('.ft'); return s.scrollHeight > s.clientHeight + 1 || f.getBoundingClientRect().bottom > s.getBoundingClientRect().bottom - 18; });
      if (!over) { fit = true; break; }
      k -= 0.015;
    }
    if (!fit) throw new Error(`${r.id}: 내용이 A4 한 쪽에 들어가지 않습니다 — 항목을 줄이세요`);
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    const n = pagesOf(pdf);
    if (n !== 1) throw new Error(`${r.id}: PDF 가 ${n}쪽입니다(1쪽이어야 함)`);
    r.pdf = pdf.toString('base64');
    // 파일 이름은 영문만: 한글 이름은 일부 환경에서 'download'(확장자 없음)로 바뀐다
    r.pdfName = `KB_GIS_Research_${String(R.periodKey || '').replace(/[^A-Za-z0-9]+/g, '')}_${String(r.en || r.id).replace(/[^A-Za-z0-9]+/g, '')}.pdf`;
    console.log(`  ${r.id.padEnd(4)} ${r.name} — 1쪽 · 글자 배율 ${k.toFixed(3)} · ${(pdf.length / 1024).toFixed(0)}KB${r.demand ? ' · 수요판 포함' : ''}`);
    if (process.env.RESEARCH_KEEP_PDF) writeFileSync(join(process.env.RESEARCH_KEEP_PDF, r.pdfName), pdf);
  }
} finally { await browser.close(); rmSync(tmp, { recursive: true, force: true }); }

writeFileSync(resolve(outPath), JSON.stringify(R));
console.log(`research.json → ${outPath}  리포트 ${R.reports.length}개 · ${(JSON.stringify(R).length / 1e6).toFixed(2)}MB (${now})`);
