/*
 * 라인업 탭 — 해외대체 펀드 라인업(고객 제공용 엑셀 'Fund Line-up')을 휴대폰·PC에서 찾아보는 읽기 전용 화면.
 * 데이터: lineup.enc.json (미팅노트 DB와 같은 비밀번호·salt 로 잠근 사본. scripts/lineup_build.py → scripts/vault.mjs)
 *   { asof, title, source, acs[], notice[], funds[]: { no, fund, note?, gp, ac, type, strategy, target, geo, structure,
 *     size, ret, status, timeline, overview, details, track, lastmod('YY.MM.DD), lm(YYYY-MM-DD) } }
 * 셀 글자는 엑셀 그대로 보여준다(고치지 않음). 내용을 바꾸려면 엑셀을 고친 뒤 Claude에 라인업 업데이트를 요청한다.
 */
const Lineup = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const h = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LS = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  let D = null, state = "idle", err = "", loadP = null;
  let ac = LS.get("kbnote-lac", ""), st = "", q = "", recent = false;
  const opened = new Set();
  const STATUS = ["모집 중", "상시 모집", "모집 예정", "모집 완료"];
  const TONE = { "모집 중": "s-go", "상시 모집": "s-done", "모집 예정": "s-watch", "모집 완료": "s-no" };
  const SHORT = { "Private Equity": "PE", "Private Credit": "Private Credit", "Real Estate": "Real Estate", "Infrastructure": "Infra", "Aviation": "Aviation", "Multi-Asset": "Multi-Asset" };
  const FIELDS = ["fund", "note", "gp", "ac", "type", "strategy", "target", "geo", "structure", "size", "ret", "status", "timeline", "overview", "details", "track"];

  function ensure() {
    if (D) return Promise.resolve(D);
    if (loadP) return loadP;
    state = "loading"; paint();
    loadP = Vault.openExtra("lineup.enc.json").then((r) => {
      if (r.data && Array.isArray(r.data.funds) && r.data.funds.length) { D = r.data; state = "ready"; }
      else { state = "error"; err = r.error || "broken"; }
      loadP = null; paint(); return D;
    });
    return loadP;
  }
  function data() {
    if (D) return Promise.resolve(D);
    if (state === "error" && (err === "missing" || err === "mismatch")) return Promise.resolve(null);
    return ensure().catch(() => null);
  }
  // 다른 화면(통합 검색 등)에서 펀드 하나를 펼쳐 보이게 한다
  function open(no) { ac = ""; st = ""; q = ""; recent = false; opened.clear(); opened.add(Number(no)); }
  function render() { if (!D && state !== "loading" && state !== "error") ensure(); paint(); }

  const dot = (iso) => (iso ? iso.replace(/-/g, ".") : "");
  // 최근 수정 = 가장 최근 수정일에서 7일 안에 고친 펀드(이번 업데이트에서 바뀐 펀드)
  function recentSet() {
    const last = D.funds.map((f) => f.lm).filter(Boolean).sort().pop();
    if (!last) return new Set();
    const t = new Date(last + "T00:00:00").getTime() - 7 * 864e5;
    return new Set(D.funds.filter((f) => f.lm && new Date(f.lm + "T00:00:00").getTime() >= t).map((f) => f.no));
  }
  const words = () => q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (f) => FIELDS.map((k) => f[k] || "").join("\n").toLowerCase();
  function mark(s) {   // 검색어 표시(글자는 그대로, 이스케이프 뒤에 감싼다)
    let out = h(s);
    words().forEach((w) => { const e = h(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); if (e) out = out.replace(new RegExp(e, "gi"), (m) => `<mark>${m}</mark>`); });
    return out;
  }
  const val = (s) => (s && s !== "-" ? mark(s) : `<span class="lu-na">-</span>`);

  function filtered(base) {
    const ws = words(), rs = recent ? recentSet() : null;
    return D.funds.filter((f) => (!base || !ac || f.ac === ac) && (!st || f.status === st) && (!rs || rs.has(f.no)) && ws.every((w) => hay(f).includes(w)));
  }

  function paint() {
    const el = $("#luMain"), sec = $("#p-lineup"); if (!el || (sec && sec.hidden)) return;   // 라인업 탭이 보일 때만
    if (!D) {
      const msg = state === "error"
        ? ({ missing: "아직 올라온 라인업이 없습니다.", mismatch: "라인업이 다른 비밀번호로 잠겨 있습니다. Claude에 라인업 업데이트를 다시 요청해 주세요.",
             network: "라인업을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.", locked: "먼저 비밀번호로 앱을 열어 주세요." }[err] || "라인업을 열지 못했습니다.")
        : "라인업을 여는 중…";
      el.innerHTML = `<div class="empty">${h(msg)}</div>`;
      if (state === "error") { const b = document.createElement("button"); b.className = "btn sm"; b.textContent = "다시 시도"; b.onclick = () => { state = "idle"; ensure(); }; el.firstChild.append(document.createElement("br"), b); }
      return;
    }
    const n = (s) => D.funds.filter((f) => f.status === s).length;
    const sts = STATUS.filter((s) => n(s)).concat(D.funds.some((f) => !STATUS.includes(f.status)) ? ["-"] : []);
    const rc = recentSet().size;
    el.innerHTML = `
      <div class="lu-head"><div class="t"><div class="eyebrow">펀드 라인업 · 기준일 ${h(dot(D.asof))}</div>
        <h2>해외대체 펀드 라인업 <small>${D.funds.length}개 펀드 · ${D.acs.length}개 자산군</small></h2></div></div>
      <div id="luKpi"></div>
      <div class="lu-tools">
        <input id="luq" type="search" placeholder="펀드명·운용사·전략·지역·일정 검색" value="${h(q)}" aria-label="라인업 검색">
        <select id="luSt" aria-label="모집 상태"><option value="">상태 전체</option>${sts.map((s) => `<option${s === st ? " selected" : ""}>${h(s)}</option>`).join("")}</select>
        <button class="qbtn" id="luNew" type="button" aria-pressed="${recent}" title="이번 업데이트(최근 수정일에서 7일 안)에 고친 펀드만">최근 수정 <span>${rc}</span></button>
      </div>
      <div class="lu-seg" role="group" aria-label="자산군"></div>
      <div class="lu-cnt" id="luCnt"></div>
      <div id="luBody"></div>
      <p class="basis">${D.notice.map(h).join("<br>")}<br>원본: ${h(D.source || "")} · ${h(D.generatedAt || "")} 정리 · 엑셀 셀 글자를 그대로 보여주는 읽기 전용 화면입니다.</p>`;
    Dash.blocks([{ t: "kpis", id: "k", items: [
      { l: "전체 펀드", v: D.funds.length, f: "n0", u: "개", s: D.acs.map((a) => `${SHORT[a] || a} ${D.funds.filter((f) => f.ac === a).length}`).join(" · ") },
      { l: "모집 중", v: n("모집 중"), f: "n0", u: "개", s: "Closed-end 펀드레이징 진행" },
      { l: "상시 모집", v: n("상시 모집"), f: "n0", u: "개", s: "Evergreen·BDC 등" },
      { l: "모집 완료", v: n("모집 완료"), f: "n0", u: "개", s: "Final close 완료" },
    ] }], $("#luKpi"), "lu");
    $("#luq").oninput = (e) => { q = e.target.value; paintBody(); };
    $("#luSt").onchange = (e) => { st = e.target.value; paintBody(); };
    $("#luNew").onclick = (e) => { recent = !recent; e.currentTarget.setAttribute("aria-pressed", String(recent)); paintBody(); };
    paintBody();
  }

  function paintBody() {
    const seg = $(".lu-seg"), body = $("#luBody"); if (!seg || !body) return;
    const pool = filtered(false);
    seg.innerHTML = [""].concat(D.acs).map((a) => `<button type="button" data-ac="${h(a)}" aria-pressed="${a === ac}">${h(a ? SHORT[a] || a : "전체")} <span>${a ? pool.filter((f) => f.ac === a).length : pool.length}</span></button>`).join("");
    $$("button", seg).forEach((b) => b.onclick = () => { ac = b.dataset.ac; LS.set("kbnote-lac", ac); paintBody(); });
    const list = filtered(true);
    $("#luCnt").textContent = `${list.length}개 펀드${q || st || recent || ac ? ` (전체 ${D.funds.length}개 중)` : ""}`;
    if (!list.length) { body.innerHTML = `<div class="empty">조건에 맞는 펀드가 없습니다.</div>`; return; }
    const head = `<div class="lu-hd" aria-hidden="true"><span>No</span><span>펀드 · 운용사</span><span>목표규모</span><span>목표수익률</span><span>상태</span><span>모집 일정·현황</span><span>수정일</span></div>`;
    body.innerHTML = D.acs.filter((a) => list.some((f) => f.ac === a)).map((a) => {
      const fs = list.filter((f) => f.ac === a);
      return `<section class="lu-sec"><h3>${h(a)} <small>${fs.length}개</small></h3>${head}${fs.map(card).join("")}</section>`;
    }).join("");
    $$("details.lu-f", body).forEach((d) => d.addEventListener("toggle", () => { const k = Number(d.dataset.no); if (d.open) opened.add(k); else opened.delete(k); }));
    const first = $("details.lu-f[open]", body);
    if (first && opened.size === 1 && !q) first.scrollIntoView({ block: "center" });
  }

  function card(f) {
    const rows = [["투자유형 · 전략", [f.type, f.strategy].filter((x) => x && x !== "-").join(" · ") || "-"], ["투자대상", f.target], ["투자지역", f.geo],
      ["펀드구조", f.structure], ["개요", f.overview], ["비고", f.details], ["주요 실적", f.track]];   // 모집 일정은 펼치면 윗줄에 전부 보인다
    return `<details class="lu-f" data-no="${f.no}"${opened.has(f.no) ? " open" : ""}>
      <summary>
        <span class="lu-no">${f.no}</span>
        <span class="lu-nm"><b>${mark(f.fund)}</b>${f.note ? `<em>${mark(f.note)}</em>` : ""}<small>${mark(f.gp)}</small></span>
        <span class="lu-sz"><i>목표규모</i>${val(f.size)}</span>
        <span class="lu-rt"><i>목표수익률</i>${val(f.ret)}</span>
        <span class="lu-st">${f.status && f.status !== "-" ? `<em class="lu-pill ${TONE[f.status] || ""}">${h(f.status)}</em>` : `<span class="lu-na">-</span>`}</span>
        <span class="lu-tl"><i>모집 일정</i>${val(f.timeline)}</span>
        <span class="lu-lm">${h(f.lastmod)}</span>
      </summary>
      <dl class="lu-d">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${val(v)}</dd>`).join("")}<dt>최종 수정일</dt><dd>${h(f.lastmod)}</dd></dl>
    </details>`;
  }

  return { render, data, open };
})();
