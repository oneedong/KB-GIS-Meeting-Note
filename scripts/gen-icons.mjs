// PWA 아이콘 생성 — 로컬 Chromium 으로 HTML 배지를 그려 PNG 로 저장한다.
// KB GIS 앱 아이콘(어두운 바탕 + 상자 안 "KB / GIS")과 같은 틀에, 우드 상자 + "KB / NOTE".
//   node scripts/gen-icons.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

// `scale` = 캔버스에서 상자가 차지하는 비율(나머지는 어두운 여백)
function html(size, scale) {
  const box = Math.round(size * scale);
  const kb = Math.round(box * 0.42);
  const sub = Math.round(box * 0.19);
  const radius = Math.round(box * 0.24);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;}
    .c{box-sizing:border-box;width:${size}px;height:${size}px;background:#1c1d1f;
       display:flex;align-items:center;justify-content:center;
       font-family:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;}
    .box{width:${box}px;height:${box}px;border-radius:${radius}px;background:#C49A68;
       display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;}
    .kb{color:#1c1d1f;font-weight:800;font-size:${kb}px;letter-spacing:-0.02em;}
    .sub{color:#1c1d1f;font-weight:800;font-size:${sub}px;letter-spacing:0.08em;
       margin-top:${Math.round(box * 0.05)}px;}
  </style></head><body>
    <div class="c"><div class="box"><div class="kb">KB</div><div class="sub">NOTE</div></div></div>
  </body></html>`;
}

const targets = [
  { file: 'icons/icon-192.png',         size: 192, scale: 0.66 },
  { file: 'icons/icon-512.png',         size: 512, scale: 0.66 },
  { file: 'icons/maskable-512.png',     size: 512, scale: 0.52 },
  { file: 'icons/apple-touch-icon.png', size: 180, scale: 0.70 },
];

const browser = await chromium.launch();
for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
  await page.setContent(html(t.size, t.scale), { waitUntil: 'networkidle' });
  await page.locator('.c').screenshot({ path: t.file });
  await page.close();
  console.log('wrote', t.file);
}
await browser.close();
