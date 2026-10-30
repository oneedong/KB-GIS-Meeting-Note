#!/usr/bin/env node
// 평문 data.json → 암호문 data.enc.json (AES-256-GCM, PBKDF2-SHA256 600,000회, gzip 후 암호화)
// 형식은 vault.js 와 같아야 한다. 평문 파일은 절대 저장소에 올리지 않는다(.gitignore).
//
//   node scripts/encrypt.mjs <평문 data.json> [출력=data.enc.json]
//   node scripts/encrypt.mjs --check [data.enc.json]       복호화해 건수만 확인
//
// 비밀번호: 환경변수 MEETING_DB_PASSWORD, 없으면 터미널에서 입력받는다(화면에 안 보임).
// 같은 비밀번호로 다시 암호화하면 기존 salt 를 그대로 써서, 휴대폰에 기억된 키가 계속 맞는다.
// 비밀번호를 바꾸면 salt 도 새로 만들고, 모든 기기에서 새 비밀번호를 한 번 다시 넣어야 한다.
import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const ITER = 600000;
const b64 = (u8) => Buffer.from(u8).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

async function askPassword(prompt) {
  if (process.env.MEETING_DB_PASSWORD) return process.env.MEETING_DB_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('MEETING_DB_PASSWORD 환경변수를 지정하세요.');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
  return new Promise((res) => {
    let pw = '';
    process.stdin.on('data', function on(ch) {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', on);
        process.stdout.write('\n'); res(pw);
      } else if (ch === '\u0003') { process.exit(130); }
      else if (ch === '\u007f') { pw = pw.slice(0, -1); }
      else pw += ch;
    });
  });
}

async function deriveKey(pw, salt, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function open(env, pw) {
  const key = await deriveKey(pw, unb64(env.salt), env.iter);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct)));
  return JSON.parse((env.z === 'gzip' ? gunzipSync(pt) : Buffer.from(pt)).toString('utf8'));
}

const counts = (j) => `미팅 ${j.meetings?.length ?? 0} · 기관 ${j.orgs?.length ?? 0} · 인물 ${j.people?.length ?? 0} (${j.generatedAt || '기준시각 없음'})`;

const args = process.argv.slice(2);
if (args[0] === '--check') {
  const file = resolve(args[1] || 'data.enc.json');
  const env = JSON.parse(readFileSync(file, 'utf8'));
  const pw = await askPassword('비밀번호: ');
  try { console.log('OK —', counts(await open(env, pw))); }
  catch { console.error('비밀번호가 맞지 않습니다.'); process.exit(1); }
  process.exit(0);
}

if (!args[0]) { console.error('사용법: node scripts/encrypt.mjs <평문 data.json> [출력=data.enc.json]'); process.exit(2); }
const src = resolve(args[0]);
const out = resolve(args[1] || 'data.enc.json');
const data = JSON.parse(readFileSync(src, 'utf8'));
for (const k of ['meetings', 'orgs', 'people']) if (!Array.isArray(data[k])) throw new Error(`${k} 배열이 없습니다`);

const pw = await askPassword('비밀번호: ');
if (pw.length < 8) { console.error('비밀번호는 8자 이상으로 해 주세요.'); process.exit(1); }

// 기존 암호문과 같은 비밀번호면 salt 유지
let salt = null, iter = ITER, reused = false;
if (existsSync(out)) {
  try {
    const prev = JSON.parse(readFileSync(out, 'utf8'));
    await open(prev, pw);
    salt = unb64(prev.salt); iter = prev.iter; reused = true;
  } catch { /* 다른 비밀번호이거나 형식이 다름 → 새 salt */ }
}
if (!salt) salt = crypto.getRandomValues(new Uint8Array(16));

const iv = crypto.getRandomValues(new Uint8Array(12));
const key = await deriveKey(pw, salt, iter);
const plain = gzipSync(Buffer.from(JSON.stringify(data), 'utf8'), { level: 9 });
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
const env = { v: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter, salt: b64(salt), iv: b64(iv), z: 'gzip', generatedAt: data.generatedAt || '', ct: b64(ct) };

// 써 넣기 전에 되풀어서 확인
const back = await open(env, pw);
if (JSON.stringify(back) !== JSON.stringify(data)) throw new Error('복호화 검증 실패');
writeFileSync(out, JSON.stringify(env) + '\n');
console.log(`암호화 완료 → ${out}`);
console.log(`  ${counts(data)}`);
console.log(`  ${reused ? '기존 salt 유지 — 기기에 기억된 키 그대로 사용' : '새 salt — 모든 기기에서 비밀번호를 한 번 다시 입력'}`);
