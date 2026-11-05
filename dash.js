/*
 * 대시보드 탭 — GIS 대시보드 엑셀(xlsm)의 모든 시트를 읽기 전용으로 보여준다.
 * 데이터: dash.enc.json (미팅노트 DB와 같은 비밀번호·salt 로 잠근 사본, scripts/dash_extract.py → scripts/vault.mjs)
 * 화면: 요약(지표 카드·월별 현금수익·KPI 연도별·Fee 예상·시딩·검증) + 시트 뷰어(엑셀 서식 그대로, 찾기·확대·머리글 고정·셀 상세).
 */
const Dash = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const h = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
               set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const mob = () => matchMedia("(max-width:760px)").matches;
  const SUM = "__sum";
  let D = null, state = "idle", err = "", sel = LS.get("kbnote-dzsel", SUM);
  let view = null;   // 지금 그린 시트 { s, tds, hits, hi, z }

  // ── 데이터 열기 ─────────────────────────────────────────
  async function ensure() {
    if (D || state === "loading") return;
    state = "loading"; paint();
    const r = await Vault.openExtra("dash.enc.json");
    if (r.data) { D = r.data; state = "ready"; buildStyles(); }
    else { state = "error"; err = r.error; }
    paint();
  }
  function render() { if (!D) { if (state !== "loading" && state !== "error") ensure(); paint(); return; } paint(); }

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
    if (sel !== SUM && !D.sheets.some((s) => s.name === sel)) sel = SUM;
    paintNav();
    if (sel === SUM) paintSummary(); else paintSheet(D.sheets.find((s) => s.name === sel));
  }

  // ── 시트 목록 ───────────────────────────────────────────
  function paintNav() {
    const nav = $("#dzNav");
    let out = `<button type="button" class="dz-item sum" data-s="${SUM}" aria-current="${sel === SUM}">요약</button>`;
    let g = null;
    D.sheets.forEach((s) => {
      if (s.group !== g) { g = s.group; out += `<div class="dz-grp">${h(g)}</div>`; }
      out += `<button type="button" class="dz-item" data-s="${h(s.name)}" title="${h(s.name)}" aria-current="${sel === s.name}">${h(s.short)}</button>`;
    });
    nav.innerHTML = out;
    nav.querySelectorAll("[data-s]").forEach((b) => b.onclick = () => go(b.dataset.s));
    const on = nav.querySelector('[aria-current="true"]');
    if (on && mob()) on.scrollIntoView({ block: "nearest", inline: "center" });
  }
  function go(name) { sel = name; LS.set("kbnote-dzsel", name); paint(); window.scrollTo({ top: 0 }); }

  // ── 요약 ───────────────────────────────────────────────
  const n2 = (v, d = 2) => (v == null || isNaN(v)) ? "-" : Number(v).toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (v, d = 1) => (v == null || isNaN(v)) ? "-" : (v * 100).toFixed(d) + "%";
  function paintSummary() {
    view = null;
    const S = D.summary || {}, fx = D.fx || {}, ck = S.check || { ok: 0, n: 0, fails: [] };
    const cards = (S.cards || []).map((c) => {
      const p = c.pct == null ? null : Math.max(0, Math.min(1, c.pct));
      const val = c.unit === "건" ? n2(c.value, 0) : n2(c.value, 2);
      return `<div class="kc"><div class="kc-l">${h(c.label)}</div>
        <div class="kc-v">${h(val)}<span>${h(c.unit)}</span></div>
        ${p == null ? "" : `<div class="kc-bar" role="img" aria-label="${h(c.sub)}"><i style="width:${(p * 100).toFixed(1)}%"></i></div>`}
        <div class="kc-s">${h(c.sub)}</div><div class="kc-n">${h(c.note)}</div></div>`;
    }).join("");
    const mon = S.monthly || [], cum = mon.reduce((a, m) => a + (m.v || 0), 0);
    const kpi = (S.kpi || []).map((k) => `<tr${k.y === (D.asof || "").slice(0, 4) * 1 ? ' class="now"' : ""}><td>${k.y}</td><td class="r">${n2(k.saleTgt, 1)}</td><td class="r">${n2(k.saleKpi, 2)}</td><td class="r ${k.saleRate >= 1 ? "ok" : ""}">${pct(k.saleRate)}</td><td class="r">${n2(k.paTgt, 0)}</td><td class="r">${n2(k.pa, 0)}</td><td class="r ${k.paRate >= 1 ? "ok" : ""}">${pct(k.paRate, 0)}</td></tr>`).join("");
    const sd = S.seed || {};
    const quick = D.sheets.map((s) => `<button type="button" class="qk" data-s="${h(s.name)}"><b>${h(s.short)}</b><span>${h(s.group)} · ${s.rows.length}행</span></button>`).join("");
    $("#dzMain").innerHTML = `
      <div class="dz-head"><div class="t"><div class="eyebrow">기준일 ${h(D.asof)} · ${h(D.generatedAt)} 업데이트</div><h2>대시보드 요약</h2></div>
        <div class="dz-meta"><span>USDKRW <b>${n2(fx.usd, 2)}</b></span><span>EURKRW <b>${n2(fx.eur, 2)}</b></span>
        <span class="ck ${ck.ok === ck.n ? "ok" : "ng"}" title="${h((ck.fails || []).join(" / "))}">검증 ${ck.ok}/${ck.n} ${ck.ok === ck.n ? "✔" : "확인 필요"}</span></div></div>
      <div class="kcards">${cards}</div>
      <div class="dz-two">
        <section class="pnl"><h3>월별 현금 수익 <small>억원 · 누적 ${n2(cum / 1e8, 2)}억</small></h3>${chartMonthly(mon)}</section>
        <section class="pnl"><h3>PA Fee 연도별 예상 <small>억원 · PA Fee Schedule 기준</small></h3>${chartFee(S.fee || {})}</section>
      </div>
      <div class="dz-two">
        <section class="pnl"><h3>KPI 목표 대비 실적 <small>판매규모 조원 · 신규 PA 건</small></h3>
          <div class="tw"><table class="kt"><thead><tr><th>연도</th><th class="r">판매 목표</th><th class="r">KPI 실적</th><th class="r">달성률</th><th class="r">PA 목표</th><th class="r">PA 실적</th><th class="r">달성률</th></tr></thead><tbody>${kpi}</tbody></table></div></section>
        <section class="pnl"><h3>해외대체 시딩 <small>억원</small></h3>
          <div class="mini"><div><span>펀드</span><b>${n2(sd.funds, 0)}개</b></div><div><span>투자잔고 NAV 합</span><b>${n2((sd.nav || 0) / 1e8, 2)}억</b></div>
          <div><span>2026 누적수익</span><b>${n2((sd.ytd || 0) / 1e8, 2)}억</b><em>${h(sd.ytdAsof || "")} 기준</em></div></div>
          ${ck.ok === ck.n ? "" : `<div class="warnbox" style="margin-top:10px">검증 확인 필요: ${h((ck.fails || []).join(" · "))}</div>`}</section>
      </div>
      <section class="pnl"><h3>시트 바로가기 <small>엑셀 원본 서식 그대로</small></h3><div class="quickg">${quick}</div></section>
      <p class="basis">원본: ${h(D.source)} · 엑셀에 저장된 값을 그대로 보여주는 읽기 전용 화면입니다. 숫자를 고치려면 엑셀을 고친 뒤 Claude에 대시보드 업데이트를 요청하세요.</p>`;
    $("#dzMain").querySelectorAll(".qk[data-s]").forEach((b) => b.onclick = () => go(b.dataset.s));
  }

  function chartMonthly(mon) {
    if (!mon.length) return `<div class="empty">데이터 없음</div>`;
    const v = mon.map((m) => (m.v || 0) / 1e8), mx = Math.max(1, ...v), mn = Math.min(0, ...v);
    const W = 600, H = 280, T = 24, B = mn < 0 ? 40 : 28, L = 6, R = 6, bw = (W - L - R) / v.length;
    const y = (x) => T + (mx - x) / (mx - mn) * (H - T - B);
    const z = y(0);
    const bars = v.map((x, i) => {
      const yy = y(Math.max(x, 0)), hh = Math.abs(y(x) - z), cx = L + bw * i + bw / 2;
      const lab = x === 0 ? "" : (Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
      return `<g><title>${mon[i].m}월 ${n2(x, 2)}억원</title><rect class="${x < 0 ? "neg" : "pos"}" x="${(cx - bw * 0.32).toFixed(1)}" y="${(x < 0 ? z : yy).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${Math.max(hh, x ? 1 : 0).toFixed(1)}" rx="2"/>
        ${lab ? `<text class="vl" x="${cx.toFixed(1)}" y="${(x < 0 ? y(x) + 12 : yy - 5).toFixed(1)}">${lab}</text>` : ""}
        <text class="xl" x="${cx.toFixed(1)}" y="${H - 8}">${mon[i].m}월</text></g>`;
    }).join("");
    return `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="월별 현금 수익(억원)"><line class="zl" x1="${L}" x2="${W - R}" y1="${z.toFixed(1)}" y2="${z.toFixed(1)}"/>${bars}</svg>`;
  }
  function chartFee(fee) {
    const ys = Object.keys(fee).sort();
    if (!ys.length) return `<div class="empty">데이터 없음</div>`;
    const mx = Math.max(...ys.map((y) => fee[y] / 1e8), 1), now = (D.asof || "").slice(0, 4);
    return `<div class="hb">${ys.map((y) => { const v = fee[y] / 1e8; return `<div class="hb-r${y === now || y * 1 === now * 1 + 1 ? " on" : ""}"><span class="hb-y">${y}</span><span class="hb-t"><i style="width:${Math.max(0, v / mx * 100).toFixed(1)}%"></i></span><span class="hb-v">${n2(v, 1)}</span></div>`; }).join("")}</div>`;
  }

  // ── 시트 뷰어 ───────────────────────────────────────────
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
  const NUM = /^[-+(]?\s*[₩$€]?\s*[\d,]+(\.\d+)?\s*%?\)?$|^[\d,]+(\.\d+)?\s*(조원|억원|억|원|건|%)$/;
  const isNoBg = (k) => { const st = D.styles[k]; return !st || !st[0] || st[0].toUpperCase() === "#FFFFFF"; };

  function paintSheet(s) {
    const key = "kbnote-dz:" + s.name;
    const total = s.cols.reduce((a, b) => a + b, 0);
    const saved = LS.get(key, null);
    const freeze = LS.get("kbnote-dzfreeze", true);
    $("#dzMain").innerHTML = `
      <div class="dz-head sheet"><div class="t"><div class="eyebrow">${h(s.group)} · ${s.rows.length}행 × ${s.cols.length}열</div><h2>${h(s.short)}</h2>${s.short !== s.name ? `<div class="sub2">${h(s.name)}</div>` : ""}</div></div>
      <div class="sh-tools">
        <div class="sh-find"><input type="search" id="shq" placeholder="이 시트에서 찾기" aria-label="이 시트에서 찾기"><span class="sh-n" id="shn"></span>
          <button type="button" class="btn sm" id="shPrev" aria-label="이전 찾기">▲</button><button type="button" class="btn sm" id="shNext" aria-label="다음 찾기">▼</button></div>
        <div class="sh-zoom" role="group" aria-label="확대"><button type="button" class="btn sm" id="zOut" aria-label="축소">−</button><span id="zLab">100%</span><button type="button" class="btn sm" id="zIn" aria-label="확대">+</button><button type="button" class="btn sm" id="zFit">화면 맞춤</button></div>
        ${s.hdr ? `<label class="sh-fz"><input type="checkbox" id="shFz" ${freeze ? "checked" : ""}> 머리글 고정</label>` : ""}
      </div>
      <div class="xwrap" id="xwrap" tabindex="0" aria-label="${h(s.short)} 표"><table class="xs" id="xs"></table></div>
      <div class="cellbar" id="cellbar" hidden></div>`;
    const wrap = $("#xwrap"), tbl = $("#xs");
    tbl.innerHTML = tableHtml(s);
    const tds = Array.from(tbl.querySelectorAll("td[data-t]"));
    view = { s, tds, hits: [], hi: -1, z: 1 };
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
    setZ(z, saved != null);
    // 찾기
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
    // 셀 누르면 전체 글자·메모
    tbl.onclick = (e) => {
      const td = e.target.closest("td[data-t]"); if (!td) return;
      tbl.querySelectorAll("td.pick").forEach((x) => x.classList.remove("pick")); td.classList.add("pick");
      const bar = $("#cellbar"), row = td.parentElement.rowIndex + 1;
      bar.innerHTML = `<div class="cb-h"><span>${h(s.short)} · ${row}번째 줄</span><button type="button" class="btn sm" id="cbX" aria-label="닫기">닫기</button></div>
        <div class="cb-t">${h(td.dataset.t) || "<span class='muted'>(빈 칸)</span>"}</div>${td.dataset.n ? `<div class="cb-n"><b>메모</b>${h(td.dataset.n)}</div>` : ""}`;
      bar.hidden = false; $("#cbX").onclick = () => { bar.hidden = true; td.classList.remove("pick"); };
    };
    window.onresize = () => { if (view && view.s === s) { size(); sticky(); } };
  }

  function tableHtml(s) {
    const cols = s.cols.map((w) => `<col style="width:${w}px">`).join("");
    const nc = s.cols.length;
    // 엑셀처럼 왼쪽 정렬 글자는 오른쪽 빈 칸으로 넘쳐 보이게(빈 칸과 합쳐 그림)
    const occ = new Set(); let out = "";
    s.rows.forEach((row, r) => {
      let c = 0, tr = "";
      for (let i = 0; i < row.length; i++) {
        while (occ.has(r + ":" + c)) c++;
        const [t, k, cs0 = 1, rs = 1, note = ""] = row[i];
        let cs = cs0;
        const st = D.styles[k] || [];
        const num = t && NUM.test(t.trim());
        if (t && rs === 1 && !num && st[4] !== "right" && st[4] !== "center" && !/\n/.test(t)) {
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
        // 여러 줄 글자: 엑셀 행 높이만큼만 보이고(넘치면 잘림) 셀을 누르면 전체가 보인다
        const ml = /\n/.test(t), hh = (s.rh && s.rh[r]) || 0;
        const cls = [`s${k}`]; if (num) cls.push("n"); if (ml) cls.push("w"); if (note) cls.push("nt"); if (isNoBg(k)) cls.push("nb");
        const inner = ml ? `<div class="ml" style="--h:${Math.max(17, hh * rs)}">${h(t).replace(/\n/g, "<br>")}</div>` : h(t);
        tr += `<td class="${cls.join(" ")}"${cs > 1 ? ` colspan="${Math.min(cs, nc - c)}"` : ""}${rs > 1 ? ` rowspan="${rs}"` : ""} data-t="${h(t)}"${note ? ` data-n="${h(note)}"` : ""}>${inner}</td>`;
        c += cs;
      }
      out += `<tr>${tr}</tr>`;
    });
    return `<colgroup>${cols}</colgroup><tbody>${out}</tbody>`;
  }

  function focusFind() { const q = $("#shq"); if (q) { q.focus(); q.select(); return true; } return false; }
  return { render, focusFind };
})();
