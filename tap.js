/*
 * 태핑 플랜 탭 — 내년(2027) 자산군별로 어떤 기관을 태핑하면 좋을지(사용자 요청 2026-11-27).
 * 데이터: 미팅노트 DB(data.enc.json)의 tap — 기관명·발언이 들어 있어 공개 코드에는 두지 않는다.
 *   { year, asof, basis, classes[]: { key, name, subs[](전략 수요판 신호 이름), summary[], sched[{ t, org, do }],
 *     items[]: { org, orgId, tier(1 우선 태핑·2 2027 계획 확인·3 재개 대기·조건부·4 제외), strat, said, cond?, when?, act?, src[미팅 id], hear?(전언) } } }
 * '현재 신호'는 기관 signals(전략 수요판과 같은 데이터)에서 그때그때 읽고, 플랜에 없는데 그 자산군 신호(진행·관심·약정)가 있는 기관은 '플랜 밖 신호'로 맨 아래에 붙인다.
 * 표는 PC 에서 한 줄, 휴대폰은 같은 표를 카드처럼(tap.css). 기관 이름 → 기관 상세, 날짜 → 그 미팅.
 */
const Tap = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const h = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LS = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const TIERS = [[1, "우선 태핑", "2027년 투자 의향을 직접 밝힌 기관"], [2, "2027 계획 확인", "올해 진행·관심이 있고 내년 계획은 아직 못 들은 기관"],
                 [3, "재개 대기·조건부", "보류 중이거나 내부 제약이 풀려야 하는 기관"], [4, "제외", "투자하지 않겠다고 밝힌 기관"]];
  const LIVE = ["진행", "관심", "약정"];
  let T = null, ck = LS.get("kbnote-tapc", "PC"), ty = "", q = "";
  const off = new Set();   // 접어 둔 구분(tier)

  const orgs = () => (typeof O !== "undefined" ? O : []);
  const meets = () => (typeof M !== "undefined" ? M : []);
  function set(tap) { T = tap && Array.isArray(tap.classes) && tap.classes.length ? tap : null; }
  const cls = () => (T ? T.classes.find((c) => c.key === ck) || T.classes[0] : null);
  const md = (d) => { const m = String(d || "").match(/^\d{4}-(\d{2})-(\d{2})/); return m ? `${+m[1]}/${+m[2]}` : ""; };

  function render() {
    const host = $("#tpMain"); if (!host) return;
    if (!T) { host.innerHTML = `<div class="empty">태핑 플랜이 아직 없습니다. Claude에 '태핑 플랜 업데이트'를 요청해 주세요.</div>`; return; }
    const c = cls(); ck = c.key;
    const byId = new Map(orgs().map((o) => [o.id, o])), mById = new Map(meets().map((m) => [m.id, m]));
    const types = [...new Set(c.items.map((i) => (byId.get(i.orgId) || {}).type).filter(Boolean))];
    const ql = q.trim().toLowerCase();
    const ok = (i) => {
      const o = byId.get(i.orgId) || {};
      if (ty && o.type !== ty) return false;
      if (!ql) return true;
      return ql.split(/\s+/).every((w) => [i.org, ...(o.aliases || []), i.strat, i.said, i.cond, i.when, i.act].join(" ").toLowerCase().includes(w));
    };
    const vis = c.items.filter(ok);
    const sig = (o) => (c.subs || []).filter((k) => (o.signals || {})[k]).map((k) => { const v = o.signals[k];
      const lb = (typeof SHORT !== "undefined" && SHORT[k]) || k;   // 전략 수요판과 같은 짧은 이름(PD·DL, Credit Sec. …)
      return `<span class="tp-sg" title="${h(k)} ${h(v.s)}${v.note ? " · " + h(v.note) : ""}"><span class="sg s-${h(v.s)}">${h(lb)} ${h(v.s)}</span>${v.date ? `<small>${h(md(v.date))}</small>` : ""}</span>`; }).join("");
    const srcs = (i) => (i.src || []).map((id) => { const m = mById.get(id); return m ? `<button type="button" class="link tp-src" data-gm="${h(id)}" title="${h(m.org)} 미팅">${h(md(m.date))}</button>` : ""; }).join("");
    const row = (i) => { const o = byId.get(i.orgId) || {};
      return `<tr>
        <td class="tp-o" data-l="기관"><button type="button" class="link" data-go="${h(i.orgId)}">${h(i.org)}</button>${i.hear ? `<span class="tp-hear" title="다른 기관·운용사를 통해 들은 내용이 섞여 있음">전언</span>` : ""}<small>${h(o.type || "")}</small></td>
        <td class="tp-st" data-l="관심 전략">${h(i.strat)}</td>
        <td class="tp-said" data-l="발언·동향">${h(i.said)}</td>
        <td class="tp-cond" data-l="조건·선호">${h(i.cond || "")}</td>
        <td class="tp-when" data-l="시점">${h(i.when || "")}</td>
        <td class="tp-act" data-l="다음 액션">${h(i.act || "")}</td>
        <td class="tp-sig" data-l="현재 신호">${sig(o)}</td>
        <td class="tp-srcs" data-l="근거 미팅">${srcs(i)}</td></tr>`; };
    const head = `<thead><tr><th>기관</th><th>관심 전략</th><th>2027 관련 발언 · 최근 동향</th><th>조건 · 선호</th><th>시점</th><th>다음 액션(제안)</th><th>현재 신호</th><th>근거 미팅</th></tr></thead>`;
    const tiers = TIERS.map(([k, n, desc]) => {
      const L = vis.filter((i) => i.tier === k), all = c.items.filter((i) => i.tier === k).length;
      const closed = off.has(k);
      return `<section class="tp-tier t${k}${closed ? " closed" : ""}"><h3><button type="button" class="tp-tg" data-tier="${k}" aria-expanded="${!closed}"><span class="tp-n">${k}</span>${h(n)} <b>${L.length}${L.length !== all ? `/${all}` : ""}곳</b><small>${h(desc)}</small></button></h3>
        ${closed ? "" : L.length ? `<div class="tp-tw"><table class="tp-t">${head}<tbody>${L.map(row).join("")}</tbody></table></div>` : `<div class="tp-none">${all ? "찾는 조건에 맞는 기관이 없습니다." : "해당 기관 없음"}</div>`}</section>`;
    }).join("");
    // 플랜 밖 신호: 이 자산군 신호(진행·관심·약정)가 있는데 플랜에 없는 기관(GP·내부 제외) — 새 미팅으로 생긴 수요를 놓치지 않게
    const inPlan = new Set(c.items.map((i) => i.orgId));
    const extra = orgs().filter((o) => !inPlan.has(o.id) && o.type !== "GP" && o.type !== "내부" && (!ty || o.type === ty)
      && (c.subs || []).some((k) => LIVE.includes(((o.signals || {})[k] || {}).s))
      && (!ql || [o.name, ...(o.aliases || [])].join(" ").toLowerCase().includes(ql)));
    const sched = (c.sched || []).map((s) => `<tr><td class="w">${h(s.t)}</td><td class="o">${h(s.org)}</td><td>${h(s.do)}</td></tr>`).join("");
    host.innerHTML = `
      <div class="tp-head"><div><div class="eyebrow">${h(T.year)} 태핑 플랜 · 작성 ${h(T.asof)} · 근거 ${h(T.basis)}</div><h2>자산군별 태핑 대상 기관</h2></div></div>
      <div class="tp-bar">
        <div class="seg tp-seg" role="group" aria-label="자산군">${T.classes.map((x) => `<button type="button" data-c="${h(x.key)}" aria-pressed="${x.key === ck}">${h(x.name)} <small>${x.items.length}</small></button>`).join("")}</div>
        <div class="tp-tools"><select id="tpType" aria-label="업권"><option value="">업권 전체</option>${types.map((t) => `<option${t === ty ? " selected" : ""}>${h(t)}</option>`).join("")}</select>
          <input id="tpq" type="search" placeholder="기관·전략·내용 찾기" value="${h(q)}" autocomplete="off"></div>
      </div>
      <div class="tp-top">
        <section class="tp-box"><h3>요약</h3><ol class="tp-sum">${(c.summary || []).map((s) => `<li>${h(s)}</li>`).join("")}</ol></section>
        <section class="tp-box"><h3>태핑 일정(안) <small>당부서 제안</small></h3><table class="tp-sched"><tbody>${sched}</tbody></table></section>
      </div>
      ${tiers}
      <section class="tp-tier tp-extra"><h3><span class="tp-n">+</span>플랜 밖 신호 <b>${extra.length}곳</b><small>전략 수요판에 ${h(c.name)} 신호(진행·관심·약정)가 있지만 플랜에 없는 기관</small></h3>
        ${extra.length ? `<div class="tp-ex">${extra.map((o) => `<div class="tp-exi"><button type="button" class="link" data-go="${h(o.id)}">${h(o.name)}</button><small>${h(o.type || "")}</small><div>${sig(o)}</div></div>`).join("")}</div>` : `<div class="tp-none">없음</div>`}</section>
      <p class="basis">기관 발언은 미팅 당시 기준입니다. '다음 액션'·'태핑 일정(안)'·'당부서 계획·판단'은 당부서 의견이고, '전언'은 다른 기관·운용사를 통해 들은 내용입니다. 현재 신호는 기관 탭의 전략 시그널을 그대로 보여 줍니다.</p>`;
    $$(".tp-seg [data-c]", host).forEach((b) => b.onclick = () => { ck = b.dataset.c; LS.set("kbnote-tapc", ck); ty = ""; render(); });
    $("#tpType", host).onchange = (e) => { ty = e.target.value; render(); };
    const qi = $("#tpq", host); let tm = 0;
    qi.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { q = qi.value; const at = qi.selectionStart; render(); const n = $("#tpq"); n.focus(); try { n.setSelectionRange(at, at); } catch (e) {} }, 200); };
    $$(".tp-tg", host).forEach((b) => b.onclick = () => { const k = +b.dataset.tier; off.has(k) ? off.delete(k) : off.add(k); render(); });
    $$("[data-go]", host).forEach((b) => b.onclick = () => { if (typeof goOrg === "function") goOrg(b.dataset.go); });
    $$("[data-gm]", host).forEach((b) => b.onclick = () => { if (typeof gotoMeeting === "function") gotoMeeting(b.dataset.gm); });
  }
  // 다른 곳(기관 상세 등)에서 자산군을 골라 연다
  function open(key) { if (key) { ck = key; LS.set("kbnote-tapc", ck); } }
  // 기관 상세용: 그 기관이 들어 있는 자산군별 항목
  function of(orgId) { return T ? T.classes.flatMap((c) => c.items.filter((i) => i.orgId === orgId).map((i) => ({ c, i }))) : []; }
  return { set, render, open, of, data: () => T };
})();
