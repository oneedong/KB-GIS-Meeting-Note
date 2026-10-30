// PWA 아이콘 생성 — 로컬 Chromium 으로 HTML 배지를 그려 PNG 로 저장한다.
// KB GIS 앱 아이콘 한 쌍(KB 노랑 #FFBC00 · KB 회색 #60584C):
//   KB GIS Market       — 노랑 바탕, 회색 KB 상자, "Market"
//   KB GIS Meeting Note — 회색 바탕, 노랑 KB 상자, "Meeting / Note"   ← 이 저장소
//   node scripts/gen-icons.mjs [market|note] [출력 폴더=icons]
import { createRequire } from 'module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const Y = '#FFBC00', G = '#60584C';
const APPS = {
  market: { bg: Y, box: G, boxText: Y, gis: G, name: ['Market'], nameColor: G },
  note:   { bg: G, box: Y, boxText: G, gis: Y, name: ['Meeting', 'Note'], nameColor: '#FFFFFF' },
};

// inset = 내용을 가운데로 모으는 비율(마스크용 아이콘은 안전 영역 안에 들어오도록 더 작게)
function html(app, S, inset) {
  const a = APPS[app], k = 1 - inset * 2, u = (f) => +(S * f * k).toFixed(2), o = S * inset;
  const nameSize = a.name.length > 1 ? 0.155 : 0.19;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0}
    .c{position:relative;width:${S}px;height:${S}px;background:${a.bg};overflow:hidden;font-family:Inter,'Helvetica Neue',Arial,sans-serif}
    .in{position:absolute;left:${o}px;top:${o}px;width:${S - 2 * o}px;height:${S - 2 * o}px}
    .kb{position:absolute;left:${u(.14)}px;top:${u(.14)}px;width:${u(.30)}px;height:${u(.30)}px;border-radius:${u(.07)}px;
        background:${a.box};color:${a.boxText};font:900 ${u(.15)}px/${u(.30)}px Inter,sans-serif;text-align:center;letter-spacing:-.03em}
    .gis{position:absolute;left:${u(.50)}px;top:${u(.235)}px;font:800 ${u(.11)}px/1 Inter,sans-serif;color:${a.gis};letter-spacing:.06em}
    .name{position:absolute;left:${u(.14)}px;bottom:${u(.13)}px;font:800 ${u(nameSize)}px/1.02 Inter,sans-serif;color:${a.nameColor};letter-spacing:-.03em}
  </style></head><body><div class="c"><div class="in">
    <div class="kb">KB</div><div class="gis">GIS</div><div class="name">${a.name.join('<br>')}</div>
  </div></div></body></html>`;
}

const app = process.argv[2] || 'note', dir = process.argv[3] || 'icons';
if (!APPS[app]) { console.error('market 또는 note'); process.exit(2); }
mkdirSync(dir, { recursive: true });
const targets = [
  { file: 'icon-192.png',         size: 192, inset: 0 },
  { file: 'icon-512.png',         size: 512, inset: 0 },
  { file: 'maskable-512.png',     size: 512, inset: 0.1 },   // 안드로이드 원형·물방울 마스크 안전 영역
  { file: 'apple-touch-icon.png', size: 180, inset: 0 },
];
const browser = await chromium.launch();
for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
  await page.setContent(html(app, t.size, t.inset), { waitUntil: 'networkidle' });
  await page.locator('.c').screenshot({ path: `${dir}/${t.file}` });
  await page.close();
  console.log('wrote', `${dir}/${t.file}`);
}
await browser.close();
