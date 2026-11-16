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
let cutOnly=false, showMatrix=false, starOnly=false, actOnly=false, actBy="date", oStarOnly=false; const listY={};
const mq=matchMedia("(max-width:760px)"); const isMob=()=>mq.matches;
const BACK=`<div class="backbar"><button class="btn sm" type="button" data-back>← 목록</button></div>`;
function fabSync(){$("#fab").hidden=!(tab==="meetings"&&canWrite&&!$("#p-meetings").classList.contains("detail"))}
function openDetail(){if(!isMob()||!["meetings","orgs","people","reports"].includes(tab))return;const sec=$("#p-"+tab);if(!sec.classList.contains("detail")){listY[tab]=scrollY;sec.classList.add("detail");try{history.pushState({detail:tab},"",location.hash)}catch(e){}}scrollTo({top:0});fabSync()}
// 휴대폰 뒤로가기(안드로이드 버튼·제스처)는 상세를 닫는다. 화면의 "← 목록"으로 닫을 때는 쌓아 둔 기록도 되돌린다.
addEventListener("popstate",()=>{if(GS.after){const f=GS.after;GS.after=null;f();return}   /* 통합 검색 결과를 눌러 닫은 뒤 이동 */
  if(!$("#gs").hidden){gsClose(true);return}const sec=$("#p-"+tab);if(sec&&sec.classList.contains("detail"))closeDetail(true)});
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
const tabY={};
function setTab(t,push=true){if(t!==tab)tabY[tab]=scrollY;tab=t;document.querySelectorAll(".tab,.bnav button").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===t?"true":"false"));
  ["meetings","orgs","demand","people","dash","research","reports"].forEach(k=>$("#p-"+k).hidden=k!==t);document.body.classList.toggle("dashmode",t==="dash");document.body.classList.toggle("rpmode",t==="reports");
  if(push){try{history.replaceState(null,"","#"+t)}catch(e){}}
  renderTab();window.scrollTo({top:tabY[t]||0});fabSync()}   /* 다른 탭에 다녀와도 보던 자리 그대로 */
document.querySelectorAll(".tab,.bnav button").forEach(b=>b.onclick=()=>{if(b.dataset.tab===tab){const sec=$("#p-"+tab);   /* 현재 탭을 다시 누르면: 상세 닫기 → 맨 위로 */
  if(isMob()&&sec&&sec.classList.contains("detail"))closeDetail();else{scrollTo({top:0,behavior:smooth()});const L=sec&&sec.querySelector(".list");if(L)L.scrollTo({top:0,behavior:smooth()})}return}setTab(b.dataset.tab)});
mq.addEventListener?.("change",()=>{if(!isMob())document.querySelectorAll(".split.detail").forEach(s=>s.classList.remove("detail"));if(tab==="demand")renderDemand();fabSync()});
function renderTab(){({meetings:()=>{renderMList();renderMMain()},orgs:()=>{renderOList();renderOMain()},demand:renderDemand,people:()=>{renderPList();renderPMain()},dash:()=>Dash.render(),research:()=>Research.render(),reports:()=>Reports.render()})[tab]()}
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
  ["evergreen","에버그린"],["open-end","오픈엔드","오픈 엔드"],["bdc","비디씨"],["clo","씨엘오"],["sma","에스엠에이"],
  // 카톡 직급 약어(원문엔 TJ·GJ로 적혀 있음). DL=대리는 Direct Lending 과 겹쳐서 넣지 않음
  ["팀장","tj"],["부장","bj"],["차장","cj"],["과장","gj"]];
let ORGKEY=new Map(),HAY=new Map(),hlCache={q:null,re:null};
function indexSearch(){ORGKEY=new Map();O.forEach(o=>[o.name,...(o.aliases||[])].forEach(k=>{if(k)ORGKEY.set(k.toLowerCase(),o)}));HAY=new Map();hlCache={q:null,re:null}}
function expand(t){const alts=new Set([t]);SYN.forEach(g=>{if(g.includes(t))g.forEach(x=>alts.add(x))});
  const o=ORGKEY.get(t);if(o)[o.name,...(o.aliases||[])].forEach(x=>alts.add(x.toLowerCase()));return [...alts]}
function terms(q){let s=(q||"").trim().toLowerCase();if(!s)return [];const T=[];
  SYN.flat().filter(x=>x.includes(" ")).sort((a,b)=>b.length-a.length).forEach(ph=>{if(s.includes(ph)){T.push(expand(ph));s=s.split(ph).join(" ")}});  // 띄어쓴 이름은 한 단어로
  s.split(/\s+/).filter(Boolean).forEach(t=>T.push(expand(t)));return T}
const hits=(hay,T)=>T.every(alts=>alts.some(a=>hay.includes(a)));
const hayO=o=>[o.name,...(o.aliases||[]),o.type,o.summary,o.prefs,o.hr,Object.keys(o.signals||{}).join(" ")].join(" ").toLowerCase();
function hayP(p){const o=orgOf(p.org);return [p.name,p.org,...(o?[o.name,...(o.aliases||[])]:[]),p.dept,p.team,p.title,p.note].join(" ").toLowerCase()}
function hayM(r){let h=HAY.get(r.id);if(h)return h;const o=orgOf(r.org);
  h=[r.org,...(o?[o.name,...(o.aliases||[])]:[]),r.dept,r.attendees,r.body,r.raw?rawText(r):"",r.nextAction,r.kbAttendees,(r.tags||[]).join(" "),(r.assets||[]).join(" "),r.category,r.orgType].join(" ").toLowerCase();HAY.set(r.id,h);return h}

// ═════ 미팅노트 ═════
function authorsRefresh(){const el=$("#mAuthor"),cur=el.value;const set=[...new Set(M.map(m=>(m.kbAttendees||"").split(/[,·\/]/)[0].trim()).filter(Boolean))].sort();
  el.innerHTML=`<option value="">작성자 전체</option>`+set.map(a=>`<option${a===cur?" selected":""}>${esc(a)}</option>`).join("")}
function mFiltered(){const T=terms($("#mq").value),c=$("#mCat").value,t=$("#mType").value,a=$("#mAsset").value,au=$("#mAuthor").value,f=$("#mFlag").value;
  const L=M.filter(r=>(!c||(r.category||"LP")===c)&&(!t||r.orgType===t)&&(!a||(r.assets||[]).includes(a))&&(!au||(r.kbAttendees||"").includes(au))&&(!cutOnly||r.truncated)&&(!newOnly||NEWS.has(r.id)||UPDS.has(r.id))&&
    (!starOnly||STAR.m.has(r.id))&&(!actOnly||!!r.nextAction)&&
    (!f||(f==="원문 잘림"?r.truncated:(r.flags||[]).some(x=>f==="확인"?/확인/.test(x):x.startsWith(f))))&&
    (!T.length||hits(hayM(r),T)));
  if(actOnly&&actBy==="org"){const last={};L.forEach(r=>{if(!last[r.org]||r.date>last[r.org])last[r.org]=r.date});   /* 기관별: 최근 액션이 있는 기관부터 */
    return L.slice().sort((x,y)=>(last[y.org]||"").localeCompare(last[x.org]||"")||x.org.localeCompare(y.org,"ko")||(y.date||"").localeCompare(x.date||""))}
  return L}
// ── 읽기 도우미: 검색어 강조·금액 강조·미리보기 ──
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
function hlRe(q){if(hlCache.q===q)return hlCache.re;const alts=[...new Set(terms(q).flat())].sort((a,b)=>b.length-a.length);
  hlCache={q,re:alts.length?new RegExp(`(<[^>]+>|&(?:amp|lt|gt|quot);)|(${alts.map(a=>reEsc(esc(a))).join("|")})`,"gi"):null};return hlCache.re}
function hl(html,q){const re=q&&hlRe(q);if(!re)return html;  // 이미 이스케이프된 html 의 글자 부분에서만 검색어를 <mark>
  return html.replace(re,(m,keep,hit)=>keep||`<mark>${hit}</mark>`)}
// 본문은 적힌 순서·문장 그대로 보여준다: *소제목 → 소제목, --> 줄 → 제자리에 시사점 표시, 나머지 → 불릿(앞의 -·•만 뗌)
function bodyHtml(r,q){const out=[];let sec=null,ul=null;
  (r.body||"").split(/\r?\n/).forEach(raw=>{const l=raw.trim();if(!l)return;
    if(l.startsWith("*")){sec={h:l.replace(/^\*\s*/,""),parts:[]};out.push(sec);ul=null;return}
    if(!sec){sec={h:"",parts:[]};out.push(sec)}
    if(l.startsWith("-->")){sec.parts.push({take:l.replace(/^-->\s*/,"")});ul=null;return}
    if(!ul){ul={li:[]};sec.parts.push(ul)}ul.li.push(l.replace(/^[-•·]\s*/,""))});
  const cutHere=`<p class="cutline" style="margin-top:6px">✂ 여기서 원문이 잘렸습니다</p>`;
  return out.map(s=>`<div class="sec">${s.h?`<h3>${hl(esc(s.h),q)}</h3>`:""}${s.parts.map(p=>p.take!=null?`<div class="take"><p>→ ${hl(esc(p.take),q)}</p></div>`
    :`<ul>${p.li.map(b=>`<li>${hl(esc(b),q)}${r.truncated&&b===r.truncAt?cutHere:""}</li>`).join("")}</ul>`).join("")}</div>`).join("")}
function firstHit(line,q){const l=line.toLowerCase();let best=null;terms(q).flat().forEach(a=>{const i=l.indexOf(a);if(i>=0&&(!best||i<best.i))best={i,n:a.length}});return best}
function snippet(line,q){const h=firstHit(line,q);if(!h)return esc(line);
  const a=Math.max(0,h.i-24),b=Math.min(line.length,h.i+h.n+60);return (a?"…":"")+hl(esc(line.slice(a,b)),q)+(b<line.length?"…":"")}
// 원문(raw) 줄: 카톡 머리(날짜, 이름 : )를 떼고, 첫 메시지의 첫 줄(미팅 머리: 날짜·기관·참석자)은 목록 제목과 겹치므로 뺀다
const KHEAD=/^\d{4}년 \d{1,2}월 \d{1,2}일 (오전|오후) \d{1,2}:\d{2}, (.+?) : /;
// 원문 탭: 카톡 내보내기 머리(날짜·시각·"이름 : ")는 떼고 올린 사람 이름만 보여준다(사용자 요청). 저장된 raw 는 그대로.
// 카톡 표시 이름("[KB] 홍길동 과장님") → DB 표기("홍길동 과장")는 미팅 기록의 source(… 게시 · 게시자)에서 맞춘다(코드에 이름을 두지 않음)
let POSTER=new Map();
function indexPosters(){POSTER=new Map();const cnt={};
  M.forEach(r=>{const h=KHEAD.exec(r.raw||""),s=/게시 · ([^·(]+?)\s*(?:\(|·|$)/.exec(r.source||"");if(h&&s){const k=h[2]+"\u0000"+s[1].trim();cnt[k]=(cnt[k]||0)+1}});
  Object.entries(cnt).sort((a,b)=>b[1]-a[1]).forEach(([k])=>{const [raw,name]=k.split("\u0000");if(!POSTER.has(raw))POSTER.set(raw,name)})}
const posterName=n=>POSTER.get(n)||n.replace(/^\[[^\]]*\]\s*/,"").replace(/님$/,"").trim();
function rawParts(r){const parts=[];let cur=null;   // [{who, text}] — 같은 사람이 이어 올린 메시지는 한 덩어리로
  (r.raw||"").split("\n").forEach(l=>{const h=KHEAD.exec(l);
    if(h){const who=posterName(h[2]),t=l.slice(h[0].length);if(cur&&cur.who===who)cur.lines.push("",t);else{cur={who,lines:[t]};parts.push(cur)}}
    else{if(!cur){cur={who:"",lines:[]};parts.push(cur)}cur.lines.push(l)}});
  return parts.map(p=>({who:p.who,text:p.lines.join("\n").replace(/\n{3,}/g,"\n\n").trim()})).filter(p=>p.text)}
const rawText=r=>rawParts(r).map(p=>(p.who?p.who+"\n":"")+p.text).join("\n\n");
const rawHtml=(r,q)=>rawParts(r).map(p=>`<div class="rawpart">${p.who?`<div class="rawwho">${esc(p.who)}</div>`:""}<div class="rawtext">${hl(esc(p.text),q)}</div></div>`).join("");
function rawLines(r){const L=(r.raw||"").split("\n").map(l=>l.replace(KHEAD,"").trim()).filter(l=>l&&!/^-{3,}/.test(l));return L.length>1?L.slice(1):L}
// 미리보기는 요약정리(body) 기준. 검색어가 원문에만 있으면 원문 줄에서 찾아 보여준다
function preview(r,q){const {secs,take}=parseBody(r.body),lines=[...secs.flatMap(s=>s.b),...(q?rawLines(r).map(l=>l.replace(/^[-•·*]\s*/,"")):[])];
  if(q){const hit=[...take,...lines,r.nextAction||"",...parseAtt(r.attendees).map(a=>a.who+" "+a.note),(r.tags||[]).join(" ")].find(l=>firstHit(l,q));if(hit)return snippet(hit,q)}
  return take[0]?`<span class="arrow">→</span> ${esc(take[0])}`:esc(lines[0]||"")}
let seenAt="",newOnly=false,ASOF="";const NEWS=new Set(),UPDS=new Set();
const CAT_CLS={"GP":"gp","시장정보":"intel","내부":"inner"};
function renderMList(){const f=mFiltered(),L=$("#mList"),q=$("#mq").value.trim().toLowerCase();
  $("#mCnt").textContent=`${f.length}건 / 전체 ${M.length}건${ASOF&&!actOnly?` · ${ASOF} 업데이트`:""}`;
  const cat=$("#mCat").value;document.querySelectorAll("#mQuick [data-cat]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.cat===cat?"true":"false"));
  const nb=$("#mNewOnly");nb.hidden=!NEWS.size&&!UPDS.size;nb.querySelector("span").textContent=NEWS.size+UPDS.size;nb.setAttribute("aria-pressed",newOnly?"true":"false");
  const sb=$("#mStarOnly"),nStar=M.filter(r=>STAR.m.has(r.id)).length+O.filter(o=>STAR.o.has(o.id)).length;sb.querySelector("span").textContent=nStar||"";sb.setAttribute("aria-pressed",starOnly?"true":"false");
  const ab=$("#mActOnly");ab.querySelector("span").textContent=M.filter(r=>r.nextAction).length;ab.setAttribute("aria-pressed",actOnly?"true":"false");
  const ag=$("#mActBy");ag.hidden=!actOnly;ag.querySelectorAll("[data-by]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.by===actBy)));
  const nf=["mType","mAsset","mAuthor","mFlag"].filter(i=>$("#"+i).value).length;$("#mFt").textContent=nf?`필터 ${nf}`:"필터";$("#mFt").setAttribute("aria-pressed",nf?"true":"false");
  jumpFill(null);
  const top=starOnly?starOrgsHtml():"";
  if(!M.length){L.innerHTML=`<div class="empty">아직 미팅노트가 없습니다.</div>`;return}
  if(!f.length){L.innerHTML=top+`<div class="empty">${starOnly&&!M.some(r=>STAR.m.has(r.id))?"★ 표시한 미팅이 없습니다. 미팅을 열고 ‘☆ 관심’을 누르면 여기에 모입니다(이 기기에만 저장).":actOnly&&!q?"다음 액션이 적힌 미팅이 없습니다.":"조건에 맞는 미팅이 없습니다. 검색어나 필터를 바꿔 보세요."}</div>`;wireStarOrgs(L);return}
  const byOrg=actOnly&&actBy==="org",gk=r=>byOrg?r.org:(r.date||"").slice(0,7);   /* 다음 액션 · 기관별이면 기관으로 묶는다 */
  const per={};f.forEach(r=>{const k=gk(r);per[k]=(per[k]||0)+1});let last=null;
  L.innerHTML=top+f.map(r=>{const {y,m,d}=md(r.date),k=gk(r),att=parseAtt(r.attendees).map(a=>a.who).join(", "),cat=r.category||"LP";
    const head=k!==last?(byOrg?`<div class="mhead">${hl(esc(k),q)}<span>${per[k]}건</span></div>`:`<div class="mhead" data-ym="${k}">${y}년 ${m}월<span>${per[k]}건</span></div>`):"";last=k;
    const badge=NEWS.has(r.id)?`<span class="badge new">NEW</span>`:UPDS.has(r.id)?`<span class="badge upd">수정</span>`:"";
    const pv=actOnly?`<span class="nlab">다음 액션</span> ${hl(esc(r.nextAction),q)}`:preview(r,q);
    return head+`<button type="button" class="item${r.id===mSel?" on":""}" data-id="${esc(r.id)}"><div class="date"><b>${d}</b>${byOrg?`${m}월`:wk(r.date)}</div>
      <div style="min-width:0"><div class="ttl">${STAR.m.has(r.id)?`<span class="smark" title="관심">★</span>`:""}${cat!=="LP"?`<span class="cattag ${CAT_CLS[cat]||""}">${esc(cat)}</span>`:""}${hl(esc(r.org),q)}${r.dept?` <span class="mdept">${hl(esc(r.dept),q)}</span>`:""}${badge}</div>
      <div class="sub2">${hl(esc(att||r.kbAttendees||""),q)}</div>
      ${pv?`<div class="pv${actOnly?" act":""}">${pv}</div>`:""}
      <div class="chips">${(r.assets||[]).slice(0,3).map(t=>`<span class="chip asset">${esc(SHORT[t]||t)}</span>`).join("")}${r.truncated?`<span class="chip cut">✂ 잘림</span>`:""}${(r.flags||[]).some(x=>x.startsWith("내부용"))?`<span class="chip flag">내부용</span>`:""}${!actOnly&&r.nextAction?`<span class="chip nxa">다음 액션</span>`:""}</div></div></button>`}).join("");
  wireStarOrgs(L);jumpFill(byOrg?null:per)}
// ★ 모아보기: 관심 기관을 목록 맨 위에 카드로(누르면 기관 상세), 그 아래 관심 미팅
function starOrgsHtml(){const os=O.filter(o=>STAR.o.has(o.id)).map(o=>({o,last:lastMeet(o),n:meetingsOf(o).length})).sort((a,b)=>(b.last||"").localeCompare(a.last||"")||a.o.name.localeCompare(b.o.name,"ko"));
  return `<div class="mhead">관심 기관<span>${os.length}곳</span></div>`+(os.length?`<div class="starorgs">${os.map(({o,last,n})=>`<button type="button" class="so" data-soid="${esc(o.id)}"><b>★ ${esc(o.name)}</b><small>${esc(o.type)} · 미팅 ${n}건${last?` · 최근 ${esc(last.slice(5).replace("-","/"))}`:""}</small></button>`).join("")}</div>`
    :`<div class="empty" style="padding:14px 18px">★ 표시한 기관이 없습니다. 기관 상세에서 ‘☆ 관심’을 누르세요.</div>`)+`<div class="mhead">관심 미팅<span>${M.filter(r=>STAR.m.has(r.id)).length}건</span></div>`}
function wireStarOrgs(L){L.querySelectorAll("[data-soid]").forEach(b=>b.onclick=e=>{e.stopPropagation();oSel=b.dataset.soid;oMode="view";setTab("orgs");openDetail()})}
// 월 이동: 목록이 길어(휴대폰 230건 ≈ 화면 35장) 달을 골라 바로 간다. 두 달 이상일 때만 보인다
function jumpFill(per){const J=$("#mJump");if(!J)return;const ks=per?Object.keys(per).sort().reverse():[];J.hidden=ks.length<2;
  J.innerHTML=`<option value="">월 이동</option>`+ks.map(k=>`<option value="${k}">${+k.slice(0,4)}년 ${+k.slice(5)}월 · ${per[k]}건</option>`).join("")}
const stickTop=()=>{const b=document.querySelector(".band");return b?Math.round(b.offsetHeight+(parseFloat(getComputedStyle(b).top)||0)):0};   /* 고정된 헤더의 아래 끝 */
const smooth=()=>matchMedia("(prefers-reduced-motion:reduce)").matches?"auto":"smooth";
function ago(d){const n=Math.round((Date.parse(today())-Date.parse(d))/864e5);return n<=0?"오늘":n===1?"어제":n<7?`${n}일 전`:n<35?`${Math.round(n/7)}주 전`:n<365?`${Math.round(n/30)}개월 전`:""}
function renderMMain(){const W=$("#mMain");if(mMode!=="view")return renderMForm();
  const r=M.find(x=>x.id===mSel);if(!r){const f=!isMob()&&$("#mList .item");if(f&&f.dataset.id!==mSel){mSel=f.dataset.id;renderMList();return renderMMain()}   /* PC: 빈 칸 대신 맨 위(최근) 미팅 */
    W.innerHTML=`<div class="empty">왼쪽에서 미팅을 선택하세요.</div>`;return}
  const {y,m,d}=md(r.date),att=parseAtt(r.attendees),{secs}=parseBody(r.body),o=orgOf(r.org),q=$("#mq").value.trim().toLowerCase();
  const inner=(r.flags||[]).some(x=>x.startsWith("내부용")),checks=(r.flags||[]).filter(x=>!x.startsWith("내부용")&&x!=="원문 잘림");
  const list=mFiltered(),i=list.findIndex(x=>x.id===r.id),newer=i>0?list[i-1]:null,older=i>=0&&i<list.length-1?list[i+1]:null;
  const cut=r.truncated?`<div class="trunc"><div style="flex:1;min-width:0"><b>✂ 원문 잘림 — 보완 필요</b><div>카톡 내보내기에서 긴 메시지 뒷부분이 잘렸습니다. 카톡 '전체보기'에서 확인한 내용을 Claude에 주면 보완합니다.</div>${r.truncAt?`<q>${esc(r.truncAt)}</q>`:""}</div></div>`:"";
  const nav=(x,dir)=>x?`<button type="button" class="pn-b ${dir}" data-nav="${esc(x.id)}"><small>${dir==="newer"?"← 더 최근":"더 이전 →"}</small><b>${esc(x.org)}</b><span>${esc(x.date)}</span></button>`:`<span></span>`;
  W.innerHTML=`<div class="backbar"><button class="btn sm" type="button" data-back>← 목록</button><span class="grow"></span>${starBtn("m",r.id,"btn sm")}<button class="btn sm" id="mCopyM" type="button">메모 복사</button></div>
  <div class="head"><div class="t">
    <div class="eyebrow">${y}.${String(m).padStart(2,"0")}.${String(d).padStart(2,"0")} (${wk(r.date)})${ago(r.date)?` · ${ago(r.date)}`:""} · ${esc(r.category||"LP")}${r.orgType?" · "+esc(r.orgType):""}</div>
    <h2>${o?`<button class="link" id="mOrg" type="button">${hl(esc(r.org),q)}</button>`:hl(esc(r.org),q)}${r.dept?` <span class="h-dept">${hl(esc(r.dept),q)}</span>`:""}</h2>
    <div class="chips">${inner?`<span class="chip flag">내부용 · 외부 공유 금지</span>`:""}${(r.assets||[]).map(t=>`<span class="chip asset">${esc(t)}</span>`).join("")}</div></div>
    <div class="actions">${starBtn("m",r.id)}<button class="btn" id="mCopy" type="button">메모 복사</button>${canWrite?`<button class="btn" id="mEdit" type="button">수정</button>`:""}</div></div>
  <div class="body">
    ${r.raw?`<div class="seg" role="group" aria-label="보기"><button type="button" data-view="memo" aria-pressed="true">요약정리</button><button type="button" data-view="raw" aria-pressed="false">원문</button></div>`:""}
    ${r.nextAction?`<div class="next"><span>다음 액션</span>${hl(esc(r.nextAction),q)}</div>`:""}
    ${att.length?`<div class="attendees">${att.map(a=>`<div class="att"><b>${hl(esc(a.who),q)}</b><div>${a.note?hl(esc(a.note),q):"<span class='ro'>소개 없음</span>"}</div></div>`).join("")}</div>`:""}
    <div class="memo">${bodyHtml(r,q)}</div>
    ${r.raw?`<div class="raw" hidden>${r.rawShared?`<p class="legacy">여러 미팅을 한 메시지로 올린 원문입니다.</p>`:""}${rawHtml(r,q)}</div>`:""}
    ${r.truncated&&!secs.some(s=>s.b.includes(r.truncAt))?`<p class="cutline">✂ 원문이 잘린 노트입니다</p>`:""}
    ${cut}
    ${checks.length?`<div class="warnbox">${checks.map(esc).join(" · ")}</div>`:""}
    <div class="meta"><div><span>작성·당사 참석</span>${esc(r.kbAttendees)||"—"}</div><div><span>출처</span>${esc(r.source)||"직접 입력"}</div><div><span>최종 수정</span>${r.updatedAt?esc(r.updatedAt.slice(0,10)):"—"}</div>
      ${(r.tags||[]).length?`<div class="tags"><span>태그</span>${(r.tags||[]).map(t=>`<button type="button" class="chip tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join("")}</div>`:""}</div>
    ${newer||older?`<div class="pn">${nav(newer,"newer")}${nav(older,"older")}</div>`:""}
  </div>`;
  $("#mCopy").onclick=$("#mCopyM").onclick=()=>{const rv=W.querySelector(".raw");copy(rv&&!rv.hidden?rawText(r):memoText(r))};
  W.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{const raw=b.dataset.view==="raw";W.querySelector(".memo").hidden=raw;W.querySelector(".raw").hidden=!raw;
    W.querySelectorAll("[data-view]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)))});const e=$("#mEdit");if(e)e.onclick=()=>{mMode="edit";confirmDel=false;renderMMain()};
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
$("#mStarOnly").onclick=()=>{starOnly=!starOnly;renderMList();if(!isMob())renderMMain()};
$("#mActOnly").onclick=()=>{actOnly=!actOnly;renderMList();if(!isMob())renderMMain()};
document.querySelectorAll("#mActBy [data-by]").forEach(b=>b.onclick=()=>{actBy=b.dataset.by;renderMList();if(!isMob())renderMMain()});
$("#mFt").onclick=()=>$("#mFilters").classList.toggle("open");
$("#mNew").onclick=$("#fab").onclick=()=>{if(!canWrite)return toast("이 링크에서는 수정 권한이 없습니다.");mMode="new";confirmDel=false;renderMMain();openDetail()};

// ═════ 기관 ═════
function lastMeet(o){const ms=meetingsOf(o);return ms.length?ms.reduce((a,b)=>a.date>b.date?a:b).date:""}
function oFiltered(){const T=terms($("#oq").value),t=$("#oType").value;
  return O.filter(o=>(!t||o.type===t)&&(!oStarOnly||STAR.o.has(o.id))&&(!T.length||hits(hayO(o),T)))
   .map(o=>({o,last:lastMeet(o),n:meetingsOf(o).length})).sort((a,b)=>(b.last||"").localeCompare(a.last||"")||a.o.name.localeCompare(b.o.name))}
function renderOList(){const f=oFiltered(),L=$("#oList");$("#oCnt").textContent=`${f.length}곳 / 전체 ${O.length}곳`;
  const sb=$("#oStarOnly"),ns=O.filter(o=>STAR.o.has(o.id)).length;sb.querySelector("span").textContent=ns||"";sb.setAttribute("aria-pressed",oStarOnly?"true":"false");
  if(!f.length){L.innerHTML=`<div class="empty">${oStarOnly&&!ns?"★ 표시한 기관이 없습니다. 기관 상세에서 ‘☆ 관심’을 누르세요(이 기기에만 저장).":"조건에 맞는 기관이 없습니다."}</div>`;return}
  L.innerHTML=f.map(({o,last,n})=>{const sg=Object.entries(o.signals||{}).filter(([k,v])=>v.s==="진행"||v.s==="관심");
    return `<button type="button" class="item noDate${o.id===oSel?" on":""}" data-id="${esc(o.id)}"><div style="min-width:0">
      <div class="ttl">${STAR.o.has(o.id)?`<span class="smark" title="관심">★</span>`:""}${esc(o.name)}</div><div class="sub2">${esc(o.type)} · 미팅 ${n}건${last?` · 최근 ${esc(last.slice(5).replace("-","/"))}`:""}</div>
      <div class="chips">${sg.slice(0,4).map(([k,v])=>`<span class="sg s-${esc(v.s)}" style="font-size:10.5px;padding:0 6px">${esc(SHORT[k]||k)}</span>`).join("")}</div></div></button>`}).join("")}
function renderOMain(){const W=$("#oMain");if(oMode!=="view")return renderOForm();
  const o=O.find(x=>x.id===oSel);if(!o){const f=!isMob()&&$("#oList .item");if(f&&f.dataset.id!==oSel){oSel=f.dataset.id;renderOList();return renderOMain()}
    W.innerHTML=`<div class="empty">왼쪽에서 기관을 선택하세요.</div>`;return}
  const ms=meetingsOf(o).sort((a,b)=>b.date.localeCompare(a.date)),ps=peopleOf(o),sig=Object.entries(o.signals||{}).sort((a,b)=>STATES.indexOf(a[1].s)-STATES.indexOf(b[1].s));
  W.innerHTML=BACK+`<div class="head"><div class="t"><div class="eyebrow">${esc(o.type)}${(o.aliases||[]).length?" · 약칭 "+(o.aliases||[]).map(esc).join(", "):""}</div>
    <h2>${esc(o.name)}</h2><div class="sub2">미팅 ${ms.length}건${ms[0]?` · 최근 ${esc(ms[0].date)}`:""} · 인물 ${ps.length}명</div></div>
    <div class="actions">${starBtn("o",o.id)}${ps.length?`<button class="btn" id="oChart" type="button">조직도</button>`:""}${canWrite?`<button class="btn" id="oMeet" type="button">+ 미팅 추가</button>`:""}${canWrite?`<button class="btn" id="oEdit" type="button">수정</button>`:""}</div></div>
  <div class="body">
    ${o.summary?`<div class="sec"><h3>최신 스탠스</h3><p>${esc(o.summary)}</p></div>`:""}
    <div class="kv">${[["선호·제약",o.prefs],["티켓",o.ticket],["심사·의사결정",o.process],["조직·인사",o.hr]].filter(x=>x[1]).map(([k,v])=>`<div><span>${k}</span>${esc(v)}</div>`).join("")}</div>
    ${sig.length?`<div class="sec"><h3>전략 시그널</h3><div class="sigrows">${sig.map(([k,v])=>`<div class="sigrow"><b>${esc(k)}</b><span class="sg s-${esc(v.s)}">${esc(v.s)}</span><span>${esc(v.note)}</span><span class="d">${esc(v.date||"")}</span></div>`).join("")}</div></div>`:""}
    <div id="oDash" class="sec dzorg" hidden></div>
    ${ps.length?`<div class="sec"><h3>인물</h3><div class="pgrid">${ps.sort((a,b)=>(b.lastSeen||"").localeCompare(a.lastSeen||"")).slice(0,18).map(p=>`<button type="button" class="pcard" data-pid="${esc(p.id)}"><b>${esc(p.name)}</b> ${esc(p.title||"")}<div class="sub2">${esc([p.dept,p.team].filter(Boolean).join(" · ")||p.note||"")}</div></button>`).join("")}</div>${ps.length>18?`<p class="basis">외 ${ps.length-18}명은 인물·조직도 탭에서 볼 수 있습니다.</p>`:""}</div>`:""}
    <div class="sec"><h3>미팅 이력</h3>${ms.length?`<div class="timeline">${ms.map(m=>{const {secs,take}=parseBody(m.body);const first=(take.length?take.map(t=>"→ "+t):secs.flatMap(s=>s.b)).slice(0,2).join(" / ");
      return `<button type="button" class="tl" data-mid="${esc(m.id)}"><span class="d">${esc(m.date)}</span><span style="min-width:0"><b>${esc(m.dept||m.category||"")}</b> ${esc(parseAtt(m.attendees).map(a=>a.who).join(", "))}${m.truncated?` <span class="chip cut">✂ 잘림</span>`:""}<span class="s">${esc(first)}</span>${m.nextAction?`<span class="s nx"><b>다음 액션</b> ${esc(m.nextAction)}</span>`:""}</span></button>`}).join("")}</div>`:`<p class="ro">기록된 미팅이 없습니다.</p>`}</div>
    <p class="basis">${esc(o.basis||"")}${o.updatedAt?` · 최종 수정 ${esc(o.updatedAt.slice(0,10))}`:""}</p>
  </div>`;
  W.querySelectorAll("[data-mid]").forEach(b=>b.onclick=()=>gotoMeeting(b.dataset.mid));
  W.querySelectorAll("[data-pid]").forEach(b=>b.onclick=()=>gotoPerson(b.dataset.pid));
  const c=$("#oChart");if(c)c.onclick=()=>{pOrg=o.name;pSel=null;pMode="view";$("#pOrg").value=o.name;setTab("people");openDetail()};
  const om=$("#oMeet");if(om)om.onclick=()=>{if(!canWrite)return toast("이 링크에서는 수정 권한이 없습니다.");mMode="new";setTab("meetings");openDetail();setTimeout(()=>{$("#fOrg").value=o.name;$("#fType").value=o.type},0)};
  const e=$("#oEdit");if(e)e.onclick=()=>{oMode="edit";renderOMain()};
  fillODash(o)}
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
$("#oStarOnly").onclick=()=>{oStarOnly=!oStarOnly;renderOList();if(!isMob())renderOMain()};
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
  if(!h&&!isMob()){const f=$("#pList .item");if(f&&f.dataset.id!==pSel){pSel=f.dataset.id;renderPList();return renderPMain()}}
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


// ═════ 관심(★) — 미팅·기관에 표시해 모아 본다. 이 기기에만 저장(localStorage kbnote-star, 데이터 파일은 그대로) ═════
const STAR={m:new Set(),o:new Set()};
try{const v=JSON.parse(localStorage.getItem("kbnote-star")||"{}");(v.m||[]).forEach(x=>STAR.m.add(x));(v.o||[]).forEach(x=>STAR.o.add(x))}catch(e){}
function starSave(){try{localStorage.setItem("kbnote-star",JSON.stringify({m:[...STAR.m],o:[...STAR.o]}))}catch(e){}}
const starBtn=(k,id,cls="btn")=>{const on=STAR[k].has(id);return `<button type="button" class="${cls} starbtn" data-sk="${k}" data-sid="${esc(id)}" aria-pressed="${on}" title="관심 표시 — 이 기기에만 저장"><span aria-hidden="true">${on?"★":"☆"}</span> 관심</button>`};
document.addEventListener("click",e=>{const b=e.target.closest("[data-sk]");if(!b)return;const k=b.dataset.sk,id=b.dataset.sid,S=STAR[k],on=!S.has(id);
  on?S.add(id):S.delete(id);starSave();toast(on?"★ 관심에 넣었습니다":"관심에서 뺐습니다");
  document.querySelectorAll(`[data-sk="${k}"][data-sid="${CSS.escape(id)}"]`).forEach(x=>{x.setAttribute("aria-pressed",String(on));x.querySelector("span").textContent=on?"★":"☆"});
  const L=k==="m"?$("#mList"):$("#oList"),y=L.scrollTop;if(k==="m")renderMList();else renderOList();L.scrollTop=y;if(k==="o"&&tab==="meetings")renderMList()});

// ═════ 기관 ↔ 대시보드 약정·수수료 ═════
// 대시보드 '기관별 약정(2010~현재)'(표 id og: 기관마다 묶음)과 '약정내역(2022~현재)'(표 id cm: 연도별 수수료)를 기관 상세에 붙인다.
// 대시보드 표기(KTCU, KPOST(보험과) …)는 DB 기관의 이름·약칭과 맞춘다(괄호 밖·안도 각각). 운용사(GP) 기관은 펀드의 운용사로 맞춘다.
// 표기가 달라 안 붙는 기관은 DB 기관의 약칭(aliases)에 대시보드 표기를 더한다 — 공개 코드에 기관명을 두지 않는다.
const nk=s=>String(s??"").toLowerCase().replace(/\s+/g,"");
function nameKeys(s){s=String(s??"").trim();const k=[nk(s)],m=/^(.+?)\s*\(([^)]+)\)$/.exec(s);if(m)k.push(nk(m[1]),nk(m[2]));return k.filter(Boolean)}
function orgKeys(o){const k=new Set();[o.name,...(o.aliases||[])].forEach(n=>nameKeys(n).forEach(x=>k.add(x)));return k}
const n2=(v,d=2)=>Number(v||0).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
let DZ=null;
function dzTable(D,id){let f=null;D.sheets.forEach(s=>Dash.walk(s.view||[],b=>{if(!f&&b.t==="table"&&b.id===id)f={s,b}}));return f}
function dzIndex(D){const og=dzTable(D,"og"),cm=dzTable(D,"cm"),com=[],fee=[],fy=[];
  if(og)(og.b.secs||[]).forEach(sec=>{const lbl=String(sec.h||"").replace(/^\d+\.\s*/,"");sec.rows.forEach(r=>com.push({lbl,k:nameKeys(lbl),c:r.c}))});
  if(cm){cm.b.cols.forEach(c=>{const m=/^f(\d{4})$/.exec(c.k);if(m)fy.push(m[1])});(cm.b.rows||[]).forEach(r=>fee.push({lbl:String(r.c.lp??""),k:nameKeys(r.c.lp),c:r.c}))}
  return {asof:D.asof,usd:(D.fx||{}).usd||0,com,fee,fy:fy.sort().reverse(),og:og&&og.s.name,cm:cm&&cm.s.name}}
function dzOf(o){if(!DZ)return null;const K=orgKeys(o),gp=o.type==="GP",mine=x=>gp?K.has(nk(x.c.gp)):x.k.some(k=>K.has(k));
  const com=DZ.com.filter(mine),fee=DZ.fee.filter(mine);if(!com.length&&!fee.length)return null;
  const used=new Set(),same=(x,y)=>nk(x.c.ab)===nk(y.c.ab)&&nk(x.c.gp)===nk(y.c.gp);
  const rows=com.map(x=>{let f=fee.find(y=>!used.has(y)&&same(x,y)&&y.k.some(k=>x.k.includes(k)));if(!f&&!gp)f=fee.find(y=>!used.has(y)&&same(x,y));if(f)used.add(f);return {x,f}});
  fee.filter(y=>!used.has(y)).forEach(y=>rows.push({x:null,f:y}));   // 약정 목록에는 아직 없는 건(진행·청구예정 등)
  const yr=r=>String((r.x&&r.x.c.yr)||(r.f&&String(r.f.c.ym||"").slice(0,4))||""),us=r=>(r.x?r.x.c.us:r.f&&(DZ.fy.map(y=>r.f.c["u"+y]).find(v=>v)))||0;
  rows.sort((a,b)=>yr(b).localeCompare(yr(a))||us(b)-us(a));
  const yrs=com.map(x=>String(x.c.yr||"")).filter(Boolean).sort(),fees=DZ.fy.map(y=>({y,v:fee.reduce((a,r)=>a+(+r.c["f"+y]||0),0)})).filter(z=>z.v);
  const lbls={};[...com,...fee].forEach(x=>{const l=gp?x.c.gp:x.lbl;if(l)lbls[l]=(lbls[l]||0)+1});
  return {gp,rows,yr,us,n:com.length,usd:com.reduce((a,x)=>a+(+x.c.us||0),0),y0:yrs[0],y1:yrs[yrs.length-1],fees,lbls:Object.keys(lbls).sort((a,b)=>lbls[b]-lbls[a])}}
const eok=v=>DZ&&DZ.usd&&v?`≈ ${n2(v*DZ.usd/1e8)}억`:"";
const amtTxt=(cy,am)=>am==null||am===""?"":cy==="KRW"?`${n2(am/1e8)}억원`:`${esc(cy||"")} ${n2(am/1e6)}M`;
function fillODash(o){const el=$("#oDash");if(!el)return;
  if(!DZ){el.hidden=true;Dash.data().then(D=>{if(!D)return;if(!DZ)DZ=dzIndex(D);const cur=O.find(x=>x.id===oSel);if(cur&&cur.id===o.id&&tab==="orgs"&&oMode==="view")fillODash(cur)});return}
  const z=dzOf(o);if(!z){el.hidden=true;el.innerHTML="";return}
  const SHOW=6,row=r=>{const c=r.x?r.x.c:r.f.c,f=r.f?r.f.c:null;
    const fs=f?DZ.fy.filter(y=>+f["f"+y]).map(y=>`${y} USD ${n2(f["f"+y])}${f["r"+y]?` (${n2(f["r"+y]*100)}%)`:""}`):[];
    const who=z.gp?(r.x?r.x.lbl:r.f.lbl):c.gp,amt=amtTxt(c.cy,c.am),u=r.x?c.us:z.us(r);
    return `<div class="dzr"><span class="d">${esc(z.yr(r)||"—")}</span><span class="m"><b>${esc([who,c.ab].filter(Boolean).join(" · "))}</b>
      <small>${esc([c.ac,c.is,c.st].filter(Boolean).join(" · "))}${!r.x?" · 약정 목록 밖(수수료 표)":""}${!z.gp&&r.x&&z.lbls.length>1?` · 표기 ${esc(r.x.lbl)}`:""}</small>${fs.length?`<small class="fee">수수료 ${esc(fs.join(" · "))}</small>`:""}</span>
      <span class="a">${amt}${u?`<small>${eok(u)}</small>`:""}</span></div>`};
  const last=z.fees[0];
  el.innerHTML=`<h3>${z.gp?"당사 경유 약정 (이 운용사 펀드)":"약정·수수료"} <span class="h-sub">대시보드 · 기준일 ${esc(DZ.asof||"")}</span></h3>
    <div class="dzk"><div><span>누적 약정</span><b>${z.n}건</b><small>${z.y0?esc(z.y0===z.y1?z.y0:z.y0+"~"+z.y1):"—"}</small></div>
      <div><span>약정 합계 (USD 환산)</span><b>USD ${n2(z.usd/1e6)}M</b><small>${eok(z.usd)}</small></div>
      ${last?`<div><span>수수료 ${esc(last.y)} (발생)</span><b>USD ${n2(last.v)}</b><small>${eok(last.v)}</small></div>`:""}</div>
    ${z.fees.length>1?`<div class="dzfy"><span>연도별 수수료</span>${z.fees.map(x=>`<span class="yy"><b>${esc(x.y)}</b> USD ${n2(x.v)} <small>${eok(x.v)}</small></span>`).join("")}</div>`:""}
    <div class="dzrows">${z.rows.slice(0,SHOW).map(row).join("")}</div>
    ${z.rows.length>SHOW?`<details class="dzmore"><summary>나머지 ${z.rows.length-SHOW}건 더 보기</summary><div class="dzrows">${z.rows.slice(SHOW).map(row).join("")}</div></details>`:""}
    <div class="dzfoot"><p class="basis">대시보드 ‘기관별 약정’·‘약정내역(2022~)’ 기준 · ${z.gp?"운용사":"대시보드"} 표기 ${z.lbls.map(esc).join(", ")} · 억원은 기준일 USDKRW ${n2(DZ.usd)} 환산</p>
      ${DZ.og?`<button type="button" class="btn sm" id="oDzGo">대시보드에서 보기</button>`:""}</div>`;
  el.hidden=false;
  const g=$("#oDzGo");if(g)g.onclick=()=>{Dash.open(DZ.og,z.lbls[0]);setTab("dash")}}

// ═════ 통합 검색(머리줄 돋보기 · Ctrl+K) — 미팅·기관·인물·대시보드·리서치·운용보고서를 한 번에 ═════
// 검색어 넓히기(기관 약칭·한영 표기)는 각 탭 검색과 같다(terms). 결과를 누르면 그 탭의 해당 항목으로 간다.
const GS={after:null,dz:null,rs:null,rp:null,dzSt:"",rsSt:"",rpSt:"",t:0};
function gsOpen(){const el=$("#gs"),i=$("#gsq");if(!el.hidden){i.focus();return}
  el.hidden=false;document.body.classList.add("gs-on");try{history.pushState({gs:1},"",location.hash)}catch(e){}
  i.focus();i.select();gsRun();
  if(!GS.dz){GS.dzSt="loading";Dash.data().then(D=>{GS.dz=D;GS.dzSt=D?"ready":"none";if(D&&!DZ)DZ=dzIndex(D);if(!el.hidden)gsRun()})}
  if(!GS.rs){GS.rsSt="loading";Research.data().then(R=>{GS.rs=R;GS.rsSt=R?"ready":"none";if(!el.hidden)gsRun()})}
  if(!GS.rp){GS.rpSt="loading";Reports.data().then(R=>{GS.rp=R;GS.rpSt=R?"ready":"none";if(!el.hidden)gsRun()})}}
function gsHide(){$("#gs").hidden=true;document.body.classList.remove("gs-on")}
function gsClose(fromPop){if($("#gs").hidden)return;gsHide();if(!fromPop&&history.state&&history.state.gs){try{history.back()}catch(e){}}}
// 결과를 누르면: 검색 창의 기록을 먼저 되돌린 뒤 이동(휴대폰 뒤로가기가 꼬이지 않게)
function gsGo(fn){gsHide();if(history.state&&history.state.gs){GS.after=fn;try{history.back();setTimeout(()=>{if(GS.after){const f=GS.after;GS.after=null;f()}},500);return}catch(e){GS.after=null}}fn()}
const dzHay=new WeakMap();
function dzRowText(r,sh){let v=dzHay.get(r);if(v==null){v=Object.values(r.c).map(x=>typeof x==="object"?"":String(x)).join(" ")+" "+sh;dzHay.set(r,v)}return v}
function gsDash(T){const out=[];if(!GS.dz)return out;
  GS.dz.sheets.forEach(s=>{if(!Array.isArray(s.view)||!s.view.length||s.name==="대시보드(Demo)")return;const hs=[];
    Dash.walk(s.view,b=>{if(b.t!=="table")return;const cd=b.card||{},tk=(cd.title&&cd.title[0]!=="@"?cd.title:null)||b.cols[0].k,subs=(cd.sub||[]).filter(k=>k[0]!=="@");
      (b.secs||[{rows:b.rows||[]}]).forEach(sec=>{const sh=String(sec.h||"");sec.rows.forEach(r=>{const ho=dzRowText(r,sh),hy=ho.toLowerCase();if(hits(hy,T))hs.push({t:r.c[tk],s:[sh.replace(/^\d+\.\s*/,""),...subs.map(k=>r.c[k])].filter(v=>v!=null&&v!=="").join(" · "),hy,ho})})})});
    if(hs.length){const q=T.map(alts=>{for(const a of alts){const x=hs.find(y=>y.hy.includes(a));if(x){const i=x.hy.indexOf(a);return x.ho.substr(i,a.length)}}return alts[0]}).join(" ");out.push({s,hs,q})}});   /* 시트 찾기 칸에는 실제로 맞은 표기를 그대로 넣는다(교공 → KTCU) */
  return out.sort((a,b)=>b.hs.length-a.hs.length)}   /* 많이 맞은 시트부터 */
function gsResearch(T,q){const out=[];if(!GS.rs)return out;
  GS.rs.reports.forEach(r=>{const lines=[r.headline,...(r.kpis||[]).map(k=>[k.l,k.v,k.s].filter(Boolean).join(" ")),...(r.sections||[]).flatMap(x=>[x.h,...(x.items||[])]),...(r.outlook||[]),...(r.insights||[])].filter(Boolean).map(String);
    if(!hits([r.name,r.short,r.en,...lines].join(" ").toLowerCase(),T))return;const hit=lines.find(l=>firstHit(l,q));out.push({r,snip:hit?snippet(hit,q):esc(r.headline||"")})});
  return out}
// 운용보고서: 펀드(이름·운용사·투자대상)와 이슈자산(자산명·요약·수치·GP 대응). 이슈자산은 펀드를 가로질러 같은 자산끼리 한 줄
function gsReports(T,q){const out=[];if(!GS.rp)return out;
  GS.rp.funds.forEach(f=>{const A=f.A||{},lines=[f.fundName,f.manager,f.underlying,A.off,A.gp,A.strategy].filter(Boolean).map(String);
    if(!hits([f.short,...lines].join(" ").toLowerCase(),T))return;const hit=lines.find(l=>firstHit(l,q));out.push({k:"f",id:f.id,t:f.short,s:hit?snippet(hit,q):esc([f.manager,f.underlying].filter(Boolean).join(" → "))})});
  Reports.groups().forEach(g=>{const lines=g.entries.flatMap(x=>[x.summary,...(x.metrics||[]),...(x.type||[]),x.gp,x.question]).filter(Boolean).map(String);
    if(!hits([g.name,...g.funds,...lines].join(" ").toLowerCase(),T))return;const hit=lines.find(l=>firstHit(l,q));out.push({k:"i",key:g.key,t:g.name,f:g.funds,lv:g.level,s:hit?snippet(hit,q):esc(g.entries[0].summary||"")})});
  return out}
function gsRun(){const raw=$("#gsq").value,q=raw.trim().toLowerCase(),B=$("#gsBody");
  if(!q){B.innerHTML=`<div class="gs-hint"><b>미팅노트·기관·인물·대시보드·리서치·운용보고서를 한 번에 찾습니다.</b><span>기관 약칭(예: 교공)이나 GP 이름을 한글·영문 어느 쪽으로 써도 찾습니다. 여러 단어는 모두 들어 있는 것만.</span></div>`;return}
  const T=terms(q),LIM=5;
  // 순서: 기관명·약칭이 검색어와 같거나 맞는 것 먼저(교공 → 교직원공제회 미팅·기관), 그다음 최근 순
  const orgHit=r=>{const o=orgOf(r.org);return hits([r.org,...(o?[o.name,...(o.aliases||[])]:[])].join(" ").toLowerCase(),T)?1:0};
  const oScore=o=>{const ns=[o.name,...(o.aliases||[])].map(x=>x.toLowerCase());return ns.includes(q)?2:hits(ns.join(" "),T)?1:0};
  const ms=M.filter(r=>hits(hayM(r),T)).sort((a,b)=>orgHit(b)-orgHit(a)||(b.date||"").localeCompare(a.date||""));
  const os=O.filter(o=>hits(hayO(o),T)).sort((a,b)=>oScore(b)-oScore(a)||(lastMeet(b)||"").localeCompare(lastMeet(a)||""));
  const ps=P.filter(p=>hits(hayP(p),T)).sort((a,b)=>(hits(a.name.toLowerCase(),T)?0:1)-(hits(b.name.toLowerCase(),T)?0:1)),dz=gsDash(T),rs=gsResearch(T,q),rp=gsReports(T,q);
  const grp=(name,n,body,all)=>`<section class="gs-g"><div class="gs-gh"><b>${name}</b><span>${n}</span>${all||""}</div>${body}</section>`;
  let h="";
  if(ms.length)h+=grp("미팅노트",`${ms.length}건`,ms.slice(0,LIM).map(r=>`<button type="button" class="gs-it" data-gm="${esc(r.id)}"><span class="gs-d">${esc(r.date.slice(5).replace("-","/"))}</span><span class="gs-m"><b>${hl(esc(r.org),q)}${r.dept?` <small>${hl(esc(r.dept),q)}</small>`:""}</b><small>${preview(r,q)}</small></span></button>`).join(""),
    ms.length>LIM?`<button type="button" class="link" data-gall="m">${ms.length}건 모두 보기</button>`:"");
  if(os.length)h+=grp("기관",`${os.length}곳`,os.slice(0,LIM).map(o=>{const n=meetingsOf(o).length,l=lastMeet(o);return `<button type="button" class="gs-it" data-go="${esc(o.id)}"><span class="gs-m"><b>${STAR.o.has(o.id)?"★ ":""}${hl(esc(o.name),q)}</b><small>${esc(o.type)} · 미팅 ${n}건${l?` · 최근 ${esc(l)}`:""}</small></span></button>`}).join(""),
    os.length>LIM?`<button type="button" class="link" data-gall="o">${os.length}곳 모두 보기</button>`:"");
  if(ps.length)h+=grp("인물",`${ps.length}명`,ps.slice(0,LIM).map(p=>`<button type="button" class="gs-it" data-gp="${esc(p.id)}"><span class="gs-m"><b>${hl(esc(p.name),q)} <small>${esc(p.title||"")}</small></b><small>${hl(esc([p.org,p.dept,p.team].filter(Boolean).join(" · ")),q)}</small></span></button>`).join(""),
    ps.length>LIM?`<button type="button" class="link" data-gall="p">${ps.length}명 모두 보기</button>`:"");
  if(dz.length)h+=grp("대시보드",`${dz.reduce((a,x)=>a+x.hs.length,0)}건 · 시트 ${dz.length}개`,dz.map((x,i)=>`<div class="gs-sh"><button type="button" class="gs-shh" data-gd="${i}"><b>${esc(x.s.short||x.s.name)}</b><span>${x.hs.length}건 · 시트에서 보기 →</span></button>${x.hs.slice(0,3).map(y=>`<button type="button" class="gs-it sub" data-gd="${i}"><span class="gs-m"><b>${hl(esc(y.t??"-"),q)}</b>${y.s?`<small>${hl(esc(y.s),q)}</small>`:""}</span></button>`).join("")}</div>`).join(""));
  else if(GS.dzSt==="loading")h+=grp("대시보드","",`<p class="gs-wait">대시보드 여는 중…</p>`);
  if(rs.length)h+=grp("리서치",`${rs.length}건`,rs.map(x=>`<button type="button" class="gs-it" data-gr="${esc(x.r.id)}"><span class="gs-m"><b>${esc(x.r.name)}${x.r.en?` <small>${esc(x.r.en)}</small>`:""}</b><small>${x.snip}</small></span></button>`).join(""));
  else if(GS.rsSt==="loading")h+=grp("리서치","",`<p class="gs-wait">리서치 여는 중…</p>`);
  if(rp.length)h+=grp("운용보고서",`${rp.length}건`,rp.slice(0,8).map((x,i)=>`<button type="button" class="gs-it" data-grp="${i}"><span class="gs-m"><b>${x.k==="i"?`<span class="rp-lv rp-lv--${esc(x.lv)}">${({high:"높음",mid:"중간",low:"참고"})[x.lv]||""}</span> `:""}${hl(esc(x.t),q)}${x.k==="i"?` <small>${esc(x.f.join(", "))}</small>`:" <small>펀드</small>"}</b><small>${x.s}</small></span></button>`).join(""));
  else if(GS.rpSt==="loading")h+=grp("운용보고서","",`<p class="gs-wait">운용보고서 여는 중…</p>`);
  B.innerHTML=h||`<div class="empty">‘${esc(raw.trim())}’ — 찾은 항목이 없습니다.</div>`;
  B.querySelectorAll("[data-gm]").forEach(b=>b.onclick=()=>gsGo(()=>{mResetFilters();$("#mq").value=raw.trim();renderMList();gotoMeeting(b.dataset.gm)}));
  B.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>gsGo(()=>{oSel=b.dataset.go;oMode="view";setTab("orgs");openDetail()}));
  B.querySelectorAll("[data-gp]").forEach(b=>b.onclick=()=>gsGo(()=>gotoPerson(b.dataset.gp)));
  B.querySelectorAll("[data-gd]").forEach(b=>b.onclick=()=>{const x=dz[+b.dataset.gd];gsGo(()=>{Dash.open(x.s.name,x.q);setTab("dash")})});
  B.querySelectorAll("[data-gr]").forEach(b=>b.onclick=()=>gsGo(()=>{Research.open(b.dataset.gr);setTab("research")}));
  B.querySelectorAll("[data-grp]").forEach(b=>b.onclick=()=>{const x=rp[+b.dataset.grp];gsGo(()=>{Reports.open(x.k==="f"?{fund:x.id}:{issue:x.key});setTab("reports")})});
  B.querySelectorAll("[data-gall]").forEach(b=>b.onclick=()=>gsGo(()=>{const k=b.dataset.gall,v=raw.trim();
    if(k==="m"){mResetFilters();$("#mq").value=v;mSel=ms[0].id;setTab("meetings")}
    else if(k==="o"){oStarOnly=false;$("#oType").value="";$("#oq").value=v;oSel=null;setTab("orgs")}
    else{$("#pOrg").value="";pOrg="";$("#pq").value=v;pSel=null;setTab("people")}}))}
function mResetFilters(){["mCat","mType","mAsset","mAuthor","mFlag"].forEach(i=>$("#"+i).value="");starOnly=actOnly=newOnly=cutOnly=false}
$("#gsBtn").onclick=gsOpen;$("#gsClose").onclick=()=>gsClose();
$("#gs").addEventListener("click",e=>{if(e.target.id==="gs")gsClose()});   /* PC: 바깥(어두운 곳)을 누르면 닫기 */
$("#gsq").addEventListener("input",()=>{clearTimeout(GS.t);GS.t=setTimeout(gsRun,150)});
$("#gsq").addEventListener("keydown",e=>{if(e.key==="Enter"){const f=$("#gsBody .gs-it");if(f){e.preventDefault();f.click()}}else if(e.key==="Escape"){e.preventDefault();e.stopPropagation();gsClose()}});

// ── 공통 저장 ──
async function write(col,id,data,after,btn){if(!col){toast("저장소에 연결되지 않아 저장할 수 없습니다.");return}const b=$(btn);if(b)b.disabled=true;
  try{const ref=id?col.doc(id):col.doc();await ref.set(data);after(ref.id);toast("저장했습니다.");renderTab()}
  catch(err){if(err&&err.code==="invalid_argument"){canWrite=false;toast("이 링크에서는 수정 권한이 없습니다.")}else if(err&&err.code==="quota_exceeded")toast("저장 공간이 가득 찼습니다. 오래된 항목을 정리해 주세요.");else toast("저장하지 못했습니다. 잠시 후 다시 시도하세요.");if(b)b.disabled=false}}
async function copy(t){try{await navigator.clipboard.writeText(t);toast("메모 양식으로 복사했습니다.")}
  catch(e){const ta=document.createElement("textarea");ta.value=t;document.body.appendChild(ta);ta.select();try{document.execCommand("copy");toast("복사했습니다.")}catch(_){toast("복사하지 못했습니다.")}ta.remove()}}

// ── 초기화 ──
const h=(location.hash||"").replace("#","");if(["meetings","orgs","demand","people"].includes(h))setTab(h,false);else renderTab();
fabSync();
addEventListener("hashchange",()=>{const t=(location.hash||"").replace("#","");if(t!==tab&&["meetings","orgs","demand","people","dash","research","reports"].includes(t))setTab(t,false)});
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
function load(j){M=(j.meetings||[]).sort((a,b)=>(b.date||"").localeCompare(a.date||""));O=j.orgs||[];P=j.people||[];indexPosters();indexSearch();markNew();
  mSel=M.length?M[0].id:null;oSel=null;pSel=null;
  authorsRefresh();orgSelRefresh();stats();renderTab();
  $("#asof").textContent=j.generatedAt?`${j.generatedAt} 업데이트`:"";ASOF=(j.generatedAt||"").slice(5).replace("-","/");renderMList();document.body.classList.add("ready")}
// 월 이동 · 맨 위로 · 고정 머리(월·기관 구분줄)가 붙을 자리 = 헤더 바로 아래
$("#mJump").onchange=e=>{const k=e.target.value;e.target.value="";const hd=k&&document.querySelector(`#mList .mhead[data-ym="${k}"]`);if(!hd)return;
  const L=$("#mList");if(L.scrollHeight>L.clientHeight+2)L.scrollTop+=hd.getBoundingClientRect().top-L.getBoundingClientRect().top;   /* PC: 목록 안에서 */
  else scrollTo({top:hd.getBoundingClientRect().top+scrollY-stickTop()+1})};
const setStick=()=>document.documentElement.style.setProperty("--stick",stickTop()+"px");
addEventListener("resize",setStick);setStick();if(document.fonts&&document.fonts.ready)document.fonts.ready.then(setStick);
const topBtn=$("#topBtn");let topTick=false;
addEventListener("scroll",()=>{if(topTick)return;topTick=true;requestAnimationFrame(()=>{topTick=false;topBtn.hidden=scrollY<900})},{passive:true});
topBtn.onclick=()=>scrollTo({top:0,behavior:smooth()});
// 인터넷이 끊기면 알림(서비스워커가 마지막으로 받은 사본을 보여준다)
addEventListener("keydown",e=>{const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||"");
  if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==="k"&&$("#gate").hidden&&document.body.classList.contains("ready")){e.preventDefault();gsOpen();return}
  if(!$("#gs").hidden){if(e.key==="Escape"){e.preventDefault();gsClose()}return}   /* 통합 검색 창이 열려 있으면 그 창만 */
  if(e.key==="/"&&!typing&&$("#gate").hidden){/* 비밀번호 화면이 아닐 때만 */const box={meetings:"#mq",orgs:"#oq",demand:"#dq",people:"#pq"}[tab];if(tab==="dash"){if(Dash.focusFind())e.preventDefault()}else if(box){e.preventDefault();$(box).focus();$(box).select()}}
  else if(e.key==="Escape"&&typing&&document.activeElement.type==="search"&&document.activeElement.value){document.activeElement.value="";document.activeElement.dispatchEvent(new Event("input"))}});
addEventListener("offline",()=>toast("오프라인 — 마지막으로 받은 사본을 보여줍니다"));addEventListener("online",()=>toast("다시 연결됐습니다"));
Vault.boot(j=>{load(j);if(!navigator.onLine)setTimeout(()=>toast("오프라인 — 마지막으로 받은 사본입니다"),2600)});
