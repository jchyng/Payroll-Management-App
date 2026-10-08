const CATS=["식비","카페/간식","생활/마트","쇼핑","교통","주거/통신","문화/여가","의료","저축","기타"];
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=()=>Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-4);
const pad=n=>String(n).padStart(2,"0");
const today=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const curMonth=()=>today().slice(0,7);
const shift=(k,n)=>{const[y,m]=k.split("-").map(Number);const d=new Date(y,m-1+n,1);return `${d.getFullYear()}-${pad(d.getMonth()+1)}`};
const mDays=k=>{const[y,m]=k.split("-").map(Number);return new Date(y,m,0).getDate()};
const dateFor=(k,day)=>`${k}-${pad(Math.min(Math.max(day,1),mDays(k)))}`;
const won=n=>Math.round(n).toLocaleString("ko-KR")+"원";
const fmt=n=>Number(n).toLocaleString("ko-KR");
const num=v=>Number(String(v).replace(/\D/g,"").slice(0,12))||0;
const dayLabel=d=>{const[y,m,dd]=d.split("-").map(Number);return `${m}/${dd} (${"일월화수목금토"[new Date(y,m-1,dd).getDay()]})`};

/* ── 저장소: IndexedDB (state 객체 하나를 통째로 저장) ── */
let dbp;
const DB=()=>dbp||(dbp=new Promise((res,rej)=>{const r=indexedDB.open("salary-planner",1);r.onupgradeneeded=()=>r.result.createObjectStore("kv");r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}));
const idbGet=async k=>{const db=await DB();return new Promise((res,rej)=>{const q=db.transaction("kv").objectStore("kv").get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})};
const idbSet=async(k,v)=>{const db=await DB();return new Promise((res,rej)=>{const t=db.transaction("kv","readwrite");t.objectStore("kv").put(v,k);t.oncomplete=res;t.onerror=()=>rej(t.error)})};
const persist=()=>idbSet("state",state).catch(()=>{});

/* ── 데이터 ── */
let state,ui={month:curMonth(),edit:null};
const blank=()=>({v:3,months:{},templates:[],merchants:{}});
function month(k=ui.month){
  if(state.months[k])return state.months[k];
  let base=[];
  for(let i=1;i<=12&&!base.length;i++){const p=state.months[shift(k,-i)];if(p)base=p.income.filter(x=>x.base)}
  return state.months[k]={
    income:base.map(x=>({...x,id:uid()})),
    plans:state.templates.map(t=>({id:uid(),tpl:t.id,name:t.name,amount:t.amount,date:dateFor(k,t.day),category:t.category,tx:null})),
    tx:[]};
}
function stats(){
  const m=month(),cm=curMonth();
  const income=m.income.reduce((a,x)=>a+x.amount,0);
  const spent=m.tx.reduce((a,x)=>a+x.amount,0);
  const reserved=m.plans.filter(p=>!p.tx).reduce((a,p)=>a+p.amount,0);
  const days=ui.month===cm?mDays(cm)-Number(today().slice(8))+1:ui.month>cm?mDays(ui.month):0;
  return{m,income,spent,reserved,remaining:income-spent-reserved,days};
}

/* ── 화면 ── */
const ICON={left:'<path d="M15 6l-6 6 6 6"/>',right:'<path d="M9 6l6 6-6 6"/>',plus:'<path d="M12 5v14M5 12h14"/>',check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',edit:'<path d="M4 20h4L18.5 9.5l-4-4L4 16v4zM13 7l4 4"/>',tune:'<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>'};
const ic=(n,s=22)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const EM={"식비":"🍚","카페/간식":"☕","생활/마트":"🛒","쇼핑":"🛍️","교통":"🚌","주거/통신":"🏠","문화/여가":"🎬","의료":"💊","저축":"🐷","기타":"✨"};
const dueTxt=p=>{
  if(p.tx||ui.month!==curMonth())return"";
  const d=Number(p.date.slice(8))-Number(today().slice(8));
  return d<0?`<span class="due late">지났어요</span>`:d===0?`<span class="due">오늘</span>`:d<=3?`<span class="due">${d}일 후</span>`:"";
};
function dl(d){
  const y=new Date();y.setDate(y.getDate()-1);
  const yd=`${y.getFullYear()}-${pad(y.getMonth()+1)}-${pad(y.getDate())}`;
  return d===today()?"오늘":d===yd?"어제":dayLabel(d);
}
function render(){
  const s=stats(),m=s.m;
  const tot=Math.max(s.income,s.spent+s.reserved)||1;
  let daily="";
  if(s.income>0){
    if(s.remaining<0)daily=`<p class="daily bad">예산보다 ${won(-s.remaining)} 부족해요</p>`;
    else if(s.days>0)daily=`<p class="daily">하루 약 <b>${won(s.remaining/s.days)}</b> 쓸 수 있어요</p>`;
    else daily=`<p class="daily off">지난 달 기록이에요</p>`;
  }
  const hero=s.income>0?`
    <div class="hl"><span>앞으로 쓸 수 있는 돈</span><button class="pill" data-act="income" aria-label="이번 달 수입 수정">${ic("edit",13)}수정</button></div>
    <div class="big ${s.remaining<0?"neg":""}">${fmt(s.remaining)}<small>원</small></div>${daily}
    <div class="bar ${s.remaining<0?"neg":""}"><i class="b1" style="width:${s.spent/tot*100}%"></i><i class="b2" style="width:${s.reserved/tot*100}%"></i></div>
    <div class="lg"><div><i class="b1"></i>쓴 돈<b>${won(s.spent)}</b></div><div><i class="b2"></i>예정<b>${won(s.reserved)}</b></div><div><i class="d3"></i>남음<b>${won(s.remaining)}</b></div></div>`:`
    <div class="hl"><span>이번 달 수입을 먼저 알려주세요</span></div>
    <div class="big" style="font-size:26px;line-height:1.4">이번 달 수입을 입력하면<br>쓸 수 있는 돈을 계산해요</div>
    <button class="btn" data-act="income">수입 입력하기</button>`;

  const plans=[...m.plans].sort((a,b)=>(!!a.tx-!!b.tx)||a.date.localeCompare(b.date));
  const left=plans.filter(p=>!p.tx).length;
  const planRows=plans.map(p=>`<div class="row ${p.tx?"done":""}">
    <button class="chk" data-act="plan-toggle" data-id="${p.id}" aria-label="${p.tx?"낸 것 취소":"냈어요"}">${p.tx?ic("check",16):""}</button>
    <button class="main" data-act="plan-edit" data-id="${p.id}"><div class="t">${esc(p.name)}</div><div class="s">${Number(p.date.slice(8))}일${p.tpl?" · 매달":""}${dueTxt(p)}</div></button>
    <span class="a">${won(p.amount)}</span></div>`).join("");

  const groups={};
  [...m.tx].sort((a,b)=>b.date.localeCompare(a.date)).forEach(t=>(groups[t.date]??=[]).push(t));
  const txHtml=Object.keys(groups).map(d=>`
    <div class="day"><span>${dl(d)}</span><span>${won(groups[d].reduce((a,t)=>a+t.amount,0))}</span></div>
    <div class="list">${groups[d].map(t=>`<button class="row" data-act="tx-edit" data-id="${t.id}">
      <span class="ic">${EM[t.category]||"✨"}</span>
      <div class="main"><div class="t">${esc(t.merchant||t.category)}</div><div class="s">${esc(t.category)}</div></div>
      <span class="a">− ${fmt(t.amount)}</span></button>`).join("")}</div>`).join("");

  $("#app").innerHTML=`
    <div class="top"><div class="mnav"><button class="ib" data-act="prev" aria-label="이전 달">${ic("left")}</button>
      <div class="mt">${Number(ui.month.slice(5))}월<small>${ui.month.slice(0,4)}</small></div>
      <button class="ib" data-act="next" aria-label="다음 달">${ic("right")}</button></div></div>
    <section class="hero">${hero}</section>
    <section class="sec"><div class="sec-head"><h2>예정 지출${plans.length?`<small>${left}개 남음</small>`:""}</h2></div>
      <div class="list">${planRows||`<div class="empty"><b>🗓️</b>월세·통신비처럼 나갈 돈은<br>지출 추가에서 "예정"으로 등록해요</div>`}</div></section>
    <section class="sec"><h2>내역</h2>${txHtml||`<div class="list" style="margin-top:10px"><div class="empty"><b>🧾</b>아직 기록이 없어요<br>아래 버튼으로 첫 지출을 추가해 보세요</div></div>`}</section>
    <div class="fab"><button class="btn" data-act="tx-new">${ic("plus",20)}지출 추가</button></div>`;
}

/* ── 시트 ── */
function sheet(title,html){$("#sheet").innerHTML=`<h3>${title}</h3>${html}`;$("#ov").classList.add("on")}
function closeSheet(){$("#ov").classList.remove("on");ui.edit=null}
const seg=on=>`<div class="seg"><button type="button" class="${on==="tx"?"on":""}" data-act="mode-tx">쓴 돈</button><button type="button" class="${on==="plan"?"on":""}" data-act="mode-plan">예정 지출</button></div>`;
const chipsHtml=()=>ui.edit.order.map(c=>`<button type="button" class="chip ${c===ui.edit.cat?"on":""}" data-act="cat" data-v="${c}">${EM[c]} ${c}</button>`).join("");
function catOrder(){
  const n={};CATS.forEach(c=>n[c]=0);
  Object.values(state.months).forEach(m=>m.tx.forEach(t=>{if(n[t.category]!=null)n[t.category]++}));
  return[...CATS].sort((a,b)=>n[b]-n[a]);
}
const defDate=()=>ui.month===curMonth()?today():dateFor(ui.month,1);

function txSheet(id){
  const t=id?month().tx.find(x=>x.id===id):null;
  ui.edit={id,cat:t?.category||"식비",user:!!t,order:catOrder()};
  if(!t)ui.edit.cat=ui.edit.order[0];
  sheet(t?"지출 수정":"지출 추가",`${t?"":seg("tx")}
    <label class="f"><span>금액</span><div class="amt-box"><input id="fAmt" class="amt" type="text" inputmode="numeric" placeholder="0" autocomplete="off" value="${t?fmt(t.amount):""}"><span class="unit" aria-hidden="true">원</span></div></label>
    <div class="chips" id="chips">${chipsHtml()}</div>
    <label class="f"><span>어디서 썼나요 (선택)</span><input id="fName" type="text" list="merch" autocomplete="off" value="${esc(t?.merchant||"")}"></label>
    <datalist id="merch">${Object.keys(state.merchants).map(k=>`<option value="${esc(k)}">`).join("")}</datalist>
    <label class="f"><span>날짜</span><input id="fDate" type="date" value="${t?.date||defDate()}"></label>
    <div class="err" id="err"></div>
    <div class="foot">${t?`<button class="btn danger" data-act="tx-del">삭제</button>`:""}<button class="btn" data-act="tx-save">저장</button></div>`);
  if(!t)setTimeout(()=>$("#fAmt").focus(),60);
}
function txSave(){
  const amount=num($("#fAmt").value),date=$("#fDate").value,merchant=$("#fName").value.trim();
  if(!amount)return $("#err").textContent="금액을 입력해 주세요.";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return $("#err").textContent="날짜를 선택해 주세요.";
  const cat=ui.edit.cat,id=ui.edit.id;
  if(merchant)state.merchants[merchant]=cat;
  const cur=month(),dest=month(date.slice(0,7));
  const old=id&&cur.tx.find(x=>x.id===id);
  if(old&&dest===cur)Object.assign(old,{date,merchant,amount,category:cat});
  else{
    if(old){cur.tx=cur.tx.filter(x=>x.id!==id);cur.plans.forEach(p=>{if(p.tx===id)p.tx=null})}
    dest.tx.push({id:id||uid(),date,merchant,amount,category:cat});
  }
  closeSheet();render();persist();
}
function txDel(){
  const m=month(),id=ui.edit.id;
  m.tx=m.tx.filter(x=>x.id!==id);m.plans.forEach(p=>{if(p.tx===id)p.tx=null});
  closeSheet();render();persist();
}

function incomeSheet(){
  const cur=month().income.reduce((a,x)=>a+x.amount,0);
  sheet("이번 달 수입",`<p class="hint">입력한 금액은 다음 달에도 이어져요. 달라지면 그 달에 다시 바꿔 주세요.</p>
    <label class="f"><div class="amt-box"><input id="iAmt" class="amt" type="text" inputmode="numeric" placeholder="0" autocomplete="off" aria-label="이번 달 수입" value="${cur?fmt(cur):""}"><span class="unit" aria-hidden="true">원</span></div></label>
    <div class="err" id="err"></div>
    <div class="foot"><button class="btn" data-act="inc-save">저장</button></div>`);
  setTimeout(()=>$("#iAmt").focus(),60);
}
function incSave(){
  const amount=num($("#iAmt").value);
  if(!amount)return $("#err").textContent="금액을 입력해 주세요.";
  month().income=[{id:uid(),name:"수입",amount,base:true}];
  closeSheet();render();persist();
}

function planSheet(id){
  const p=id?month().plans.find(x=>x.id===id):null;
  ui.edit={id,cat:p?.category||"기타",order:CATS};
  sheet(p?"예정 지출 수정":"지출 추가",`${p?"":seg("plan")}
    <label class="f"><span>이름</span><input id="pName" type="text" autocomplete="off" placeholder="예: 월세" value="${esc(p?.name||"")}"></label>
    <label class="f"><span>금액</span><div class="amt-box"><input id="pAmt" class="amt" type="text" inputmode="numeric" placeholder="0" value="${p?fmt(p.amount):""}"><span class="unit" aria-hidden="true">원</span></div></label>
    <label class="f"><span>날짜</span><input id="pDate" type="date" value="${p?.date||defDate()}"></label>
    <div class="chips" id="chips">${chipsHtml()}</div>
    <label class="ck"><input id="pRep" type="checkbox" ${p?.tpl||!p?"checked":""}>매달 반복</label>
    <div class="err" id="err"></div>
    <div class="foot">${p?`<button class="btn danger" data-act="plan-del">삭제</button>`:""}<button class="btn" data-act="plan-save">저장</button></div>
    ${p?.tpl?`<p class="hint" style="margin-top:10px">삭제하면 앞으로의 반복도 함께 사라져요.</p>`:""}`);
}
function planSave(){
  const name=$("#pName").value.trim(),amount=num($("#pAmt").value),d=$("#pDate").value,rep=$("#pRep").checked;
  if(!name)return $("#err").textContent="이름을 입력해 주세요.";
  if(!amount)return $("#err").textContent="금액을 입력해 주세요.";
  const day=Number((d||defDate()).slice(8))||1,date=dateFor(ui.month,day),category=ui.edit.cat,m=month();
  let p=ui.edit.id&&m.plans.find(x=>x.id===ui.edit.id);
  if(p)Object.assign(p,{name,amount,date,category});
  else{p={id:uid(),tpl:null,name,amount,date,category,tx:null};m.plans.push(p)}
  const t=p.tpl&&state.templates.find(x=>x.id===p.tpl);
  if(rep){
    if(t)Object.assign(t,{name,amount,day,category});
    else{const n={id:uid(),name,amount,day,category};state.templates.push(n);p.tpl=n.id}
  }else if(p.tpl){state.templates=state.templates.filter(x=>x.id!==p.tpl);p.tpl=null}
  closeSheet();render();persist();
}
function planDel(){
  const m=month(),p=m.plans.find(x=>x.id===ui.edit.id);
  if(p?.tpl)state.templates=state.templates.filter(x=>x.id!==p.tpl);
  m.plans=m.plans.filter(x=>x.id!==ui.edit.id);
  closeSheet();render();persist();
}
function planToggle(id){
  const m=month(),p=m.plans.find(x=>x.id===id);if(!p)return;
  if(p.tx){m.tx=m.tx.filter(x=>x.id!==p.tx);p.tx=null}
  else{const t={id:uid(),date:ui.month===curMonth()?today():p.date,merchant:p.name,amount:p.amount,category:p.category};m.tx.push(t);p.tx=t.id}
  render();persist();
}

/* ── 이벤트 ── */
const ACT={
  prev:()=>{ui.month=shift(ui.month,-1);render()},
  next:()=>{ui.month=shift(ui.month,1);render()},
  income:incomeSheet,
  "inc-save":incSave,
  "tx-new":()=>txSheet(),
  "tx-edit":e=>txSheet(e.dataset.id),
  "tx-save":txSave,"tx-del":txDel,
  "mode-tx":()=>txSheet(),
  "mode-plan":()=>planSheet(),
  "plan-edit":e=>planSheet(e.dataset.id),
  "plan-save":planSave,"plan-del":planDel,
  "plan-toggle":e=>planToggle(e.dataset.id),
  cat:e=>{ui.edit.cat=e.dataset.v;ui.edit.user=true;$("#chips").innerHTML=chipsHtml()},
};
document.addEventListener("click",e=>{
  if(e.target.id==="ov")return closeSheet();
  const el=e.target.closest("[data-act]");if(el)ACT[el.dataset.act]?.(el);
});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeSheet()});
document.addEventListener("input",e=>{
  const t=e.target;
  if(t.classList.contains("amt")){const n=num(t.value);t.value=n?fmt(n):""}
  if(t.id==="fName"&&ui.edit&&!ui.edit.user){const c=state.merchants[t.value.trim()];if(c){ui.edit.cat=c;$("#chips").innerHTML=chipsHtml()}}
});

(async()=>{
  try{state=await idbGet("state")}catch(e){}
  if(!state||state.v!==3)state=blank();
  try{navigator.storage?.persist?.()}catch(e){}
  render();
})();
