/*
 * 대시보드 탭 — GIS 대시보드 엑셀(xlsm)의 모든 시트를 읽기 좋은 화면으로.
 * 데이터: dash.enc.json (미팅노트 DB와 같은 비밀번호·salt 로 잠근 사본, scripts/dash_extract.py → scripts/vault.mjs)
 * 시트마다 '정리 화면'(scripts/dash_views.py 가 만든 블록: 지표 카드·차트·표/카드 목록)과 '엑셀 원본'(서식 그대로의 격자)을 오간다.
 *   표: PC·태블릿은 표(머리글 고정·정렬·펼침), 휴대폰은 카드 목록. 찾기·필터·연도 선택·합계는 둘 다.
 */
const Dash = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const h = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
               set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const mob = () => matchMedia("(max-width:760px)").matches;
  const SUM = "__sum", DEMO = "대시보드(Demo)";
  let D = null, state = "idle", err = "", sel = LS.get("kbnote-dzsel", SUM);
  const mode = {};          // 시트별 '정리 화면'(v) / '엑셀 원본'(g)
  const T = {};             // 표 상태(찾기·필터·연도·정렬·펼침) — 앱을 닫을 때까지 유지
  let pendingQ = "", lastMob = null, gridView = null;

  // ── 데이터 열기 ─────────────────────────────────────────
  async function ensure() {
    if (D || state === "loading") return;
    state = "loading"; paint();
    const r = await Vault.openExtra("dash.enc.json");
    if (r.data) { D = r.data; state = "ready"; buildStyles(); index(); }
    else { state = "error"; err = r.error; }
    paint();
  }
  function render() { if (!D) { if (state !== "loading" && state !== "error") ensure(); paint(); return; } paint(); }

  function index() {
    // 표 행마다 고정 번호(펼침 상태용)·찾기용 글자
    D.sheets.forEach((s) => walk(s.view || [], (b) => {
      if (b.t !== "table") return;
      let n = 0;
      (b.secs || [{ rows: b.rows || [] }]).forEach((sec) => sec.rows.forEach((r) => { r._i = n++; }));
    }));
  }
  function walk(blocks, fn) { blocks.forEach((b) => { if (b.t === "row") walk(b.blocks, fn); else fn(b); }); }
  const sheetBy = (n) => D.sheets.find((s) => s.name === n);
  const hasView = (s) => s && Array.isArray(s.view) && s.view.length;

  function paint() {
    const nav = $("#dzNav"), main = $("#dzMain");
    if (!nav) return;
    if (!D) {
      nav.innerHTML = "";
      const msg = state === "error"
        ? ({ missing: "아직 올라온 대시보드 데이터가 없습니다.", mismatch: "대시보드 데이터가 다른 비밀번호로 잠겨 있습니다. Claude에 대시보드 업데이트를 다시 요청해 주세요.",
             network: "대시보드 데이터를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.", locked: "먼저 비밀번호로 앱을 열어 주세요." }[err] || "대시보드 데이터를 열지 못했습니다.")
        : "대시보드 데이터를 여는 중…";
      main.innerHTML = `<div class="empty">${h(msg)}</div>`;
      if (state === "error") { const b = document.createElement("button"); b.className = "btn sm"; b.textContent = "다시 시도"; b.onclick = () => { state = "idle"; ensure(); }; main.firstChild.append(document.createElement("br"), b); }
      return;
    }
    if (sel !== SUM && !sheetBy(sel)) sel = SUM;
    lastMob = mob();
    paintNav();
    paintPage();
  }

  // ── 시트 목록 ───────────────────────────────────────────
  function paintNav() {
    const nav = $("#dzNav");
    let out = `<button type="button" class="dz-item sum" data-s="${SUM}" aria-current="${sel === SUM}">요약</button>`;
    let g = null;
    D.sheets.forEach((s) => {
      if (s.name === DEMO && hasView(s)) return;     // 요약이 곧 대시보드 시트
      if (s.group !== g) { g = s.group; out += `<div class="dz-grp">${h(g)}</div>`; }
      out += `<button type="button" class="dz-item" data-s="${h(s.name)}" title="${h(s.name)}" aria-current="${sel === s.name}">${h(s.short)}</button>`;
    });
    nav.innerHTML = out;
    nav.querySelectorAll("[data-s]").forEach((b) => b.onclick = () => go(b.dataset.s));
    const on = nav.querySelector('[aria-current="true"]');
    if (on && matchMedia("(max-width:1100px)").matches) on.scrollIntoView({ block: "nearest", inline: "center" });
  }
  function go(name, q) {
    sel = name; LS.set("kbnote-dzsel", name);
    if (q) { pendingQ = q; mode[name] = "v"; }
    paint(); window.scrollTo({ top: 0 });
  }

  // ── 쪽(요약 / 시트) ─────────────────────────────────────
  function paintPage() {
    const isSum = sel === SUM, s = isSum ? sheetBy(DEMO) : sheetBy(sel);
    const ck = (D.summary && D.summary.check) || { ok: 0, n: 0, fails: [] }, fx = D.fx || {};
    const canView = hasView(s), canGrid = s && s.rows && s.rows.length;
    const m = !canView ? "g" : (mode[sel] || "v");
    gridView = null;
    const title = isSum ? "대시보드 요약" : s.short;
    const eyebrow = isSum ? `기준일 ${h(D.asof)} · ${h(D.generatedAt)} 업데이트` : `${h(s.group)} · 기준일 ${h(D.asof)}`;
    const meta = isSum ? `<div class="dz-meta"><span>USDKRW <b>${num(fx.usd, 2)}</b></span><span>EURKRW <b>${num(fx.eur, 2)}</b></span>
        <button type="button" class="ck ${ck.ok === ck.n ? "ok" : "ng"}" data-s="검증" title="${h((ck.fails || []).join(" / "))}">검증 ${ck.ok}/${ck.n} ${ck.ok === ck.n ? "✔" : "확인 필요"}</button></div>` : "";
    const seg = canView && canGrid ? `<div class="seg dz-seg" role="group" aria-label="보기 방식"><button type="button" data-m="v" aria-pressed="${m === "v"}">정리 화면</button><button type="button" data-m="g" aria-pressed="${m === "g"}">엑셀 원본</button></div>` : "";
    const gs = isSum && m === "v" ? `<div class="gfind"><input type="search" id="gq" placeholder="대시보드 전체에서 찾기 (운용사·펀드·기관…)" aria-label="대시보드 전체에서 찾기" autocomplete="off"></div>` : "";
    $("#dzMain").innerHTML = `
      <div class="dz-head"><div class="t"><div class="eyebrow">${eyebrow}</div><h2>${h(title)}</h2>${!isSum && s.short !== s.name ? `<div class="sub2">${h(s.name)}</div>` : ""}</div>${meta}${seg}</div>
      ${gs}<div id="dzBody" class="dz-body"></div>`;
    $$("#dzMain .dz-seg button").forEach((b) => b.onclick = () => { mode[sel] = b.dataset.m; paintPage(); });
    const ckb = $("#dzMain .ck[data-s]"); if (ckb && sheetBy("검증")) ckb.onclick = () => go("검증");
    const body = $("#dzBody");
    if (m === "g") { paintGrid(s, body); return; }
    const blocks = s.view.slice();
    if (isSum) blocks.push({ t: "links" }, { t: "basis" });
    renderBlocks(blocks, body, sel);
    if (pendingQ) {   // 전체 찾기에서 넘어왔으면 첫 표의 찾기 칸으로
      const inp = $("#dzBody .tb-q"); pendingQ = "";
      if (inp) { inp.closest(".blk").scrollIntoView({ block: "start" }); }
    }
    if (isSum) mountGlobalFind();
  }

  // ── 블록 ───────────────────────────────────────────────
  let bid = 0;
  function renderBlocks(blocks, el, key) {
    bid = 0; charts = [];
    const mounts = [];
    el.innerHTML = blocks.map((b, i) => blockHtml(b, `${key}:${b.id || i}`, mounts)).join("");
    mounts.forEach((fn) => fn());
  }
  function blockHtml(b, key, mounts) {
    const id = "b" + (++bid);
    if (b.t === "row") {
      const cls = b.ratio === "2:1" ? " r21" : "";
      return `<div class="brow${cls}" style="--n:${b.blocks.length}">${b.blocks.map((x, i) => blockHtml(x, `${key}.${x.id || i}`, mounts)).join("")}</div>`;
    }
    if (b.t === "kpis") return kpisHtml(b);
    if (b.t === "notes") return `<section class="blk notes">${b.title ? `<h3>${h(b.title)}</h3>` : ""}<ul>${b.items.map((x) => `<li>${h(x)}</li>`).join("")}</ul></section>`;
    if (b.t === "links") return linksHtml();
    if (b.t === "basis") return `<p class="basis">원본: ${h(D.source)} · 엑셀에 저장된 값을 그대로 보여주는 읽기 전용 화면입니다. 숫자를 고치려면 엑셀을 고친 뒤 Claude에 대시보드 업데이트를 요청하세요.</p>`;
    if (b.t === "col") { mounts.push(() => mountChart(id, b)); return `<section class="blk pnl ch-blk" id="${id}">${head(b)}<div class="chslot"></div></section>`; }
    if (b.t === "bars") { mounts.push(() => mountBars(id, b, key)); return `<section class="blk pnl" id="${id}"></section>`; }
    if (b.t === "table") { mounts.push(() => mountTable(id, b, key)); return b.fold ? `<details class="blk fold" id="${id}"><summary>${h(b.title || "")}${b.sub ? ` <small>${h(b.sub)}</small>` : ""}</summary><div class="fold-in"></div></details>` : `<section class="blk pnl tbl${b.compact ? " compact" : ""}" id="${id}"></section>`; }
    return "";
  }
  const head = (b, extra = "") => (b.title || extra) ? `<div class="bh"><h3>${h(b.title || "")}${b.sub ? ` <small>${h(b.sub)}</small>` : ""}</h3>${extra}</div>` : "";

  function kpisHtml(b) {
    return `<div class="blk kcards${b.big ? " big" : ""}">${b.items.map((k) => {
      const p = k.pct == null ? null : Math.max(0, Math.min(1, k.pct));
      const v = typeof k.v === "number" ? fmt(k.v, k.f || "n0") : h(k.v ?? "-");
      return `<div class="kc${k.tone ? " t-" + k.tone : ""}"><div class="kc-l">${h(k.l)}</div>
        <div class="kc-v">${v}${k.u ? `<span>${h(k.u)}</span>` : ""}</div>
        ${p == null ? "" : `<div class="kc-bar" role="img" aria-label="${h(k.s || "")}"><i style="width:${(p * 100).toFixed(1)}%"></i></div>`}
        ${k.s ? `<div class="kc-s">${h(k.s)}</div>` : ""}${k.note ? `<div class="kc-n">${h(k.note)}</div>` : ""}</div>`;
    }).join("")}</div>`;
  }
  function linksHtml() {
    const items = D.sheets.filter((s) => !(s.name === DEMO && hasView(s))).map((s) => {
      const k = (s.view || []).find((b) => b.t === "kpis");
      const line = k && k.items[0] ? `${k.items[0].l} ${typeof k.items[0].v === "number" ? fmt(k.items[0].v, k.items[0].f || "n0") : ""}${k.items[0].u || ""}` : `${s.group}`;
      return `<button type="button" class="qk" data-s="${h(s.name)}"><b>${h(s.short)}</b><span>${h(line)}</span></button>`;
    }).join("");
    setTimeout(() => $$("#dzBody .qk[data-s]").forEach((b) => b.onclick = () => go(b.dataset.s)));
    return `<section class="blk pnl"><div class="bh"><h3>시트 바로가기 <small>엑셀의 모든 시트</small></h3></div><div class="quickg">${items}</div></section>`;
  }

  // ── 숫자 형식 ──────────────────────────────────────────
  const NFS = [0, 1, 2, 3].map((d) => new Intl.NumberFormat("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const num = (v, d = 0) => (v == null || typeof v !== "number" || isNaN(v)) ? "-" : NFS[Math.max(0, Math.min(3, d))].format(v);
  function fmt(v, f, row, unit) {
    if (v == null || v === "") return "";
    if (f === "bool") return v === true ? "✔ 일치" : v === false ? "✖ 불일치" : h(v);
    if (typeof v !== "number") return h(v);
    const u = (s) => unit ? s : "";
    if (v === 0 && /^(won|wk|eok|eok1|usd|usd2|usdk|amt)$/.test(f)) return "-";
    switch (f) {
      case "won": return num(v, 0) + u("원");
      case "wk": return num(v / 1e8, 2) + u("억");
      case "eok": return num(v, 2) + u("억");
      case "eok1": return num(v, 1) + u("억");
      case "usd": return u("USD ") + num(v, Math.abs(v) < 100 && v % 1 ? 2 : 0);
      case "usd2": return u("USD ") + num(v, 2);
      case "usdk": return u("USD ") + num(v / 1000, 0) + u("천");
      case "int": return String(v);
      case "n0": return num(v, 0); case "n1": return num(v, 1); case "n2": return num(v, 2); case "n3": return num(v, 3);
      case "pct": case "bar": return num(v * 100, 1) + "%";
      case "pct0": return num(v * 100, 0) + "%";
      case "pct2": return num(v * 100, 2) + "%";
      case "x2": return num(v, 2) + "x";
      case "amt": return `${h((row && row.cy) || "")} ${num(v, Math.abs(v) < 1000 && v % 1 ? 2 : 0)}`.trim();
      default: return num(v, v % 1 ? 2 : 0);
    }
  }
  const isNum = (c) => /^(won|wk|eok|eok1|usd|usd2|usdk|n\d|pct\d?|bar|x2|amt|int)$/.test(c.f);
  const TONE = { ok: "ok", warn: "warn", info: "info", bad: "bad", muted: "muted" };
  function cell(c, r, unit) {
    const v = r[c.k];
    if (v == null || v === "") return "";
    if (c.f === "tag") return `<span class="tg${c.tone && c.tone[v] ? " t-" + TONE[c.tone[v]] : ""}">${h(v)}</span>`;
    if (c.f === "bool") return `<span class="tg ${v === true ? "t-ok" : v === false ? "t-bad" : ""}">${fmt(v, "bool")}</span>`;
    if (c.f === "bar" && typeof v === "number") return `<span class="pbar"><i style="width:${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%"></i></span><span class="pv">${fmt(v, "pct")}</span>`;
    if (c.f === "months") return months(v);
    if (c.f === "long") return `<span class="long">${h(v)}</span>`;
    const s = fmt(v, c.f, r, unit);
    return typeof v === "number" && v < 0 ? `<span class="neg">${s}</span>` : s;
  }
  let curLabels = null;
  function months(v) {
    const L = curLabels || Array.from({ length: 12 }, (_, i) => String(i + 1));
    const rs = (v && v.rs) || [], cm = (v && v.cm) || [];
    return `<span class="mstrip">${L.map((l, i) => {
      const a = rs[i] || 0, c = cm[i] || 0;
      return `<span class="${a || c ? "on" : ""}" title="${l}월${a ? ` · 로드쇼 ${a}회` : ""}${c ? ` · 약정 ${num(c, c % 1 ? 1 : 0)}` : ""}"><i>${l}</i><em>${a ? "●".repeat(Math.min(a, 3)) : ""}</em><b>${c ? num(c, c % 1 && c < 100 ? 1 : 0) : ""}</b></span>`;
    }).join("")}</span>`;
  }

  // ── 세로 막대 ─────────────────────────────────────────
  const ASSET = { "PE": 1, "PC": 2, "RE": 3, "Infra": 4, "기타(혼합자산)": 5, "기타": 5, "장외주식 중개": 6 };
  function colorsFor(b) {
    if (b.series.length === 1) return ["var(--kb-yellow)"];
    if (b.series.every((s) => ASSET[s.n])) return b.series.map((s) => `var(--c${ASSET[s.n]})`);
    if (b.series.length === 2) return ["var(--kb-yellow)", "var(--ch2)"];
    return b.series.map((_, i) => `var(--c${(i % 8) + 1})`);
  }
  function ticks(lo, hi, n = 4) {
    const span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const out = []; for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(+v.toFixed(6));
    return out;
  }
  function barPath(x, w, y0, y1, r) {   // y0 = 기준선, y1 = 끝(둥근 쪽)
    const hgt = Math.abs(y1 - y0); r = Math.min(r, w / 2, hgt);
    if (hgt < 0.5) return "";
    if (y1 < y0) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
    return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
  }
  function colChart(b, W) {
    const n = b.cats.length, S = b.series, col = colorsFor(b), stack = !!b.stack;
    W = Math.max(260, Math.round(W || 520));
    const H = Math.round(Math.max(200, Math.min(290, W * 0.4))), L = 40, R = 6, T = 22, B = 26;
    let lo = 0, hi = 0;
    for (let i = 0; i < n; i++) {
      if (stack) { let p = 0, q = 0; S.forEach((s) => { const v = s.v[i] || 0; if (v >= 0) p += v; else q += v; }); hi = Math.max(hi, p); lo = Math.min(lo, q); }
      else S.forEach((s) => { hi = Math.max(hi, s.v[i] || 0); lo = Math.min(lo, s.v[i] || 0); });
    }
    const tk = ticks(lo, hi * 1.08); lo = Math.min(lo, tk[0]); hi = Math.max(hi, tk[tk.length - 1]);
    const y = (v) => T + (hi - v) / (hi - lo || 1) * (H - T - B), z = y(0);
    const bw = (W - L - R) / n, gw = bw * (stack || S.length === 1 ? 0.56 : 0.74), sw = stack ? gw : gw / S.length;
    const d = b.f === "n0" ? 0 : 1;
    let g = tk.map((t) => `<line class="gl${t === 0 ? " z" : ""}" x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="yl" x="${L - 6}" y="${(y(t) + 3.5).toFixed(1)}">${num(t, Math.abs(t) < 10 && t % 1 ? 1 : 0)}</text>`).join("");
    for (let i = 0; i < n; i++) {
      const x0 = L + bw * i + (bw - gw) / 2;
      let pos = 0, neg = 0, segs = "";
      S.forEach((s, j) => {
        const v = s.v[i] || 0; if (!v) return;
        let a, e, x;
        if (stack) { x = x0; if (v >= 0) { a = pos; pos += v; e = pos; } else { a = neg; neg += v; e = neg; } }
        else { x = x0 + sw * j; a = 0; e = v; }
        const last = stack ? S.slice(j + 1).every((t) => !(t.v[i]) || Math.sign(t.v[i]) !== Math.sign(v)) : true;
        const p = last ? barPath(x + 0.5, sw - 1, y(a), y(e), 3) : `M${x + 0.5},${y(a)}V${y(e)}H${x + sw - 0.5}V${y(a)}Z`;
        segs += `<path d="${p}" style="fill:${col[j]}" class="${stack ? "sg" : ""}"/>`;
        if (!stack && S.length === 1) segs += `<text class="vl" x="${(x + sw / 2).toFixed(1)}" y="${(v < 0 ? y(e) + 12 : y(e) - 5).toFixed(1)}">${num(v, Math.abs(v) >= 10 ? 1 : (d ? 2 : 0))}</text>`;
      });
      if (stack && (b.tot || S.length > 1)) {
        const t = b.tot ? b.tot[i] : pos + neg;
        if (t) segs += `<text class="vl" x="${(x0 + gw / 2).toFixed(1)}" y="${(y(pos) - 5).toFixed(1)}">${num(t, d)}</text>`;
      }
      g += `<g class="cg" data-i="${i}">${segs}<rect class="hit" x="${L + bw * i}" y="${T}" width="${bw}" height="${H - T - B}"/><text class="xl" x="${(L + bw * i + bw / 2).toFixed(1)}" y="${H - 8}">${h(b.cats[i])}</text></g>`;
    }
    const lg = S.length > 1 ? `<div class="lg">${S.map((s, j) => `<span><i style="background:${col[j]}"></i>${h(s.n)}</span>`).join("")}</div>` : "";
    return `${lg}<div class="chw"><svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(b.title || "")}">${g}</svg><div class="tip" hidden></div></div>`;
  }
  let charts = [];
  function mountChart(id, b) {
    const el = document.getElementById(id); if (!el) return;
    const slot = $(".chslot", el);
    slot.innerHTML = colChart(b, slot.clientWidth);
    charts.push({ id, b, w: slot.clientWidth });
    const tip = $(".tip", el), wrap = $(".chw", el), col = colorsFor(b);
    const show = (e) => {
      const g = e.target.closest(".cg"); if (!g) { tip.hidden = true; return; }
      const i = +g.dataset.i, f = b.f || "n1";
      const rows = b.series.map((s, j) => `<div><i style="background:${col[j]}"></i>${h(s.n)}<b>${fmt(s.v[i] || 0, f)}</b></div>`).join("");
      const tot = b.stack && b.series.length > 1 ? `<div class="tt"><span>합계</span><b>${fmt(b.tot ? b.tot[i] : b.series.reduce((a, s) => a + (s.v[i] || 0), 0), f)}</b></div>` : "";
      tip.innerHTML = `<div class="th">${h(b.cats[i])}${b.sub ? ` <small>${h(b.sub.split("·")[0])}</small>` : ""}</div>${rows}${tot}`;
      tip.hidden = false;
      const wr = wrap.getBoundingClientRect(), gr = g.getBoundingClientRect();
      let x = gr.left - wr.left + gr.width / 2 - tip.offsetWidth / 2;
      x = Math.max(0, Math.min(wr.width - tip.offsetWidth, x));
      tip.style.left = x + "px"; tip.style.top = "4px";
      $$(".cg", el).forEach((x) => x.classList.toggle("on", x === g));
    };
    wrap.addEventListener("pointermove", show); wrap.addEventListener("click", show);
    wrap.addEventListener("pointerleave", () => { tip.hidden = true; $$(".cg", el).forEach((x) => x.classList.remove("on")); });
  }

  // ── 가로 막대(순위) ────────────────────────────────────
  function mountBars(id, b, key) {
    const el = document.getElementById(id); if (!el) return;
    const st = T[key] || (T[key] = { pick: b.def });
    const draw = () => {
      const items = b.sets ? (b.sets[st.pick] || []) : b.items;
      const mx = Math.max(1e-9, ...items.map((x) => Math.abs(x.v)));
      const chips = b.sets ? `<div class="seg sm" role="group" aria-label="연도">${Object.keys(b.sets).map((k) => `<button type="button" data-p="${h(k)}" aria-pressed="${k === st.pick}">${h(k)}</button>`).join("")}</div>` : "";
      el.innerHTML = `${head(b, chips)}<div class="hb${b.rank ? " rank" : ""}">${items.length ? items.map((x, i) => `<div class="hb-r${x.hi ? " on" : ""}${b.rank && i === 0 ? " on" : ""}">${b.rank ? `<span class="hb-n">${i + 1}</span>` : ""}<span class="hb-y" title="${h(x.l)}">${h(x.l)}</span><span class="hb-t"><i style="width:${Math.max(0, x.v / mx * 100).toFixed(1)}%"></i></span><span class="hb-v">${fmt(x.v, b.f)}</span></div>`).join("") : `<div class="empty">값 없음</div>`}</div>`;
      $$("[data-p]", el).forEach((x) => x.onclick = () => { st.pick = x.dataset.p; draw(); });
    };
    draw();
  }

  // ── 표 / 카드 목록 ─────────────────────────────────────
  const resolve = (k, b, st) => {
    if (!k || k[0] !== "@") return k;
    const pc = b.pick && b.pick.cols ? (b.pick.cols[st.pick] || []) : [];
    if (k === "@last") return pc[pc.length - 1];
    if (k === "@prev") return pc[pc.length - 2];
    const hit = pc.find((x) => x.startsWith(k.slice(1)));
    return hit || (k === "@u" ? "am" : null);
  };
  function visCols(b, st) {
    if (!b.pick || !b.pick.cols) return b.cols.filter((c) => !c.d);
    const all = new Set(Object.values(b.pick.cols).flat()), on = new Set(b.pick.cols[st.pick] || []);
    return b.cols.filter((c) => !c.d && (!all.has(c.k) || on.has(c.k)));
  }
  function detCols(b, st) {
    if (!b.pick || !b.pick.cols) return b.cols.filter((c) => c.d);
    const all = new Set(Object.values(b.pick.cols).flat()), on = new Set(b.pick.cols[st.pick] || []);
    return b.cols.filter((c) => c.d && (!all.has(c.k) || on.has(c.k)));
  }
  const hay = (r) => r._h || (r._h = (Object.values(r.c).map((v) => typeof v === "object" ? "" : String(v)).join(" ") + " " +
    (r.x || []).map((x) => (x.rows || []).map((y) => Object.values(y).join(" ")).join(" ") + " " + (x.text || "")).join(" ")).toLowerCase());
  function baseRows(b, st) {
    let secs = b.secs || [{ rows: b.rows || [] }];
    if (b.pick && !b.pick.cols) secs = secs.filter((s) => s.p == null || s.p === st.pick);
    const need = b.pick && b.pick.need && st.pick !== "전체" ? b.pick.need.split("|") : null;
    return secs.map((s) => ({ ...s, rows: need ? s.rows.filter((r) => need.some((p) => r.c[p + st.pick] != null)) : s.rows }));
  }
  function applyRows(b, st, secs) {
    const ws = (st.q || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    const fk = Object.keys(st.f || {}).filter((k) => st.f[k] != null);
    const sk = st.sort && st.sort.k, sd = st.sort ? st.sort.d : 1;
    return secs.map((s) => {
      let rows = s.rows.filter((r) => fk.every((k) => String(r.c[k] ?? "(없음)") === st.f[k]) && ws.every((w) => hay(r).includes(w)));
      if (sk) rows = rows.slice().sort((a, b2) => {
        const x = a.c[sk], y = b2.c[sk], ex = x == null || x === "", ey = y == null || y === "";
        if (ex || ey) return ex === ey ? 0 : (ex ? 1 : -1);   // 빈 값은 방향과 상관없이 맨 뒤
        return cmp(x, y) * sd;
      });
      return { ...s, rows };
    });
  }
  const cmp = (a, b) => {
    if (a == null || a === "") return (b == null || b === "") ? 0 : 1;
    if (b == null || b === "") return -1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b), "ko", { numeric: true });
  };
  function mountTable(id, b, key) {
    const host = document.getElementById(id); if (!host) return;
    const st = T[key] || (T[key] = { q: "", f: {}, pick: b.pick ? b.pick.def : null, sort: null, open: new Set() });
    if (!st.sort && b.sort) st.sort = { k: b.sort.k, d: b.sort.d };
    if (pendingQ && !st.q) st.q = pendingQ;
    const el = b.fold ? $(".fold-in", host) : host;
    const total = (b.secs || [{ rows: b.rows || [] }]).reduce((a, s) => a + s.rows.length, 0);
    const tools = !b.compact && (total > 12 || b.pick || (b.filters || []).length);
    if (b.fold && st.q) host.open = true;
    el.innerHTML = `${b.fold ? "" : head(b)}${tools ? `<div class="tb"></div>` : ""}<div class="tb-body"></div>${(b.notes || []).length ? `<ul class="bnotes">${b.notes.map((x) => `<li>${h(x)}</li>`).join("")}</ul>` : ""}`;
    const tb = $(".tb", el), body = $(".tb-body", el);
    const draw = () => {
      if (st.sort && st.sort.k && st.sort.k[0] === "@") st.sort.k = resolve(st.sort.k, b, st);
      const base = baseRows(b, st), secs = applyRows(b, st, base);
      const shown = secs.reduce((a, s) => a + s.rows.length, 0);
      if (tb) drawTools(tb, b, st, base, shown, draw);
      curLabels = b.mlabels || null;
      body.innerHTML = shown || !total ? (useCards(b, st, body) ? cardsHtml(b, st, secs) : tableHtml(b, st, secs)) : `<div class="empty">조건에 맞는 항목이 없습니다.</div>`;
      curLabels = null;
      wire(body, b, st, draw);
    };
    draw();
  }
  // 휴대폰이거나, 표가 화면보다 한참 넓으면(태블릿의 열 많은 표) 카드 목록으로
  const COLW = { text: 140, long: 200, tag: 90, months: 380, date: 96, bool: 80 };
  function useCards(b, st, el) {
    if (b.compact) return false;
    if (mob()) return true;
    const w = visCols(b, st).reduce((a, c) => a + (COLW[c.f] || 100), 0);
    return w > (el.clientWidth || 1000) * 1.25;
  }
  function drawTools(tb, b, st, base, shown, draw) {
    const all = base.flatMap((s) => s.rows);
    const filt = (b.filters || []).map((k) => {
      const c = b.cols.find((x) => x.k === k); if (!c) return "";
      const cnt = new Map(); all.forEach((r) => { const v = r.c[k]; if (v == null || v === "") return; cnt.set(String(v), (cnt.get(String(v)) || 0) + 1); });
      if (cnt.size < 2 && !st.f[k]) return "";
      const vals = [...cnt.entries()].sort((a, b2) => b2[1] - a[1] || a[0].localeCompare(b2[0], "ko"));
      if (vals.length > 9) return `<label class="tb-sel"><span>${h(c.l)}</span><select data-f="${h(k)}"><option value="">전체</option>${vals.map(([v, n]) => `<option value="${h(v)}"${st.f[k] === v ? " selected" : ""}>${h(v)} (${n})</option>`).join("")}</select></label>`;
      return `<div class="tb-chips" role="group" aria-label="${h(c.l)}"><span class="tb-l">${h(c.l)}</span><button type="button" class="fchip" data-f="${h(k)}" data-v="" aria-pressed="${!st.f[k]}">전체</button>${vals.map(([v, n]) => `<button type="button" class="fchip" data-f="${h(k)}" data-v="${h(v)}" aria-pressed="${st.f[k] === v}">${h(v)} <small>${n}</small></button>`).join("")}</div>`;
    }).join("");
    const pick = b.pick ? `<div class="seg sm tb-pick" role="group" aria-label="${h(b.pick.l)}">${b.pick.opts.map((o) => `<button type="button" data-p="${h(o)}" aria-pressed="${o === st.pick}">${h(o)}</button>`).join("")}</div>` : "";
    const sortable = visCols(b, st).filter((c) => c.f !== "months" && c.f !== "long");
    const sortSel = !b.compact && useCards(b, st, tb) ? `<label class="tb-sel"><span>정렬</span><select data-sort>${[`<option value="">엑셀 순서</option>`].concat(sortable.map((c) => [1, -1].map((d) => `<option value="${h(c.k)}|${d}"${st.sort && st.sort.k === c.k && st.sort.d === d ? " selected" : ""}>${h(c.l)} ${isNum(c) ? (d < 0 ? "큰 순" : "작은 순") : (d < 0 ? "역순" : "순")}</option>`).join(""))).join("")}</select></label>` : "";
    const active = st.q || Object.values(st.f).some((v) => v);
    const keepFocus = document.activeElement && document.activeElement.classList.contains("tb-q") && tb.contains(document.activeElement);
    tb.innerHTML = `<div class="tb-1"><input type="search" class="tb-q" placeholder="이 표에서 찾기" aria-label="이 표에서 찾기" value="${h(st.q)}">${pick}<span class="tb-n">${shown}건${active ? ` <button type="button" class="tb-x">조건 지우기</button>` : ""}</span></div>${filt || sortSel ? `<div class="tb-2">${filt}${sortSel}</div>` : ""}`;
    const q = $(".tb-q", tb);
    if (keepFocus) { q.focus(); const n = q.value.length; q.setSelectionRange(n, n); }
    let t = 0; q.oninput = () => { clearTimeout(t); t = setTimeout(() => { st.q = q.value; draw(); }, 180); };
    $$("[data-p]", tb).forEach((x) => x.onclick = () => { st.pick = x.dataset.p; if (st.sort && b.sort && b.sort.k[0] === "@") st.sort = { k: b.sort.k, d: b.sort.d }; draw(); });
    $$(".fchip", tb).forEach((x) => x.onclick = () => { st.f[x.dataset.f] = x.dataset.v || null; draw(); });
    $$("select[data-f]", tb).forEach((x) => x.onchange = () => { st.f[x.dataset.f] = x.value || null; draw(); });
    const ss = $("select[data-sort]", tb); if (ss) ss.onchange = () => { const [k, d] = ss.value.split("|"); st.sort = k ? { k, d: +d } : null; draw(); };
    const xb = $(".tb-x", tb); if (xb) xb.onclick = () => { st.q = ""; st.f = {}; draw(); };
  }
  function sums(b, st, secs, cols) {
    const rows = secs.flatMap((s) => s.rows);
    const c = {}; cols.filter((x) => x.sum).forEach((x) => { c[x.k] = rows.reduce((a, r) => a + (typeof r.c[x.k] === "number" ? r.c[x.k] : 0), 0); });
    return { l: `선택한 ${rows.length}건 합계`, c, calc: 1 };
  }
  const filtered = (st) => !!(st.q || Object.values(st.f || {}).some((v) => v));
  const expandable = (b, st, r) => (r.x && r.x.length) || detCols(b, st).some((c) => r.c[c.k] != null && r.c[c.k] !== "");

  function tableHtml(b, st, secs) {
    const cols = visCols(b, st), dc = detCols(b, st), nc = cols.length;
    const sk = st.sort && st.sort.k;
    const th = cols.map((c, i) => `<th class="${isNum(c) ? "n" : ""}${c.f === "months" ? " mo" : ""}" data-k="${h(c.k)}"${c.f !== "months" && c.f !== "long" ? ` data-sort="1" aria-sort="${sk === c.k ? (st.sort.d > 0 ? "ascending" : "descending") : "none"}"` : ""}>${c.f === "months" ? monthHead(b) : h(c.l)}${sk === c.k ? `<i class="so">${st.sort.d > 0 ? "▲" : "▼"}</i>` : ""}</th>`).join("");
    const row = (r) => {
      const ex = expandable(b, st, r), open = st.open.has(r._i);
      const tds = cols.map((c, i) => `<td class="${isNum(c) ? "n" : ""}${c.f === "long" ? " lg" : c.f === "text" ? " tx" : ""}">${i === 0 && ex ? `<span class="chev" aria-hidden="true">${open ? "▾" : "▸"}</span>` : ""}${cell(c, r.c)}</td>`).join("");
      let out = `<tr class="r${ex ? " ex" : ""}${r.st ? " st-" + r.st : ""}${open ? " open" : ""}" data-i="${r._i}"${ex ? ` tabindex="0" aria-expanded="${open}"` : ""}>${tds}</tr>`;
      if (ex && open) out += `<tr class="xrow"><td colspan="${nc}">${detailHtml(b, st, r, dc)}</td></tr>`;
      return out;
    };
    const footRow = (f, cls) => `<tr class="${cls}">${cols.map((c, i) => `<td class="${isNum(c) ? "n" : ""}">${i === 0 ? h(f.l) : (f.c[c.k] != null && f.c[c.k] !== "" && c.f !== "tag" ? cell(c, f.c) : (c.f === "months" && f.c.mo ? months(f.c.mo) : ""))}</td>`).join("")}</tr>`;
    const fl = filtered(st);
    let body = "";
    secs.forEach((s) => {
      if (!s.rows.length && (fl || !s.h)) return;
      if (s.h) body += `<tr class="sec"><th colspan="${nc}"><b>${h(s.h)}</b>${s.s ? `<span>${h(s.s)}</span>` : ""}</th></tr>`;
      body += s.rows.map(row).join("");
      if (!fl && !sk) (s.foot || []).forEach((f) => { body += footRow(f, "sf"); });
    });
    const tf = fl ? (cols.some((c) => c.sum) ? [sums(b, st, secs, cols)] : []) : (b.foot || []);
    const tall = secs.reduce((a, s) => a + s.rows.length, 0) > 24;
    return `<div class="dtw${tall ? " tall" : ""}"><table class="dt"><thead><tr>${th}</tr></thead><tbody>${body}</tbody>${tf.length ? `<tfoot>${tf.map((f) => footRow(f, "tf")).join("")}</tfoot>` : ""}</table></div>`;
  }
  const monthHead = (b) => `<span class="mstrip hd">${(b.mlabels || []).map((l) => `<span><i>${h(l)}</i></span>`).join("")}</span>`;
  function detailHtml(b, st, r, dc, skip) {
    const fields = dc.concat(skip ? b.cols.filter((c) => !c.d && !skip.has(c.k)) : []).filter((c) => r.c[c.k] != null && r.c[c.k] !== "" && (!b.pick || !b.pick.cols || detCols(b, st).includes(c) || visCols(b, st).includes(c)));
    const dl = fields.length ? `<dl class="kv">${fields.map((c) => `<div${c.f === "long" || c.f === "months" ? ' class="w"' : ""}><dt>${h(c.l)}</dt><dd class="${isNum(c) ? "n" : ""}">${c.f === "wk" ? `${fmt(r.c[c.k], "wk", r.c, true)} <small>${fmt(r.c[c.k], "won", r.c, true)}</small>` : cell(c, r.c, true)}</dd></div>`).join("")}</dl>` : "";
    const xs = (r.x || []).map((x) => x.text ? `<div class="xd"><h4>${h(x.h)}</h4><p class="xt">${h(x.text)}</p></div>`
      : `<div class="xd"><h4>${h(x.h)}</h4><div class="dtw"><table class="dt mini"><thead><tr>${x.cols.map((c) => `<th class="${isNum(c) ? "n" : ""}">${h(c.l)}</th>`).join("")}</tr></thead><tbody>${x.rows.map((y) => `<tr>${x.cols.map((c) => `<td class="${isNum(c) ? "n" : ""}">${cell(c, y)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`).join("");
    return dl + xs;
  }
  function autoCard(b, st) {   // 카드 배치가 없는 표: 첫 열 = 제목, 숫자 열 = 작은 지표, 글자 열 = 부제
    const vc = visCols(b, st), rest = vc.slice(1);
    return { title: vc[0] && vc[0].k, sub: rest.filter((c) => c.f === "text").slice(0, 2).map((c) => c.k),
             chips: rest.filter((c) => c.f === "tag").slice(0, 2).map((c) => c.k), stats: rest.filter(isNum).slice(0, 9).map((c) => c.k) };
  }
  function cardsHtml(b, st, secs) {
    const cd = b.card || autoCard(b, st), cols = b.cols, byK = Object.fromEntries(cols.map((c) => [c.k, c]));
    const K = (k) => resolve(k, b, st);
    const tk = K(cd.title) || cols[0].k, ak = K(cd.amt), bk = cd.bar, wk = cd.wide;
    const subs = (cd.sub || []).map(K).filter(Boolean), metas = (cd.meta || []).map(K).filter(Boolean), chips = (cd.chips || []).map(K).filter(Boolean), stats = (cd.stats || []).map(K).filter(Boolean);
    const used = new Set([tk, ak, bk, wk, ...subs, ...metas, ...chips, ...stats].filter(Boolean));
    const vc = new Set(visCols(b, st).map((c) => c.k));
    const skip = new Set([...used].concat(cols.filter((c) => !c.d && !vc.has(c.k)).map((c) => c.k)));
    const fv = (k, r, unit = true) => byK[k] ? cell(byK[k], r.c, unit) : h(r.c[k]);
    const card = (r) => {
      const leftover = cols.filter((c) => !skip.has(c.k) && !c.d && r.c[c.k] != null && r.c[c.k] !== "");
      const ex = (r.x && r.x.length) || leftover.length || detCols(b, st).some((c) => r.c[c.k] != null && r.c[c.k] !== "");
      const open = st.open.has(r._i);
      const sub = subs.map((k) => r.c[k]).filter((v) => v != null && v !== "").map((v, i) => byK[subs[i]] && byK[subs[i]].f !== "text" && byK[subs[i]].f !== "tag" ? fv(subs[i], r) : h(v)).join(" · ");
      const amt = ak && r.c[ak] != null ? fv(ak, r) : "";
      const meta = metas.filter((k) => r.c[k] != null && r.c[k] !== "").map((k) => `<span><small>${h(byK[k] ? byK[k].l : k)}</small> ${fv(k, r)}</span>`).join("");
      const ch = chips.map((k) => r.c[k] != null && r.c[k] !== "" ? cell(byK[k] && byK[k].f === "tag" ? byK[k] : { k, f: "tag" }, r.c) : "").join("");
      const bar = bk && typeof r.c[bk] === "number" ? `<div class="cd-bar"><span class="pbar"><i style="width:${Math.max(0, Math.min(100, r.c[bk] * 100)).toFixed(1)}%"></i></span><span>${h(byK[bk].l)} ${fmt(r.c[bk], "pct")}</span></div>` : "";
      const sg = stats.length ? `<dl class="cd-st">${stats.filter((k) => r.c[k] != null).map((k) => `<div><dt>${h(byK[k].l.replace(/\((억원|원|USD)\)/, "").trim())}</dt><dd>${fv(k, r)}</dd></div>`).join("")}</dl>` : "";
      const wide = wk && r.c[wk] ? `<div class="cd-w">${cell(byK[wk], r.c)}</div>` : "";
      return `<article class="cd${ex ? " ex" : ""}${open ? " open" : ""}${r.st ? " st-" + r.st : ""}" data-i="${r._i}"${ex ? ` tabindex="0" role="button" aria-expanded="${open}"` : ""}>
        <div class="cd-1"><b class="cd-t">${fv(tk, r, false) || "-"}</b>${amt ? `<span class="cd-a">${amt}</span>` : ""}</div>
        ${sub ? `<div class="cd-2">${sub}</div>` : ""}${ch || meta ? `<div class="cd-3">${ch}${meta ? `<span class="cd-m">${meta}</span>` : ""}</div>` : ""}${bar}${sg}${wide}
        ${ex && open ? `<div class="cd-x">${detailHtml(b, st, r, detCols(b, st), skip)}</div>` : ""}${ex ? `<span class="cd-more">${open ? "접기" : "자세히"}</span>` : ""}</article>`;
    };
    const footCard = (f, cls) => {
      const vs = cols.filter((c) => f.c[c.k] != null && f.c[c.k] !== "" && c.f !== "tag" && c.f !== "text" && c.k !== tk).map((c) => `<div><dt>${h(c.l)}</dt><dd class="n">${cell(c, f.c, true)}</dd></div>`).join("");
      return `<div class="cd-ft ${cls}"><b>${h(f.l)}</b>${vs ? `<dl>${vs}</dl>` : ""}</div>`;
    };
    const fl = filtered(st), sk = st.sort && st.sort.k;
    let out = "";
    secs.forEach((s) => {
      if (!s.rows.length && (fl || !s.h)) return;
      if (s.h) out += `<div class="sec-h"><b>${h(s.h)}</b>${s.s ? `<span>${h(s.s)}</span>` : ""}</div>`;
      out += s.rows.map(card).join("");
      if (!fl && !sk) (s.foot || []).forEach((f) => { out += footCard(f, "sf"); });
    });
    const tf = fl ? (cols.some((c) => c.sum) ? [sums(b, st, secs, visCols(b, st))] : []) : (b.foot || []);
    out += tf.map((f) => footCard(f, "tf")).join("");
    return `<div class="cards">${out}</div>`;
  }
  function wire(body, b, st, draw) {
    const th = $(".dt thead", body), w = $(".dtw", body);
    if (th && w) w.style.setProperty("--hh", th.offsetHeight + "px");
    const toggle = (el) => { const i = +el.dataset.i; if (st.open.has(i)) st.open.delete(i); else st.open.add(i); draw(); };
    $$("tr.r.ex, article.cd.ex", body).forEach((el) => {
      el.onclick = (e) => { if (e.target.closest("a,button,select,input")) return; toggle(el); };
      el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(el); } };
    });
    $$("th[data-sort]", body).forEach((th) => th.onclick = () => {
      const k = th.dataset.k, c = b.cols.find((x) => x.k === k), first = isNum(c) || c.f === "date" ? -1 : 1;
      if (!st.sort || st.sort.k !== k) st.sort = { k, d: first };
      else if (st.sort.d === first) st.sort = { k, d: -first };
      else st.sort = null;
      draw();
    });
  }

  // ── 전체 찾기(요약 화면) ───────────────────────────────
  function mountGlobalFind() {
    const q = $("#gq"); if (!q) return;
    const body = $("#dzBody"), keep = body.innerHTML;
    let t = 0, showing = false;
    q.oninput = () => { clearTimeout(t); t = setTimeout(run, 200); };
    q.onkeydown = (e) => { if (e.key === "Escape") { q.value = ""; run(); } };
    function run() {
      const w = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (!w.length) { if (showing) { paintPage(); } return; }
      showing = true;
      const res = [];
      D.sheets.forEach((s) => {
        if (!hasView(s) || s.name === DEMO) return;
        const hits = [];
        walk(s.view, (b) => {
          if (b.t !== "table") return;
          const cd = b.card || {}, tk = (cd.title && cd.title[0] !== "@" ? cd.title : null) || b.cols[0].k;
          const subs = (cd.sub || []).filter((k) => k[0] !== "@");
          (b.secs || [{ rows: b.rows || [] }]).forEach((sec) => sec.rows.forEach((r) => {
            if (w.every((x) => hay(r).includes(x))) hits.push({ t: r.c[tk], s: [sec.h, ...subs.map((k) => r.c[k])].filter((v) => v != null && v !== "").join(" · "), bt: b.title });
          }));
        });
        if (hits.length) res.push({ s, hits });
      });
      body.innerHTML = res.length ? `<div class="gres">${res.map(({ s, hits }) => `<section class="pnl"><div class="bh"><h3>${h(s.short)} <small>${hits.length}건</small></h3><button type="button" class="btn sm" data-go="${h(s.name)}">시트에서 보기</button></div>
        <ul>${hits.slice(0, 6).map((x) => `<li><b>${h(x.t ?? "-")}</b>${x.s ? `<span>${h(x.s)}</span>` : ""}</li>`).join("")}${hits.length > 6 ? `<li class="more">외 ${hits.length - 6}건</li>` : ""}</ul></section>`).join("")}</div>`
        : `<div class="empty">'${h(q.value.trim())}' — 찾은 항목이 없습니다.</div>`;
      $$("[data-go]", body).forEach((x) => x.onclick = () => go(x.dataset.go, q.value.trim()));
    }
  }

  // ── 엑셀 원본(서식 그대로의 격자) ──────────────────────
  let styleEl = null;
  function buildStyles() {
    const css = [];
    (D.styles || []).forEach(([bg, fc, b, i, al, bd], k) => {
      const r = [];
      if (/^#[0-9A-F]{6}$/i.test(bg) && bg.toUpperCase() !== "#FFFFFF") r.push(`background:${bg}`);
      if (/^#[0-9A-F]{6}$/i.test(fc) && fc.toUpperCase() !== "#000000") r.push(`color:${fc}`);
      if (b) r.push("font-weight:700"); if (i) r.push("font-style:italic");
      if (/^(left|right|center)$/.test(al)) r.push(`text-align:${al}`);
      const sides = ["top", "bottom", "left", "right"];
      String(bd || "0000").split("").forEach((w, j) => { if (+w) r.push(`border-${sides[j]}:${w}px solid #222`); });
      if (r.length) css.push(`.xs td.s${k}{${r.join(";")}}`);
    });
    if (!styleEl) { styleEl = document.createElement("style"); document.head.appendChild(styleEl); }
    styleEl.textContent = css.join("\n");
  }
  const NUMRE = /^[-+(]?\s*[₩$€]?\s*[\d,]+(\.\d+)?\s*%?\)?$|^[\d,]+(\.\d+)?\s*(조원|억원|억|원|건|%)$/;
  const isNoBg = (k) => { const st = D.styles[k]; return !st || !st[0] || st[0].toUpperCase() === "#FFFFFF"; };

  function paintGrid(s, host) {
    const key = "kbnote-dz:" + s.name;
    const total = s.cols.reduce((a, b) => a + b, 0);
    const saved = LS.get(key, null);
    const freeze = LS.get("kbnote-dzfreeze", true);
    host.innerHTML = `
      <div class="sh-tools">
        <div class="sh-find"><input type="search" id="shq" placeholder="이 시트에서 찾기" aria-label="이 시트에서 찾기"><span class="sh-n" id="shn"></span>
          <button type="button" class="btn sm" id="shPrev" aria-label="이전 찾기">▲</button><button type="button" class="btn sm" id="shNext" aria-label="다음 찾기">▼</button></div>
        <div class="sh-zoom" role="group" aria-label="확대"><button type="button" class="btn sm" id="zOut" aria-label="축소">−</button><span id="zLab">100%</span><button type="button" class="btn sm" id="zIn" aria-label="확대">+</button><button type="button" class="btn sm" id="zFit">화면 맞춤</button></div>
        ${s.hdr ? `<label class="sh-fz"><input type="checkbox" id="shFz" ${freeze ? "checked" : ""}> 머리글 고정</label>` : ""}
      </div>
      <div class="xwrap" id="xwrap" tabindex="0" aria-label="${h(s.short)} 표"><table class="xs" id="xs"></table></div>
      <div class="cellbar" id="cellbar" hidden></div>`;
    const wrap = $("#xwrap"), tbl = $("#xs");
    tbl.innerHTML = gridHtml(s);
    const tds = Array.from(tbl.querySelectorAll("td[data-t]"));
    const view = gridView = { s, tds, hits: [], hi: -1, z: 1 };
    const fitZ = () => Math.max(0.35, Math.min(1.6, (wrap.clientWidth - 4) / total));
    let z = saved != null ? saved : (fitZ() >= (mob() ? 0.7 : 0.8) ? Math.min(1, fitZ()) : (mob() ? 0.8 : 1));
    const setZ = (v, keep) => {
      z = Math.max(0.35, Math.min(2, Math.round(v * 100) / 100)); view.z = z;
      tbl.style.setProperty("--z", z);
      tbl.querySelectorAll("col").forEach((c, i) => c.style.width = (s.cols[i] * z).toFixed(1) + "px");
      tbl.style.width = (total * z).toFixed(1) + "px";
      $("#zLab").textContent = Math.round(z * 100) + "%";
      if (keep !== false) LS.set(key, z);
      requestAnimationFrame(() => { sticky(); size(); });
    };
    $("#zIn").onclick = () => setZ(z + 0.1); $("#zOut").onclick = () => setZ(z - 0.1); $("#zFit").onclick = () => setZ(fitZ());
    const sticky = () => {
      const on = s.hdr && (!$("#shFz") || $("#shFz").checked), hs = s.hs || 0;
      const rows = tbl.rows; let top = 0;
      for (let i = 0; i < Math.min(rows.length, s.hdr); i++) {
        const fz = on && i >= hs; rows[i].classList.toggle("fz", fz);
        for (const td of rows[i].cells) td.style.top = fz ? top + "px" : "";
        if (fz) top += rows[i].getBoundingClientRect().height;
      }
    };
    if ($("#shFz")) $("#shFz").onchange = (e) => { LS.set("kbnote-dzfreeze", e.target.checked); sticky(); };
    const size = () => {
      const r = wrap.getBoundingClientRect(), bottom = mob() ? 78 : 14;
      wrap.style.maxHeight = Math.max(320, window.innerHeight - Math.max(r.top, 0) - bottom) + "px";
    };
    view.size = size; view.sticky = sticky;
    setZ(z, saved != null);
    const q = $("#shq"), cnt = $("#shn");
    let t = 0;
    q.oninput = () => { clearTimeout(t); t = setTimeout(find, 160); };
    q.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); } };
    $("#shNext").onclick = () => step(1); $("#shPrev").onclick = () => step(-1);
    function find() {
      view.hits.forEach((td) => td.classList.remove("hit", "cur")); view.hits = []; view.hi = -1;
      const w = q.value.trim().toLowerCase();
      if (!w) { cnt.textContent = ""; return; }
      const ws = w.split(/\s+/);
      view.hits = tds.filter((td) => { const x = (td.dataset.t + " " + (td.dataset.n || "")).toLowerCase(); return ws.every((k) => x.includes(k)); });
      view.hits.forEach((td) => td.classList.add("hit"));
      cnt.textContent = view.hits.length ? `${view.hits.length}건` : "없음";
      if (view.hits.length) step(1);
    }
    function step(d) {
      if (!view.hits.length) return;
      if (view.hi >= 0) view.hits[view.hi].classList.remove("cur");
      view.hi = (view.hi + d + view.hits.length) % view.hits.length;
      const td = view.hits[view.hi]; td.classList.add("cur");
      cnt.textContent = `${view.hi + 1}/${view.hits.length}`;
      const wr = wrap.getBoundingClientRect(), r = td.getBoundingClientRect();
      wrap.scrollBy({ left: r.left - wr.left - wr.width / 2 + r.width / 2, top: r.top - wr.top - wr.height / 2 + r.height / 2, behavior: "smooth" });
    }
    tbl.onclick = (e) => {
      const td = e.target.closest("td[data-t]"); if (!td) return;
      tbl.querySelectorAll("td.pick").forEach((x) => x.classList.remove("pick")); td.classList.add("pick");
      const bar = $("#cellbar"), row = td.parentElement.rowIndex + 1;
      bar.innerHTML = `<div class="cb-h"><span>${h(s.short)} · ${row}번째 줄</span><button type="button" class="btn sm" id="cbX" aria-label="닫기">닫기</button></div>
        <div class="cb-t">${h(td.dataset.t) || "<span class='muted'>(빈 칸)</span>"}</div>${td.dataset.n ? `<div class="cb-n"><b>메모</b>${h(td.dataset.n)}</div>` : ""}`;
      bar.hidden = false; $("#cbX").onclick = () => { bar.hidden = true; td.classList.remove("pick"); };
    };
  }
  function gridHtml(s) {
    const cols = s.cols.map((w) => `<col style="width:${w}px">`).join("");
    const nc = s.cols.length;
    const occ = new Set(); let out = "";
    s.rows.forEach((row, r) => {
      let c = 0, tr = "";
      for (let i = 0; i < row.length; i++) {
        while (occ.has(r + ":" + c)) c++;
        const [t, k, cs0 = 1, rs = 1, note = ""] = row[i];
        let cs = cs0;
        const st = D.styles[k] || [];
        const nm = t && NUMRE.test(t.trim());
        if (t && rs === 1 && !nm && st[4] !== "right" && st[4] !== "center" && !/\n/.test(t)) {
          let j = i + 1;
          while (j < row.length) {
            const nx = row[j];
            if (nx[0] || (nx[2] || 1) > 1 || (nx[3] || 1) > 1 || nx[4] || occ.has(r + ":" + (c + cs))) break;
            const ns = D.styles[nx[1]] || [];
            if ((ns[0] || "") !== (st[0] || "") || (ns[5] && ns[5] !== "0000")) break;
            cs += 1; j += 1;
            if (cs > 12) break;
          }
          i = j - 1;
        }
        for (let a = 0; a < rs; a++) for (let b = 0; b < cs; b++) occ.add((r + a) + ":" + (c + b));
        const ml = /\n/.test(t), hh = (s.rh && s.rh[r]) || 0;
        const cls = [`s${k}`]; if (nm) cls.push("n"); if (ml) cls.push("w"); if (note) cls.push("nt"); if (isNoBg(k)) cls.push("nb");
        const inner = ml ? `<div class="ml" style="--h:${Math.max(17, hh * rs)}">${h(t).replace(/\n/g, "<br>")}</div>` : h(t);
        tr += `<td class="${cls.join(" ")}"${cs > 1 ? ` colspan="${Math.min(cs, nc - c)}"` : ""}${rs > 1 ? ` rowspan="${rs}"` : ""} data-t="${h(t)}"${note ? ` data-n="${h(note)}"` : ""}>${inner}</td>`;
        c += cs;
      }
      out += `<tr>${tr}</tr>`;
    });
    return `<colgroup>${cols}</colgroup><tbody>${out}</tbody>`;
  }

  // 화면 폭이 휴대폰↔PC 로 바뀌면 다시 그림(표 ↔ 카드)
  let rt = 0;
  window.addEventListener("resize", () => {
    if (!D || !$("#dzBody")) return;
    if (gridView) { gridView.size(); gridView.sticky(); }
    clearTimeout(rt); rt = setTimeout(() => {
      if (!document.body.classList.contains("dashmode")) return;
      if (lastMob !== mob()) { paint(); return; }
      const cs = charts; charts = [];
      cs.forEach((c) => { const el = document.getElementById(c.id); if (!el) return; const w = $(".chslot", el).clientWidth; if (Math.abs(w - c.w) > 8) mountChart(c.id, c.b); else charts.push(c); });
    }, 150);
  });

  function focusFind() {
    const q = $("#gq") || $("#dzBody .tb-q") || $("#shq");
    if (q) { q.focus(); q.select(); return true; } return false;
  }
  return { render, focusFind };
})();
