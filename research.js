/*
 * 리서치 탭 — 구독 리포트(예: Preqin 분기 리포트)를 자산군별로 정리한 화면 + A4 1쪽 PDF 받기.
 * 데이터: research.enc.json (미팅노트 DB와 같은 비밀번호·salt 로 잠근 사본. scripts/research_build.mjs → scripts/vault.mjs)
 *   reports[]: { id, name, short, en, headline, kpis[], charts[], table?, sections[], outlook[], insights[], strats[], pdf(base64), pdfName }
 * 지표 카드·차트는 대시보드의 블록 그리기(Dash.blocks)를 그대로 쓴다. '국내 LP 수요'는 전략 수요판(기관 시그널)에서 그때그때 센다.
 */
const Research = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const h = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LS = { get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  let D = null, state = "idle", err = "", sel = LS.get("kbnote-rsel", "");

  async function ensure() {
    if (D || state === "loading") return;
    state = "loading"; paint();
    const r = await Vault.openExtra("research.enc.json");
    if (r.data && Array.isArray(r.data.reports) && r.data.reports.length) { D = r.data; state = "ready"; }
    else { state = "error"; err = r.error || "broken"; }
    paint();
  }
  function render() { if (!D && state !== "loading" && state !== "error") ensure(); paint(); }

  // 전략 수요판(기관 시그널)에서 그 자산군의 전략별 진행·관심·약정 기관 수
  const ST = ["진행", "관심", "약정"];
  function demand(strats) {
    const orgs = (typeof O !== "undefined" ? O : []).filter((o) => o.signals && Object.keys(o.signals).length);
    const rows = strats.map((k) => { const n = { k }; ST.forEach((s) => { n[s] = orgs.filter((o) => (o.signals[k] || {}).s === s).length; }); return n; });
    return { rows, lp: orgs.filter((o) => strats.some((k) => ST.includes((o.signals[k] || {}).s))).length };
  }

  // 작은 막대 차트(막대 2~4개): 리포트 본문에 나온 숫자만 그린다. 마지막(최근) 막대는 노랑. PDF 의 차트와 같은 모양
  function bars(c) {
    const W = 150, H = 66, B = 14, T = 13, n = c.v.length, mx = Math.max(...c.v.map(Math.abs)) || 1;
    const gw = W / n, bw = Math.min(30, gw * 0.5);
    const f = (v) => (c.f === "n1" ? v.toFixed(1) : String(Math.round(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(c.title)}: ${h(c.cats.map((x, i) => x + " " + f(c.v[i])).join(", "))}"><line x1="0" y1="${H - B}" x2="${W}" y2="${H - B}"/>`;
    c.v.forEach((v, i) => {
      const bh = Math.max(1.5, (H - B - T) * Math.abs(v) / mx), x = gw * i + (gw - bw) / 2, y = H - B - bh;
      s += `<rect${i === n - 1 ? ' class="on"' : ""} x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.6"/>`
        + `<text class="v" x="${(x + bw / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}">${f(v)}</text><text class="l" x="${(x + bw / 2).toFixed(1)}" y="${H - 3.5}">${h(c.cats[i])}</text>`;
    });
    return s + "</svg>";
  }

  function paint() {
    const el = $("#rsMain"); if (!el) return;
    if (!D) {
      const msg = state === "error"
        ? ({ missing: "아직 올라온 리서치 자료가 없습니다.", mismatch: "리서치 자료가 다른 비밀번호로 잠겨 있습니다. Claude에 리서치 업데이트를 다시 요청해 주세요.",
             network: "리서치 자료를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.", locked: "먼저 비밀번호로 앱을 열어 주세요." }[err] || "리서치 자료를 열지 못했습니다.")
        : "리서치 자료를 여는 중…";
      el.innerHTML = `<div class="empty">${h(msg)}</div>`;
      if (state === "error") { const b = document.createElement("button"); b.className = "btn sm"; b.textContent = "다시 시도"; b.onclick = () => { state = "idle"; ensure(); }; el.firstChild.append(document.createElement("br"), b); }
      return;
    }
    const r = D.reports.find((x) => x.id === sel) || D.reports[0]; sel = r.id;
    const tabs = D.reports.map((x) => `<button type="button" data-k="${h(x.id)}" aria-pressed="${x.id === r.id}">${h(x.short || x.name)}</button>`).join("");
    const ul = (items) => `<ul>${(items || []).map((x) => `<li>${h(x)}</li>`).join("")}</ul>`;
    const table = r.table ? `<section class="pnl rs-tbl"><div class="bh"><h3>${h(r.table.title)}${r.table.sub ? ` <small>${h(r.table.sub)}</small>` : ""}</h3></div>
        <div class="dtw"><table class="dt"><thead><tr>${r.table.cols.map((c) => `<th>${h(c)}</th>`).join("")}</tr></thead><tbody>${r.table.rows.map((row) => `<tr>${row.map((c, i) => `<td${i ? "" : ' class="rs-k"'}>${h(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section>` : "";
    const secs = (r.sections || []).map((s) => `<section class="pnl rs-sec"><h3>${h(s.h)}</h3>${ul(s.items)}</section>`).join("");
    const outlook = (r.outlook || []).length ? `<section class="rs-out"><h3>Preqin의 시각</h3>${ul(r.outlook)}</section>` : "";
    // 국내 LP 수요: 자산군 쪽은 전략별, 종합은 자산군별 합계
    let dm = "";
    if ((r.strats || []).length) {
      const d = demand(r.strats);
      dm = `<div class="rs-dm"><div class="rs-dmh"><b>국내 LP 수요</b><span>전략 수요판 기준 · 관심 이상 ${d.lp}개 기관</span></div>
        <div class="rs-dmr">${d.rows.map((x) => `<button type="button" class="rs-st" data-strat="${h(x.k)}"><b>${h(x.k)}</b>${ST.map((s) => `<span class="sg s-${s}">${s} ${x[s]}</span>`).join("")}</button>`).join("")}</div></div>`;
    } else {
      const gs = D.reports.filter((x) => (x.strats || []).length).map((x) => { const d = demand(x.strats); return { x, lp: d.lp, n: Object.fromEntries(ST.map((s) => [s, d.rows.reduce((a, y) => a + y[s], 0)])) }; });
      if (gs.length) dm = `<div class="rs-dm"><div class="rs-dmh"><b>국내 LP 수요</b><span>전략 수요판 기준 · 자산군별 관심 이상 기관 수와 시그널 합계</span></div>
        <div class="rs-dmr">${gs.map((g) => `<button type="button" class="rs-st" data-go="${h(g.x.id)}"><b>${h(g.x.short || g.x.name)} <small>${g.lp}개 기관</small></b>${ST.map((s) => `<span class="sg s-${s}">${s} ${g.n[s]}</span>`).join("")}</button>`).join("")}</div></div>`;
    }
    const oldApp = !window.KBApp && /; wv\)/.test(navigator.userAgent);   // 안드로이드 앱(WebView)인데 PDF 저장 기능이 없는 옛 버전
    el.innerHTML = `
      <div class="rs-head"><div class="t"><div class="eyebrow">리서치 · ${h(D.generatedAt || "")} 정리</div><h2>${h(D.title || "리서치")} <small>${h(D.period || "")}</small></h2></div>
        ${r.pdf ? `<button type="button" class="btn primary rs-pdf" id="rsPdf"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>PDF 받기 <small>A4 1쪽</small></button>` : ""}</div>
      <div class="seg yseg rs-seg" role="group" aria-label="자산군">${tabs}</div>
      ${oldApp && r.pdf ? `<p class="rs-warn">이 앱 버전은 PDF 저장을 지원하지 않습니다. <a href="./install.html">설치 페이지</a>에서 새 버전을 받아 그대로 설치해 주세요(기존 앱 위에 설치됩니다).</p>` : ""}
      <div class="rs-ttl"><h3>${h(r.name)}${r.en ? ` <small>${h(r.en)}</small>` : ""}</h3><p class="rs-hl">${h(r.headline || "")}</p></div>
      <div id="rsKpi"></div><div id="rsCh"></div>
      ${table}<div class="rs-secs">${secs}</div>${outlook}
      <section class="rs-ins"><h3>KB GIS 시사점 <small>리포트가 아닌 당부서의 해석</small></h3>${ul(r.insights)}${dm}</section>
      <p class="basis">${h(D.notice || "")}<br>출처: ${h(D.source || "")}</p>`;
    if ((r.kpis || []).length) Dash.blocks([{ t: "kpis", id: "k", items: r.kpis }], $("#rsKpi"), "rs:" + r.id);
    $("#rsCh").innerHTML = (r.charts || []).map((c) => `<div class="pnl rs-c"><div class="rs-ct"><b>${h(c.title)}</b><small>${h(c.sub || "")}</small></div>${bars(c)}</div>`).join("");
    $$(".rs-seg button", el).forEach((b) => b.onclick = () => { sel = b.dataset.k; LS.set("kbnote-rsel", sel); paint(); });
    $$("[data-go]", el).forEach((b) => b.onclick = () => { sel = b.dataset.go; LS.set("kbnote-rsel", sel); paint(); window.scrollTo({ top: 0 }); });
    $$("[data-strat]", el).forEach((b) => b.onclick = () => {   // 그 전략을 보는 기관 목록(전략 수요판)으로
      const s = document.querySelector("#dStrat"); if (!s || typeof setTab !== "function") return;
      s.value = b.dataset.strat; setTab("demand"); window.scrollTo({ top: 0 });
    });
    const pb = $("#rsPdf", el); if (pb) pb.onclick = () => download(r);
  }

  // PDF 받기: 안드로이드 앱(WebView)은 앱이 다운로드 폴더에 저장, 그 밖(PC·휴대폰 브라우저)은 파일 내려받기
  function download(r) {
    const name = r.pdfName || "report.pdf", say = (m) => { if (typeof toast === "function") toast(m); };
    try {
      if (window.KBApp && typeof window.KBApp.savePdf === "function") { window.KBApp.savePdf(name, r.pdf); return; }
      const bin = atob(r.pdf), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([u8], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = name; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      say("PDF를 내려받았습니다 — " + name);
    } catch (e) { say("PDF를 받지 못했습니다"); }
  }

  // 화면 폭이 바뀌면 차트를 다시 그린다
  let rt = 0;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { const sec = document.querySelector("#p-research"); if (D && sec && !sec.hidden) paint(); }, 200); });

  return { render };
})();
