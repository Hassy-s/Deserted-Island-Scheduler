// UI・保存・スケジュール生成処理

// 4h / 6h / 8h product names cross-checked against user-provided in-game lists (v0.19).
const STORAGE_KEY="island_workshop_scheduler_v019";
const PREVIOUS_STORAGE_KEYS=["island_workshop_scheduler_v029","island_workshop_scheduler_v028","island_workshop_scheduler_v018"];
const HISTORY_KEY="island_workshop_scheduler_history_v1";

function loadHistory(){
  try{
    const h=JSON.parse(localStorage.getItem(HISTORY_KEY)||"[]");
    return Array.isArray(h)?h:[];
  }catch(e){ return []; }
}
function saveHistory(h){
  localStorage.setItem(HISTORY_KEY,JSON.stringify(h.slice(-8)));
}
function loadHistoryRedo(){
  try{const h=JSON.parse(localStorage.getItem(HISTORY_REDO_KEY)||"[]");return Array.isArray(h)?h:[]}
  catch(e){return []}
}
function saveHistoryRedo(h){localStorage.setItem(HISTORY_REDO_KEY,JSON.stringify(h.slice(-8)))}
function weightedHistoryMaterials(){
  const h=loadHistory();
  const out={};
  // Most recent week matters most; effect fades over several weeks.
  const weights=[1.0,0.55,0.28,0.12];
  for(let back=0;back<Math.min(h.length,weights.length);back++){
    const week=h[h.length-1-back];
    const w=weights[back];
    for(const [name,qty] of Object.entries(week.materials||{})){
      out[name]=(out[name]||0)+qty*w;
    }
  }
  return out;
}
function historyMaterialPenalty(item,workshops){
  if(searchMode()!=="standard") return 0;
  const hist=ACTIVE_HISTORY_MATERIALS || {};
  let p=0;
  for(const m of (item.materials||[])){
    p += (hist[m.name]||0) * m.qty * workshops * 0.42;
  }
  return p;
}

let excludedMaterials=new Set(), wantedItems=new Set(), LAST=null, activeDay=0;
let EDIT_UNDO=[], EDIT_REDO=[];
let REPLACE_CTX=null, REPLACE_SHOW_ALL=false;
const HISTORY_REDO_KEY="island_workshop_scheduler_history_redo_v1";

// v0.41 generation context: values that are constant during one search.
let ACTIVE_SEARCH_MODE=null;
let ACTIVE_CAPS=null;
let ACTIVE_HISTORY_MATERIALS=null;
let ACTIVE_WANTED_ITEMS=null;

const $=s=>document.querySelector(s);
const collator=new Intl.Collator("ja");
const intersects=(a,b)=>a.some(x=>b.includes(x));
const EFFICIENT_IDS=new Map();
for(const a of ITEMS){
  const set=new Set();
  for(const b of ITEMS){
    if(a.id!==b.id && intersects(a.cats,b.cats)) set.add(b.id);
  }
  EFFICIENT_IDS.set(a.id,set);
}
const efficient=(a,b)=>!!(a&&b&&EFFICIENT_IDS.get(a.id)?.has(b.id));

function autoWorkshops(rank){return rank>=15?4:rank>=5?3:2}
function itemUsesExcludedMaterial(item){
  return (item.materials||[]).some(m=>excludedMaterials.has(m.name));
}
function materialAvailableAtRank(name,rank){
  const info=MATERIAL_PROGRESS[name];
  return !!info && rank>=info.minRank;
}
function itemMaterialsAvailableAtRank(item,rank){
  return (item.materials||[]).every(m=>materialAvailableAtRank(m.name,rank));
}
function itemAvailableAtRank(item,rank){
  return item.rank<=rank && itemMaterialsAvailableAtRank(item,rank);
}
function available(){
  const rank=+$("#rank").value;
  return ITEMS.filter(i=>itemAvailableAtRank(i,rank)&&!itemUsesExcludedMaterial(i))
}
function favorEnabled(){return $("#favorOn").checked}
function fillFavorSelects(){
  const rank=+$("#rank").value;
  for(const t of [4,6,8]){
    const sel=$("#favor"+t), old=sel.value;
    sel.innerHTML='<option value="">---- 選択してください ----</option>';
    ITEMS.filter(i=>i.time===t&&itemAvailableAtRank(i,rank)&&!itemUsesExcludedMaterial(i))
      .sort((a,b)=>collator.compare(a.name,b.name))
      .forEach(i=>{
        const o=document.createElement("option");
        o.value=i.id;o.textContent=i.name;sel.appendChild(o)
      });
    if([...sel.options].some(o=>o.value===old)) sel.value=old
  }
}
function save(){
  localStorage.setItem(STORAGE_KEY,JSON.stringify({
    rank:+$("#rank").value,
    workshops:+$("#workshops").value,
    landmarks:+$("#landmarks").value,
    excludedMaterials:[...excludedMaterials],
    wantedItems:[...wantedItems],
    favor:favorEnabled(),
    searchMode:searchMode(),
    capGather:+$("#capGather").value,
    capCrop:+$("#capCrop").value,
    capAnimal:+$("#capAnimal").value,
    capGranary:+$("#capGranary").value
  }))
}
function load(){
  try{
    let raw=localStorage.getItem(STORAGE_KEY);
    if(!raw){
      for(const key of PREVIOUS_STORAGE_KEYS){
        raw=localStorage.getItem(key);
        if(raw) break;
      }
    }
    const s=JSON.parse(raw||"{}");
    if(s.rank)$("#rank").value=s.rank;
    if(s.workshops)$("#workshops").value=s.workshops;
    if(s.landmarks)$("#landmarks").value=s.landmarks;
    excludedMaterials=new Set(s.excludedMaterials||[]);
    wantedItems=new Set((s.wantedItems||[]).map(Number));
    $("#favorOn").checked=!!s.favor;
    $("#favorOff").checked=!s.favor;
    $("#favors").classList.toggle("on",!!s.favor);
    fillFavorSelects();
    $("#favor4").value="";
    $("#favor6").value="";
    $("#favor8").value="";
    $("#searchModeSelect").value = s.searchMode==="max" ? "max" : "standard";
    if(s.capGather!==undefined)$("#capGather").value=s.capGather;
    if(s.capCrop!==undefined)$("#capCrop").value=s.capCrop;
    if(s.capAnimal!==undefined)$("#capAnimal").value=s.capAnimal;
    if(s.capGranary!==undefined)$("#capGranary").value=s.capGranary
  }catch(e){}
  renderExclude();
  updateExcludeSummary();
  renderWanted();
  updateWantedSummary()
}
function allMaterials(){
  const rank=+$("#rank").value;
  const map=new Map();

  // v1.1: 現在の進行度で実際に入手可能な素材だけを表示。
  for(const item of ITEMS.filter(i=>itemAvailableAtRank(i,rank))){
    for(const m of (item.materials||[])){
      if(materialAvailableAtRank(m.name,rank) && !map.has(m.name)){
        map.set(m.name,{
          name:m.name,
          type:materialType(m.name)
        });
      }
    }
  }

  return [...map.values()].sort((a,b)=>collator.compare(a.name,b.name));
}
function materialTypeLabel(t){
  return t==="granary"?"グラナリー":t==="animal"?"飼育動物":t==="crop"?"作物":"採集";
}
function updateExcludeSummary(){
  const blocked=ITEMS.filter(itemUsesExcludedMaterial).length;
  $("#excludeSummary").textContent=`除外素材：${excludedMaterials.size}件 / 対象外になる島産品：${blocked}品 / 現在使用可能：${available().length}品`;
  const count=$("#excludeCount"); if(count) count.textContent=`${excludedMaterials.size}件除外`;
}
function renderExclude(){
  const q=$("#filter").value.trim(),grid=$("#itemGrid");
  grid.innerHTML="";
  allMaterials()
    .filter(m=>!q||m.name.includes(q))
    .forEach(m=>{
      const d=document.createElement("label");
      d.className="itemcheck materialcheck";
      d.innerHTML=`
        <input type="checkbox" ${excludedMaterials.has(m.name)?"checked":""} data-name="${m.name}">
        <span class="iname">${m.name}</span>
        <span class="pill">${materialTypeLabel(m.type)}</span>`;
      grid.appendChild(d)
    });
  grid.querySelectorAll("input").forEach(cb=>cb.onchange=()=>{
    const name=cb.dataset.name;
    cb.checked?excludedMaterials.add(name):excludedMaterials.delete(name);
    updateExcludeSummary();fillFavorSelects();
    const visibleWanted=new Set(wantedAvailableItems().map(i=>i.id));
    wantedItems=new Set([...wantedItems].filter(id=>visibleWanted.has(id)));
    renderWanted();updateWantedSummary();save()
  })
}


function wantedAvailableItems(){
  const rank=+$("#rank").value;
  return ITEMS.filter(i=>itemAvailableAtRank(i,rank)&&!itemUsesExcludedMaterial(i))
    .sort((a,b)=>collator.compare(a.name,b.name));
}
function updateWantedSummary(){
  const el=$("#wantedCount");
  if(el) el.textContent=`${wantedItems.size}件選択`;
}
function renderWanted(){
  const grid=$("#wantedGrid");
  if(!grid) return;
  const q=$("#wantedFilter").value.trim();
  grid.innerHTML="";
  wantedAvailableItems().filter(i=>!q||i.name.includes(q)).forEach(item=>{
    const d=document.createElement("label");
    d.className="itemcheck wantedcheck";
    d.innerHTML=`<input type="checkbox" ${wantedItems.has(item.id)?"checked":""} data-id="${item.id}">
      <span class="iname">${item.name}</span><span class="pill">${item.time}H</span>`;
    grid.appendChild(d);
  });
  grid.querySelectorAll("input").forEach(cb=>cb.onchange=()=>{
    const id=+cb.dataset.id;
    cb.checked?wantedItems.add(id):wantedItems.delete(id);
    updateWantedSummary();save();
  });
}
function wantedEfficientIds(days){
  const found=new Set();
  if(!ACTIVE_WANTED_ITEMS || !ACTIVE_WANTED_ITEMS.size) return found;
  for(const day of (days||[])){
    for(const slot of (day||[])){
      if(slot.eff && ACTIVE_WANTED_ITEMS.has(slot.item.id)) found.add(slot.item.id);
    }
  }
  return found;
}
function wantedWeekBonus(days){
  // v1.3.1:
  // "作りたい島産品" earns a preference ONLY when it is actually produced
  // with あわせて生産. It never receives a weekly bonus merely for being
  // forced into a non-efficient slot.
  return wantedEfficientIds(days).size*1100;
}
function wantedSetupBonus(item){
  // Reverse-plan toward a selected product: modestly prefer an item that can
  // serve as the immediately preceding setup for a wanted product.
  // This helps build "前置き品 → 作りたい島産品" without ever overriding
  // the structural preference for current efficient production.
  if(!ACTIVE_WANTED_ITEMS || !ACTIVE_WANTED_ITEMS.size) return 0;
  for(const id of ACTIVE_WANTED_ITEMS){
    const wanted=ITEMS.find(i=>i.id===id);
    if(wanted && wanted.id!==item.id && efficient(item,wanted)) return 420;
  }
  return 0;
}

function grooveCap(){
  const lm=+$("#landmarks").value;
  return ({1:15,2:20,3:25,4:35,5:45})[lm]||15;
}


function addMaterials(total,item,workshops){
  const out={...total};
  for(const m of (item.materials||[])){
    out[m.name]=(out[m.name]||0)+m.qty*workshops;
  }
  return out;
}

function rawSearchMode(){ return $("#searchModeSelect").value==="max" ? "max" : "standard"; }
function searchMode(){ return ACTIVE_SEARCH_MODE || rawSearchMode(); }

function materialType(name){
  return MATERIAL_PROGRESS[name]?.category || "gather";
}

function comfortLimit(name){
  // Search Settings now define the actual material comfort threshold.
  return standardSoftCap(name);
}

function typeMultiplier(name){
  const t=materialType(name);
  if(t==="granary") return 4.0;
  if(t==="animal") return 2.2;
  if(t==="crop") return 1.7;
  return 1.0;
}

function capValue(id,fallback){
  if(ACTIVE_CAPS && ACTIVE_CAPS[id]!==undefined) return ACTIVE_CAPS[id];
  const el=$(id);
  const v=el ? +el.value : fallback;
  return Number.isFinite(v) && v>=1 ? v : fallback;
}
function standardSoftCap(name){
  const t=materialType(name);
  if(t==="granary") return capValue("#capGranary",12);
  if(t==="animal") return capValue("#capAnimal",16);
  if(t==="crop") return capValue("#capCrop",20);
  return capValue("#capGather",25);
}

function wouldExceedStandardCap(currentMaterials,item,workshops){
  if(searchMode()!=="standard") return false;
  for(const m of (item.materials||[])){
    const after=(currentMaterials[m.name]||0) + m.qty*workshops;
    if(after>standardSoftCap(m.name)) return true;
  }
  return false;
}

function materialAge(name){
  const current=+$("#rank").value;
  const unlock=MATERIAL_UNLOCK[name] || current;
  return Math.max(0,current-unlock);
}


function materialWeight(name){
  if(searchMode()==="max") return 0;

  const age=materialAge(name);
  let ageWeight;
  if(age>=10) ageWeight=0.70;
  else if(age>=7) ageWeight=0.82;
  else if(age>=4) ageWeight=0.95;
  else if(age>=2) ageWeight=1.08;
  else if(age>=1) ageWeight=1.18;
  else ageWeight=1.30;

  return ageWeight * typeMultiplier(name);
}

function materialCostForQty(name,qty){
  if(searchMode()==="max") return 0;
  const w=materialWeight(name);
  const limit=comfortLimit(name);

  // Up to the comfort amount, cost is intentionally gentle.
  const baseQty=Math.min(qty,limit);
  let cost=baseQty*w*1.4;

  // Once the material passes the comfort line, every extra piece
  // becomes progressively more expensive.
  const over=Math.max(0,qty-limit);
  cost += over*over*w*22.0;

  // If it keeps climbing well past the comfort line, strongly encourage
  // the search to switch to other materials.
  const severe=Math.max(0,qty-(limit+8));
  cost += severe*severe*w*42.0;

  return cost;
}

function materialBurden(materials){
  if(searchMode()==="max") return 0;

  const entries=Object.entries(materials||{});
  let p=0;
  for(const [name,qty] of entries){
    p += materialCostForQty(name,qty);
  }

  // A moderate spread is useful on the island, but do not reward
  // infinite variety. This only acts as a tie-breaker.
  const unique=entries.filter(([_,qty])=>qty>0).length;
  const diversityCredit=Math.min(unique,16)*18;

  return Math.max(0,p-diversityCredit);
}

function incrementalMaterialBurden(currentMaterials,item,workshops){
  if(searchMode()==="max") return 0;

  let delta=0;
  for(const m of (item.materials||[])){
    const before=currentMaterials[m.name]||0;
    const after=before + m.qty*workshops;
    delta += materialCostForQty(m.name,after)-materialCostForQty(m.name,before);
  }
  return delta;
}


function capViolationScore(materials){
  if(searchMode()!=="standard") return 0;
  let score=0;
  for(const [name,qty] of Object.entries(materials||{})){
    const over=Math.max(0,qty-standardSoftCap(name));
    score += over*over*10000;
  }
  return score;
}

function practicalBurden(materials,days){
  return materialBurden(materials)+capViolationScore(materials);
}

function earlyGrooveBonus(dayIndex, isEff, grooveBefore, grooveAfter, grooveCapValue){
  if(!isEff || grooveAfter<=grooveBefore) return 0;

  // Early groove has more future crafts to benefit from.
  // Day 1 is strongest, Day 2 medium, Day 3 light, Days 4-5 no extra bonus.
  const dayWeight = [115, 65, 22, 0, 0][dayIndex] ?? 0;
  const gained = grooveAfter-grooveBefore;

  // While far from cap, gaining groove is especially useful.
  const remainingRatio = grooveCapValue>0
    ? Math.max(0,(grooveCapValue-grooveBefore)/grooveCapValue)
    : 0;

  return dayWeight * gained * (0.75 + remainingRatio*0.25);
}

function candidateBaseScore(item, prev, grooveAfter, favorRemaining, currentMaterials, workshops, dayIndex=0, grooveBefore=0, grooveCapValue=0){
  let score = (item.value / item.time) * 12;
  const eff = efficient(prev,item);
  if(eff) score += 1400;
  score *= (1 + grooveAfter/100);

  if(favorRemaining && favorRemaining[item.id] > 0){
    score += 2500 + favorRemaining[item.id] * 40;

    // v1.1.5: one efficient craft with 4 workshops produces 8 items,
    // enough to finish any of the 4h/6h/8h Favor requests in one placement.
    // Therefore Favor is strongly preferred AFTER a compatible setup item.
    if(eff){
      score += 5200;
    }else if(prev){
      score -= 2600;
    }else{
      // Do not waste a Favor target in the first slot of a day when it cannot
      // receive efficient-production bonus. It remains legal as a fallback.
      score -= 3600;
    }

    // 4h Favor remains welcome during days 1-2 because it fits groove growth.
    if(dayIndex<=1 && item.time===4) score += 900;
  }

  if(ACTIVE_WANTED_ITEMS?.has(item.id) && eff){
    // Wanted products are preferred only inside an already-valid efficient chain.
    score += 900;
  }

  // Small reverse-planning nudge for a setup item that can lead into a wanted
  // product on the next craft. This is deliberately weaker than the normal
  // あわせて生産 bonus (+1400 above).
  score += wantedSetupBonus(item);

  if(prev && prev.id===item.id) score -= 5000;

  // Key v0.11 behavior:
  // as soon as a material is already near/over its comfort amount,
  // adding more of it becomes unattractive before the day is finalized.
  score -= incrementalMaterialBurden(currentMaterials||{},item,workshops) * 5.5;

  // Cross-week rotation: recent material use is only a gentle tie-breaker.
  // It never acts as a ban and is much weaker than this week's material limits.
  score -= historyMaterialPenalty(item,workshops);

  // Early groove remains valuable, but v0.35 also uses explicit weekly phases.
  score += earlyGrooveBonus(
    dayIndex,
    efficient(prev,item),
    grooveBefore,
    grooveAfter,
    grooveCapValue
  );

  score += phaseItemBias(item,prev,dayIndex,grooveBefore,grooveCapValue);
  score += favorPlacementBias(item,favorRemaining,dayIndex,grooveBefore,grooveCapValue);

  return score;
}

function cloneFavor(obj){
  const x={};
  for(const k in obj) x[k]=obj[k];
  return x;
}
function favorKey(obj){
  return Object.keys(obj).sort((a,b)=>a-b).map(k=>`${k}:${obj[k]}`).join("|");
}
function applyProductionToFavor(favor,itemId,qty){
  if(favor[itemId]!==undefined){
    favor[itemId]=Math.max(0,favor[itemId]-qty);
  }
}
function favorPenalty(favor){
  let miss=0;
  for(const k in favor) miss += favor[k];
  return miss;
}

function favorHoursNeededConservative(favor,workshops){
  let hours=0;
  for(const [idStr,remaining] of Object.entries(favor||{})){
    if(remaining<=0) continue;
    const item=ITEMS.find(i=>i.id===+idStr);
    if(!item) continue;
    // One normal production of a shared schedule produces `workshops` items.
    // Ignore efficient-production doubling here: this is intentionally conservative.
    hours += Math.ceil(remaining/workshops)*item.time;
  }
  return hours;
}

function canReserveFavorForDays3to5(favor,workshops){
  return favorHoursNeededConservative(favor,workshops)<=72;
}


const DAY_SEARCH_CACHE=new Map();

function compactMaterialKey(materials){
  // Small deterministic key for cache lookup.
  return Object.entries(materials||{})
    .filter(([,q])=>q>0)
    .map(([n,q])=>`${MATERIAL_INDEX[n]??n}:${q}`)
    .sort()
    .join(".");
}

function daySearchCacheKey(avail,workshops,cap,startGroove,startFavor,startMaterials,beamWidth,dayIndex){
  // available items are stable for a generation run; include ids so exclusions/rank stay safe.
  const availKey=avail.map(i=>i.id).join(",");
  return [
    dayIndex,workshops,cap,startGroove,beamWidth,
    favorKey(startFavor||{}),
    compactMaterialKey(startMaterials||{}),
    availKey
  ].join("|");
}

function cloneDayCandidates(rows){
  // Search results are treated as immutable by the weekly layer, shallow cloning is enough.
  return rows.map(r=>({
    ...r,
    favor:cloneFavor(r.favor),
    materials:{...(r.materials||{})},
    dayMaterials:{...(r.dayMaterials||{})},
    slots:[...(r.slots||[])]
  }));
}

function daySearch(avail, workshops, cap, startGroove, startFavor, startMaterials={}, beamWidth=180, dayIndex=0){
  // Beam-search all 24h sequences. State contains time, prev, groove, favor remaining and value.
  let beam=[{
    time:0, prev:null, groove:startGroove, favor:cloneFavor(startFavor),
    value:0, effTransitions:0, favorEffCompletions:0,
    slots:[], materials:{...startMaterials}, dayMaterials:{},
    burden:materialBurden(startMaterials||{})
  }];

  const bestByKey = new Map();

  while(true){
    let expanded=[];
    let any=false;
    for(const st of beam){
      if(st.time===24){
        expanded.push(st);
        continue;
      }
      let fits=avail.filter(i=>st.time+i.time<=24);

      // v1.1.3:
      // Reserve Favor for days 3-5 whenever the remaining requests fit there
      // even without efficient-production doubling. This keeps days 1-2 focused
      // on groove growth. Only when 72h is insufficient may Favor move forward.
      if(dayIndex<=1 && favorEnabled() && canReserveFavorForDays3to5(st.favor,workshops)){
        // 4h Favor is compatible with the early groove-growth plan, so allow it.
        // Keep 6h/8h Favor reserved for days 3-5 whenever the late window is sufficient.
        const earlyAllowedFits=fits.filter(i=>
          (st.favor?.[i.id]||0)<=0 || i.time===4
        );
        if(earlyAllowedFits.length) fits=earlyAllowedFits;
      }

      // v0.38 groove-growth rule:
      // During days 1-2, use 4h crafts only while current groove is below
      // the CURRENT progression cap (25 / 35 / 45 etc.).
      // The instant the cap is reached, release the restriction even if
      // there are hours left in the same day.
      if(dayIndex<=1 && st.groove<cap){
        const fourHourFits=fits.filter(i=>i.time===4);
        if(fourHourFits.length) fits=fourHourFits;
      }

      // v0.41 structural pruning:
      // Prefer staying under material caps first. Within that practical pool,
      // if an efficient continuation exists, non-efficient branches are not
      // worth exploring except an unfinished Favor target.
      if(st.prev && fits.length){
        let practicalPool=fits;
        if(searchMode()==="standard"){
          const underCap=fits.filter(item=>!wouldExceedStandardCap(st.materials,item,workshops));
          if(dayIndex>=2 && favorEnabled()){
            const requiredFavor=fits.filter(item=>(st.favor?.[item.id]||0)>0);
            if(underCap.length || requiredFavor.length){
              const seen=new Set();
              practicalPool=[...requiredFavor,...underCap].filter(item=>{
                if(seen.has(item.id)) return false;
                seen.add(item.id);
                return true;
              });
            }
          }else if(underCap.length){
            practicalPool=underCap;
          }
        }

        const efficientPool=practicalPool.filter(item=>efficient(st.prev,item));
        if(efficientPool.length){
          // v1.1.5: when an efficient continuation exists, stay on efficient
          // production. This prevents an unfinished Favor from being inserted
          // non-efficiently (4 items) when it can instead be completed as 8.
          fits=efficientPool;
        }else{
          fits=practicalPool;
        }
      }

      if(!fits.length){
        expanded.push(st);
        continue;
      }
      any=true;

      // Pre-rank choices to keep browser search manageable.
      const hasEfficientChoice=!!st.prev && fits.some(item=>efficient(st.prev,item));

      let ranked=fits.map(item=>{
        const isEff=efficient(st.prev,item);
        const grooveAfter=isEff?Math.min(cap,st.groove+workshops):st.groove;

        let rank=candidateBaseScore(
          item,st.prev,grooveAfter,st.favor,st.materials,workshops,
          dayIndex,st.groove,cap
        );

        // v0.39: "あわせて生産" doubles output, so if an efficient
        // continuation exists, a non-efficient choice needs a very good reason.
        if(hasEfficientChoice && !isEff) rank -= 1200;

        return {
          item,
          rank,
          overCap:wouldExceedStandardCap(st.materials,item,workshops)
        };
      }).sort((a,b)=>b.rank-a.rank);

      // Stay under the weekly soft caps whenever at least one valid choice exists.
      // Only fall back to over-cap choices if every continuation would exceed a cap.
      if(searchMode()==="standard"){
        const underCap=ranked.filter(x=>!x.overCap);
        if(dayIndex>=2 && favorEnabled()){
          const requiredFavor=ranked.filter(x=>(st.favor?.[x.item.id]||0)>0);
          if(underCap.length || requiredFavor.length){
            const seen=new Set();
            ranked=[...requiredFavor,...underCap].filter(x=>{
              if(seen.has(x.item.id)) return false;
              seen.add(x.item.id);
              return true;
            }).sort((a,b)=>b.rank-a.rank);
          }
        }else if(underCap.length){
          ranked=underCap;
        }
      }

      // Keep CPU-friendly branching, but never trim unfinished Favor on days 3-5.
      if(dayIndex>=2 && favorEnabled()){
        const requiredRanked=ranked.filter(x=>(st.favor?.[x.item.id]||0)>0);
        const normalRanked=ranked.filter(x=>(st.favor?.[x.item.id]||0)<=0);
        ranked=[...requiredRanked,...normalRanked.slice(0,6)];
      }else{
        ranked=ranked.slice(0,6);
      }

      for(const {item} of ranked){
        const isEff=efficient(st.prev,item);
        const grooveBefore=st.groove;
        const grooveAfter=isEff?Math.min(cap,st.groove+workshops):st.groove;
        const qty=workshops*(isEff?2:1);
        const value=Math.round(item.value*qty*(1+grooveAfter/100));
        const favor=cloneFavor(st.favor);
        const favorBefore=st.favor?.[item.id]||0;
        applyProductionToFavor(favor,item.id,qty);
        const favorCompletedEfficiently = isEff && favorBefore>0 && (favor[item.id]||0)===0;
        const materials=addMaterials(st.materials,item,workshops);
        const dayMaterials=addMaterials(st.dayMaterials,item,workshops);
        const burden=materialBurden(materials);
        expanded.push({
          time:st.time+item.time,
          prev:item,
          groove:grooveAfter,
          favor,
          value:st.value+value,
          effTransitions:st.effTransitions+(isEff?1:0),
          favorEffCompletions:(st.favorEffCompletions||0)+(favorCompletedEfficiently?1:0),
          materials,
          dayMaterials,
          burden,
          slots:[...st.slots,{
            item,start:st.time,end:st.time+item.time,eff:isEff,qty,
            grooveBefore,grooveAfter,valueWithGroove:value
          }]
        });
      }
    }

    if(!any) break;

    bestByKey.clear();
    for(const st of expanded){
      // v0.39: coarse material bucket avoids treating tiny material
      // differences as completely separate branches.
      const matLoad=Math.round((st.burden||0)/120);
      const key=`${st.time}|${st.prev?st.prev.id:0}|${st.groove}|${favorKey(st.favor)}|${matLoad}`;
      const old=bestByKey.get(key);
      if(!old){
        bestByKey.set(key,st);
      }else{
        const stBurden=st.burden||0;
        const oldBurden=old.burden||0;
        const dominates =
          (st.value>=old.value && stBurden<=oldBurden) &&
          (st.value>old.value || stBurden<oldBurden);
        if(dominates || (st.value>old.value && stBurden<=oldBurden*1.03)){
          bestByKey.set(key,st);
        }
      }
    }

    beam=[...bestByKey.values()].sort((a,b)=>{
      // Favor shortfall dominates; then value, then groove, then efficient transitions.
      const pa=favorPenalty(a.favor), pb=favorPenalty(b.favor);
      const favorWeight = dayIndex>=2 ? 4200 : 0;
      const sa=a.value + a.groove*80 + a.effTransitions*40 + (a.favorEffCompletions||0)*1800 - pa*favorWeight - (a.burden||0);
      const sb=b.value + b.groove*80 + b.effTransitions*40 + (b.favorEffCompletions||0)*1800 - pb*favorWeight - (b.burden||0);
      return sb-sa;
    }).slice(0,beamWidth);

    if(beam.every(x=>x.time===24)) break;
  }

  const result=beam.filter(x=>x.time===24).sort((a,b)=>{
    const pa=favorPenalty(a.favor), pb=favorPenalty(b.favor);
    if(pa!==pb) return pa-pb;
    if(searchMode()==="standard"){
      const ba=practicalBurden(a.materials), bb=practicalBurden(b.materials);
      if(ba!==bb) return ba-bb;
    }
    return b.value-a.value;
  }).slice(0,24);
  return result;
}


function daySignature(slots){
  return (slots||[]).map(s=>s.item.id).join("-");
}


function growthPhase(dayIndex, groove, cap){
  if(groove>=cap) return "profit";
  if(dayIndex<=1) return "growth";
  if(dayIndex===2) return "transition";
  return "profit";
}

function phaseItemBias(item, prev, dayIndex, groove, cap){
  // v0.36: no duration is forced.
  // 4h / 6h / 8h all remain valid; the 48h ROI evaluation decides whether
  // faster groove or higher immediate value is better for the whole week.
  return 0;
}

function favorPlacementBias(item, favorRemaining, dayIndex, groove, cap){
  if(!favorEnabled() || !favorRemaining?.[item.id]) return 0;

  // v1.1.5: Favor should preferably be completed by efficient production.
  // The actual efficient check is applied in candidateBaseScore where `prev` exists.
  if(dayIndex<=1 && item.time===4) return 180;
  if(dayIndex>=2 && item.time>=6) return 180;
  return 80;
}


function representativeValuePerHour(avail){ return 0; }
function futureGrooveROI(groove, completedDays, avail, workshops){ return 0; }
function early48Score(wk, completedDays, avail, workshops, cap){ return 0; }

function grooveTimingScore(wk, grooveCapValue){
  if(searchMode()!=="standard") return 0;
  const h=wk.grooveHistory||[];
  if(!h.length || grooveCapValue<=0) return 0;

  // Desired end-of-day progression for the phase algorithm:
  // Day1 ~45%, Day2 ~90%, Day3 100%.
  const targets=[0.45,0.90,1.00,1.00,1.00];

  let score=0;
  for(let d=0;d<h.length;d++){
    const g=h[d];
    const target=grooveCapValue*targets[d];
    const deficit=Math.max(0,target-g);

    // Missing an early target is costly because later crafts lose the groove bonus.
    const deficitWeight=[90,135,180,50,10][d]||0;
    score -= deficit*deficitWeight;

    // Earlier groove gets additional positive value.
    const carryWeight=[65,48,26,10,2][d]||0;
    score += g*carryWeight;
  }
  return score;
}


function materialStateBurdenForBeam(wk){
  return wk.burden ?? practicalBurden(wk.materials||{},wk.days||[]);
}

function mergeUniqueWeeks(groups, limit){
  const seen=new Set();
  const out=[];
  for(const group of groups){
    for(const wk of group){
      const matBucket=Math.round(materialStateBurdenForBeam(wk)/150);
      const valueBucket=Math.round(wk.value/400);
      const key=`${wk.groove}|${favorKey(wk.favor)}|${valueBucket}|${matBucket}|${wk.daySignatures?.join("/")||""}`;
      if(seen.has(key)) continue;
      seen.add(key);
      out.push(wk);
      if(out.length>=limit) return out;
    }
  }
  return out;
}

function preserveEarlyWeekDiversity(weeks, dayIndex, cap){
  // v0.38: the cap-aware 4h growth rule makes the expensive wide search unnecessary.
  return weeks.slice(0,48);
}

function chooseSchedule(){
  ACTIVE_SEARCH_MODE=rawSearchMode();
  ACTIVE_CAPS={
    "#capGather":+$("#capGather").value,
    "#capCrop":+$("#capCrop").value,
    "#capAnimal":+$("#capAnimal").value,
    "#capGranary":+$("#capGranary").value
  };
  ACTIVE_HISTORY_MATERIALS=ACTIVE_SEARCH_MODE==="standard" ? weightedHistoryMaterials() : {};
  ACTIVE_WANTED_ITEMS=new Set([...wantedItems].filter(id=>ITEMS.some(i=>i.id===id)));

  const avail=available();
  if(!avail.length) throw new Error("使用可能な島産品がありません。");

  const workshops=+$("#workshops").value;
  const cap=grooveCap();

  const favorStart={};
  const targets=[];
  if(favorEnabled()){
    for(const [t,n] of [[4,8],[6,6],[8,8]]){
      const id=+$("#favor"+t).value;
      if(!id) throw new Error(`${t}時間品のお願いを選択してください。`);
      const item=ITEMS.find(x=>x.id===id);
      if(!item) throw new Error(`${t}時間品が現在の条件では使用できません。`);
      if(itemUsesExcludedMaterial(item)){
        const names=(item.materials||[]).filter(m=>excludedMaterials.has(m.name)).map(m=>m.name).join("、");
        throw new Error(`ねこみみさんのおねがいの${t}時間品に、除外した素材（${names}）が含まれています。`);
      }
      if(!avail.some(x=>x.id===id)) throw new Error(`${t}時間品が現在の条件では使用できません。`);
      favorStart[id]=n;
      targets.push(id);
    }
  }

  // Weekly beam: each branch chooses one complete 24h day schedule.
  let weekBeam=[{
    day:0, groove:0, favor:cloneFavor(favorStart), value:0,
    effTransitions:0, days:[], produced:{}, materials:{}, burden:0, daySignatures:[], grooveHistory:[]
  }];

  const WEEK_BEAM=28;

  for(let day=0;day<5;day++){
    let next=[];
    for(const wk of weekBeam){
      const dayCandidates=daySearch(avail,workshops,cap,wk.groove,wk.favor,wk.materials,28,day);

      for(const dc of dayCandidates.slice(0,8)){
        const produced={...wk.produced};
        for(const sl of dc.slots){
          produced[sl.item.id]=(produced[sl.item.id]||0)+sl.qty;
        }
        const materials={...wk.materials};
        for(const [name,qty] of Object.entries(dc.dayMaterials||{})){
          materials[name]=(materials[name]||0)+qty;
        }
        const sig=daySignature(dc.slots);
        const prevSig=wk.daySignatures.length ? wk.daySignatures[wk.daySignatures.length-1] : null;

        // In standard mode, do not repeat the exact same day back-to-back.
        // Highest-efficiency mode is allowed to repeat if it is mathematically best.
        if(searchMode()==="standard" && prevSig && sig===prevSig){
          continue;
        }

        const weeklyBurden=practicalBurden(materials,[...wk.days,dc.slots]);

        next.push({
          day:day+1,
          groove:dc.groove,
          favor:cloneFavor(dc.favor),
          value:wk.value+dc.value,
          effTransitions:wk.effTransitions+dc.effTransitions,
          days:[...wk.days,dc.slots],
          produced,
          materials,
          burden:weeklyBurden,
          daySignatures:[...wk.daySignatures,sig],
          grooveHistory:[...wk.grooveHistory,dc.groove]
        });
      }
    }

    next.sort((a,b)=>{
      const pa=favorPenalty(a.favor), pb=favorPenalty(b.favor);
      // Before final day, remaining favors are a strong penalty but not absolute,
      // so optimizer can build groove first when useful.
      const remainingDays=5-(day+1);
      const favorWeekWeight =
        day<=1 ? 0 :
        remainingDays===0 ? 1000000 :
        remainingDays===1 ? 18000 :
        9000;
      const aFeasiblePenalty=pa * favorWeekWeight;
      const bFeasiblePenalty=pb * favorWeekWeight;
      const burdenA=a.burden ?? practicalBurden(a.materials,a.days);
      const burdenB=b.burden ?? practicalBurden(b.materials,b.days);

      if(searchMode()==="standard"){
        // Standard mode: material burden dominates.
        // Value/groove only break ties between similarly easy schedules.
        const sa = -(burdenA*4.5) + a.value*0.24 + a.groove*70 + a.effTransitions*12 + wantedWeekBonus(a.days) - aFeasiblePenalty;
        const sb = -(burdenB*4.5) + b.value*0.24 + b.groove*70 + b.effTransitions*12 + wantedWeekBonus(b.days) - bFeasiblePenalty;
        return sb-sa;
      }else{
        const sa=a.value + a.groove*95 + a.effTransitions*30 + wantedWeekBonus(a.days) - aFeasiblePenalty;
        const sb=b.value + b.groove*95 + b.effTransitions*30 + wantedWeekBonus(b.days) - bFeasiblePenalty;
        return sb-sa;
      }
    });

    // v0.37:
    // For the first 48h, preserve multiple trade-offs instead of collapsing
    // them to one "best-looking" intermediate state.
    if(day<=1){
      weekBeam=preserveEarlyWeekDiversity(next,day,cap);
    }else{
      // After the 48h investment window, keep a broader but conventional beam.
      const dedup=new Map();
      for(const wk of next){
        const matBucket=Math.round(materialStateBurdenForBeam(wk)/200);
        const valueBucket=Math.round(wk.value/500);
        const key=`${wk.groove}|${favorKey(wk.favor)}|${valueBucket}|${matBucket}`;
        const old=dedup.get(key);

        if(!old){
          dedup.set(key,wk);
          continue;
        }

        if(searchMode()==="standard"){
          const oldScore=old.value-materialStateBurdenForBeam(old)*3.5+wantedWeekBonus(old.days);
          const newScore=wk.value-materialStateBurdenForBeam(wk)*3.5+wantedWeekBonus(wk.days);
          if(newScore>oldScore) dedup.set(key,wk);
        }else{
          if(wk.value>old.value) dedup.set(key,wk);
        }
      }

      weekBeam=[...dedup.values()].sort((a,b)=>{
        const pa=favorPenalty(a.favor), pb=favorPenalty(b.favor);
        if(day===4 && pa!==pb) return pa-pb;

        if(searchMode()==="standard"){
          const sa=a.value-materialStateBurdenForBeam(a)*3.5+wantedWeekBonus(a.days);
          const sb=b.value-materialStateBurdenForBeam(b)*3.5+wantedWeekBonus(b.days);
          return sb-sa;
        }
        return b.value-a.value;
      }).slice(0,WEEK_BEAM);
    }
  }

  if(!weekBeam.length) throw new Error("現在の条件では5日分のスケジュールを生成できません。");

  // If favors are enabled, only accept fully satisfied schedules.
  let candidates=weekBeam;
  if(favorEnabled()){
    const satisfied=weekBeam.filter(w=>favorPenalty(w.favor)===0);
    if(!satisfied.length){
      const best=weekBeam.slice().sort((a,b)=>favorPenalty(a.favor)-favorPenalty(b.favor))[0];
      let details=[];
      for(const id of targets){
        const item=ITEMS.find(i=>i.id===id);
        const need=item.time===6?6:8;
        const got=Math.min(need,best.produced[id]||0);
        if(got<need) details.push(`${item.name}: ${got}/${need}`);
      }
      throw new Error(`現在の条件では、ねこみみさんのおねがいを絶対達成できる案が見つかりません。${details.length?"（"+details.join(" / ")+"）":""}`);
    }
    candidates=satisfied;
  }

  let best;
  if(searchMode()==="max"){
    best=candidates.slice().sort((a,b)=>(b.value+wantedWeekBonus(b.days))-(a.value+wantedWeekBonus(a.days)))[0];
  }else{
    best=candidates.slice().sort((a,b)=>{
      const burdenA=a.burden ?? practicalBurden(a.materials,a.days);
      const burdenB=b.burden ?? practicalBurden(b.materials,b.days);

      // Final decision uses the actually calculated five-day value.
      // No future-value estimate is used here.
      const scoreA=a.value-burdenA*3.5+wantedWeekBonus(a.days);
      const scoreB=b.value-burdenB*3.5+wantedWeekBonus(b.days);
      return scoreB-scoreA;
    })[0];
  }

  const favorNeeds=new Map();
  for(const id of targets){
    favorNeeds.set(id,best.favor[id]||0);
  }

  const usedCount=new Map();
  for(const [id,qty] of Object.entries(best.produced||{})){
    usedCount.set(+id,qty);
  }

  const totalSlots=best.days.reduce((sum,day)=>sum+day.length*workshops,0);

  return{
    days:best.days,
    workshops,
    targets,
    favorNeeds,
    usedCount,
    estimatedValue:best.value,
    effTransitions:best.effTransitions,
    totalSlots,
    groove:best.groove,
    grooveCap:cap,
    materials:best.materials||{},
    materialPenalty:practicalBurden(best.materials||{},best.days||[])
  };
}

function snapshotSchedule(){
  return LAST ? LAST.days.map(day=>day.map(s=>s.item.id)) : null;
}
function restoreSchedule(snapshot){
  if(!LAST || !snapshot) return;
  LAST.days=snapshot.map(day=>day.map(id=>({item:ITEMS.find(i=>i.id===id)})));
  recalculateManualSchedule();
}
function updateEditButtons(){
  const u=$("#undoEdit"),r=$("#redoEdit");
  if(u)u.disabled=!EDIT_UNDO.length;
  if(r)r.disabled=!EDIT_REDO.length;
}
function currentFavorStart(){
  const out={};
  if(!favorEnabled()) return out;
  for(const [t,n] of [[4,8],[6,6],[8,8]]){
    const id=+$("#favor"+t).value;
    if(id)out[id]=n;
  }
  return out;
}
function recalculateManualSchedule(){
  if(!LAST)return;
  const workshops=LAST.workshops,cap=LAST.grooveCap;
  let groove=0,value=0,effTransitions=0;
  let materials={},produced={},favor=currentFavorStart();
  const rebuilt=[];

  for(const day of LAST.days){
    let prev=null,time=0;
    const slots=[];
    for(const old of day){
      const item=old.item||ITEMS.find(i=>i.id===old);
      const isEff=efficient(prev,item);
      const grooveBefore=groove;
      const grooveAfter=isEff?Math.min(cap,groove+workshops):groove;
      const qty=workshops*(isEff?2:1);
      const slotValue=Math.round(item.value*qty*(1+grooveAfter/100));
      applyProductionToFavor(favor,item.id,qty);
      produced[item.id]=(produced[item.id]||0)+qty;
      materials=addMaterials(materials,item,workshops);
      slots.push({item,start:time,end:time+item.time,eff:isEff,qty,grooveBefore,grooveAfter,valueWithGroove:slotValue});
      time+=item.time; value+=slotValue; if(isEff)effTransitions++;
      groove=grooveAfter; prev=item;
    }
    rebuilt.push(slots);
  }
  LAST.days=rebuilt;
  LAST.estimatedValue=value;
  LAST.effTransitions=effTransitions;
  LAST.groove=groove;
  LAST.materials=materials;
  LAST.usedCount=new Map(Object.entries(produced).map(([id,q])=>[+id,q]));
  LAST.favorNeeds=new Map((LAST.targets||[]).map(id=>[id,favor[id]||0]));
  LAST.totalSlots=rebuilt.reduce((s,d)=>s+d.length*workshops,0);
  LAST.materialPenalty=practicalBurden(materials,rebuilt);
  renderSummary();renderDay(activeDay);renderMaterials();updateEditButtons();
}
function replacementFit(prev,item,next){
  const before=!!prev&&efficient(prev,item);
  const after=!!next&&efficient(item,next);
  const rank=before&&after?3:before?2:after?1:0;
  return {before,after,rank};
}
function closeReplacePopover(){
  const p=$("#replacePopover"); if(p)p.hidden=true;
  REPLACE_CTX=null;
}
function positionReplacePopover(row){
  const p=$("#replacePopover"),r=row.getBoundingClientRect();
  p.hidden=false;
  const w=Math.min(430,window.innerWidth-24);
  let left=Math.min(window.innerWidth-w-12,Math.max(12,r.left+60));
  let top=r.bottom+8;
  if(top+Math.min(560,window.innerHeight-24)>window.innerHeight) top=Math.max(12,r.top-430);
  p.style.left=left+"px";p.style.top=top+"px";
}
function openReplacement(dayIndex,slotIndex,row){
  if(!LAST)return;
  const slots=LAST.days[dayIndex],slot=slots[slotIndex];
  REPLACE_CTX={dayIndex,slotIndex,current:slot.item};
  REPLACE_SHOW_ALL=false;
  $("#replaceTitle").textContent=`現在：${slot.item.name}（${slot.item.time}H）`;
  renderReplacementCandidates();
  positionReplacePopover(row);
}
function replacementCandidates(){
  if(!REPLACE_CTX)return [];
  const {dayIndex,slotIndex,current}=REPLACE_CTX;
  const day=LAST.days[dayIndex],prev=slotIndex?day[slotIndex-1].item:null,next=slotIndex<day.length-1?day[slotIndex+1].item:null;
  return available()
    .filter(i=>i.id!==current.id && i.time===current.time)
    .map(item=>({item,fit:replacementFit(prev,item,next)}))
    .sort((a,b)=>b.fit.rank-a.fit.rank || b.item.value-a.item.value || collator.compare(a.item.name,b.item.name));
}
function renderReplacementCandidates(){
  if(!REPLACE_CTX)return;
  const all=replacementCandidates(),shown=REPLACE_SHOW_ALL?all:all.slice(0,6);
  $("#replaceCandidates").innerHTML=shown.length?shown.map(({item,fit})=>{
    const cls=fit.rank===3?"both":fit.rank===2?"before":fit.rank===1?"after":"none";
    const mark=fit.rank===3?"◎":fit.rank===2?"○":fit.rank===1?"△":"×";
    const text=fit.rank===3?"前後一致":fit.rank===2?"手前一致":fit.rank===1?"後ろ一致":"一致なし";
    return `<button class="replace-candidate" data-id="${item.id}">
      <span class="replace-fit ${cls}" title="${text}">${mark}</span>
      <span>
        <div class="replace-candidate-name">${item.name}</div>
        <div class="replace-candidate-meta">${item.cats.join(" / ")}</div>
      </span>
      <span class="replace-candidate-side">
        <span class="replace-base-value">基本価値 ${item.value.toLocaleString()}</span>
        <span class="replace-candidate-time">${item.time}H</span>
      </span>
    </button>`;
  }).join(""):`<div class="replace-empty">条件に合う候補がありません。</div>`;
  $("#replaceCandidates").querySelectorAll("button").forEach(b=>b.onclick=()=>replaceCurrentItem(+b.dataset.id));
  const more=$("#replaceShowAll");
  if(!REPLACE_SHOW_ALL && all.length>6){more.hidden=false;more.textContent=`すべて表示（${all.length}）`;}
  else{more.hidden=true;}
}
function replaceCurrentItem(itemId){
  if(!REPLACE_CTX||!LAST)return;
  const item=ITEMS.find(i=>i.id===itemId); if(!item)return;
  EDIT_UNDO.push(snapshotSchedule()); if(EDIT_UNDO.length>30)EDIT_UNDO.shift();
  EDIT_REDO=[];
  LAST.days[REPLACE_CTX.dayIndex][REPLACE_CTX.slotIndex]={...LAST.days[REPLACE_CTX.dayIndex][REPLACE_CTX.slotIndex],item};
  closeReplacePopover();
  recalculateManualSchedule();
}

function formatCats(cats){
  return cats.map(c=>`<span class="tag">${c}</span>`).join("")
}
function renderDay(idx){
  if(!LAST)return;
  activeDay=idx;
  const slots=LAST.days[idx];
  $("#dayTitle").textContent=`${idx+1}日目の工房スケジュール（全工房共通）`;
  $("#scheduleBody").innerHTML=slots.map((s,i)=>{
    const isTarget=LAST.targets.includes(s.item.id);
    return `<tr class="${s.eff?'efficient-row':''} replaceable-row" data-slot="${i}" title="クリックして置き換え候補を表示">
      <td class="col-no"><div class="no-circle">${i+1}</div></td>
      <td class="col-name"><span class="item-name">${s.item.name}</span>${isTarget?'<span class="target-mini">お願い</span>':""}</td>
      <td class="col-time">${s.item.time}時間</td>
      <td class="col-rank">${s.item.rank}</td>
      <td class="col-cat">${formatCats(s.item.cats)}</td>
      <td class="col-value value-cell">${s.valueWithGroove.toLocaleString()}</td>
      <td class="col-eff">${s.eff
        ? `<span class="eff-badge">あわせて生産</span>`
        : `<span class="eff-none">－</span>`}</td>
      <td class="col-groove">${s.eff
        ? `${s.grooveBefore}→${s.grooveAfter}`
        : `${s.grooveAfter}`}</td>
    </tr>`
  }).join("");
  $("#scheduleBody").querySelectorAll("tr.replaceable-row").forEach(row=>row.onclick=()=>openReplacement(idx,+row.dataset.slot,row));
  $("#tabs").querySelectorAll("button").forEach((b,i)=>b.classList.toggle("active",i===idx))
}
function renderSummary(){
  const unmet=[...LAST.favorNeeds.entries()].filter(([_,n])=>n>0);
  let favorProgress="";
  if(favorEnabled()){
    favorProgress = LAST.targets.map(id=>{
      const item=ITEMS.find(i=>i.id===id);
      const need=item.time===6?6:8;
      const got=Math.min(need,LAST.usedCount.get(id)||0);
      return `${item.time}h ${got}/${need}`;
    }).join(" / ");
  }

  const status = favorEnabled()
    ? (unmet.length
        ? '<span class="status-warn">⚠ 未達</span>'
        : '<span class="status-ok">✓ 達成</span>')
    : '<span class="status-neutral">使用しない</span>';

  $("#summary").innerHTML=`
    <div class="summary-card">
      <div class="label">工房の数</div>
      <div class="value">${LAST.workshops}棟</div>
    </div>
    <div class="summary-card coin-card">
      <div class="label">概算青船貨獲得数</div>
      <div class="value">${Math.round(LAST.estimatedValue*1.5).toLocaleString()}</div>
      <div class="sub">青船貨（目安）・需要/人気度 1.5倍想定</div>
    </div>
    <div class="summary-card">
      <div class="label">あわせて生産回数</div>
      <div class="value">${LAST.effTransitions}</div>
      <div class="sub">共通スケジュール上</div>
    </div>
    <div class="summary-card">
      <div class="label">工房のやる気</div>
      <div class="value">${LAST.groove}/${LAST.grooveCap}</div>
      <div class="sub">売上 +${LAST.groove}%</div>
    </div>
    <div class="summary-card status">
      <div class="label">ねこみみ達成状況</div>
      <div class="value summary-status-value">${status}</div>
      ${favorProgress?`<div class="sub">${favorProgress}</div>`:""}
    </div>`;
}
function renderTabs(){
  $("#tabs").style.display="grid";
  $("#tabs").innerHTML=[0,1,2,3,4].map(i=>`<button class="day-tab ${i===0?"active":""}" data-day="${i}">${i+1}日目</button>`).join("");
  $("#tabs").querySelectorAll("button").forEach(b=>b.onclick=()=>renderDay(+b.dataset.day))
}

function renderMaterials(){
  if(!LAST)return;
  const rows=Object.entries(LAST.materials||{}).sort((a,b)=>b[1]-a[1] || collator.compare(a[0],b[0]));
  $("#materialPanel").style.display="block";
  $("#weekConfirmBar").style.display="flex";
  const hc=loadHistory().length;
  $("#historyStatus").textContent=hc?`確定済み履歴：${hc}週`:"";
  $("#materialGrid").innerHTML=rows.map(([name,qty])=>{
    const t=materialType(name);
    const limit=comfortLimit(name);
    const cls=qty>limit+12?"very-heavy":qty>limit?"heavy":"";
    let hint=t==="granary"?"グラナリー":t==="animal"?"飼育":t==="crop"?"作物":"採集";
    return `<div class="material-card ${cls}">
      <span class="mname">${t==="granary"?"⚠ ":""}${name} <span class="pill">${hint}</span></span>
      <span class="mqty">×${qty}</span>
    </div>`;
  }).join("");
}
function render(){
  try{LAST=chooseSchedule();EDIT_UNDO=[];EDIT_REDO=[];updateEditButtons();closeReplacePopover()}
  catch(e){
    $("#scheduleBody").innerHTML=`<tr><td colspan="7" style="text-align:center;color:#b94d4d;padding:30px">${e.message}</td></tr>`;
    return
  }
  renderSummary();
  renderTabs();
  renderDay(0);
  renderMaterials();
  $("#weekConfirmBar").style.display="flex";
  const hc=loadHistory().length;
  $("#historyStatus").textContent=hc?`確定済み履歴：${hc}週`:"";
  save()
}

$("#rank").addEventListener("change",()=>{
  $("#workshops").value=autoWorkshops(+$("#rank").value);

  // Drop exclusions for materials that are no longer relevant at the selected rank.
  const visibleNames=new Set(allMaterials().map(m=>m.name));
  excludedMaterials=new Set([...excludedMaterials].filter(name=>visibleNames.has(name)));

  renderExclude();
  fillFavorSelects();
  updateExcludeSummary();
  const visibleWanted=new Set(wantedAvailableItems().map(i=>i.id));
  wantedItems=new Set([...wantedItems].filter(id=>visibleWanted.has(id)));
  renderWanted();updateWantedSummary();
  save();
});
$("#workshops").addEventListener("change",save);
$("#landmarks").addEventListener("change",save);
$("#favorOn").addEventListener("change",()=>{
  $("#favors").classList.add("on");save()
});
$("#favorOff").addEventListener("change",()=>{
  $("#favors").classList.remove("on");save()
});
["#favor4","#favor6","#favor8"].forEach(s=>$(s).addEventListener("change",save));
$("#searchModeSelect").addEventListener("change",save);
["#capGather","#capCrop","#capAnimal","#capGranary"].forEach(sel=>$(sel).addEventListener("change",save));
$("#filter").oninput=renderExclude;
$("#wantedFilter").oninput=renderWanted;
$("#allOn").onclick=()=>{allMaterials().forEach(m=>excludedMaterials.add(m.name));renderExclude();updateExcludeSummary();fillFavorSelects();wantedItems.clear();renderWanted();updateWantedSummary();save()};
$("#allOff").onclick=()=>{excludedMaterials.clear();renderExclude();updateExcludeSummary();fillFavorSelects();renderWanted();updateWantedSummary();save()};
$("#confirmWeek").onclick=()=>{
  if(!LAST || !LAST.materials){
    $("#historyStatus").textContent="先にスケジュールを生成してください。";
    return;
  }
  const h=loadHistory();
  const materials={...LAST.materials};
  const signature=JSON.stringify(Object.entries(materials).sort(([a],[b])=>a.localeCompare(b)));
  if(h.length && h[h.length-1].signature===signature){
    $("#historyStatus").textContent="この生成結果はすでに今週分として確定済みです。";
    return;
  }
  h.push({
    confirmedAt:new Date().toISOString(),
    materials,
    signature
  });
  saveHistory(h);
  saveHistoryRedo([]);
  $("#historyStatus").textContent=`今週分を保存しました（履歴 ${loadHistory().length}週）`;
};

$("#undoWeek").onclick=()=>{
  const h=loadHistory();
  if(!h.length){
    $("#historyStatus").textContent="取り消せる履歴はありません。";
    return;
  }
  const removed=h.pop();
  saveHistory(h);
  const redo=loadHistoryRedo();redo.push(removed);saveHistoryRedo(redo);
  $("#historyStatus").textContent=`直前の確定を取り消しました（履歴 ${h.length}週）`;
};
$("#redoWeek").onclick=()=>{
  const redo=loadHistoryRedo();
  if(!redo.length){$("#historyStatus").textContent="戻せる取り消しはありません。";return;}
  const restored=redo.pop(),h=loadHistory();h.push(restored);
  saveHistory(h);saveHistoryRedo(redo);
  $("#historyStatus").textContent=`取り消した確定を戻しました（履歴 ${h.length}週）`;
};


$("#undoEdit").onclick=()=>{
  if(!EDIT_UNDO.length||!LAST)return;
  EDIT_REDO.push(snapshotSchedule());
  restoreSchedule(EDIT_UNDO.pop());
  closeReplacePopover();
};
$("#redoEdit").onclick=()=>{
  if(!EDIT_REDO.length||!LAST)return;
  EDIT_UNDO.push(snapshotSchedule());
  restoreSchedule(EDIT_REDO.pop());
  closeReplacePopover();
};
$("#replaceClose").onclick=closeReplacePopover;
$("#replaceShowAll").onclick=()=>{REPLACE_SHOW_ALL=true;renderReplacementCandidates()};
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeReplacePopover()});
document.addEventListener("click",e=>{
  const p=$("#replacePopover");
  if(!p.hidden && !p.contains(e.target) && !e.target.closest?.("tr.replaceable-row")) closeReplacePopover();
});

$("#generate").onclick=()=>{
  const btn=$("#generate");
  const status=$("#generateStatus");
  btn.disabled=true;
  btn.classList.add("generating");
  btn.textContent="⏳ 生成中…";
  status.textContent="スケジュールを計算しています。";

  setTimeout(()=>{
    try{
      render();
      status.textContent="生成完了";
    }catch(err){
      status.textContent="生成中にエラーが発生しました。";
      console.error(err);
    }finally{
      btn.disabled=false;
      btn.classList.remove("generating");
      btn.textContent="⚙ スケジュールを生成";
    }
  },30);
};
$("#saveBtn").onclick=()=>{save();alert("設定を保存しました。")};
$("#reset").onclick=()=>{
  localStorage.removeItem(STORAGE_KEY);excludedMaterials.clear();wantedItems.clear();
  $("#rank").value=5;$("#workshops").value=3;$("#landmarks").value=2;
  $("#favorOff").checked=true;$("#favorOn").checked=false;$("#favors").classList.remove("on");$("#searchModeSelect").value="standard";$("#capGather").value=25;$("#capCrop").value=20;$("#capAnimal").value=16;$("#capGranary").value=12;
  fillFavorSelects();renderExclude();updateExcludeSummary();
  $("#summary").innerHTML=`
    <div class="summary-card"><div class="label">工房の数</div><div class="value">-</div></div>
    <div class="summary-card coin-card"><div class="label">概算青船貨獲得数</div><div class="value">-</div><div class="sub">青船貨（目安）</div></div>
    <div class="summary-card"><div class="label">あわせて生産回数</div><div class="value">-</div></div>
    <div class="summary-card"><div class="label">やる気</div><div class="value">-</div></div>
    <div class="summary-card status"><div class="label">ねこみみ達成状況</div><div class="value">未生成</div></div>`;
  $("#scheduleBody").innerHTML=`<tr><td colspan="7" style="text-align:center;color:#777;padding:30px">条件を設定して「スケジュールを生成」を押してください。</td></tr>`;
  $("#tabs").style.display="none";
  $("#materialPanel").style.display="none";
  $("#generateStatus").textContent="";
  LAST=null;EDIT_UNDO=[];EDIT_REDO=[];updateEditButtons();closeReplacePopover()
};
load();
