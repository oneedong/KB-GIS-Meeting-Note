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
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/pretendard|ERR_|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
  page.route(/cdn\.jsdelivr\.net/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));

  await page.goto(URL_);
  await page.locator('#gate').waitFor({ state: 'visible' });
  ok('비밀번호 화면이 뜬다', await page.locator('#gate').isVisible());
  ok('잠금 상태에서는 데이터가 없다', (await page.locator('#mList .item').count()) === 0);

  await page.fill('#pw', 'wrong-password');
  await page.click('#unlock');
  await page.locator('#gateMsg', { hasText: '맞지 않습니다' }).waitFor();
  ok('틀린 비밀번호는 거절', await page.locator('#gate').isVisible());

  await page.fill('#pw', PW);
  await page.click('#unlock');
  await page.locator('#gate').waitFor({ state: 'hidden' });
  ok('맞는 비밀번호로 열림', (await page.locator('#mList .item').count()) === 2);
  ok('건수 표시', (await page.textContent('#stats')).includes('미팅 2'));
  ok('추가 버튼 숨김(읽기 전용)', !(await page.locator('#mNew').isVisible()));
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
  await page.locator('#stats', { hasText: '미팅 2' }).waitFor();
  ok('기억된 키로 자동 열림', !(await page.locator('#gate').isVisible()));

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
