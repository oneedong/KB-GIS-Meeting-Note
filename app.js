const STRATS=["PE Buyout","PE Secondary","Co-invest","Growth/VC","PD/DL","Opp Credit/SS","Credit Secondary","인프라 Debt","인프라 Equity","인프라 Secondary","부동산 Debt","부동산 Equity","항공기","Open-end/BDC","헤지펀드","ABF/CLO/구조화","GP Financing"];
const SHORT={"PE Buyout":"Buyout","PE Secondary":"PE Sec.","Co-invest":"Co-inv","Growth/VC":"Growth·VC","PD/DL":"PD·DL","Opp Credit/SS":"Opp·SS","Credit Secondary":"Credit Sec.","인프라 Debt":"인프라 D","인프라 Equity":"인프라 E","인프라 Secondary":"인프라 Sec.","부동산 Debt":"부동산 D","부동산 Equity":"부동산 E","항공기":"항공기","Open-end/BDC":"OE·BDC","헤지펀드":"HF","ABF/CLO/구조화":"ABF·CLO","GP Financing":"GP Fin."};
const STATES=["진행","관심","약정","보류","불가"];
const STATE_DESC={"약정":"올해 약정 완료(Re-up·추가 후보)","진행":"실사·심의·선정 진행 중","관심":"검토 의향 있음","보류":"일시 중단·재개 대기","불가":"규정·방침상 어려움"};
const TYPES=["연기금","공제회","보험","운용사","은행","증권","캐피탈","저축은행","기타","GP","내부"];

const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let db=null, canWrite=false;
const C={meetings:null,orgs:null,people:null};
let M=[],O=[],P=[];
let tab="meetings", mSel=null, mMode="view", oSel=null, oMode="view", pSel=null, pOrg="", pMode="view", confirmDel=false, cellSel=null;
let cutOnly=false, showMatrix=false; const listY={};
const mq=matchMedia("(max-width:760px)"); const isMob=()=>mq.matches;
const BACK=`<div class="backbar"><button class="btn sm" type="button" data-back>← 목록</button></div>`;
function fabSync(){$("#fab").hidden=!(tab==="meetings"&&canWrite&&!$("#p-meetings").classList.contains("detail"))}
function openDetail(){if(!isMob()||!["meetings","orgs","people"].includes(tab))return;const sec=$("#p-"+tab);if(!sec.classList.contains("detail")){listY[tab]=scrollY;sec.classList.add("detail");try{history.pushState({detail:tab},"",location.hash)}catch(e){}}scrollTo({top:0});fabSync()}
// 휴대폰 뒤로가기(안드로이드 버튼·제스처)는 상세를 닫는다. 화면의 "← 목록"으로 닫을 때는 쌓아 둔 기록도 되돌린다.
addEventListener("popstate",()=>{const sec=$("#p-"+tab);if(sec&&sec.classList.contains("detail"))closeDetail(true)});
function closeDetail(fromPop){const sec=$("#p-"+tab);if(!sec)return;const was=sec.classList.contains("detail");sec.classList.remove("detail");if(was&&!fromPop&&history.state&&history.state.detail){try{history.back()}catch(e){}}
  if(tab==="meetings"&&mMode!=="view"){mMode="view";renderMMain()} if(tab==="orgs"&&oMode!=="view"){oMode="view";renderOMain()} if(tab==="people"&&pMode!=="view"){pMode="view";renderPMain()}
  confirmDel=false;requestAnimationFrame(()=>scrollTo({top:listY[tab]||0}));fabSync()}
document.addEventListener("click",e=>{if(e.target.closest("[data-back]"))closeDetail()});

function toast(m){const t=$("#toast");t.textContent=m;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,2400)}
function md(d){const [y,m,dd]=(d||"").split("-");return {y,m:+m,d:+dd}}
function wk(d){try{return "일월화수목금토"[new Date(d+"T00:00:00").getDay()]}catch(e){return ""}}
function nowIso(){return new Date().toISOString()}
function today(){return new Date(Date.now()+9*3600e3).toISOString().slice(0,10)}
function opt(sel,vals){const el=$(sel);vals.forEach(v=>el.insertAdjacentHTML("beforeend",`<option>${esc(v)}</option>`))}
opt("#mType",TYPES);opt("#oType",TYPES);opt("#dType",TYPES);opt("#mAsset",STRATS);opt("#dStrat",STRATS);
$("#legend").innerHTML=STATES.map(s=>`<span class="sg s-${s}" title="${esc(STATE_DESC[s])}">${s}</span>`).join("")+`<span>· ${STATES.map(s=>s+"="+STATE_DESC[s]).join(" / ")}</span>`;

// ── 기관 매칭 ──
function orgOf(name){if(!name)return null;return O.find(o=>o.name===name||(o.aliases||[]).includes(name))||null}
function meetingsOf(o){const names=new Set([o.name,...(o.aliases||[])]);return M.filter(m=>names.has(m.org))}
function peopleOf(o){const names=new Set([o.name,...(o.aliases||[])]);return P.filter(p=>names.has(p.org))}

// ── 메모 파서 ──
function parseBody(text){const secs=[],take=[];let cur=null;
  (text||"").split(/\r?\n/).forEach(raw=>{const l=raw.trim();if(!l)return;
    if(l.startsWith("-->")){take.push(l.replace(/^-->\s*/,""));return}
    if(l.startsWith("*")){cur={h:l.replace(/^\*\s*/,""),b:[]};secs.push(cur);return}
    if(!cur){cur={h:"",b:[]};secs.push(cur)} cur.b.push(l.replace(/^[-•·]\s*/,""))});
  return {secs,take}}
function parseAtt(text){return (text||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(l=>{const [who,...rest]=l.split(/\s+[-–:]\s+/);return {who:who.trim(),note:rest.join(" - ").trim()}})}
function memoText(r){const {m,d}=md(r.date),att=parseAtt(r.attendees);
  let s=`# ${m}/${d} ${r.category==="GP"?"GP":"LP"} 미팅 : ${r.org}${r.dept?" "+r.dept:""} ${att.map(a=>a.who).join(", ")}\n`;
  att.forEach(a=>{if(a.note)s+=`- ${a.who}: ${a.note}\n`});return s+"\n"+(r.body||"").trim()+"\n"+(r.truncated?"※ 원문 잘림 — 카톡 '전체보기'로 보완 필요\n":"")}

// ── 탭 ──
function setTab(t,push=true){tab=t;document.querySelectorAll(".tab,.bnav button").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===t?"true":"false"));
  ["meetings","orgs","demand","people"].forEach(k=>$("#p-"+k).hidden=k!==t);
  if(push){try{history.replaceState(null,"","#"+t)}catch(e){}}
  renderTab();window.scrollTo({top:0});fabSync()}
document.querySelectorAll(".tab,.bnav button").forEach(b=>b.onclick=()=>{if(b.dataset.tab===tab&&isMob()){closeDetail();return}setTab(b.dataset.tab)});
mq.addEventListener?.("change",()=>{if(!isMob())document.querySelectorAll(".split.detail").forEach(s=>s.classList.remove("detail"));if(tab==="demand")renderDemand();fabSync()});
function renderTab(){({meetings:()=>{renderMList();renderMMain()},orgs:()=>{renderOList();renderOMain()},demand:renderDemand,people:()=>{renderPList();renderPMain()}})[tab]()}
function gotoOrg(name){const o=orgOf(name);if(!o){toast("기관 프로필이 아직 없습니다. 기관 탭에서 추가하세요.");return}oSel=o.id;oMode="view";setTab("orgs");openDetail()}
function gotoMeeting(id){mSel=id;mMode="view";setTab("meetings");if(isMob()){openDetail();return}setTimeout(()=>{const el=document.querySelector(`#mList [data-id="${CSS.escape(id)}"]`);if(el)el.scrollIntoView({block:"nearest"})},30)}
function gotoPerson(id){const p=P.find(x=>x.id===id);if(!p)return;pSel=id;pMode="view";setTab("people");openDetail()}

function stats(){$("#stats").textContent=`미팅 ${M.length} · 기관 ${O.length} · 인물 ${P.length}`}

// ═════ 검색 ═════
// 여러 단어는 모두 들어 있어야 맞음. 각 단어는 기관 약칭(DB의 aliases: 교공→한국교직원공제회)과
// 아래 한·영 표기 묶음(블루아울↔Blue Owl)으로 넓혀서 찾는다. 공개 코드이므로 일반 GP명·업계 용어만 둔다.
const SYN=[["blue owl","블루아울","블루 아울"],["apollo","아폴로"],["blackrock","블랙록"],["blackstone","블랙스톤"],["carlyle","칼라일"],["kkr","케이케이알"],
  ["ares","아레스"],["brookfield","브룩필드"],["hamilton lane","해밀턴레인","해밀턴 레인"],["stepstone","스텝스톤"],["neuberger","누버거","뉴버거"],["golub","골럽","골룹"],
  ["oaktree","오크트리"],["bain","베인"],["partners group","파트너스그룹","파트너스 그룹"],["ardian","아디안","아르디안"],["macquarie","맥쿼리"],["goldman","골드만"],
  ["morgan stanley","모건스탠리","모건 스탠리"],["pimco","핌코"],["sixth street","식스스트리트"],["tpg","티피지"],["permira","퍼미라"],["warburg","워버그"],
  ["silver point","실버포인트"],["centerbridge","센터브릿지"],["crescent","크레센트"],["sculptor","스컬프터","스컵터"],["eurazeo","유라제오"],["digital bridge","디지털브릿지","digitalbridge"],
  ["farallon","패럴론","파랄론"],["benefit street","bsp"],["lexington","렉싱턴"],["wellington","웰링턴"],["jefferies","제프리스"],["oak hill","오크힐","oha"],
  ["private debt","pd","사모대출","사모 대출"],["private credit","프라이빗 크레딧","사모신용"],["direct lending","dl","직접대출"],["secondary","세컨더리","세컨"],
  ["buyout","바이아웃"],["co-invest","코인베","공동투자","co-investment"],["infra","인프라","infrastructure"],["real estate","부동산"],["re-up","리업"],
  ["blind","블라인드","블펀"],["capital call","캐피탈콜","캐피털콜","캐콜"],["hedge fund","헤지펀드","헤지 펀드"],["aircraft","항공기"],["gp financing","gp 파이낸싱","gp파이낸싱"],
  ["evergreen","에버그린"],["open-end","오픈엔드","오픈 엔드"],["bdc","비디씨"],["clo","씨엘오"],["sma","에스엠에이"]];
let ORGKEY=new Map(),HAY=new Map(),hlCache={q:null,re:null};
function indexSearch(){ORGKEY=new Map();O.forEach(o=>[o.name,...(o.aliases||[])].forEach(k=>{if(k)ORGKEY.set(k.toLowerCase(),o)}));HAY=new Map();hlCache={q:null,re:null}}
function expand(t){const alts=new Set([t]);SYN.forEach(g=>{if(g.includes(t))g.forEach(x=>alts.add(x))});
  const o=ORGKEY.get(t);if(o)[o.name,...(o.aliases||[])].forEach(x=>alts.add(x.toLowerCase()));return [...alts]}
function terms(q){let s=(q||"").trim().toLowerCase();if(!s)return [];const T=[];
  SYN.flat().filter(x=>x.includes(" ")).sort((a,b)=>b.length-a.length).forEach(ph=>{if(s.includes(ph)){T.push(expand(ph));s=s.split(ph).join(" ")}});  // 띄어쓴 이름은 한 단어로
  s.split(/\s+/).filter(Boolean).forEach(t=>T.push(expand(t)));return T}
const hits=(hay,T)=>T.every(alts=>alts.some(a=>hay.includes(a)));
function hayM(r){let h=HAY.get(r.id);if(h)return h;const o=orgOf(r.org);
  h=[r.org,...(o?[o.name,...(o.aliases||[])]:[]),r.dept,r.attendees,r.body,r.nextAction,r.kbAttendees,(r.tags||[]).join(" "),(r.assets||[]).join(" "),r.category,r.orgType].join(" ").toLowerCase();HAY.set(r.id,h);return h}

// ═════ 미팅노트 ═════
function authorsRefresh(){const el=$("#mAuthor"),cur=el.value;const set=[...new Set(M.map(m=>(m.kbAttendees||"").split(/[,·\/]/)[0].trim()).filter(Boolean))].sort();
  el.innerHTML=`<option value="">작성자 전체</option>`+set.map(a=>`<option${a===cur?" selected":""}>${esc(a)}</option>`).join("")}
function mFiltered(){const T=terms($("#mq").value),c=$("#mCat").value,t=$("#mType").value,a=$("#mAsset").value,au=$("#mAuthor").value,f=$("#mFlag").value;
  return M.filter(r=>(!c||(r.category||"LP")===c)&&(!t||r.orgType===t)&&(!a||(r.assets||[]).includes(a))&&(!au||(r.kbAttendees||"").includes(au))&&(!cutOnly||r.truncated)&&(!newOnly||NEWS.has(r.id)||UPDS.has(r.id))&&
    (!f||(f==="원문 잘림"?r.truncated:f==="다음 액션"?!!r.nextAction:(r.flags||[]).some(x=>f==="확인"?/확인/.test(x):x.startsWith(f))))&&
    (!T.length||hits(hayM(r),T)))}
// ── 읽기 도우미: 검색어 강조·금액 강조·미리보기 ──
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
function hlRe(q){if(hlCache.q===q)return hlCache.re;const alts=[...new Set(terms(q).flat())].sort((a,b)=>b.length-a.length);
  hlCache={q,re:alts.length?new RegExp(`(<[^>]+>|&(?:amp|lt|gt|quot);)|(${alts.map(a=>reEsc(esc(a))).join("|")})`,"gi"):null};return hlCache.re}
function hl(html,q){const re=q&&hlRe(q);if(!re)return html;  // 이미 이스케이프된 html 의 글자 부분에서만 검색어를 <mark>
  return html.replace(re,(m,keep,hit)=>keep||`<mark>${hit}</mark>`)}
const NUM=/(?:USD|EUR|GBP|JPY|KRW|AUD|US\$|\$|€|£)\s?\d[\d,.]*\s?(?:bn|mn|m|b|k|조|억|만)?|\d[\d,.]*\s?(?:조|억|천만|백만|만)\s?(?:원|달러|불)?|\d[\d,.]*\s?(?:%|bp|bps|x|배)(?![A-Za-z가-힣])|\d[\d,.]*\s?(?:bn|mn)(?![A-Za-z])/gi;
function rich(t,q){return hl(esc(t).replace(NUM,m=>`<b class="num">${m}</b>`),q)}  // 본문 한 줄: 금액·비율 굵게 + 검색어
function firstHit(line,q){const l=line.toLowerCase();let best=null;terms(q).flat().forEach(a=>{const i=l.indexOf(a);if(i>=0&&(!best||i<best.i))best={i,n:a.length}});return best}
function snippet(line,q){const h=firstHit(line,q);if(!h)return esc(line);
  const a=Math.max(0,h.i-24),b=Math.min(line.length,h.i+h.n+60);return (a?"…":"")+hl(esc(line.slice(a,b)),q)+(b<line.length?"…":"")}
function preview(r,q){const {secs,take}=parseBody(r.body),lines=secs.flatMap(s=>s.b);
  if(q){const hit=[...take,...lines,r.nextAction||"",...parseAtt(r.attendees).map(a=>a.who+" "+a.note),(r.tags||[]).join(" ")].find(l=>firstHit(l,q));if(hit)return snippet(hit,q)}
  return take[0]?`<span class="arrow">→</span> ${esc(take[0])}`:esc(lines[0]||"")}
let seenAt="",newOnly=false,ASOF="";const NEWS=new Set(),UPDS=new Set();
const CAT_CLS={"GP":"gp","시장정보":"intel","내부":"inner"};
function renderMList(){const f=mFiltered(),L=$("#mList"),q=$("#mq").value.trim().toLowerCase();
  $("#mCnt").textContent=`${f.length}건 / 전체 ${M.length}건${ASOF?` · ${ASOF} 업데이트`:""}`;
  const cat=$("#mCat").value;document.querySelectorAll("#mQuick [data-cat]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.cat===cat?"true":"false"));
  const nb=$("#mNewOnly");nb.hidden=!NEWS.size&&!UPDS.size;nb.querySelector("span").textContent=NEWS.size+UPDS.size;nb.setAttribute("aria-pressed",newOnly?"true":"false");
  const nf=["mType","mAsset","mAuthor","mFlag"].filter(i=>$("#"+i).value).length;$("#mFt").textContent=nf?`필터 ${nf}`:"필터";$("#mFt").setAttribute("aria-pressed",nf?"true":"false");
  if(!M.length){L.innerHTML=`<div class="empty">아직 미팅노트가 없습니다.</div>`;return}
  if(!f.length){L.innerHTML=`<div class="empty">조건에 맞는 미팅이 없습니다. 검색어나 필터를 바꿔 보세요.</div>`;return}
  const per={};f.forEach(r=>{const k=(r.date||"").slice(0,7);per[k]=(per[k]||0)+1});let last="";
  L.innerHTML=f.map(r=>{const {y,m,d}=md(r.date),k=(r.date||"").slice(0,7),att=parseAtt(r.attendees).map(a=>a.who).join(", "),cat=r.category||"LP";
    const head=k!==last?`<div class="mhead">${y}년 ${m}월<span>${per[k]}건</span></div>`:"";last=k;
    const badge=NEWS.has(r.id)?`<span class="badge new">NEW</span>`:UPDS.has(r.id)?`<span class="badge upd">수정</span>`:"";
    return head+`<button type="button" class="item${r.id===mSel?" on":""}" data-id="${esc(r.id)}"><div class="date"><b>${d}</b>${wk(r.date)}</div>
      <div style="min-width:0"><div class="ttl">${cat!=="LP"?`<span class="cattag ${CAT_CLS[cat]||""}">${esc(cat)}</span>`:""}${hl(esc(r.org),q)}${r.dept?` <span class="mdept">${hl(esc(r.dept),q)}</span>`:""}${badge}</div>
      <div class="sub2">${hl(esc(att||r.kbAttendees||""),q)}</div>
      ${(()=>{const pv=preview(r,q);return pv?`<div class="pv">${pv}</div>`:""})()}
      <div class="chips">${(r.assets||[]).slice(0,3).map(t=>`<span class="chip asset">${esc(SHORT[t]||t)}</span>`).join("")}${r.truncated?`<span class="chip cut">✂ 잘림</span>`:""}${(r.flags||[]).some(x=>x.startsWith("내부용"))?`<span class="chip flag">내부용</span>`:""}</div></div></button>`}).join("")}
function ago(d){const n=Math.round((Date.parse(today())-Date.parse(d))/864e5);return n<=0?"오늘":n===1?"어제":n<7?`${n}일 전`:n<35?`${Math.round(n/7)}주 전`:n<365?`${Math.round(n/30)}개월 전`:""}
function renderMMain(){const W=$("#mMain");if(mMode!=="view")return renderMForm();
  const r=M.find(x=>x.id===mSel);if(!r){W.innerHTML=`<div class="empty">왼쪽에서 미팅을 선택하세요.</div>`;return}
  const {y,m,d}=md(r.date),att=parseAtt(r.attendees),{secs,take}=parseBody(r.body),o=orgOf(r.org),q=$("#mq").value.trim().toLowerCase();
  const inner=(r.flags||[]).some(x=>x.startsWith("내부용")),checks=(r.flags||[]).filter(x=>!x.startsWith("내부용")&&x!=="원문 잘림");
  const list=mFiltered(),i=list.findIndex(x=>x.id===r.id),newer=i>0?list[i-1]:null,older=i>=0&&i<list.length-1?list[i+1]:null;
  const cut=r.truncated?`<div class="trunc"><div style="flex:1;min-width:0"><b>✂ 원문 잘림 — 보완 필요</b><div>카톡 내보내기에서 긴 메시지 뒷부분이 잘렸습니다. 카톡 '전체보기'에서 확인한 내용을 Claude에 주면 보완합니다.</div>${r.truncAt?`<q>${esc(r.truncAt)}</q>`:""}</div></div>`:"";
  const nav=(x,dir)=>x?`<button type="button" class="pn-b ${dir}" data-nav="${esc(x.id)}"><small>${dir==="newer"?"← 더 최근":"더 이전 →"}</small><b>${esc(x.org)}</b><span>${esc(x.date)}</span></button>`:`<span></span>`;
  W.innerHTML=`<div class="backbar"><button class="btn sm" type="button" data-back>← 목록</button><span class="grow"></span><button class="btn sm" id="mCopyM" type="button">메모 복사</button></div>
  <div class="head"><div class="t">
    <div class="eyebrow">${y}.${String(m).padStart(2,"0")}.${String(d).padStart(2,"0")} (${wk(r.date)})${ago(r.date)?` · ${ago(r.date)}`:""} · ${esc(r.category||"LP")}${r.orgType?" · "+esc(r.orgType):""}</div>
    <h2>${o?`<button class="link" id="mOrg" type="button">${hl(esc(r.org),q)}</button>`:hl(esc(r.org),q)}${r.dept?` <span class="h-dept">${hl(esc(r.dept),q)}</span>`:""}</h2>
    <div class="chips">${inner?`<span class="chip flag">내부용 · 외부 공유 금지</span>`:""}${(r.assets||[]).map(t=>`<span class="chip asset">${esc(t)}</span>`).join("")}</div></div>
    <div class="actions"><button class="btn" id="mCopy" type="button">메모 복사</button>${canWrite?`<button class="btn" id="mEdit" type="button">수정</button>`:""}</div></div>
  <div class="body">
    ${take.length||r.nextAction?`<div class="key">${take.length?`<div class="key-h">핵심</div><ul>${take.map(t=>`<li>${rich(t,q)}</li>`).join("")}</ul>`:""}${r.nextAction?`<div class="key-next"><span>다음 액션</span>${rich(r.nextAction,q)}</div>`:""}</div>`:""}
    ${att.length?`<div class="attendees">${att.map(a=>`<div class="att"><b>${hl(esc(a.who),q)}</b><div>${a.note?hl(esc(a.note),q):"<span class='ro'>소개 없음</span>"}</div></div>`).join("")}</div>`:""}
    ${secs.map(s=>`<div class="sec">${s.h?`<h3>${esc(s.h)}</h3>`:""}<ul>${s.b.map(b=>`<li>${rich(b,q)}${r.truncated&&b===r.truncAt?`<p class="cutline" style="margin-top:6px">✂ 여기서 원문이 잘렸습니다</p>`:""}</li>`).join("")}</ul></div>`).join("")}
    ${r.truncated&&!secs.some(s=>s.b.includes(r.truncAt))?`<p class="cutline">✂ 원문이 잘린 노트입니다</p>`:""}
    ${cut}
    ${checks.length?`<div class="warnbox">${checks.map(esc).join(" · ")}</div>`:""}
    <div class="meta"><div><span>작성·당사 참석</span>${esc(r.kbAttendees)||"—"}</div><div><span>출처</span>${esc(r.source)||"직접 입력"}</div><div><span>최종 수정</span>${r.updatedAt?esc(r.updatedAt.slice(0,10)):"—"}</div>
      ${(r.tags||[]).length?`<div class="tags"><span>태그</span>${(r.tags||[]).map(t=>`<button type="button" class="chip tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join("")}</div>`:""}</div>
    ${newer||older?`<div class="pn">${nav(newer,"newer")}${nav(older,"older")}</div>`:""}
  </div>`;
  $("#mCopy").onclick=$("#mCopyM").onclick=()=>copy(memoText(r));const e=$("#mEdit");if(e)e.onclick=()=>{mMode="edit";confirmDel=false;renderMMain()};
  W.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>{mSel=b.dataset.nav;renderMList();renderMMain();if(isMob())scrollTo({top:0});else{W.scrollIntoView({block:"nearest"});const el=document.querySelector(`#mList [data-id="${CSS.escape(mSel)}"]`);if(el)el.scrollIntoView({block:"nearest"})}});
  W.querySelectorAll("[data-tag]").forEach(b=>b.onclick=()=>{$("#mq").value=b.dataset.tag;renderMList();if(isMob())closeDetail();else renderMMain()});
  const mo=$("#mOrg");if(mo)mo.onclick=()=>gotoOrg(r.org)}
function renderMForm(){const r=mMode==="edit"?M.find(x=>x.id===mSel)||{}:{date:today(),category:"LP"};
  $("#mMain").innerHTML=BACK+`<form id="mFrm" novalidate><div class="eyebrow">${mMode==="edit"?"미팅노트 수정":"새 미팅노트"}</div>
    <div class="row"><label>미팅일<input id="fDate" type="date" value="${esc(r.date)}"></label>
      <label>기관명<input id="fOrg" list="orgNames" value="${esc(r.org)}" placeholder="예: 군인공제회"></label>
      <label>부서·팀<input id="fDept" value="${esc(r.dept)}" placeholder="예: 기업금융2팀"></label>
      <label>업권<select id="fType"><option value=""></option>${TYPES.map(t=>`<option${t===r.orgType?" selected":""}>${t}</option>`).join("")}</select></label>
      <label>구분<select id="fCat">${["LP","GP","시장정보","내부"].map(t=>`<option${t===(r.category||"LP")?" selected":""}>${t}</option>`).join("")}</select></label></div>
    <datalist id="orgNames">${O.map(o=>`<option value="${esc(o.name)}">`).join("")}</datalist>
    <label>참석자 <span class="hint">한 줄에 한 명 · 이름 직급 - 소개</span><textarea id="fAtt" rows="3">${esc(r.attendees)}</textarea></label>
    <label>미팅 내용 <span class="hint">*섹션 / - 불릿 / --> 시사점</span><textarea id="fBody" rows="12" placeholder="*조직/인사 및 운용 규모&#10;- …&#10;*최근 투자현황/계획&#10;- …&#10;--> …">${esc(r.body)}</textarea></label>
    <div><div class="hint" style="margin-bottom:5px">관련 전략</div><div class="checks">${STRATS.map((s,i)=>`<label><input type="checkbox" id="fa${i}" value="${esc(s)}"${(r.assets||[]).includes(s)?" checked":""}>${esc(s)}</label>`).join("")}</div></div>
    <div class="row"><label>다음 액션<input id="fNext" value="${esc(r.nextAction)}"></label><label>작성·당사 참석<input id="fKb" value="${esc(r.kbAttendees)}" placeholder="예: 원동민 주임"></label></div>
    <div class="row"><label>태그 <span class="hint">쉼표 구분</span><input id="fTags" value="${esc((r.tags||[]).join(", "))}"></label><label>확인 필요 표시 <span class="hint">쉼표 구분 (내부용, 이름 확인 …)</span><input id="fFlags" value="${esc((r.flags||[]).join(", "))}"></label></div>
    <div class="checks"><label><input type="checkbox" id="fCut"${r.truncated?" checked":""}>✂ 원문 잘림(보완 필요) — 보완을 마쳤으면 체크 해제</label></div>
    <div class="formbar">${mMode==="edit"?(confirmDel?`<span class="confirm">이 미팅노트를 삭제할까요? <button class="btn danger" id="dYes" type="button">삭제</button><button class="btn" id="dNo" type="button">취소</button></span>`:`<button class="btn danger" id="dDel" type="button">삭제</button>`):""}
      <span class="grow"></span><button class="btn" id="fCancel" type="button">취소</button><button class="btn primary" type="submit" id="fSave">저장</button></div></form>`;
  $("#fCancel").onclick=()=>{const wasNew=mMode==="new";mMode="view";if(wasNew&&isMob())closeDetail();else renderMMain()};
  const dd=$("#dDel");if(dd)dd.onclick=()=>{confirmDel=true;keepForm(renderMForm,"#mFrm")};
  const dy=$("#dYes");if(dy)dy.onclick=async()=>{try{await C.meetings.doc(mSel).delete();mSel=null;mMode="view";confirmDel=false;toast("삭제했습니다.");closeDetail()}catch(e){toast("삭제하지 못했습니다.")}};
  const dn=$("#dNo");if(dn)dn.onclick=()=>{confirmDel=false;keepForm(renderMForm,"#mFrm")};
  $("#fOrg").addEventListener("change",()=>{const o=orgOf($("#fOrg").value.trim());if(o&&!$("#fType").value)$("#fType").value=o.type});
  $("#mFrm").onsubmit=async e=>{e.preventDefault();const date=$("#fDate").value,org=$("#fOrg").value.trim();
    if(!date||!org){toast("미팅일과 기관명을 입력하세요.");return}
    const old=mMode==="edit"?M.find(x=>x.id===mSel)||{}:{};const split=s=>s.split(",").map(x=>x.trim()).filter(Boolean);
    const data={...old,date,org,dept:$("#fDept").value.trim(),orgType:$("#fType").value,category:$("#fCat").value,attendees:$("#fAtt").value.trim(),body:$("#fBody").value.trim(),
      assets:STRATS.filter((s,i)=>$("#fa"+i).checked),nextAction:$("#fNext").value.trim(),kbAttendees:$("#fKb").value.trim(),tags:split($("#fTags").value),flags:split($("#fFlags").value),truncated:$("#fCut").checked,updatedAt:nowIso()};
    delete data.id;if(!data.createdAt)data.createdAt=data.updatedAt;
    await write(C.meetings,mMode==="edit"?mSel:null,data,id=>{mSel=id;mMode="view"},"#fSave")}}
function keepForm(fn,sel){const vals=[...document.querySelectorAll(sel+" input,"+sel+" select,"+sel+" textarea")].map(el=>[el.id,el.type==="checkbox"?el.checked:el.value]);fn();vals.forEach(([id,v])=>{const el=document.getElementById(id);if(!el)return;if(el.type==="checkbox")el.checked=v;else el.value=v})}
$("#mList").addEventListener("click",e=>{const b=e.target.closest(".item");if(!b)return;mSel=b.dataset.id;mMode="view";renderMList();renderMMain();if(isMob())openDetail();else if(innerWidth<=900)$("#mMain").scrollIntoView()});
["mq","mCat","mType","mAsset","mAuthor","mFlag"].forEach(i=>$("#"+i).addEventListener("input",()=>{renderMList();if(!isMob())renderMMain()}));  // PC는 상세의 검색어 강조·이전/다음도 갱신
document.querySelectorAll("#mQuick [data-cat]").forEach(b=>b.onclick=()=>{$("#mCat").value=b.dataset.cat;renderMList();if(!isMob())renderMMain()});
$("#mNewOnly").onclick=()=>{newOnly=!newOnly;renderMList()};
$("#mFt").onclick=()=>$("#mFilters").classList.toggle("open");
$("#mNew").onclick=$("#fab").onclick=()=>{if(!canWrite)return toast("이 링크에서는 수정 권한이 없습니다.");mMode="new";confirmDel=false;renderMMain();openDetail()};

// ═════ 기관 ═════
function lastMeet(o){const ms=meetingsOf(o);return ms.length?ms.reduce((a,b)=>a.date>b.date?a:b).date:""}
function oFiltered(){const T=terms($("#oq").value),t=$("#oType").value;
  return O.filter(o=>(!t||o.type===t)&&(!T.length||hits([o.name,...(o.aliases||[]),o.summary,o.prefs,o.hr,Object.keys(o.signals||{}).join(" ")].join(" ").toLowerCase(),T)))
   .map(o=>({o,last:lastMeet(o),n:meetingsOf(o).length})).sort((a,b)=>(b.last||"").localeCompare(a.last||"")||a.o.name.localeCompare(b.o.name))}
function renderOList(){const f=oFiltered(),L=$("#oList");$("#oCnt").textContent=`${f.length}곳 / 전체 ${O.length}곳`;
  if(!f.length){L.innerHTML=`<div class="empty">조건에 맞는 기관이 없습니다.</div>`;return}
  L.innerHTML=f.map(({o,last,n})=>{const sg=Object.entries(o.signals||{}).filter(([k,v])=>v.s==="진행"||v.s==="관심");
    return `<button type="button" class="item noDate${o.id===oSel?" on":""}" data-id="${esc(o.id)}"><div style="min-width:0">
      <div class="ttl">${esc(o.name)}</div><div class="sub2">${esc(o.type)} · 미팅 ${n}건${last?` · 최근 ${esc(last.slice(5).replace("-","/"))}`:""}</div>
      <div class="chips">${sg.slice(0,4).map(([k,v])=>`<span class="sg s-${esc(v.s)}" style="font-size:10.5px;padding:0 6px">${esc(SHORT[k]||k)}</span>`).join("")}</div></div></button>`}).join("")}
function renderOMain(){const W=$("#oMain");if(oMode!=="view")return renderOForm();
  const o=O.find(x=>x.id===oSel);if(!o){W.innerHTML=`<div class="empty">왼쪽에서 기관을 선택하세요.</div>`;return}
  const ms=meetingsOf(o).sort((a,b)=>b.date.localeCompare(a.date)),ps=peopleOf(o),sig=Object.entries(o.signals||{}).sort((a,b)=>STATES.indexOf(a[1].s)-STATES.indexOf(b[1].s));
  W.innerHTML=BACK+`<div class="head"><div class="t"><div class="eyebrow">${esc(o.type)}${(o.aliases||[]).length?" · 약칭 "+(o.aliases||[]).map(esc).join(", "):""}</div>
    <h2>${esc(o.name)}</h2><div class="sub2">미팅 ${ms.length}건${ms[0]?` · 최근 ${esc(ms[0].date)}`:""} · 인물 ${ps.length}명</div></div>
    <div class="actions">${ps.length?`<button class="btn" id="oChart" type="button">조직도</button>`:""}${canWrite?`<button class="btn" id="oMeet" type="button">+ 미팅 추가</button>`:""}${canWrite?`<button class="btn" id="oEdit" type="button">수정</button>`:""}</div></div>
  <div class="body">
    ${o.summary?`<div class="sec"><h3>최신 스탠스</h3><p>${esc(o.summary)}</p></div>`:""}
    <div class="kv">${[["선호·제약",o.prefs],["티켓",o.ticket],["심사·의사결정",o.process],["조직·인사",o.hr]].filter(x=>x[1]).map(([k,v])=>`<div><span>${k}</span>${esc(v)}</div>`).join("")}</div>
    ${sig.length?`<div class="sec"><h3>전략 시그널</h3><div class="sigrows">${sig.map(([k,v])=>`<div class="sigrow"><b>${esc(k)}</b><span class="sg s-${esc(v.s)}">${esc(v.s)}</span><span>${esc(v.note)}</span><span class="d">${esc(v.date||"")}</span></div>`).join("")}</div></div>`:""}
    ${ps.length?`<div class="sec"><h3>인물</h3><div class="pgrid">${ps.sort((a,b)=>(b.lastSeen||"").localeCompare(a.lastSeen||"")).slice(0,18).map(p=>`<button type="button" class="pcard" data-pid="${esc(p.id)}"><b>${esc(p.name)}</b> ${esc(p.title||"")}<div class="sub2">${esc([p.dept,p.team].filter(Boolean).join(" · ")||p.note||"")}</div></button>`).join("")}</div>${ps.length>18?`<p class="basis">외 ${ps.length-18}명은 인물·조직도 탭에서 볼 수 있습니다.</p>`:""}</div>`:""}
    <div class="sec"><h3>미팅 이력</h3>${ms.length?`<div class="timeline">${ms.map(m=>{const {secs,take}=parseBody(m.body);const first=(take.length?take.map(t=>"→ "+t):secs.flatMap(s=>s.b)).slice(0,2).join(" / ");
      return `<button type="button" class="tl" data-mid="${esc(m.id)}"><span class="d">${esc(m.date)}</span><span style="min-width:0"><b>${esc(m.dept||m.category||"")}</b> ${esc(parseAtt(m.attendees).map(a=>a.who).join(", "))}${m.truncated?` <span class="chip cut">✂ 잘림</span>`:""}<span class="s">${esc(first)}</span></span></button>`}).join("")}</div>`:`<p class="ro">기록된 미팅이 없습니다.</p>`}</div>
    <p class="basis">${esc(o.basis||"")}${o.updatedAt?` · 최종 수정 ${esc(o.updatedAt.slice(0,10))}`:""}</p>
  </div>`;
  W.querySelectorAll("[data-mid]").forEach(b=>b.onclick=()=>gotoMeeting(b.dataset.mid));
  W.querySelectorAll("[data-pid]").forEach(b=>b.onclick=()=>gotoPerson(b.dataset.pid));
  const c=$("#oChart");if(c)c.onclick=()=>{pOrg=o.name;pSel=null;pMode="view";$("#pOrg").value=o.name;setTab("people");openDetail()};
  const om=$("#oMeet");if(om)om.onclick=()=>{if(!canWrite)return toast("이 링크에서는 수정 권한이 없습니다.");mMode="new";setTab("meetings");openDetail();setTimeout(()=>{$("#fOrg").value=o.name;$("#fType").value=o.type},0)};
  const e=$("#oEdit");if(e)e.onclick=()=>{oMode="edit";renderOMain()}}
function renderOForm(){const o=oMode==="edit"?O.find(x=>x.id===oSel)||{}:{type:"공제회",signals:{}};const sg=o.signals||{};
  $("#oMain").innerHTML=BACK+`<form id="oFrm" novalidate><div class="eyebrow">${oMode==="edit"?"기관 프로필 수정":"새 기관"}</div>
    <div class="row"><label>기관명<input id="gName" value="${esc(o.name)}"></label><label>업권<select id="gType">${TYPES.map(t=>`<option${t===o.type?" selected":""}>${t}</option>`).join("")}</select></label>
      <label>약칭 <span class="hint">쉼표 구분 · 미팅노트 기관명과 매칭</span><input id="gAli" value="${esc((o.aliases||[]).join(", "))}"></label></div>
    <label>최신 스탠스<textarea id="gSum" rows="4">${esc(o.summary)}</textarea></label>
    <label>선호·제약<textarea id="gPref" rows="2">${esc(o.prefs)}</textarea></label>
    <div class="row"><label>티켓<input id="gTicket" value="${esc(o.ticket)}"></label><label>심사·의사결정<input id="gProc" value="${esc(o.process)}"></label></div>
    <label>조직·인사<textarea id="gHr" rows="2">${esc(o.hr)}</textarea></label>
    <div><div class="hint" style="margin-bottom:6px">전략 시그널 — 상태 / 근거 / 기준일</div><div class="sigedit">${STRATS.map((s,i)=>{const v=sg[s]||{};
      return `<div class="r"><b>${esc(s)}</b><select id="gs${i}"><option value="">—</option>${STATES.map(x=>`<option${x===v.s?" selected":""}>${x}</option>`).join("")}</select><input id="gn${i}" value="${esc(v.note)}" placeholder="근거"><input id="gd${i}" type="date" value="${esc(v.date)}"></div>`}).join("")}</div></div>
    <div class="formbar">${oMode==="edit"?(confirmDel?`<span class="confirm">이 기관 프로필을 삭제할까요? 미팅노트는 남습니다. <button class="btn danger" id="dYes" type="button">삭제</button><button class="btn" id="dNo" type="button">취소</button></span>`:`<button class="btn danger" id="dDel" type="button">삭제</button>`):""}
      <span class="grow"></span><button class="btn" id="gCancel" type="button">취소</button><button class="btn primary" type="submit" id="gSave">저장</button></div></form>`;
  $("#gCancel").onclick=()=>{const wasNew=oMode==="new";oMode="view";confirmDel=false;if(wasNew&&isMob())closeDetail();else renderOMain()};
  const dd=$("#dDel");if(dd)dd.onclick=()=>{confirmDel=true;keepForm(renderOForm,"#oFrm")};
  const dy=$("#dYes");if(dy)dy.onclick=async()=>{try{await C.orgs.doc(oSel).delete();oSel=null;oMode="view";confirmDel=false;toast("삭제했습니다.");closeDetail()}catch(e){toast("삭제하지 못했습니다.")}};
  const dn=$("#dNo");if(dn)dn.onclick=()=>{confirmDel=false;keepForm(renderOForm,"#oFrm")};
  $("#oFrm").onsubmit=async e=>{e.preventDefault();const name=$("#gName").value.trim();if(!name){toast("기관명을 입력하세요.");return}
    const signals={};STRATS.forEach((s,i)=>{const st=$("#gs"+i).value;if(st)signals[s]={s:st,note:$("#gn"+i).value.trim(),date:$("#gd"+i).value}});
    const old=oMode==="edit"?O.find(x=>x.id===oSel)||{}:{};
    const data={...old,name,type:$("#gType").value,aliases:$("#gAli").value.split(",").map(x=>x.trim()).filter(Boolean),summary:$("#gSum").value.trim(),prefs:$("#gPref").value.trim(),
      ticket:$("#gTicket").value.trim(),process:$("#gProc").value.trim(),hr:$("#gHr").value.trim(),signals,updatedAt:nowIso()};delete data.id;if(!data.createdAt)data.createdAt=data.updatedAt;
    await write(C.orgs,oMode==="edit"?oSel:null,data,id=>{oSel=id;oMode="view"},"#gSave")}}
$("#oList").addEventListener("click",e=>{const b=e.target.closest(".item");if(!b)return;oSel=b.dataset.id;oMode="view";confirmDel=false;renderOList();renderOMain();if(isMob())openDetail();else if(innerWidth<=900)$("#oMain").scrollIntoView()});
["oq","oType"].forEach(i=>$("#"+i).addEventListener("input",renderOList));
$("#oNew").onclick=()=>{if(!canWrite)return toast("이 링크에서는 수정 권한이 없습니다.");oMode="new";confirmDel=false;renderOMain();openDetail()};

// ═════ 전략 수요판 ═════
function renderDemand(){const s=$("#dStrat").value,t=$("#dType").value,q=$("#dq").value.trim().toLowerCase(),B=$("#dBody");
  const rows=O.filter(o=>Object.keys(o.signals||{}).length&&(!t||o.type===t)&&(!q||[o.name,...(o.aliases||[])].join(" ").toLowerCase().includes(q)));
  if(!rows.length){B.innerHTML=`<div class="empty">조건에 맞는 기관이 없습니다. 기관 탭에서 전략 시그널을 입력하면 여기에 나타납니다.</div>`;return}
  if(!s&&isMob()&&!showMatrix){
    B.innerHTML=`<p class="ro" style="margin:0 0 8px">전략을 누르면 지금 그 전략을 보는 기관이 상태별로 나옵니다.</p><div class="picker">${STRATS.map(k=>{const n={};rows.forEach(o=>{const v=(o.signals||{})[k];if(v)n[v.s]=(n[v.s]||0)+1});
      return `<button type="button" class="pk" data-pick="${esc(k)}"><b>${esc(k)}</b><div class="chips">${["진행","관심","약정"].filter(x=>n[x]).map(x=>`<span class="sg s-${x}" style="font-size:11px;padding:0 6px">${x} ${n[x]}</span>`).join("")||`<span class="ro">시그널 없음</span>`}</div></button>`}).join("")}</div>
      <p style="margin-top:12px"><button class="btn sm" type="button" id="dMx">전체 표로 보기</button></p>`;
    B.querySelectorAll("[data-pick]").forEach(b=>b.onclick=()=>{$("#dStrat").value=b.dataset.pick;renderDemand();scrollTo({top:0})});
    $("#dMx").onclick=()=>{showMatrix=true;renderDemand()};return}
  if(s){const lanes=STATES.map(st=>({st,items:rows.filter(o=>(o.signals[s]||{}).s===st).sort((a,b)=>((b.signals[s].date||"").localeCompare(a.signals[s].date||"")))}));
    B.innerHTML=`<div class="lanes">${lanes.map(l=>`<div class="lane"><h3><span class="sg s-${l.st}">${l.st}</span><span class="ro">${l.items.length}곳 · ${esc(STATE_DESC[l.st])}</span></h3>${l.items.length?l.items.map(o=>{const v=o.signals[s];
      return `<button type="button" class="card" data-org="${esc(o.id)}"><b>${esc(o.name)}</b> <span class="ro">${esc(o.type)}</span><div class="n">${esc(v.note||"")}</div><div class="d">${esc(v.date||"")}${lastMeet(o)?` · 최근 미팅 ${esc(lastMeet(o))}`:""}</div></button>`}).join(""):`<div class="empty" style="padding:14px">없음</div>`}</div>`).join("")}</div>`;
    if(isMob())B.insertAdjacentHTML("afterbegin",`<p style="margin:0 0 10px"><button class="btn sm" type="button" id="dAll">← 전략 목록</button></p>`);
    const da=$("#dAll");if(da)da.onclick=()=>{$("#dStrat").value="";showMatrix=false;renderDemand()};
    B.querySelectorAll("[data-org]").forEach(b=>b.onclick=()=>{oSel=b.dataset.org;oMode="view";setTab("orgs");openDetail()});return}
  const ord=rows.sort((a,b)=>TYPES.indexOf(a.type)-TYPES.indexOf(b.type)||a.name.localeCompare(b.name));
  B.innerHTML=`<div class="mx-wrap"><table class="mx"><thead><tr><th class="org">기관</th>${STRATS.map(k=>`<th><button type="button" data-strat="${esc(k)}" title="${esc(k)}만 보기">${esc(SHORT[k]||k)}</button></th>`).join("")}</tr></thead>
    <tbody>${ord.map(o=>`<tr><td class="org"><button class="link" type="button" data-org="${esc(o.id)}">${esc(o.name)}</button><small>${esc(o.type)}</small></td>${STRATS.map(k=>{const v=(o.signals||{})[k];
      return v?`<td class="s-${esc(v.s)}"><button type="button" data-cell="${esc(o.id)}|${esc(k)}" title="${esc(k)}: ${esc(v.s)} — ${esc(v.note||"")} (${esc(v.date||"")})">${esc(v.s)}</button></td>`:`<td></td>`}).join("")}</tr>`).join("")}</tbody></table></div><div id="cellInfo"></div>`;
  B.querySelectorAll("[data-strat]").forEach(b=>b.onclick=()=>{$("#dStrat").value=b.dataset.strat;renderDemand()});
  B.querySelectorAll("[data-org]").forEach(b=>b.onclick=()=>{oSel=b.dataset.org;oMode="view";setTab("orgs");openDetail()});
  if(isMob()){B.insertAdjacentHTML("afterbegin",`<p style="margin:0 0 10px"><button class="btn sm" type="button" id="dAll">← 전략 목록</button></p>`);$("#dAll").onclick=()=>{showMatrix=false;renderDemand()}}
  B.querySelectorAll("[data-cell]").forEach(b=>b.onclick=()=>{const [id,k]=b.dataset.cell.split("|");const o=O.find(x=>x.id===id),v=o.signals[k];
    $("#cellInfo").innerHTML=`<div class="cellinfo"><b>${esc(o.name)}</b><span>${esc(k)}</span><span class="sg s-${esc(v.s)}">${esc(v.s)}</span><span>${esc(v.note||"")}</span><span class="ro">${esc(v.date||"")}</span><span class="grow"></span><button class="btn sm" type="button" id="ciGo">기관 보기</button></div>`;
    $("#ciGo").onclick=()=>{oSel=id;oMode="view";setTab("orgs");openDetail()}})}
["dStrat","dType","dq"].forEach(i=>$("#"+i).addEventListener("input",renderDemand));

// ═════ 인물·조직도 ═════
function orgSelRefresh(){const el=$("#pOrg"),cur=el.value||pOrg;const cnt={};P.forEach(p=>cnt[p.org]=(cnt[p.org]||0)+1);
  el.innerHTML=`<option value="">기관 전체</option>`+Object.keys(cnt).sort().map(n=>`<option value="${esc(n)}"${n===cur?" selected":""}>${esc(n)} (${cnt[n]})</option>`).join("")}
function pFiltered(){const T=terms($("#pq").value),org=$("#pOrg").value;
  return P.filter(p=>{const o=orgOf(p.org);return (!org||p.org===org)&&(!T.length||hits([p.name,p.org,...(o?[o.name,...(o.aliases||[])]:[]),p.dept,p.team,p.title,p.note].join(" ").toLowerCase(),T))})
    .sort((a,b)=>a.org.localeCompare(b.org,"ko")||(a.dept||"").localeCompare(b.dept||"")||(a.team||"").localeCompare(b.team||"")||a.name.localeCompare(b.name))}
function renderPList(){pOrg=$("#pOrg").value;const f=pFiltered(),L=$("#pList");$("#pCnt").textContent=`${f.length}명 / 전체 ${P.length}명`;
  if(!f.length){L.innerHTML=`<div class="empty">조건에 맞는 인물이 없습니다.</div>`;return}
  const q=$("#pq").value,per={};f.forEach(p=>per[p.org]=(per[p.org]||0)+1);let last="";
  L.innerHTML=f.slice(0,400).map(p=>{const head=p.org!==last?`<div class="mhead">${hl(esc(p.org),q)}<span>${per[p.org]}명</span></div>`:"";last=p.org;
    return head+`<button type="button" class="item noDate${p.id===pSel?" on":""}" data-id="${esc(p.id)}"><div style="min-width:0"><div class="ttl">${hl(esc(p.name),q)} <span class="sub2" style="display:inline">${esc(p.title||"")}</span></div>
    <div class="sub2">${hl(esc([p.dept,p.team].filter(Boolean).join(" · ")||p.note||""),q)}</div></div></button>`}).join("")+(f.length>400?`<div class="empty">상위 400명만 표시 — 검색으로 좁혀 보세요.</div>`:"")}
function chartHtml(org){const ps=P.filter(p=>p.org===org);if(!ps.length)return"";const depts={};
  ps.forEach(p=>{const d=p.dept||"부서 미상",t=p.team||"";(depts[d]=depts[d]||{head:[],teams:{}});if(p.role==="부서장"&&!t)depts[d].head.push(p);else (depts[d].teams[t||"—"]=depts[d].teams[t||"—"]||[]).push(p)});
  const mem=p=>`<button type="button" class="mem${p.role==="팀장"?" lead":""}" data-pid="${esc(p.id)}"><span>${esc(p.name)} ${esc(p.title&&p.title!=="팀장"?p.title:(p.role==="팀장"?"팀장":""))}${p.mobile||p.email?` <span class="has" title="연락처 있음">●</span>`:""}</span><small>${esc(p.ext||"")}</small></button>`;
  return `<div class="chart">${Object.entries(depts).sort((a,b)=>a[0].localeCompare(b[0])).map(([d,v])=>`<div class="dept"><div class="dept-h"><b>${esc(d)}</b>${v.head.map(h=>`<span>부서장 <button class="link" type="button" data-pid="${esc(h.id)}" style="color:#fff">${esc(h.name)}</button>${h.ext?` ☎ ${esc(h.ext)}`:""}</span>`).join("")}</div>
    <div class="teams">${Object.entries(v.teams).sort((a,b)=>a[0].localeCompare(b[0])).map(([t,ms])=>`<div class="team"><h4>${esc(t==="—"?"팀 미상":t)} · ${ms.length}</h4>${ms.sort((a,b)=>(a.role==="팀장"?-1:0)-(b.role==="팀장"?-1:0)||(a.ext||"").localeCompare(b.ext||"")).map(mem).join("")}</div>`).join("")}</div></div>`).join("")}</div>`}
function renderPMain(){const W=$("#pMain");if(pMode!=="view")return renderPForm();const p=P.find(x=>x.id===pSel),org=$("#pOrg").value;let h="";
  if(p){const o=orgOf(p.org),ms=M.filter(m=>(m.attendees||"").includes(p.name)&&(m.org===p.org||(o&&meetingsOf(o).includes(m)))).sort((a,b)=>b.date.localeCompare(a.date));
    h+=BACK+`<div class="head"><div class="t"><div class="eyebrow">${esc(p.org)}${p.dept?" · "+esc(p.dept):""}${p.team?" · "+esc(p.team):""}</div><h2>${esc(p.name)} ${esc(p.title||"")}</h2></div>
      <div class="actions">${canWrite?`<button class="btn" id="pEdit" type="button">수정</button>`:""}</div></div>
      <div class="body"><div class="kv">${[["전화",p.phone||p.ext,p.phone?"tel:":""],["휴대폰",p.mobile,"tel:"],["이메일",p.email,"mailto:"],["최근 언급",p.lastSeen],["출처",p.source]].filter(x=>x[1]).map(([k,v,ln])=>`<div><span>${k}</span>${ln?`<a class="contact" href="${ln}${esc(ln==="tel:"?v.replace(/[^\d+]/g,""):v.trim())}">${esc(v)}</a>`:esc(v)}</div>`).join("")}</div>
      ${p.note?`<div class="sec"><h3>메모</h3><p>${esc(p.note)}</p></div>`:""}
      ${ms.length?`<div class="sec"><h3>참석한 미팅</h3><div class="timeline">${ms.map(m=>`<button type="button" class="tl" data-mid="${esc(m.id)}"><span class="d">${esc(m.date)}</span><span>${esc(m.org)} ${esc(m.dept||"")}</span></button>`).join("")}</div></div>`:""}</div>`}
  const chartOrg=org||(p&&p.org);
  if(chartOrg){const c=chartHtml(chartOrg);if(c)h+=(p?"":BACK)+`<div class="body" style="${p?"border-top:1px solid var(--line)":""}"><div class="sec"><h3>${esc(chartOrg)} 조직도</h3>${c}</div><p class="basis">● 표시는 연락처(휴대폰·이메일)가 있는 인물. 노란 배경은 팀장.</p></div>`}
  W.innerHTML=h||`<div class="empty">기관을 고르면 조직도가, 인물을 고르면 상세가 보입니다.</div>`;
  W.querySelectorAll("[data-pid]").forEach(b=>b.onclick=()=>{pSel=b.dataset.pid;pMode="view";renderPList();renderPMain()});
  W.querySelectorAll("[data-mid]").forEach(b=>b.onclick=()=>gotoMeeting(b.dataset.mid));
  const e=$("#pEdit");if(e)e.onclick=()=>{pMode="edit";confirmDel=false;renderPMain()}}
function renderPForm(){const p=pMode==="edit"?P.find(x=>x.id===pSel)||{}:{org:$("#pOrg").value||""};
  const F=(id,l,v,ph="")=>`<label>${l}<input id="${id}" value="${esc(v)}" placeholder="${esc(ph)}"></label>`;
  $("#pMain").innerHTML=BACK+`<form id="pFrm" novalidate><div class="eyebrow">${pMode==="edit"?"인물 수정":"새 인물"}</div>
    <div class="row">${F("hName","이름",p.name)}${F("hTitle","직급",p.title)}<label>기관<input id="hOrg" list="orgNames2" value="${esc(p.org)}"></label></div>
    <datalist id="orgNames2">${[...new Set([...O.map(o=>o.name),...P.map(x=>x.org)])].map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
    <div class="row">${F("hDept","부서",p.dept)}${F("hTeam","팀",p.team)}<label>역할<select id="hRole">${["","부서장","팀장","팀원"].map(r=>`<option${r===(p.role||"")?" selected":""}>${r}</option>`).join("")}</select></label></div>
    <div class="row">${F("hExt","내선",p.ext)}${F("hMob","휴대폰",p.mobile)}${F("hMail","이메일",p.email)}</div>
    <label>메모 <span class="hint">이력·담당·인사 이동</span><textarea id="hNote" rows="3">${esc(p.note)}</textarea></label>
    <div class="formbar">${pMode==="edit"?(confirmDel?`<span class="confirm">이 인물을 삭제할까요? <button class="btn danger" id="dYes" type="button">삭제</button><button class="btn" id="dNo" type="button">취소</button></span>`:`<button class="btn danger" id="dDel" type="button">삭제</button>`):""}
      <span class="grow"></span><button class="btn" id="hCancel" type="button">취소</button><button class="btn primary" type="submit" id="hSave">저장</button></div></form>`;
  $("#hCancel").onclick=()=>{const wasNew=pMode==="new";pMode="view";confirmDel=false;if(wasNew&&isMob())closeDetail();else renderPMain()};
  const dd=$("#dDel");if(dd)dd.onclick=()=>{confirmDel=true;keepForm(renderPForm,"#pFrm")};
  const dy=$("#dYes");if(dy)dy.onclick=async()=>{try{await C.people.doc(pSel).delete();pSel=null;pMode="view";confirmDel=false;toast("삭제했습니다.");closeDetail()}catch(e){toast("삭제하지 못했습니다.")}};
  const dn=$("#dNo");if(dn)dn.onclick=()=>{confirmDel=false;keepForm(renderPForm,"#pFrm")};
  $("#pFrm").onsubmit=async e=>{e.preventDefault();const name=$("#hName").value.trim(),org=$("#hOrg").value.trim();if(!name||!org){toast("이름과 기관을 입력하세요.");return}
    const old=pMode==="edit"?P.find(x=>x.id===pSel)||{}:{};
    const data={...old,name,org,title:$("#hTitle").value.trim(),dept:$("#hDept").value.trim(),team:$("#hTeam").value.trim(),role:$("#hRole").value,ext:$("#hExt").value.trim(),mobile:$("#hMob").value.trim(),email:$("#hMail").value.trim(),note:$("#hNote").value.trim(),updatedAt:nowIso()};
    delete data.id;if(!data.source)data.source="직접 입력";
    await write(C.people,pMode==="edit"?pSel:null,data,id=>{pSel=id;pMode="view"},"#hSave")}}
$("#pList").addEventListener("click",e=>{const b=e.target.closest(".item");if(!b)return;pSel=b.dataset.id;pMode="view";confirmDel=false;renderPList();renderPMain();if(isMob())openDetail();else if(innerWidth<=900)$("#pMain").scrollIntoView()});
$("#pq").addEventListener("input",renderPList);$("#pOrg").addEventListener("input",()=>{pSel=null;pMode="view";renderPList();renderPMain();if($("#pOrg").value&&isMob())openDetail()});
$("#pNew").onclick=()=>{if(!canWrite)return toast("이 링크에서는 수정 권한이 없습니다.");pMode="new";confirmDel=false;renderPMain();openDetail()};


// ── 공통 저장 ──
async function write(col,id,data,after,btn){if(!col){toast("저장소에 연결되지 않아 저장할 수 없습니다.");return}const b=$(btn);if(b)b.disabled=true;
  try{const ref=id?col.doc(id):col.doc();await ref.set(data);after(ref.id);toast("저장했습니다.");renderTab()}
  catch(err){if(err&&err.code==="invalid_argument"){canWrite=false;toast("이 링크에서는 수정 권한이 없습니다.")}else if(err&&err.code==="quota_exceeded")toast("저장 공간이 가득 찼습니다. 오래된 항목을 정리해 주세요.");else toast("저장하지 못했습니다. 잠시 후 다시 시도하세요.");if(b)b.disabled=false}}
async function copy(t){try{await navigator.clipboard.writeText(t);toast("메모 양식으로 복사했습니다.")}
  catch(e){const ta=document.createElement("textarea");ta.value=t;document.body.appendChild(ta);ta.select();try{document.execCommand("copy");toast("복사했습니다.")}catch(_){toast("복사하지 못했습니다.")}ta.remove()}}

// ── 초기화 ──
const h=(location.hash||"").replace("#","");if(["meetings","orgs","demand","people"].includes(h))setTab(h,false);else renderTab();
fabSync();
addEventListener("hashchange",()=>{const t=(location.hash||"").replace("#","");if(t!==tab&&["meetings","orgs","demand","people"].includes(t))setTab(t,false)});
// 암호화된 DB(data.enc.json)를 풀어서 읽기 전용으로 보여준다. 미팅 추가·수정은 Claude에 미팅노트 텍스트를 주면
// data.enc.json 을 갱신해 다시 배포한다(CLAUDE.md).
["#mNew","#oNew","#pNew"].forEach(s=>$(s).hidden=true);fabSync();
// 화면 모드(라이트·다크) — 처음 값은 index.html 머리말 스크립트가 정한다
function setTheme(t){const r=document.documentElement;r.dataset.theme=t;try{localStorage.setItem("kbnote-theme",t)}catch(e){}
  const lbl=t==="dark"?"라이트 모드로":"다크 모드로",b=$("#themeBtn");b.setAttribute("aria-label",lbl);b.title=lbl;
  const band=getComputedStyle(r).getPropertyValue("--kb-gray").trim();document.querySelectorAll('meta[name="theme-color"]').forEach(m=>m.content=band)}
$("#themeBtn").onclick=()=>setTheme(document.documentElement.dataset.theme==="dark"?"light":"dark");
const FS=[["m","보통"],["l","크게"],["xl","아주 크게"]];
function setFs(v,say){document.documentElement.dataset.fs=v;try{localStorage.setItem("kbnote-fs",v)}catch(e){}
  const n=FS.find(x=>x[0]===v)||FS[0],b=$("#fsBtn"),lbl=`글자 크기: ${n[1]} (누르면 바꿈)`;b.setAttribute("aria-label",lbl);b.title=lbl;if(say)toast(`글자 크기: ${n[1]}`)}
$("#fsBtn").onclick=()=>{const i=FS.findIndex(x=>x[0]===document.documentElement.dataset.fs);setFs(FS[(i+1)%FS.length][0],true);if(tab==="demand")renderDemand()};
setFs(document.documentElement.dataset.fs||"m");
setTheme(document.documentElement.dataset.theme==="dark"?"dark":"light");
function markNew(){let seen="";try{seen=localStorage.getItem("kbnote-seen")||""}catch(e){}
  const latest=M.reduce((a,r)=>[r.createdAt||"",r.updatedAt||"",a].sort().pop(),"");NEWS.clear();UPDS.clear();
  if(seen)M.forEach(r=>{if((r.createdAt||"")>seen)NEWS.add(r.id);else if((r.updatedAt||"")>seen)UPDS.add(r.id)});
  try{if(latest)localStorage.setItem("kbnote-seen",latest)}catch(e){}  // 다음에 열 때는 이번 것 이후만 새 소식
  if(NEWS.size||UPDS.size)toast(`지난번 이후 새 미팅 ${NEWS.size}건${UPDS.size?` · 수정 ${UPDS.size}건`:""}`)}
function load(j){M=(j.meetings||[]).sort((a,b)=>(b.date||"").localeCompare(a.date||""));O=j.orgs||[];P=j.people||[];indexSearch();markNew();
  mSel=M.length?M[0].id:null;oSel=null;pSel=null;
  authorsRefresh();orgSelRefresh();stats();renderTab();
  $("#asof").textContent=j.generatedAt?`${j.generatedAt} 업데이트`:"";ASOF=(j.generatedAt||"").slice(5).replace("-","/");renderMList();document.body.classList.add("ready")}
// 인터넷이 끊기면 알림(서비스워커가 마지막으로 받은 사본을 보여준다)
addEventListener("keydown",e=>{const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||"");
  if(e.key==="/"&&!typing&&$("#gate").hidden){/* 비밀번호 화면이 아닐 때만 */const box={meetings:"#mq",orgs:"#oq",demand:"#dq",people:"#pq"}[tab];if(box){e.preventDefault();$(box).focus();$(box).select()}}
  else if(e.key==="Escape"&&typing&&document.activeElement.type==="search"&&document.activeElement.value){document.activeElement.value="";document.activeElement.dispatchEvent(new Event("input"))}});
addEventListener("offline",()=>toast("오프라인 — 마지막으로 받은 사본을 보여줍니다"));addEventListener("online",()=>toast("다시 연결됐습니다"));
Vault.boot(j=>{load(j);if(!navigator.onLine)setTimeout(()=>toast("오프라인 — 마지막으로 받은 사본입니다"),2600)});
