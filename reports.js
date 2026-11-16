/*
 * 운용보고서 탭 — 재간접·멀티에셋 펀드 운용보고서를 LP 관점 10개 표준 항목(A~J)과 이슈자산으로 정리한 화면.
 * 데이터: reports.enc.json (미팅노트 DB와 같은 비밀번호·salt 로 잠근 사본. scripts/reports_build.mjs → scripts/vault.mjs)
 *   funds[]: { id, short, manager, underlying, fundName, structure, asOf, period, asOfNote, A~J{}, holdings[], nonaccrual[], watchlist[],
 *              issues[](자산 단위), flags[](펀드 단위), gaps[], checks[], derived[] } — 형식은 docs/REPORTS.md
 * 보기: 요약(지표 카드·먼저 볼 것·펀드 카드) · 펀드별(목록/상세) · 이슈자산(펀드를 가로질러 같은 자산끼리) · 비교표 · 공시·확인
 *   PC·태블릿은 표·2단, 휴대폰은 카드·한 단(펀드 상세는 목록 → 상세, 뒤로가기로 목록).
 */
const Reports = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const h = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LS = { get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const mob = () => matchMedia("(max-width:760px)").matches;
  const VIEWS = [["sum", "요약"], ["fund", "펀드별"], ["issue", "이슈자산"], ["cmp", "비교표"], ["disc", "공시·확인"]];
  let D = null, state = "idle", err = "";
  let view = LS.get("kbnote-rpview", "sum"), sel = LS.get("kbnote-rpsel", ""), wantDetail = false, wantIssue = "";
  const F = { lv: "", tr: "", fund: "" }, OPEN = new Set(), PICK = new Set();
  if (!VIEWS.some((v) => v[0] === view)) view = "sum";

  // ── 데이터 열기 ─────────────────────────────────────────
  let loadP = null;
  function ensure() {
    if (D) return Promise.resolve(D);
    if (loadP) return loadP;
    state = "loading"; paint();
    loadP = Vault.openExtra("reports.enc.json").then((r) => {
      if (r.data && Array.isArray(r.data.funds) && r.data.funds.length) { D = r.data; state = "ready"; }
      else { state = "error"; err = r.error || "broken"; }
      loadP = null; paint(); return D;
    });
    return loadP;
  }
  // 통합 검색이 읽을 때(없거나 못 열면 null)
  function data() {
    if (D) return Promise.resolve(D);
    if (state === "error" && (err === "missing" || err === "mismatch")) return Promise.resolve(null);
    return ensure().catch(() => null);
  }
  // 다른 탭에서 열기: { fund: id } → 그 펀드 상세, { issue: key } → 이슈자산에서 펼쳐서
  function open(o) {
    if (o && o.fund) { view = "fund"; sel = o.fund; wantDetail = true; LS.set("kbnote-rpsel", sel); }
    if (o && o.issue) { view = "issue"; F.lv = F.tr = F.fund = ""; OPEN.add(o.issue); wantIssue = o.issue; }
    LS.set("kbnote-rpview", view);
  }
  function render() { if (!D && state !== "loading" && state !== "error") ensure(); paint(); }

  // ── 도우미 ──────────────────────────────────────────────
  const LV = { high: "높음", mid: "중간", low: "참고" }, LO = { high: 0, mid: 1, low: 2 }, HOLD = { ok: "정상", watch: "주의", concern: "우려" };
  const TO = { "악화": 0, "신규": 1, "유지": 2, "개선": 3 }, TC = { "악화": "worse", "개선": "better", "신규": "new", "유지": "flat" }, TS = { "악화": "▼", "개선": "▲", "신규": "●", "유지": "—" };
  const arr = (x) => (Array.isArray(x) ? x : []);
  const has = (v) => v != null && String(v).trim() !== "" && String(v).trim() !== "—";
  const norm = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9가-힣]/g, "").replace(/(inc|llc|ltd|corp|co)$/, "");
  const lvo = (l) => LO[l] ?? 3;
  const lvTag = (l) => `<span class="rp-lv rp-lv--${h(l)}">${LV[l] || ""}</span>`;
  const trTag = (t) => { t = t || "비교불가"; return `<span class="rp-tr rp-tr--${TC[t] || "na"}">${TS[t] || "·"} ${h(t)}</span>`; };
  const NA = `<i class="rp-na">미기재</i>`;
  const rj = (...v) => v.filter(has).join(" · ");
  const val = (v) => (has(v) ? h(v) : NA);
  const funds = () => (D ? D.funds : []);
  const fundBy = (id) => funds().find((f) => f.id === id);
  const latest = () => { const d = funds().map((f) => f.asOf || "").filter(Boolean).sort(); return d[d.length - 1] || ""; };
  const ymd = (d) => String(d || "").replace(/^(\d{4})-(\d{2})-(\d{2})$/, (m, y, mo, dd) => `${y.slice(2)}.${+mo}.${+dd}`);
  const BACK = `<div class="backbar"><button class="btn sm" type="button" data-back>← 목록</button></div>`;

  // 펀드의 이슈자산: 명시한 issues 가 있으면 그것, 없는 자산은 GP 공시(Non-accrual·Watchlist)·편입자산 우려에서 기본값으로 채운다
  function issuesOf(f) {
    const list = arr(f.issues).filter((x) => x && x.asset).map((x) => ({ ...x, fund: f.short, fid: f.id, fundAsOf: f.asOf }));
    const explicit = list.length > 0, seen = new Set(list.map((x) => norm(x.asset)));
    const add = (o) => { const k = norm(o.asset); if (!k || seen.has(k)) return; seen.add(k); list.push({ ...o, fund: f.short, fid: f.id, fundAsOf: f.asOf, auto: 1 }); };
    arr(f.nonaccrual).forEach((n) => add({ asset: n.name, type: ["Non-accrual"], level: "mid", trend: "비교불가", exposure: has(n.pct) ? "비중 " + n.pct : "", metrics: [[n.principal, n.fv].filter(has).join(" → ")].filter(has), summary: n.note || n.ind || "" }));
    arr(f.watchlist).forEach((w) => { const r = Number(w.rating); add({ asset: w.name, type: ["GP Watchlist" + (r >= 3 && r <= 5 ? " 등급 " + r : "")], level: "low", trend: w.tag === "신규" ? "신규" : "비교불가", exposure: has(w.pct) ? "비중 " + w.pct : "", metrics: [w.principal].filter(has), summary: w.ind || "" }); });
    if (!explicit) arr(f.holdings).forEach((x) => { if (x.level !== "concern" && x.level !== "watch") return; add({ asset: x.name, type: ["편입자산 " + HOLD[x.level]], level: x.level === "concern" ? "mid" : "low", trend: "비교불가", exposure: x.size || "", metrics: [x.terms].filter(has), summary: x.status || "" }); });
    return list.sort((a, b) => lvo(a.level) - lvo(b.level) || (TO[a.trend] ?? 4) - (TO[b.trend] ?? 4));
  }
  // 펀드를 가로질러 같은 자산끼리 묶기(여러 펀드에 같은 차주가 나오면 '공통')
  function groups() {
    const map = new Map();
    funds().forEach((f) => issuesOf(f).forEach((x) => { const k = norm(x.asset); if (!map.has(k)) map.set(k, { key: k, name: x.asset, entries: [] }); map.get(k).entries.push(x); }));
    return [...map.values()].map((g) => { g.entries.sort((a, b) => lvo(a.level) - lvo(b.level)); g.level = g.entries[0].level; g.trend = g.entries[0].trend || "비교불가"; g.funds = [...new Set(g.entries.map((e) => e.fund))]; return g; })
      .sort((a, b) => lvo(a.level) - lvo(b.level) || (TO[a.trend] ?? 4) - (TO[b.trend] ?? 4) || a.name.localeCompare(b.name));
  }
  function shared() {
    const map = new Map();
    funds().forEach((f) => arr(f.watchlist).concat(arr(f.nonaccrual)).forEach((w) => { const k = norm(w.name); if (!k) return; if (!map.has(k)) map.set(k, { name: w.name, funds: new Set() }); map.get(k).funds.add(f.short); }));
    return [...map.values()].filter((x) => x.funds.size > 1).map((x) => ({ name: x.name, key: norm(x.name), funds: [...x.funds] }));
  }
  const flagsAll = () => funds().flatMap((f) => arr(f.flags).map((x) => ({ ...x, fund: f.short, fid: f.id }))).sort((a, b) => lvo(a.level) - lvo(b.level));
  const counts = (list) => { const c = { high: 0, mid: 0, low: 0 }; list.forEach((x) => { if (c[x.level] != null) c[x.level]++; }); return c; };

  // ── 그리기 ──────────────────────────────────────────────
  function paint() {
    const sec = $("#p-reports"), top = $("#rpTop"), body = $("#rpBody");
    if (!sec || sec.hidden || !body) return;   // 탭이 보일 때만(통합 검색이 데이터만 읽을 때는 그리지 않음)
    if (!D) {
      top.innerHTML = "";
      const msg = state === "error"
        ? ({ missing: "아직 올라온 운용보고서 정리가 없습니다.", mismatch: "운용보고서 자료가 다른 비밀번호로 잠겨 있습니다. Claude에 운용보고서 업데이트를 다시 요청해 주세요.",
             network: "운용보고서 자료를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.", locked: "먼저 비밀번호로 앱을 열어 주세요." }[err] || "운용보고서 자료를 열지 못했습니다.")
        : "운용보고서를 여는 중…";
      body.innerHTML = `<div class="empty">${h(msg)}</div>`;
      if (state === "error") { const b = document.createElement("button"); b.className = "btn sm"; b.textContent = "다시 시도"; b.onclick = () => { state = "idle"; ensure(); }; body.firstChild.append(document.createElement("br"), b); }
      return;
    }
    if (view !== "fund" && sec.classList.contains("detail")) sec.classList.remove("detail");
    const g = groups(), c = counts(g), urgent = c.high + c.mid;
    const ds = [...new Set(funds().map((f) => f.asOf))].sort();
    top.innerHTML = `<div class="rp-head"><div class="t"><div class="eyebrow">운용보고서 · LP 관점 10개 표준 항목 · ${h(D.generatedAt || "")} 정리</div>
        <h2>${h(D.title || "운용보고서")} <small>펀드 ${funds().length}개 · 기준일 ${h(ymd(ds[0]))}${ds.length > 1 ? " ~ " + h(ymd(ds[ds.length - 1])) : ""}</small></h2></div></div>
      <div class="seg yseg rp-seg" role="group" aria-label="운용보고서 보기">${VIEWS.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${view === k}">${l}${k === "issue" && urgent ? `<span class="rp-cnt">${urgent}</span>` : ""}</button>`).join("")}</div>`;
    $$(".rp-seg [data-v]", top).forEach((b) => b.onclick = () => { view = b.dataset.v; LS.set("kbnote-rpview", view); paint(); window.scrollTo({ top: 0 }); });
    ({ sum: paintSum, fund: paintFund, issue: paintIssue, cmp: paintCmp, disc: paintDisc })[view](body, g);
    wire(body);
  }

  // 공통 클릭: 펀드로·이슈로·보기 전환·기관으로
  function wire(el) {
    $$("[data-fund]", el).forEach((b) => b.onclick = (e) => { e.preventDefault(); goFund(b.dataset.fund); });
    $$("[data-issue]", el).forEach((b) => b.onclick = (e) => { e.preventDefault(); open({ issue: b.dataset.issue }); paint(); });
    $$("[data-gv]", el).forEach((b) => b.onclick = () => { view = b.dataset.gv; LS.set("kbnote-rpview", view); paint(); window.scrollTo({ top: 0 }); });
    $$("[data-org]", el).forEach((b) => b.onclick = () => { if (typeof gotoOrg === "function") gotoOrg(b.dataset.org); });
    $$("details.rp-is", el).forEach((d) => d.addEventListener("toggle", () => { if (d.open) OPEN.add(d.dataset.k); else OPEN.delete(d.dataset.k); }));
    if (wantIssue) {
      const t = el.querySelector(`details.rp-is[data-k="${CSS.escape(wantIssue)}"]`); wantIssue = "";
      if (t) requestAnimationFrame(() => t.scrollIntoView({ block: "start" }));
    }
  }
  // 휴대폰: 요약·이슈자산 등에서 펀드를 열면, 뒤로가기(← 목록·안드로이드 뒤로)로 그 보기로 돌아간다
  let backView = "", backY = 0;
  window.addEventListener("popstate", () => setTimeout(() => {
    const sec = document.querySelector("#p-reports");
    if (!backView || !sec || sec.hidden || sec.classList.contains("detail")) return;
    view = backView; backView = ""; LS.set("kbnote-rpview", view); paint(); requestAnimationFrame(() => window.scrollTo({ top: backY }));
  }, 0));
  function goFund(id) {
    if (mob() && view !== "fund") { backView = view; backY = window.scrollY; } else backView = "";
    sel = id; view = "fund"; LS.set("kbnote-rpsel", id); LS.set("kbnote-rpview", view); wantDetail = true; paint();
    if (!mob()) window.scrollTo({ top: 0 });
  }

  // ── 요약 ────────────────────────────────────────────────
  function paintSum(el, g) {
    const c = counts(g), na = funds().reduce((a, f) => a + arr(f.nonaccrual).length, 0), fl = flagsAll(), fc = counts(fl);
    const worse = g.filter((x) => x.trend === "악화"), gaps = funds().reduce((a, f) => a + arr(f.gaps).length, 0);
    const ds = [...new Set(funds().map((f) => f.asOf))].sort();
    el.innerHTML = `<div id="rpKpi"></div>${alerts(g)}
      <section class="rp-blk"><div class="bh"><h3>펀드 한눈에 <small>누르면 펀드 상세</small></h3></div><div class="rp-fcards">${funds().map(fundCard).join("")}</div></section>
      ${g.length ? `<section class="rp-blk"><div class="bh"><h3>주요 이슈자산 <small>높음·중간 ${c.high + c.mid}건 · 전체 ${g.length}건</small></h3><button type="button" class="btn sm" data-gv="issue">이슈자산 전체 보기</button></div>
        <div class="rp-ilist">${g.filter((x) => x.level !== "low").map((x) => issueCard(x, true)).join("") || `<div class="empty">높음·중간 수준 이슈자산이 없습니다.</div>`}</div></section>` : ""}
      ${foot()}`;
    Dash.blocks([{ t: "kpis", id: "rp", items: [
      { l: "펀드", v: funds().length, f: "n0", u: "개", s: ds.length > 1 ? `기준일 ${ymd(ds[0])} ~ ${ymd(ds[ds.length - 1])}` : `기준일 ${ymd(ds[0] || "")}`, tone: ds.length > 1 ? "info" : "" },
      { l: "이슈자산", v: g.length, f: "n0", u: "건", s: `높음 ${c.high} · 중간 ${c.mid} · 참고 ${c.low}`, tone: c.high ? "bad" : c.mid ? "warn" : "ok" },
      { l: "악화 추이", v: worse.length, f: "n0", u: "건", s: worse.slice(0, 3).map((x) => x.name).join(", ") + (worse.length > 3 ? " 외" : ""), tone: worse.length ? "bad" : "ok" },
      { l: "Non-accrual", v: na, f: "n0", u: "건", s: na ? funds().filter((f) => arr(f.nonaccrual).length).map((f) => f.short).join(", ") : "보고서상 없음", tone: na ? "warn" : "ok" },
      { l: "펀드 단위 이슈", v: fl.length, f: "n0", u: "건", s: `높음 ${fc.high} · 중간 ${fc.mid} · 참고 ${fc.low}`, tone: fc.high ? "bad" : fc.mid ? "warn" : "muted" },
      { l: "공시 누락", v: gaps, f: "n0", u: "건", s: "운용사에 보완 요청할 항목", tone: gaps ? "warn" : "ok" },
    ] }], $("#rpKpi"), "rp:sum");
  }
  function fundCard(f) {
    const B = f.B || {}, C = f.C || {}, is = issuesOf(f), c = counts(is), fl = arr(f.flags), old = f.asOf && f.asOf < latest();
    const top = is[0], tf = fl.slice().sort((a, b) => lvo(a.level) - lvo(b.level))[0];
    const lead = top ? `${lvTag(top.level)}<b>${h(top.asset)}</b> ${trTag(top.trend)}<span>${h(top.summary || "")}</span>`
      : tf ? `${lvTag(tf.level)}<b>${h(tf.title)}</b><span>${h(tf.target || "")}</span>` : `<span class="rp-ok">보고서상 이슈자산 없음</span>`;
    const row = (l, v) => `<div><dt>${l}</dt><dd>${val(v)}</dd></div>`;
    return `<button type="button" class="rp-fc${c.high ? " is-high" : c.mid ? " is-mid" : ""}" data-fund="${h(f.id)}">
      <span class="rp-fc-h"><b>${h(f.short)}</b><span class="chip${old ? " flag" : ""}">${h(f.period)} · ${h(ymd(f.asOf))}</span></span>
      <span class="rp-fc-s">${h(f.manager || "")} → ${h(f.underlying || "")}</span>
      <dl class="rp-fc-d">${row("약정 · 소진", rj(B.commit, B.deploy))}${row("평가", C.nav || C.dnav)}${row("수익률", C.irr)}</dl>
      <span class="rp-fc-i">${lead}</span>
      <span class="rp-fc-c">${is.length ? `이슈자산 ${is.length}${c.high ? ` · <em class="h">높음 ${c.high}</em>` : ""}${c.mid ? ` · <em class="m">중간 ${c.mid}</em>` : ""}` : "이슈자산 0"}${fl.length ? ` · 펀드 이슈 ${fl.length}` : ""}${arr(f.gaps).length ? ` · 공시 누락 ${arr(f.gaps).length}` : ""}</span>
    </button>`;
  }
  function alerts(g) {
    const a = [], dates = {};
    funds().forEach((f) => { const k = f.asOf || "미기재"; (dates[k] = dates[k] || []).push(f); });
    const dk = Object.keys(dates).sort();
    if (dk.length > 1) a.push(["info", "보고 기준일이 서로 다릅니다", dk.map((d) => `<span class="rp-al-i"><b>${h(ymd(d))}</b> ${dates[d].map((f) => h(f.short)).join(", ")}</span>`).join("") + `<span class="rp-al-n">같은 시점 비교가 아니므로 수치는 기준일과 함께 보세요.</span>`]);
    funds().forEach((f) => arr(f.nonaccrual).forEach((n) => a.push(["high", `Non-accrual · ${h(n.name)} <small>${h(f.short)}</small>`, `투자원금 ${h(n.principal || "-")} → 평가 ${h(n.fv || "-")}. ${h(n.note || "")}`])));
    g.filter((x) => x.level === "high").forEach((x) => a.push(["high", `${h(x.name)} <small>${x.funds.map(h).join(", ")}</small>`, `${h(x.entries[0].summary || "")} <button class="link" type="button" data-issue="${h(x.key)}">자세히</button>`]));
    const sh = shared();
    if (sh.length) a.push(["watch", `여러 펀드에 함께 나오는 Watchlist 차주 ${sh.length}곳`, sh.map((s) => `<span class="rp-al-i"><b>${h(s.name)}</b> ${s.funds.map(h).join(", ")}</span>`).join("") + `<span class="rp-al-n">펀드를 합한 익스포저는 개별 보고서 기준보다 큽니다.</span>`]);
    if (!a.length) return "";
    return `<section class="rp-blk"><div class="bh"><h3>먼저 볼 것</h3></div><div class="rp-alerts">${a.map(([c, t, b]) => `<div class="rp-al rp-al--${c}"><b>${t}</b><div>${b}</div></div>`).join("")}</div></section>`;
  }
  const foot = () => `<p class="basis rp-foot">${h(D.notice || "")} 수준(높음·중간·참고)과 추이(악화·신규·유지·개선)는 보고서 수치를 근거로 한 분석 판단이며 GP의 공식 등급이 아닙니다.<br>새 운용보고서는 Claude에 PDF를 주고 “운용보고서 업데이트해줘”라고 하면 이 탭에 반영됩니다.</p>`;

  // ── 이슈자산 카드(요약·펀드 상세·이슈자산 보기에서 같이 씀) ──
  function issueCard(gr, showFunds) {
    const e = gr.entries[0], types = [...new Set(gr.entries.flatMap((x) => arr(x.type)))], open = OPEN.has(gr.key);
    const metric = arr(e.metrics)[0];
    return `<details class="rp-is rp-is--${h(gr.level)}${showFunds ? "" : " nf"}" data-k="${h(gr.key)}"${open ? " open" : ""}>
      <summary><span class="rp-is-l">${lvTag(gr.level)}${trTag(gr.trend)}</span>
        <span class="rp-is-n"><b>${h(gr.name)}</b><span class="rp-is-t">${types.map((t) => `<span class="chip">${h(t)}</span>`).join("")}</span></span>
        <span class="rp-is-x">${h(e.summary || "")}${has(metric) ? `<em>${h(metric)}</em>` : ""}</span>
        ${showFunds ? `<span class="rp-is-f">${gr.funds.map((f) => `<span class="rp-ft">${h(f)}</span>`).join("")}${gr.funds.length > 1 ? `<span class="rp-sh">공통</span>` : ""}</span>` : ""}
      </summary>
      <div class="rp-is-b">${gr.entries.map((x) => entryHtml(x, gr.entries.length > 1 || showFunds, e.summary)).join("")}</div>
    </details>`;
  }
  function entryHtml(x, showFund, head) {
    const hist = arr(x.history).filter((v) => v && (v.d || v.t));
    return `<div class="rp-en">
      ${showFund ? `<div class="rp-en-h"><button type="button" class="link" data-fund="${h(x.fid)}">${h(x.fund)}</button>${has(x.exposure) ? `<span>${h(x.exposure)}</span>` : ""}<span>${h(x.asOf || ymd(x.fundAsOf))}</span></div>`
        : `<div class="rp-en-h">${has(x.exposure) ? `<span>${h(x.exposure)}</span>` : ""}<span>${h(x.asOf || ymd(x.fundAsOf))}</span></div>`}
      ${has(x.summary) && x.summary !== head ? `<p class="rp-en-s">${h(x.summary)}</p>` : ""}
      <div class="rp-en-g">
        <div>${arr(x.metrics).length ? `<div class="rp-lab">핵심 수치</div><ul class="rp-ml">${arr(x.metrics).map((m) => `<li>${h(m)}</li>`).join("")}</ul>` : ""}
          ${hist.length ? `<div class="rp-lab">경과</div><ol class="rp-hist">${hist.map((v) => `<li><i>${h(v.d || "")}</i><span>${h(v.t || "")}</span></li>`).join("")}</ol>` : ""}</div>
        <div class="rp-en-r"><div class="rp-box"><b>GP 대응 <small>보고서 기재</small></b>${h(x.gp || "보고서상 GP 코멘트 없음")}</div>
          <div class="rp-box q"><b>LP 확인 질문</b>${h(x.question || "—")}</div>
          ${has(x.related) ? `<p class="rp-rel">${h(x.related)}</p>` : ""}${x.auto ? `<p class="rp-rel">GP 공시(Watchlist·Non-accrual)에서 옮긴 항목이라 수준·추이는 기본값입니다.</p>` : ""}</div>
      </div></div>`;
  }
  function flagCard(x, showFund) {
    return `<div class="rp-fl rp-fl--${h(x.level)}"><div class="rp-fl-h">${lvTag(x.level)}<b>${h(x.title)}</b>${showFund ? `<button type="button" class="rp-ft" data-fund="${h(x.fid)}">${h(x.fund)}</button>` : ""}</div>
      ${has(x.target) ? `<p class="rp-fl-t">${h(x.target)}</p>` : ""}${has(x.detail) ? `<p>${h(x.detail)}</p>` : ""}
      <div class="rp-en-r two"><div class="rp-box"><b>GP 대응 <small>보고서 기재</small></b>${h(x.response || "보고서상 GP 코멘트 없음")}</div><div class="rp-box q"><b>LP 확인 질문</b>${h(x.question || "—")}</div></div></div>`;
  }

  // ── 펀드별(목록 / 상세) ───────────────────────────────────
  let fq = "";
  function paintFund(el) {
    const list = funds().filter((f) => !fq || [f.short, f.fundName, f.manager, f.underlying, (f.A || {}).off, (f.A || {}).gp].join(" ").toLowerCase().includes(fq.toLowerCase()));
    let f = fundBy(sel);
    if (!f && !mob()) { f = list[0] || funds()[0]; if (f) sel = f.id; }   // PC: 빈 칸 대신 맨 위 펀드
    el.innerHTML = `<div class="split rp-split"><aside class="side">
        <div class="filters"><input id="rpq" class="full" type="search" placeholder="펀드·운용사·투자대상 검색" value="${h(fq)}"></div>
        <div class="count"><span>${list.length}개 / 전체 ${funds().length}개</span></div>
        <div class="list" id="rpList">${list.length ? list.map(listItem).join("") : `<div class="empty">조건에 맞는 펀드가 없습니다.</div>`}</div></aside>
      <main class="main" id="rpMain">${f ? BACK + fundHtml(f) : `<div class="empty">왼쪽에서 펀드를 선택하세요.</div>`}</main></div>`;
    const q = $("#rpq", el); q.oninput = () => { fq = q.value; const pos = q.selectionStart; paintFund(el); wire(el); const n = $("#rpq", el); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
    $$("#rpList [data-fid]", el).forEach((b) => b.onclick = () => { sel = b.dataset.fid; LS.set("kbnote-rpsel", sel); wantDetail = true; paint(); if (!mob() && innerWidth <= 900) $("#rpMain").scrollIntoView(); });
    if (wantDetail) { wantDetail = false; if (mob() && f && typeof openDetail === "function") openDetail(); }
  }
  function listItem(f) {
    const is = issuesOf(f), c = counts(is), old = f.asOf && f.asOf < latest();
    return `<button type="button" class="item noDate${f.id === sel ? " on" : ""}" data-fid="${h(f.id)}"><div style="min-width:0"><div class="ttl">${h(f.short)}</div>
      <div class="sub2">${h(f.manager || "")} → ${h(f.underlying || "")}</div>
      <div class="chips"><span class="chip${old ? " flag" : ""}">${h(f.period)} · ${h(ymd(f.asOf))}</span>${c.high ? `<span class="rp-lv rp-lv--high">높음 ${c.high}</span>` : ""}${c.mid ? `<span class="rp-lv rp-lv--mid">중간 ${c.mid}</span>` : ""}${is.length ? `<span class="chip">이슈 ${is.length}</span>` : ""}${arr(f.flags).length ? `<span class="chip">펀드 이슈 ${arr(f.flags).length}</span>` : ""}</div></div></button>`;
  }
  function fundHtml(f) {
    const A = f.A || {}, B = f.B || {}, C = f.C || {}, Dd = f.D || {}, E = f.E || {}, Fq = f.F || {}, G = f.G || {}, H = f.H || {}, I = f.I || {}, J = f.J || {};
    const lt = latest(), old = f.asOf && lt && f.asOf < lt;
    const kv = (rows) => `<div class="kv rp-kv">${rows.map(([k, v]) => `<div><span>${h(k)}</span>${val(v)}</div>`).join("")}</div>`;
    const sec = (t, body, sub) => `<section class="sec rp-sec"><h3>${t}${sub ? ` <small>${sub}</small>` : ""}</h3>${body}</section>`;
    const hold = arr(f.holdings), fl = arr(f.flags), na = arr(f.nonaccrual), wl = arr(f.watchlist);
    const iss = issuesOf(f).map((x) => ({ key: norm(x.asset), name: x.asset, level: x.level, trend: x.trend || "비교불가", funds: [x.fund], entries: [x] }));
    const fact = (l, v) => `<div class="rp-fact"><span>${l}</span><b>${val(v)}</b></div>`;
    const org = typeof orgOf === "function" && f.manager && orgOf(f.manager);
    const lists = (t, l, cls) => `<div class="rp-note${cls ? " " + cls : ""}"><b>${t} <small>${arr(l).length}</small></b>${arr(l).length ? `<ul>${arr(l).map((x) => `<li>${h(x)}</li>`).join("")}</ul>` : `<p class="ro">없음</p>`}</div>`;
    return `<div class="head"><div class="t"><div class="eyebrow">${h(f.manager || "")} · ${f.structure === "multi" ? "멀티에셋" : "재간접"} · ${h(f.period)} (${h(f.asOf)})</div>
        <h2>${h(f.short)}</h2><div class="sub2 rp-fname">${h(f.fundName || "")}</div>
        <div class="chips">${old ? `<span class="chip flag">최신 기준일(${h(ymd(lt))})보다 이전</span>` : ""}${f.fileName ? `<span class="chip">${h(f.fileName)}</span>` : ""}</div></div>
        ${org ? `<div class="actions"><button type="button" class="btn sm" data-org="${h(f.manager)}">기관 보기</button></div>` : ""}</div>
      <div class="body rp-body">
        ${has(f.asOfNote) ? `<div class="warnbox"><b>기준일</b> ${h(f.asOfNote)}</div>` : ""}
        <div class="rp-facts">${fact("약정", B.commit)}${fact("소진율", B.deploy)}${fact("누적 출자", B.called)}${fact("미인출 약정", B.unfunded)}${fact("평가액 · NAV", C.nav)}${fact("기준가 · 순자산", C.dnav)}${fact("IRR", C.irr)}${fact("TVPI · MOIC · DPI", rj(C.tvpi, C.moic, C.dpi))}</div>
        ${iss.length ? sec(`이슈자산 ${iss.length}건`, `<div class="rp-ilist">${iss.map((x) => issueCard(x, false)).join("")}</div>`, "누르면 핵심 수치·경과·GP 대응·LP 확인 질문") : ""}
        ${fl.length ? sec(`펀드 단위 이슈 ${fl.length}건`, `<div class="rp-fls">${fl.map((x) => flagCard(x, false)).join("")}</div>`) : ""}
        ${hold.length ? sec(`편입자산 ${hold.length}건`, holdHtml(hold)) : ""}
        ${na.length || wl.length ? sec("GP 공시 · Non-accrual · Watchlist", gpHtml(na.map((n) => ({ ...n, na: 1 })).concat(wl), false), "GP가 공시한 그대로") : ""}
        ${sec("A · 펀드 개요", kv([["투자대상", A.off], ["GP · 운용사", A.gp], ["구조", A.structure], ["투자전략", A.strategy], ["목표수익률", A.target], ["설정 · 만기", rj(A.incept, A.maturity)]]))}
        ${sec("B · C 약정 · 성과", kv([["약정 · 소진율", rj(B.commit, B.deploy)], ["누적 출자", B.called], ["미인출 약정", B.unfunded], ["누적 분배 · 회수", B.recovered], ["NAV · 기준가", rj(C.nav, C.dnav)], ["IRR", C.irr], ["TVPI · MOIC · DPI", rj(C.tvpi, C.moic, C.dpi)], ["분배율", C.dist], ["Total Net Return", C.tnr]]))}
        ${sec("D · E 포트폴리오 건전성", kv([["투자기업", Dd.cos], ["First Lien / Floating", [Dd.firstlien, Dd.floating].filter(has).join(" / ")], ["Leverage · LTV", Dd.lev], ["EBITDA · 이자보상", rj(Dd.ebitda, Dd.cover)], ["Yield · Spread", Dd.yield], ["섹터 · 분산", Dd.sector], ["Non-accrual", E.na], ["GP Watchlist", E.wl]]))}
        ${sec("F · G 유동성 · 이슈 대응", kv([["환매 · 유동성", Fq.redeem], ["주요 이슈", G.issue], ["GP 대응", G.resolution]]))}
        ${sec("H · I · J 환헤지 · 보수 · 거버넌스", kv([["환헤지", rj(H.hedge, H.fwd)], ["역외 · 하위 GP 보수", I.offFee], ["국내 보수", I.domFee], ["Key Person", J.person], ["LPA 위반 여부", J.lpa], ["조직 · 전략 변경", J.org]]))}
        <div class="rp-notes">${lists("공시 누락", f.gaps, "gap")}${lists("수치 확인 · 표기 오류", f.checks, "chk")}${lists("산출 근거", f.derived)}</div>
        <p class="basis">Claude 정리${f.updatedAt ? ` · 최종 수정 ${h(f.updatedAt)}` : ""} · "(산출)"은 보고서 수치로 계산한 값입니다.</p>
      </div>`;
  }
  function holdHtml(hold) {
    if (mob()) return `<div class="rp-hc">${hold.map((x) => `<div class="rp-hci rp-hci--${h(x.level)}"><div class="rp-hci-h"><span class="rp-dot rp-dot--${h(x.level)}"></span><b>${h(x.name)}</b><span class="rp-hst">${h(HOLD[x.level] || "")}</span></div>
      <div class="rp-hci-m">${[x.type, x.size, x.asOf].filter(has).map(h).join(" · ")}</div>${has(x.terms) ? `<div class="rp-hci-t">${h(x.terms)}</div>` : ""}${has(x.status) ? `<div class="rp-hci-s">${h(x.status)}</div>` : ""}</div>`).join("")}</div>`;
    return `<div class="dtw"><table class="dt rp-ht"><thead><tr><th>자산</th><th>상태</th><th>유형</th><th>규모</th><th>주요 조건</th><th>현황</th><th>기준</th></tr></thead><tbody>${hold.map((x) => `<tr class="rp-hr--${h(x.level)}">
      <td class="rp-hn"><b>${h(x.name)}</b></td><td class="rp-st"><span class="rp-dot rp-dot--${h(x.level)}"></span>${h(HOLD[x.level] || "")}</td><td class="rp-t">${h(x.type)}</td><td class="rp-t">${h(x.size)}</td><td class="rp-w">${h(x.terms)}</td><td class="rp-w">${h(x.status)}</td><td class="rp-st">${h(x.asOf)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function gpHtml(list, showFund) {
    const sh = new Set(shared().map((s) => s.key));
    return `<div class="rp-gp">${list.map((n) => {
      const r = Number(n.rating), rt = n.na ? "na" : (r >= 3 && r <= 5 ? r : "w");
      return `<div class="rp-gpr"><span class="rp-rt rp-rt--${rt}" title="${n.na ? "Non-accrual" : rt === "w" ? "GP Watchlist (등급 미공시)" : "내부등급 " + rt}">${n.na ? "NA" : rt === "w" ? "W" : rt}</span>
        <div class="rp-gpn"><b>${h(n.name)}</b>${sh.has(norm(n.name)) ? ` <span class="rp-sh">공통</span>` : ""}${n.tag ? ` <span class="chip">${h(n.tag)}</span>` : ""}<div class="ro">${h(n.ind || "")}${n.na && n.note ? " — " + h(n.note) : ""}</div></div>
        <div class="rp-gpm">${h(n.principal || "")}${n.na && n.fv ? " → " + h(n.fv) : ""}<span>비중 ${h(n.pct || "—")}</span></div>${showFund ? `<button type="button" class="rp-ft" data-fund="${h(n.fid)}">${h(n.fund)}</button>` : ""}</div>`;
    }).join("")}</div>`;
  }

  // ── 이슈자산(펀드를 가로질러) ─────────────────────────────
  function paintIssue(el, all) {
    const cnt = (k, v) => all.filter((g) => g[k] === v).length;
    const list = all.filter((g) => (!F.lv || g.level === F.lv) && (!F.tr || g.trend === F.tr) && (!F.fund || g.entries.some((e) => e.fid === F.fund)));
    const seg = (key, opts, label) => `<div class="seg sm rp-fseg" role="group" aria-label="${label}">${opts.map(([v, l]) => `<button type="button" data-f="${key}" data-fv="${h(v)}" aria-pressed="${F[key] === v}">${l}</button>`).join("")}</div>`;
    const gp = funds().flatMap((f) => arr(f.nonaccrual).map((n) => ({ ...n, fund: f.short, fid: f.id, na: 1 })).concat(arr(f.watchlist).map((w) => ({ ...w, fund: f.short, fid: f.id }))))
      .sort((a, b) => (b.na ? 9 : Number(b.rating) || 3) - (a.na ? 9 : Number(a.rating) || 3));
    el.innerHTML = `<div class="rp-isum"><span>이슈자산 <b>${all.length}</b>건</span>${["high", "mid", "low"].map((l) => `<span>${lvTag(l)} <b>${cnt("level", l)}</b></span>`).join("")}<span class="rp-isum-t">${["악화", "신규", "유지", "개선"].map((t) => `${trTag(t)} <b>${cnt("trend", t)}</b>`).join(" ")}</span></div>
      <div class="rp-fbar">${seg("lv", [["", "전체"], ["high", "높음"], ["mid", "중간"], ["low", "참고"]], "수준")}${seg("tr", [["", "전체 추이"], ["악화", "악화"], ["신규", "신규"], ["유지", "유지"], ["개선", "개선"]], "추이")}
        <select id="rpIf" aria-label="펀드"><option value="">펀드 전체</option>${funds().map((f) => `<option value="${h(f.id)}"${F.fund === f.id ? " selected" : ""}>${h(f.short)}</option>`).join("")}</select>
        <span class="rp-fbar-a"><button type="button" class="btn sm" id="rpOpenAll">${list.length && list.every((g) => OPEN.has(g.key)) ? "모두 접기" : "모두 펼치기"}</button></span></div>
      ${list.length ? `<div class="rp-ilist">${list.map((g) => issueCard(g, true)).join("")}</div>` : `<div class="empty">조건에 맞는 이슈자산이 없습니다. 필터를 바꿔 보세요.</div>`}
      ${gp.length ? `<section class="rp-blk"><div class="bh"><h3>GP 공시 원장 <small>Non-accrual · Watchlist — GP가 공시한 그대로, 등급 없이 Watchlist로만 공시한 차주는 W</small></h3></div>${gpHtml(gp, true)}</section>` : ""}
      ${foot()}`;
    $$("[data-f]", el).forEach((b) => b.onclick = () => { F[b.dataset.f] = b.dataset.fv; paint(); });
    $("#rpIf", el).onchange = (e) => { F.fund = e.target.value; paint(); };
    $("#rpOpenAll", el).onclick = () => { const all2 = list.every((g) => OPEN.has(g.key)); list.forEach((g) => (all2 ? OPEN.delete(g.key) : OPEN.add(g.key))); paint(); };
  }

  // ── 비교표 ─────────────────────────────────────────────
  const ROWS = [["A", "A · 펀드 식별정보"], ["_asof", "보고 기준일"], ["A.off", "투자대상", "A", ["off"]], ["A.gp", "GP · 운용사", "A", ["gp"]], ["A.st", "구조", "A", ["structure"]], ["A.sg", "투자전략", "A", ["strategy"]], ["A.tg", "목표수익률", "A", ["target"]], ["A.dt", "설정 · 만기", "A", ["incept", "maturity"]],
    ["B", "B · 약정 · 소진 · 회수"], ["B.c", "약정금액", "B", ["commit"]], ["B.d", "소진율 · 누적출자", "B", ["deploy", "called"]], ["B.u", "미인출 약정", "B", ["unfunded"]], ["B.r", "누적 분배 · 회수", "B", ["recovered"]],
    ["C", "C · 성과지표"], ["C.n", "NAV · 기준가", "C", ["nav", "dnav"]], ["C.i", "IRR", "C", ["irr"]], ["C.t", "TVPI · MOIC · DPI", "C", ["tvpi", "moic", "dpi"]], ["C.d", "분배율", "C", ["dist"]], ["C.r", "Total Net Return", "C", ["tnr"]],
    ["D", "D · 포트폴리오 건전성"], ["_hold", "편입자산"], ["D.c", "투자기업 수", "D", ["cos"]], ["D.f", "First Lien / Floating", "D", ["firstlien", "floating"]], ["D.l", "Leverage · LTV", "D", ["lev"]], ["D.e", "EBITDA · 이자보상", "D", ["ebitda", "cover"]], ["D.y", "Yield · Spread", "D", ["yield"]], ["D.s", "섹터 · 분산", "D", ["sector"]],
    ["E", "E · 부실 · 이슈자산"], ["E.n", "Non-accrual", "E", ["na"]], ["E.w", "GP Watchlist", "E", ["wl"]], ["_issues", "이슈자산"], ["_flags", "펀드 단위 이슈"],
    ["F", "F · 유동성 · 환매"], ["F.r", "환매 현황", "F", ["redeem"]], ["G", "G · 이슈 및 대응방안"], ["G.i", "주요 이슈", "G", ["issue"]], ["G.r", "GP 대응", "G", ["resolution"]],
    ["H", "H · 환헤지"], ["H.h", "헤지 · Forward", "H", ["hedge", "fwd"]], ["I", "I · 보수 구조"], ["I.o", "역외 · 하위 GP 보수", "I", ["offFee"]], ["I.d", "국내 보수", "I", ["domFee"]],
    ["J", "J · 거버넌스 · 공시 품질"], ["J.p", "Key Person", "J", ["person"]], ["J.l", "LPA 위반 여부", "J", ["lpa"]], ["J.o", "조직 · 전략 변경", "J", ["org"]], ["_gaps", "공시 누락"]];
  const isGrp = (r) => r.length === 2 && r[0][0] !== "_";
  function cell(f, r, lt) {
    const id = r[0];
    if (id[0] === "_") return special(id, f, lt);
    const g = f[r[2]] || {}, vals = r[3].map((k) => g[k]).filter(has);
    let s = vals.length ? vals.map(h).join(" · ") : NA;
    if (vals.length && /미기재|비공개|미제공/.test(vals.join(" "))) s = `<span class="ro">${s}</span>`;
    if (id === "E.n" && arr(f.nonaccrual).length) s = `<b class="rp-hot">${arr(f.nonaccrual).length}건</b> · ` + s;
    return s;
  }
  function special(id, f, lt) {
    const cc = (c) => ["high", "mid", "low"].filter((k) => c[k]).map((k) => `${lvTag(k)} <b>${c[k]}</b>`).join(" ");
    if (id === "_asof") { const old = f.asOf && lt && f.asOf !== lt; return `<span class="chip${old ? " flag" : ""}">${h(f.period)} · ${h(f.asOf || "미기재")}</span>${has(f.asOfNote) ? `<div class="rp-sub">${h(f.asOfNote)}</div>` : ""}`; }
    if (id === "_hold") { const x = arr(f.holdings); if (!x.length) return `<span class="ro">단일 피투자펀드</span>`; return `<b>${x.length}건</b><ul class="rp-hl">${x.map((y) => `<li><span class="rp-dot rp-dot--${h(y.level)}"></span>${h(y.name)}</li>`).join("")}</ul>`; }
    if (id === "_issues") { const is = issuesOf(f); if (!is.length) return `<span class="ro">없음</span>`; return `<div>${cc(counts(is))}</div><div class="rp-sub">${is.slice(0, 5).map((x) => h(x.asset)).join(" / ")}${is.length > 5 ? ` 외 ${is.length - 5}건` : ""}</div>`; }
    if (id === "_flags") { const fl = arr(f.flags); if (!fl.length) return `<span class="ro">없음</span>`; return `<div>${cc(counts(fl))}</div><div class="rp-sub">${fl.map((x) => h(x.title)).join(" / ")}</div>`; }
    if (id === "_gaps") { const g = arr(f.gaps); if (!g.length) return `<span class="ro">없음</span>`; return `<b>${g.length}건</b><div class="rp-sub">${g.map(h).join(" · ")}</div>`; }
    return "";
  }
  function paintCmp(el) {
    const all = funds(); if (!PICK.size) all.forEach((f) => PICK.add(f.id));
    const fs = all.filter((f) => PICK.has(f.id)), lt = latest();
    const picks = `<div class="rp-pick" role="group" aria-label="비교할 펀드"><span class="rp-pick-l">비교할 펀드</span>${all.map((f) => `<button type="button" class="qbtn" data-pk="${h(f.id)}" aria-pressed="${PICK.has(f.id)}">${h(f.short)}</button>`).join("")}</div>`;
    let body = "";
    if (!fs.length) body = `<div class="empty">비교할 펀드를 하나 이상 고르세요.</div>`;
    else if (mob()) {   // 휴대폰: 항목 묶음(A~J)별 접이식 카드 — 항목마다 펀드 값을 차례로
      let cur = null; const out = [];
      ROWS.forEach((r) => {
        if (isGrp(r)) { cur = { t: r[1], rows: [] }; out.push(cur); return; }
        cur.rows.push(`<div class="rp-cr"><div class="rp-cr-l">${h(r[1])}</div>${fs.map((f) => `<div class="rp-cr-v"><span class="rp-ft">${h(f.short)}</span><div>${cell(f, r, lt)}</div></div>`).join("")}</div>`);
      });
      body = `<div class="rp-cm">${out.map((g, i) => `<details class="rp-cg"${i < 2 ? " open" : ""}><summary>${h(g.t)}</summary>${g.rows.join("")}</details>`).join("")}</div>`;
    } else {
      let t = `<thead><tr><th class="rp-c0">항목</th>${fs.map((f) => `<th><button type="button" class="rp-chd" data-fund="${h(f.id)}"><b>${h(f.short)}</b><span>${h(f.manager || "")} → ${h(f.underlying || "")}</span></button></th>`).join("")}</tr></thead><tbody>`;
      ROWS.forEach((r) => {
        if (isGrp(r)) { t += `<tr class="rp-grp"><th class="rp-c0">${h(r[1])}</th><td colspan="${fs.length}"></td></tr>`; return; }
        t += `<tr><th class="rp-c0">${h(r[1])}</th>${fs.map((f) => `<td>${cell(f, r, lt)}</td>`).join("")}</tr>`;
      });
      body = `<div class="dtw tall rp-cw"><table class="dt rp-cmp">${t}</tbody></table></div>`;
    }
    el.innerHTML = `${picks}${body}<p class="basis">10개 표준 항목(A~J)으로 펀드를 나란히 봅니다. 기준일이 서로 다르니 수치는 기준일과 함께 보세요. 펀드 이름을 누르면 상세로 갑니다.</p>`;
    $$("[data-pk]", el).forEach((b) => b.onclick = () => { const k = b.dataset.pk; if (PICK.has(k)) PICK.delete(k); else PICK.add(k); if (!PICK.size) all.forEach((f) => PICK.add(f.id)); paint(); });
  }

  // ── 공시·확인 ──────────────────────────────────────────
  function paintDisc(el) {
    const fl = flagsAll(), nG = funds().reduce((a, f) => a + arr(f.gaps).length, 0), nC = funds().reduce((a, f) => a + arr(f.checks).length, 0);
    el.innerHTML = `<section class="rp-blk"><div class="bh"><h3>펀드 단위 이슈 <small>한 자산에 국한되지 않는 이슈(포트폴리오 전체·환매·차입·환헤지·공시 수준 등)</small></h3></div>
        ${fl.length ? `<div class="rp-fls">${fl.map((x) => flagCard(x, true)).join("")}</div>` : `<div class="empty">펀드 단위 이슈가 없습니다.</div>`}</section>
      <section class="rp-blk"><div class="bh"><h3>공시 누락 · 수치 확인 <small>누락 ${nG}건 · 확인 ${nC}건 — 운용사에 보완·확인 요청할 항목</small></h3></div>
        <div class="rp-dg">${funds().map((f) => { const g = arr(f.gaps), c = arr(f.checks), d = arr(f.derived);
          return `<div class="pnl rp-dc"><div class="rp-dc-h"><button type="button" class="link" data-fund="${h(f.id)}"><b>${h(f.short)}</b></button><span class="chip">${h(f.period)} · ${h(ymd(f.asOf))}</span></div>
            ${g.length ? `<div class="rp-lab gap">공시 누락 ${g.length}</div><ul>${g.map((x) => `<li>${h(x)}</li>`).join("")}</ul>` : ""}
            ${c.length ? `<div class="rp-lab chk">수치 확인 ${c.length}</div><ul>${c.map((x) => `<li>${h(x)}</li>`).join("")}</ul>` : ""}
            ${d.length ? `<details class="rp-dd"><summary>산출 근거 ${d.length}</summary><ul>${d.map((x) => `<li>${h(x)}</li>`).join("")}</ul></details>` : ""}
            ${!g.length && !c.length ? `<p class="ro">없음</p>` : ""}</div>`; }).join("")}</div></section>
      ${foot()}`;
  }

  // 휴대폰 ↔ PC 폭이 바뀌면 다시 그림(표 ↔ 카드)
  let rt = 0, lastMob = mob();
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { const sec = document.querySelector("#p-reports"); if (D && sec && !sec.hidden && lastMob !== mob()) { lastMob = mob(); paint(); } }, 200); });

  return { render, data, open, groups: () => (D ? groups() : []), issuesOf, norm };
})();
