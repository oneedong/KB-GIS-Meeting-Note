// 앱 점검 — 가상 데이터(tests/fixture.json)를 테스트 비밀번호로 암호화해 실제 브라우저에서 연다.
// 실제 data.enc.json·비밀번호는 쓰지 않는다.   node tests/smoke.mjs
import { createRequire } from 'module';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
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

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = p === '/data.enc.json' ? ENC : join(ROOT, p);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(0);
const URL_ = `http://localhost:${server.address().port}/`;

let fail = 0;
const ok = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) fail++; };

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
  ok('업데이트 시각 표시', (await page.textContent('#mCnt')).includes('01/01 09:00 업데이트'));
  if (vp.width >= 760) {
    await page.fill('#mq', ''); await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('/');
    ok("PC '/' 키로 검색창", await page.evaluate(() => document.activeElement.id === 'mq'));
  }
  await page.fill('#mq', 'PD 2건');
  ok('검색어 강조(목록)', (await page.locator('#mList mark').count()) > 0);
  await page.locator('#mList .item').first().click();
  ok('핵심 상자가 맨 위', (await page.locator('#mMain .body > :first-child').getAttribute('class')) === 'key');
  ok('검색어 강조(상세)', (await page.locator('#mMain mark').count()) > 0);
  ok('금액·비율 굵게', (await page.locator('#mMain b.num', { hasText: 'USD 30mn' }).count()) === 1);
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
