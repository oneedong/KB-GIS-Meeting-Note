// 앱 점검 — 가상 데이터(tests/fixture.json)를 테스트 비밀번호로 암호화해 실제 브라우저에서 연다.
// 실제 data.enc.json·비밀번호는 쓰지 않는다.   node tests/smoke.mjs
import { createRequire } from 'module';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PW = 'smoke-test-password';
const ENC = join(ROOT, 'tests', '_fixture.enc.json');
execFileSync(process.execPath, [join(ROOT, 'scripts/vault.mjs'), 'encrypt', join(ROOT, 'tests/fixture.json'), ENC],
  { env: { ...process.env, MEETING_DB_PASSWORD: PW }, stdio: 'inherit' });
// 가상 대시보드(tests/dash-fixture.json)도 같은 비밀번호·salt 로 — 앱은 미팅노트를 연 키로 대시보드를 연다
const DENC = join(ROOT, 'tests', '_dash.enc.json');
execFileSync(process.execPath, [join(ROOT, 'scripts/vault.mjs'), 'encrypt', join(ROOT, 'tests/dash-fixture.json'), DENC, '--salt-from', ENC],
  { env: { ...process.env, MEETING_DB_PASSWORD: PW }, stdio: 'inherit' });
// 가상 리서치(tests/research-fixture.json): A4 1쪽 PDF 를 만들어 붙이고(research_build) 같은 비밀번호·salt 로 잠근다
const RJSON = join(ROOT, 'tests', '_research.json'), RENC = join(ROOT, 'tests', '_research.enc.json');
execFileSync(process.execPath, [join(ROOT, 'scripts/research_build.mjs'), join(ROOT, 'tests/research-fixture.json'), RJSON, '--data', join(ROOT, 'tests/fixture.json')], { stdio: 'inherit' });
execFileSync(process.execPath, [join(ROOT, 'scripts/vault.mjs'), 'encrypt', RJSON, RENC, '--salt-from', ENC],
  { env: { ...process.env, MEETING_DB_PASSWORD: PW }, stdio: 'inherit' });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = p === '/data.enc.json' ? ENC : p === '/dash.enc.json' ? DENC : p === '/research.enc.json' ? RENC : join(ROOT, p);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(0);
const URL_ = `http://localhost:${server.address().port}/`;

let fail = 0;
const ok = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) fail++; };

// 원문 보존 검사: body 가 raw 에 글자 그대로면 통과, 다듬으면 저장 거부
{
  const tmp = (n, o) => { const f = join(ROOT, 'tests', `_${n}.json`); writeFileSync(f, JSON.stringify(o)); return f; };
  const raw = '[가상] 2/1 미팅\n홍길동 TJ 왈 올해 PD는 2건 정도\n--> 하반기 재접촉';
  const base = { id: '20260201-x', date: '2026-02-01', org: '샘플공제회', orgType: '공제회', dept: '', category: 'LP', attendees: '', kbAttendees: '', assets: [], nextAction: '', tags: [], flags: [], source: '테스트', raw };
  const db = tmp('upsert-db', JSON.parse(readFileSync(join(ROOT, 'tests/fixture.json'), 'utf8')));
  const run = (patch) => { try { execFileSync(process.execPath, [join(ROOT, 'scripts/upsert.mjs'), db, tmp('upsert-patch', patch), '--dry-run'], { stdio: 'pipe' }); return true; } catch { return false; } };
  ok('숫자가 원문에 있는 요약정리는 저장', run({ meetings: [{ ...base, body: '*최근 투자현황/계획\n- 올해 PD 2건 정도 검토\n--> 하반기 재접촉' }] }));
  ok('원문에 없는 숫자가 든 요약정리는 저장 거부', !run({ meetings: [{ ...base, body: '*최근 투자현황/계획\n- 올해 PD 3건, USD 50mn 투자 예정\n--> 하반기 재접촉' }] }));
}

// 보안 정책(CSP): 인라인 스크립트 해시가 index.html 과 맞는지
ok('CSP 해시 맞음', (() => { try { execFileSync(process.execPath, [join(ROOT, 'scripts/csp.mjs'), '--check'], { stdio: 'pipe' }); return true; } catch { return false; } })());

// 대시보드 다듬기(scripts/dash_curate.py): 작업 기록(금감원 보고·출처 설명·시트별 열)을 빼고 시트 순서·묶음·숨김을 정한다
{
  const f = join(ROOT, 'tests', '_curate.json');
  const tbl = (title, cols) => ({ t: 'table', title, cols: cols.map((l, i) => ({ k: 'c' + i, l, f: 'text' })), rows: [{ c: Object.fromEntries(cols.map((l, i) => ['c' + i, '가상'])) }] });
  writeFileSync(f, JSON.stringify({ fx: { usd: 1000 }, sheets: [
    { name: '2026 RFP·RFI', group: 'x', short: 'x', view: [tbl('목록', ['기관'])] },
    { name: '검증', group: 'x', short: 'x', view: [] },
    { name: '약정 통계', group: 'x', short: 'x', view: [
      { t: 'kpis', items: [{ l: '약정 건수', v: 1, s: '수수료 USD 1,000,000' }, { l: '금감원 보고 중', v: 1 }] },
      { t: 'notes', items: ['가상 출처 설명'] },
      tbl('금감원 보고 여부별', ['구분']),
      tbl('기관별 — 2010~현재 (기관명 통일 집계)', ['기관명', '2010~21 약정 건수', 'USD 환산', '함께 집계한 표기'])] },
    { name: 'KPI 실적 요약', group: 'x', short: 'x', view: [] },
    { name: '가상 시딩 관리판', group: 'x', short: 'x', view: [
      { t: 'kpis', items: [{ l: '약정금액(원화 환산)', v: 1 }, { l: '누적 인출', v: 1 }] },
      { t: 'table', id: 'sd', cols: [{ k: 'no', l: 'No', f: 'n0' }, { k: 'ck', l: '약정(억원)', f: 'wk' }, { k: 'cfx', l: '약정(외화)' }], rows: [
        { c: { no: 1, ac: 'PE', ap: 300000000, apc: 'KRW', ck: 298000000, cf: 220000, cfx: 'USD 220,000', dr: 100000000 } },
        { c: { no: 2, ac: 'PC', ap: 100000, apc: 'USD', ck: 80000000, dr: 100000000 } }] },
      { t: 'table', id: 'sm', cols: [{ k: 'C', l: '자산군' }, { k: 'D', l: '개수', f: 'n0' }, { k: 'E', l: '약정금액(원)', f: 'won' }],
        rows: [{ c: { C: 'PE', D: 1, E: 1 } }, { c: { C: 'PC', D: 1, E: 1 } }], foot: [{ c: { C: '합계', D: 2, E: 2 } }] }] }] }));
  execFileSync('python3', [join(ROOT, 'scripts/dash_curate.py'), f], { stdio: 'pipe' });
  execFileSync('python3', [join(ROOT, 'scripts/dash_curate.py'), f], { stdio: 'pipe' });   // 두 번 돌려도 같아야 한다
  const c = JSON.parse(readFileSync(f, 'utf8')), st = c.sheets.find((x) => x.name === '약정 통계');
  ok('대시보드 다듬기: 시트 순서·검증 숨김', c.sheets.map((x) => x.short).join(',') === 'KPI 실적 요약,RFP·RFI,약정 현황 (2010~),시딩 관리판');
  {
    const sd = c.sheets.find((x) => x.short === '시딩 관리판').view, fund = sd[1].rows.map((r) => r.c);
    ok('시딩 약정 = 심사 승인금액(원화 그대로·외화는 기준일 환율)', fund[0].ck === 300000000 && !fund[0].cfx && fund[1].ck === 100000000 && fund[1].cfx === 'USD 100,000.00'
      && sd[0].items[0].v === 4 && sd[0].items[1].s === '소진율 50.0%' && sd[2].rows[0].c.E === 300000000 && sd[2].foot[0].c.E === 400000000);
  }
  ok('대시보드 다듬기: 금감원·출처 설명 빼고 합계 열만', st.view.length === 2 && st.view[0].items.length === 1
    && st.view[1].cols.map((x) => x.l).join(',') === '기관명,USD 환산' && st.view[1].title === '기관별 (2010~현재)');
  ok('대시보드 다듬기: 억원 함께(카드 문장 한 번만)', st.view[0].items[0].s === '수수료 USD 1,000,000 (≈ 10.00억)');
}

// 금액은 소수점 둘째 자리(Fee·약정금액 등): 금액 칸·카드·막대만 2자리 형식으로, 건수·원 단위는 그대로
{
  const f = join(ROOT, 'tests', '_money.json');
  writeFileSync(f, JSON.stringify({ fx: { usd: 1000 }, sheets: [{ name: '가상 약정', group: 'x', short: 'x', view: [
    { t: 'kpis', items: [{ l: '2026 약정', v: 1, f: 'n0', u: 'USD M' }, { l: '등록 건수', v: 3, f: 'n0', u: '건' }] },
    { t: 'bars', title: '가상 순위', sub: '억원', f: 'eok1', items: [{ l: 'a', v: 1 }] },
    { t: 'table', title: '가상 표', cols: [{ k: 'a', l: '수수료(USD)', f: 'usd' }, { k: 'b', l: '약정 건수', f: 'n0' }, { k: 'c', l: '총약정금액', f: 'amt' },
      { k: 'd', l: 'Fee(bp)', f: 'n1' }, { k: 'e', l: '수익(원)', f: 'won' }, { k: 'g', l: 'KRW 기준', f: 'n0' }], rows: [{ c: { a: 1, b: 1, c: 1, d: 1, e: 1, g: 1 } }] }] }] }));
  execFileSync('python3', [join(ROOT, 'scripts/dash_curate.py'), f], { stdio: 'pipe' });
  const v = JSON.parse(readFileSync(f, 'utf8')).sheets[0].view, fs = Object.fromEntries(v[2].cols.map((x) => [x.l, x.f]));
  ok('금액은 소수점 둘째 자리(금액 칸·카드·막대 → 2자리, 건수·원 단위는 그대로)', v[0].items[0].f === 'n2' && v[0].items[1].f === 'n0' && v[1].f === 'eok'
    && fs['수수료(USD)'] === 'usd2' && fs['총약정금액'] === 'amt2' && fs['Fee(bp)'] === 'n2' && fs['약정 건수'] === 'n0' && fs['수익(원)'] === 'won' && fs['KRW 기준'] === 'n0');
}

const browser = await chromium.launch();
for (const vp of [{ name: '휴대폰', width: 390, height: 844 }, { name: 'PC', width: 1280, height: 860 }]) {
  console.log(`— ${vp.name} ${vp.width}×${vp.height}`);
  // 휴대폰 설정이 다크여도 앱은 라이트로 시작해야 한다
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: 'dark', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/pretendard|ERR_|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
  page.route(/cdn\.jsdelivr\.net/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));

  await page.addInitScript(() => { try { if (!sessionStorage.getItem('t')) { localStorage.setItem('kbnote-seen', '2026-01-01T00:00:00.000Z'); sessionStorage.setItem('t', '1'); } } catch (e) {} });
  await page.goto(URL_);
  await page.locator('#gate').waitFor({ state: 'visible' });
  ok('비밀번호 화면이 뜬다', await page.locator('#gate').isVisible());
  ok('잠금 상태에서는 데이터가 없다', (await page.locator('#mList .item').count()) === 0);

  await page.click('#pwShow');
  ok('비밀번호 보기', (await page.getAttribute('#pw', 'type')) === 'text');
  await page.click('#pwShow');
  await page.fill('#pw', 'wrong-password');
  await page.click('#unlock');
  await page.locator('#gateMsg', { hasText: '맞지 않습니다' }).waitFor();
  ok('틀린 비밀번호는 거절', await page.locator('#gate').isVisible());

  await page.fill('#pw', PW);
  await page.click('#unlock');
  await page.locator('#gate').waitFor({ state: 'hidden' });
  ok('맞는 비밀번호로 열림', (await page.locator('#mList .item').count()) === 2);
  ok('건수 표시', (await page.textContent('#stats')).includes('미팅 2'));
  ok('지난 방문 이후 새 미팅 NEW 표시', (await page.locator('#mList .badge.new').count()) === 2 && await page.locator('#mNewOnly').isVisible());
  ok('추가 버튼 숨김(읽기 전용)', !(await page.locator('#mNew').isVisible()));
  const theme = () => page.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor].join(' '));
  ok('기본은 라이트 모드(휴대폰이 다크여도)', (await theme()) === 'light rgb(247, 246, 243)');
  await page.click('#themeBtn');
  ok('다크 모드로 전환', (await theme()) === 'dark rgb(27, 25, 21)');
  await page.screenshot({ path: join(ROOT, `tests/_${vp.width}-list.png`) });

  await page.locator('#mList .item').first().click();
  await page.locator('#mMain h2').waitFor();
  ok('미팅 상세', (await page.textContent('#mMain')).includes('테스트용 가상 데이터'));
  await page.screenshot({ path: join(ROOT, `tests/_${vp.width}-detail.png`) });

  const tabSel = vp.width < 760 ? '.bnav button' : '.tab';
  ok('약어 사전 탭 없음', (await page.locator('[data-tab="glossary"]').count()) === 0);
  for (const t of ['orgs', 'demand', 'people']) {
    await page.locator(`${tabSel}[data-tab="${t}"]`).click();
    ok(`${t} 탭`, await page.locator(`#p-${t}`).isVisible());
  }
  await page.locator(`${tabSel}[data-tab="demand"]`).click();
  await page.screenshot({ path: join(ROOT, `tests/_${vp.width}-demand.png`) });

  // 대시보드 탭: 같은 키로 열림 → 요약(지표 카드·차트·순위) → 전체 찾기 → 시트 정리 화면(필터·합계·펼침) → 엑셀 원본(머리글 고정·셀 메모)
  await page.locator(`${tabSel}[data-tab="dash"]`).click();
  await page.locator('#dzMain .kc').first().waitFor();
  ok('대시보드 요약 카드', (await page.locator('#dzMain .kc').count()) === 2 && (await page.textContent('#dzMain')).includes('12.30'));
  ok('대시보드 차트(2계열 범례)', (await page.locator('#dzBody svg.ch path').count()) >= 5 && (await page.locator('#dzBody .lg span').count()) === 2);
  ok('순위 막대', (await page.locator('#dzBody .hb-r').count()) === 3);
  ok('검증은 어긋날 때만 표시(3/3 일치 → 배지 없음)', (await page.locator('#dzMain .ck').count()) === 0);
  // 시트 고르기: PC·태블릿은 왼쪽 목록, 휴대폰은 묶음별 선택 상자
  const pickSheet = (name) => vp.width < 760 ? page.selectOption('#dzNav .dz-pick select', name) : page.locator(`.dz-item[data-s="${name}"]`).click();
  if (vp.width < 760) ok('휴대폰 시트 선택 상자(묶음별)', (await page.locator('#dzNav .dz-pick optgroup').count()) >= 1 && !(await page.locator('.dz-item').first().isVisible()));
  ok('요약에 시트 바로가기', (await page.locator('#dzBody .qk').count()) === 2);
  await page.screenshot({ path: join(ROOT, `tests/_${vp.width}-dash.png`), fullPage: vp.width < 760 });
  await page.fill('#gq', 'Demo Partners'); await page.waitForTimeout(400);
  ok('전체 찾기', (await page.locator('#dzBody .gres li').count()) >= 6 && (await page.textContent('#dzBody .gres')).includes('샘플 수익표'));
  await page.locator('#dzBody [data-go]').first().click();
  await page.locator('#dzBody .tb-q').waitFor();
  ok('찾은 시트로 이동·검색어 유지', (await page.inputValue('#dzBody .tb-q')) === 'Demo Partners' && (await page.textContent('#dzBody .tb-n')).startsWith('13건'));
  await page.locator('#dzBody .tb-x').click();
  ok('조건 지우기', (await page.textContent('#dzBody .tb-n')).startsWith('40건'));
  const item = vp.width < 760 ? '#dzBody article.cd' : '#dzBody tr.r';
  ok(vp.width < 760 ? '휴대폰은 카드 목록' : 'PC는 표', (await page.locator(item).count()) === 40);
  ok('묶음 머리·묶음 합계', (await page.locator(vp.width < 760 ? '#dzBody .sec-h' : '#dzBody tr.sec').count()) === 2 && (await page.textContent('#dzBody')).includes('상반기 합계'));
  await page.locator('#dzBody .fchip[data-f="st"][data-v="미수금"]').click();
  ok('필터 칩 → 선택 합계', (await page.textContent('#dzBody .tb-n')).startsWith('10건') && (await page.textContent('#dzBody')).includes('선택한 10건 합계'));
  await page.locator('#dzBody .tb-x').click();
  await page.locator(item).first().click();
  ok('펼치면 세부 내역', (await page.locator('#dzBody .xd .dt.mini tr').count()) === 3);
  await page.screenshot({ path: join(ROOT, `tests/_${vp.width}-dash-sheet.png`) });
  await page.locator('.dz-seg button[data-m="g"]').click();
  await page.locator('#xs td').first().waitFor();
  ok('엑셀 원본 표', (await page.locator('#xs tr').count()) >= 40);
  await page.locator('#xs tr.fz').first().waitFor({ timeout: 3000 }).catch(() => {});   // 고정은 다음 화면 프레임에 붙는다
  ok('원본 머리글 행 고정', (await page.locator('#xs tr.fz').count()) === 1 && (await page.locator('#xs tr.fz').textContent()).includes('운용사'));
  await page.fill('#shq', 'Demo Partners'); await page.waitForTimeout(350);
  ok('원본 안 찾기', /^1\/\d+$/.test((await page.textContent('#shn')).trim()) && (await page.locator('#xs td.cur').count()) === 1);
  await page.locator('#xs td.nt').first().click();
  ok('셀 누르면 전체 글자·메모', await page.locator('#cellbar').isVisible() && (await page.textContent('#cellbar')).includes('가상 메모'));
  await page.locator('.dz-seg button[data-m="v"]').click();
  await pickSheet('__sum');
  await page.locator('.dz-seg button[data-m="g"]').click();
  await page.locator('#xs td').first().waitFor();
  ok('요약의 원본(화면 배치 시트)은 머리글 고정 없음', (await page.locator('#xs tr.fz').count()) === 0);
  await page.locator('.dz-seg button[data-m="v"]').click();

  // 연도별 묶음(tabs, KPI 실적 요약): 처음엔 최근 연도, 단추로 그 해 카드·근거·목록으로 바뀐다
  await pickSheet('가상 연도별');
  await page.locator('#dzBody .yseg button').first().waitFor();
  const ypanel = () => page.textContent('#dzBody .ypanel');
  ok('달러 금액에 억원 함께(기준일 환율 안내 포함)', /≈ [\d,.]+억원/.test(await page.textContent('#dzBody .ypanel .kc-k')) && (await page.locator('#dzBody .krwnote').count()) === 1);
  ok('연도 단추·처음엔 최근 연도', (await page.locator('#dzBody .yseg button').count()) === 2
    && (await page.getAttribute('#dzBody .yseg button[data-k="2026"]', 'aria-pressed')) === 'true' && (await ypanel()).includes('가상 근거 2026'));
  await page.locator('#dzBody .yseg button[data-k="2025"]').click();
  ok('연도 바꾸기', (await ypanel()).includes('가상 근거 2025') && !(await ypanel()).includes('가상 근거 2026')
    && (await page.textContent('#dzBody .ypanel .fold summary')).includes('2건'));
  await page.locator('#dzBody .ypanel .fold summary').click();
  ok('그 해 목록 펼치기', (await page.textContent('#dzBody .ypanel .fold')).includes('가상 GP 2025-2'));
  ok('연도 화면 가로 넘침 없음', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await pickSheet('__sum');

  // 리서치 탭: 자산군 단추·지표 카드·차트·시사점·국내 LP 수요(수요판 연결), PDF 받기(A4 1쪽)
  await page.locator(`${tabSel}[data-tab="research"]`).click();
  await page.locator('#rsMain .rs-seg button').first().waitFor();
  ok('리서치: 자산군 단추·지표 카드·표', (await page.locator('#rsMain .rs-seg button').count()) === 2 && (await page.locator('#rsKpi .kc').count()) === 2
    && (await page.textContent('#rsMain .rs-hl')).includes('가상 종합 헤드라인') && (await page.locator('#rsMain .rs-tbl tbody tr').count()) === 1);
  await page.locator('#rsMain .rs-seg button[data-k="fa"]').click();
  ok('리서치: 자산군 바꾸기·차트·시사점·국내 LP 수요', (await page.textContent('#rsMain .rs-hl')).includes('가상 자산군 헤드라인') && (await page.locator('#rsCh svg rect').count()) === 2
    && (await page.textContent('#rsMain .rs-ins')).includes('가상 시사점 둘') && (await page.locator('#rsMain .rs-st[data-strat="PE Buyout"]').count()) === 1);
  ok('리서치 화면 가로 넘침 없음', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#rsPdf')]);
    const f = join(ROOT, 'tests', `_dl-${vp.width}.pdf`); await dl.saveAs(f);
    const pdf = readFileSync(f); unlinkSync(f);
    ok('리서치: PDF 받기(A4 1쪽·영문 파일 이름)', dl.suggestedFilename() === 'KB_GIS_Research_2026Q1_FakeAsset.pdf' && pdf.subarray(0, 5).toString() === '%PDF-'
      && (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length === 1);
  }
  await page.locator('#rsMain .rs-st[data-strat="PE Buyout"]').click();
  ok('리서치 → 전략 수요판으로 이동', !(await page.locator('#p-demand').evaluate((e) => e.hidden)) && (await page.inputValue('#dStrat')) === 'PE Buyout');
  await page.locator(`${tabSel}[data-tab="dash"]`).click();
  await page.locator(vp.width < 760 ? '#dzNav .dz-pick select' : '#dzNav .dz-item').first().waitFor();

  // 기억하기 → 새로고침해도 바로 열림
  await page.reload();
  await page.locator('#stats', { hasText: '미팅 2' }).waitFor({ state: 'attached' });   // 휴대폰에선 건수 줄이 숨겨져 있음
  ok('기억된 키로 자동 열림', !(await page.locator('#gate').isVisible()));
  ok('다크 모드 기억', (await theme()).startsWith('dark'));
  await page.click('#themeBtn');
  ok('라이트 모드로 되돌리기', (await theme()) === 'light rgb(247, 246, 243)');

  // 읽기 기능: 구분 칩·검색 강조·미리보기·이전/다음·뒤로가기·글자 크기·연락처 링크
  await page.locator(vp.width < 760 ? '.bnav button[data-tab="meetings"]' : '.tab[data-tab="meetings"]').click();
  await page.locator('#mQuick [data-cat="GP"]').click();
  ok('구분 칩(GP)으로 거르기', (await page.textContent('#mCnt')).startsWith('1건'));
  await page.locator('#mQuick [data-cat=""]').click();
  ok('미리보기에 시사점', (await page.locator('#mList .pv').first().textContent()).includes('하반기 재접촉'));
  ok('월 구분 머리', (await page.locator('#mList .mhead').first().textContent()).includes('2026년 1월'));
  const cnt = async (q) => { await page.fill('#mq', q); return (await page.textContent('#mCnt')).split('건')[0]; };
  ok('약칭으로 검색(샘공→샘플공제회)', (await cnt('샘공')) === '1');
  ok('여러 단어 검색(모두 포함)', (await cnt('샘공 PD')) === '1' && (await cnt('샘공 Buyout')) === '0');
  ok('한·영 표기 검색(바이아웃→Buyout)', (await cnt('바이아웃')) === '1');
  ok('직급 약어 검색(팀장↔TJ)', await page.evaluate(() => terms('팀장')[0].includes('tj') && terms('TJ')[0].includes('팀장')));
  ok('업데이트 시각 표시', (await page.textContent('#mCnt')).includes('01/01 09:00 업데이트'));
  if (vp.width >= 760) {
    await page.fill('#mq', ''); await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('/');
    ok("PC '/' 키로 검색창", await page.evaluate(() => document.activeElement.id === 'mq'));
  }
  await page.fill('#mq', 'PD 2건');
  ok('검색어 강조(목록)', (await page.locator('#mList mark').count()) > 0);
  await page.locator('#mList .item').first().click();
  ok('시사점은 적힌 자리(본문 끝)에', (await page.locator('#mMain .memo .sec:last-child > :last-child').getAttribute('class')) === 'take');
  ok('검색어 강조(상세)', (await page.locator('#mMain mark').count()) > 0);
  ok('본문 문장 그대로(덧붙인 강조 없음)', (await page.locator('#mMain .memo li', { hasText: '올해 PD 2건 검토 중 (건당 USD 30mn)' }).count()) === 1 && (await page.locator('#mMain .memo b').count()) === 0);
  ok('요약정리가 먼저, 원문은 두 번째 탭', await page.locator('#mMain .memo').isVisible() && !(await page.locator('#mMain .raw').isVisible())
    && (await page.locator('#mMain .seg button').allInnerTexts()).join('|') === '요약정리|원문');
  await page.locator('#mMain [data-view="raw"]').click();
  ok('원문 탭(쓴 그대로)', await page.locator('#mMain .raw').isVisible() && (await page.textContent('#mMain .raw')).includes('1/15(목) 샘플공제회 대체투자팀 홍길동TJ') && !(await page.locator('#mMain .memo').isVisible()));
  ok('원문 탭엔 카톡 머리 대신 올린 사람 이름만', !(await page.textContent('#mMain .raw')).includes('2026년 1월 15일 오후') && (await page.textContent('#mMain .raw .rawwho')) === '테스트 차장');
  await page.locator('#mMain [data-view="memo"]').click();
  if (vp.width < 760) await page.locator('#mMain [data-back]').click();
  await page.fill('#mq', '');
  await page.locator('#mList .item').first().click();
  await page.locator('#mMain [data-nav]').first().click();
  ok('이전/다음 미팅', (await page.locator('#mMain h2').textContent()).includes('Sample Capital'));
  if (vp.width < 760) {
    await page.goBack();
    ok('뒤로가기로 상세 닫힘', !(await page.locator('#p-meetings').evaluate((e) => e.classList.contains('detail'))) && await page.locator('#mList').isVisible());
  }
  await page.click('#fsBtn');
  ok('글자 크기 크게', await page.evaluate(() => document.documentElement.dataset.fs) === 'l');
  await page.click('#fsBtn'); await page.click('#fsBtn');
  ok('글자 크기 보통으로 돌아옴', await page.evaluate(() => document.documentElement.dataset.fs) === 'm');

  // 긴 목록 이동: 월 이동 상자 · 맨 위로 단추 · 탭을 오가도 보던 자리 · 현재 탭 다시 누르면 맨 위 · 누르는 대상 크기
  ok('월 이동: 한 달뿐이면 숨김', await page.locator('#mJump').isHidden());
  await page.evaluate(() => jumpFill({ '2026-01': 2, '2025-12': 1 }));
  ok('월 이동: 두 달 이상이면 달 목록', await page.locator('#mJump').isVisible() && (await page.locator('#mJump option').count()) === 3
    && (await page.locator('#mJump option').nth(1).textContent()).startsWith('2026년 1월'));
  await page.evaluate(() => { renderMList(); document.body.style.minHeight = '4000px'; scrollTo(0, 1500); });
  ok('길게 내려가면 맨 위로 단추', await page.locator('#topBtn').waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false));
  await page.locator(`${tabSel}[data-tab="orgs"]`).click();
  await page.locator(`${tabSel}[data-tab="meetings"]`).click();
  ok('탭을 다녀와도 보던 자리', Math.abs((await page.evaluate(() => scrollY)) - 1500) < 5);
  await page.click('#topBtn');
  ok('맨 위로 단추를 누르면 맨 위(단추는 사라짐)', await page.waitForFunction(() => scrollY === 0 && document.querySelector('#topBtn').hidden, null, { timeout: 4000 }).then(() => true, () => false));
  await page.evaluate(() => scrollTo(0, 1200));
  await page.locator(`${tabSel}[data-tab="meetings"]`).click();
  ok('현재 탭을 다시 누르면 맨 위로', await page.waitForFunction(() => scrollY === 0, null, { timeout: 4000 }).then(() => true, () => false));
  await page.evaluate(() => { document.body.style.minHeight = ''; });
  if (vp.width < 760) ok('휴대폰: 누르는 대상 36px 이상', (await page.locator('.iconbtn, #mQuick .qbtn').evaluateAll((a) => Math.min(...a.map((e) => e.getBoundingClientRect().height).filter((x) => x > 0)))) >= 36);

  await page.evaluate(() => gotoPerson('p-test1'));
  const links = await page.locator('#pMain a.contact').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  ok('전화·메일 링크', links.includes('tel:01000000000') && links.includes('mailto:hong@example.com'));

  // 잠그기 → 다시 비밀번호 화면
  await page.click('#lockBtn');
  await page.locator('#gate').waitFor({ state: 'visible' });
  ok('잠그기 후 비밀번호 다시 요구', await page.locator('#gate').isVisible());
  await page.screenshot({ path: join(ROOT, `tests/_${vp.width}-gate.png`) });

  ok('콘솔 오류 없음' + (errors.length ? ': ' + errors.join(' | ') : ''), errors.length === 0);
  await ctx.close();
}
// 설치 안내 페이지 — 기기별로 맞는 안내가 뜨는지
const UAS = {
  ios: ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1', '#s-ios'],
  android: ['Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', '#s-android'],
  kakao: ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.8.0', '#s-inapp'],
  desktop: ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', '#s-desktop'],
};
for (const [name, [ua, sel]] of Object.entries(UAS)) {
  const ctx = await browser.newContext({ userAgent: ua, viewport: name === 'desktop' ? { width: 1280, height: 900 } : { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.route(/cdn\.jsdelivr\.net/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(URL_ + 'install.html', { waitUntil: 'domcontentloaded' });   // 카카오톡은 곧 외부 브라우저로 넘김
  await page.waitForTimeout(150);
  const shown = await Promise.all(['#s-ios', '#s-android', '#s-inapp', '#s-desktop'].map((s) => page.locator(s).isVisible()));
  ok(`설치 안내(${name}): ${sel}만 보임`, shown.filter(Boolean).length === 1 && await page.locator(sel).isVisible());
  if (name === 'android') ok('APK 내려받기 링크', /releases\/download\/android\/KB-GIS-Meeting-Note\.apk$/.test(await page.getAttribute('#apkBtn', 'href')) && await page.locator('#apkBtn').isVisible());
  ok(`설치 안내(${name}) 오류 없음` + (errors.length ? ': ' + errors.join(' | ') : ''), errors.length === 0);
  await page.screenshot({ path: join(ROOT, `tests/_install-${name}.png`), fullPage: true });
  await ctx.close();
}

await browser.close();
server.close();
console.log(fail ? `\n${fail}개 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);
