#!/usr/bin/env node
// index.html 의 보안 정책(CSP) 갱신·확인 — 인라인 <script> 를 고치면 해시가 바뀌므로 다시 돌린다.
//   node scripts/csp.mjs          해시 다시 계산해 index.html 에 써 넣기
//   node scripts/csp.mjs --check  맞는지 확인만(tests/smoke.mjs 가 부름)
// 정책: 스크립트는 이 사이트 파일과 index.html 인라인 2개만, 데이터 통신은 이 사이트로만(connect-src 'self').
// → 복호화한 미팅노트가 다른 주소로 나갈 길을 막는다. 외부는 Pretendard 글꼴(cdn.jsdelivr.net)뿐.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html');
const html = readFileSync(FILE, 'utf8');
const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
const policy = [
  "default-src 'self'",
  `script-src 'self' ${hashes.join(' ')}`,
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' https://cdn.jsdelivr.net",
  "img-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
const RE = /<meta http-equiv="Content-Security-Policy" content="[^"]*">/;

if (process.argv.includes('--check')) {
  const cur = html.match(RE);
  if (!cur || cur[0] !== tag) { console.error('index.html 보안 정책(CSP)이 인라인 스크립트와 맞지 않습니다 → node scripts/csp.mjs'); process.exit(1); }
  console.log(`CSP OK (인라인 스크립트 ${hashes.length}개)`);
} else {
  const out = RE.test(html) ? html.replace(RE, tag) : html.replace('<meta charset="utf-8">\n', `<meta charset="utf-8">\n${tag}\n`);
  if (!out.includes(tag)) throw new Error('CSP 를 넣을 자리를 찾지 못했습니다');
  writeFileSync(FILE, out);
  console.log(`CSP 갱신 (인라인 스크립트 ${hashes.length}개)`);
}
