#!/usr/bin/env node
// claude.ai 아티팩트 저장소 내보내기 → 평문 data.json (암호화 전 단계)
//
// Claude 의 ArtifactData 도구로 meetings·orgs·people 컬렉션을 out_dir 에 저장하면
// <폴더>/<컬렉션>/<문서ID>.json 파일이 생긴다(내용은 {..필드} 또는 {data:{..필드}}).
//
//   node scripts/build-data.mjs <내보내기 폴더> <출력 data.json>
//
// 출력 파일은 평문이므로 저장소 밖(임시 폴더)에 두고, 바로 scripts/encrypt.mjs 로 암호화한다.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('사용법: node scripts/build-data.mjs <내보내기 폴더> <출력 data.json>'); process.exit(2); }

function load(col) {
  const d = join(resolve(dir), col);
  if (!existsSync(d)) throw new Error(`${d} 폴더가 없습니다`);
  return readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => {
    const j = JSON.parse(readFileSync(join(d, f), 'utf8'));
    const doc = j && typeof j.data === 'object' && !Array.isArray(j.data) ? j.data : j;
    return { ...doc, id: f.slice(0, -5) };
  });
}

// 기준 시각: 한국 시간 YYYY-MM-DD HH:MM
const kst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const data = {
  generatedAt: kst,
  meetings: load('meetings').sort((a, b) => (b.date || '').localeCompare(a.date || '')),
  orgs: load('orgs'),
  people: load('people'),
};
writeFileSync(resolve(out), JSON.stringify(data));
console.log(`${out} — 미팅 ${data.meetings.length} · 기관 ${data.orgs.length} · 인물 ${data.people.length} (${kst} 기준)`);
