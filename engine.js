// ════════════════════════════════════════════════════════
//  engine.js — Hydraulic P&ID v14
//  State + Calc + Draw  |  لو عايز تعدل حسابات → ابعت الملف ده
// ════════════════════════════════════════════════════════

// ── CONSTANTS ─────────────────────────────────────────────
const SNAP_GRID=20,HIT_RADIUS=28,VALVE_HIT_R=18,PIPE_HIT_W=13;
const PIPE_HIT_T_MIN=0.08,PIPE_HIT_T_MAX=0.92;
const LABEL_ZOOM_MIN=0.45,LABEL_ZOOM_SML=0.32,GRID_STEP=40;
const ZOOM_MIN=0.08,ZOOM_MAX=8,HISTORY_LIMIT=30;
const AUTOSAVE_KEY='hydraulic_pid_v14';
const uid=()=>Math.random().toString(36).slice(2,9)+Date.now().toString(36);

// ── CORE SETUP ─────────────────────────────────────────────
const cv=document.getElementById('cv'),ctx=cv.getContext('2d'),wrap=document.getElementById('cvwrap');
let W,H,zoom=1,panX=0,panY=0,isPanning=false,panStart={x:0,y:0};
let rafPending=false;
function scheduleDraw(){if(!rafPending){rafPending=true;requestAnimationFrame(()=>{draw();rafPending=false;});}}
function rsz(){W=wrap.clientWidth;H=wrap.clientHeight;cv.width=W;cv.height=H;scheduleDraw();}
const ro=new ResizeObserver(rsz);ro.observe(wrap);

function isDark(){return document.body.classList.contains('dark');}

let _flashT=null;
function showFlash(msg,col){
  const el=document.getElementById('flash');if(!el)return;
  el.textContent=msg;el.style.color=col||'var(--txt2)';el.style.opacity='1';
  if(_flashT)clearTimeout(_flashT);
  _flashT=setTimeout(()=>{el.style.opacity='0';},1600);
}

// ── LABEL QUEUE — anti-overlap ─────────────────────────────
let _lblQ=[];
function qLbl(text,wx,wy,clr,pri){_lblQ.push({text,wx,wy,clr:clr||'#555',pri:pri||0});}
function flushLabels(){
  if(!_lblQ.length)return;
  _lblQ.sort((a,b)=>a.pri-b.pri);
  const placed=[];
  nodes.forEach(n=>{
    if(n.type==='valve'||n.type==='note')return;
    const s=w2s(n.wx,n.wy),r=n.type==='junc'?8:n.type==='outlet'?16:n.type==='hex'?24:18;
    placed.push({x1:s.x-r,y1:s.y-r,x2:s.x+r,y2:s.y+r});
  });
  pipes.forEach(p=>{
    if(!p.nA||!p.nB)return;
    const sa=w2s(p.nA.wx,p.nA.wy),sb=w2s(p.nB.wx,p.nB.wy);
    placed.push({x1:Math.min(sa.x,sb.x)-4,y1:Math.min(sa.y,sb.y)-4,x2:Math.max(sa.x,sb.x)+4,y2:Math.max(sa.y,sb.y)+4});
  });
  const dark=isDark();
  _lblQ.forEach(({text,wx,wy,clr})=>{
    const s=w2s(wx,wy);
    ctx.save();ctx.font='bold 8.5px "Segoe UI",sans-serif';
    const tw=ctx.measureText(text).width+8,th=14;ctx.restore();
    const cands=[{dx:0,dy:28},{dx:0,dy:-28},{dx:36,dy:0},{dx:-36,dy:0},{dx:28,dy:24},{dx:-28,dy:24},{dx:28,dy:-24},{dx:-28,dy:-24},{dx:0,dy:42},{dx:0,dy:-42},{dx:50,dy:0},{dx:-50,dy:0}];
    let bestX=s.x,bestY=s.y+28,minOvlp=999;
    for(const{dx,dy}of cands){
      const tx=Math.max(tw/2+3,Math.min(W-tw/2-3,s.x+dx)),ty=Math.max(th/2+3,Math.min(H-th/2-3,s.y+dy));
      const box={x1:tx-tw/2,y1:ty-th/2,x2:tx+tw/2,y2:ty+th/2};
      let ovlp=0;for(const p of placed)if(box.x1<p.x2&&box.x2>p.x1&&box.y1<p.y2&&box.y2>p.y1)ovlp++;
      if(ovlp<minOvlp){minOvlp=ovlp;bestX=tx;bestY=ty;if(ovlp===0)break;}
    }
    placed.push({x1:bestX-tw/2,y1:bestY-th/2,x2:bestX+tw/2,y2:bestY+th/2});
    bgText(text,bestX,bestY,'center','middle',clr,dark?'rgba(8,10,13,.94)':'rgba(255,255,255,.96)');
  });
  _lblQ=[];
}

// ── STATE ──────────────────────────────────────────────────
let nodes=[],pipes=[],sel=null,selSet=new Set(),mode='sel',pipeSt=null;
let drag=null,doff={x:0,y:0},mp={x:0,y:0};
let calc=false,ncnt={};
let boxSelecting=false,boxStart={x:0,y:0},boxEnd={x:0,y:0};
let multiDragStart=null,multiDragOffsets=[];

// ── PROJECT TABS ───────────────────────────────────────────
let projectTabs=[{id:uid(),name:'Main Diagram',snap:null}];
let activeProjId=projectTabs[0].id;

function renderTabs(){
  const bar=document.getElementById('proj-tabs-bar');if(!bar)return;
  bar.innerHTML='';
  projectTabs.forEach(pt=>{
    const tab=document.createElement('div');
    tab.className='proj-tab'+(pt.id===activeProjId?' active':'');
    const nm=document.createElement('span');nm.textContent=pt.name;
    nm.ondblclick=e=>{e.stopPropagation();const v=prompt('Rename project:',pt.name);if(v&&v.trim()){pt.name=v.trim();renderTabs();updateStatusBar();}};
    const cl=document.createElement('button');cl.className='proj-tab-close';cl.textContent='×';
    cl.onclick=e=>{e.stopPropagation();closeProject(pt.id);};
    tab.onclick=()=>switchProject(pt.id);
    tab.appendChild(nm);if(projectTabs.length>1)tab.appendChild(cl);
    bar.appendChild(tab);
  });
  const add=document.createElement('div');add.className='proj-tab-add';add.textContent='+';add.title='New diagram';add.onclick=newProject;
  bar.appendChild(add);
  const sbName=document.getElementById('sb-proj-name');
  if(sbName){const cur=projectTabs.find(p=>p.id===activeProjId);if(cur)sbName.textContent=cur.name;}
}

function _packCurrentState(){
  return JSON.stringify({
    nodes:nodes.map(deepNode),
    pipes:pipes.map(p=>({...p,nA:p.nA?.id,nB:p.nB?.id,valve:p.valve?.id})),
    ncnt:{...ncnt}
  });
}
function switchProject(id){
  const curr=projectTabs.find(p=>p.id===activeProjId);
  if(curr)curr.snap=_packCurrentState();
  activeProjId=id;
  const next=projectTabs.find(p=>p.id===id);
  sel=null;selSet.clear();calc=false;history=[];historyPtr=-1;
  if(next?.snap){restoreSnap(next.snap);}
  else{nodes=[];pipes=[];ncnt={};}
  document.getElementById('phint').style.display='';
  document.getElementById('pprops').style.display='none';
  renderTabs();updateUndoRedo();scheduleDraw();
}
function newProject(){
  const curr=projectTabs.find(p=>p.id===activeProjId);
  if(curr)curr.snap=_packCurrentState();
  const pt={id:uid(),name:'Diagram '+(projectTabs.length+1),snap:null};
  projectTabs.push(pt);activeProjId=pt.id;
  nodes=[];pipes=[];ncnt={};sel=null;selSet.clear();calc=false;history=[];historyPtr=-1;
  document.getElementById('phint').style.display='';document.getElementById('pprops').style.display='none';
  renderTabs();updateUndoRedo();scheduleDraw();showFlash('New diagram created','#1971c2');
}
function duplicateProject(){
  const snap=_packCurrentState();
  const curr=projectTabs.find(p=>p.id===activeProjId);
  const pt={id:uid(),name:(curr?.name||'Diagram')+' (copy)',snap};
  projectTabs.push(pt);renderTabs();
  showFlash('Diagram duplicated ✓','#2f9e44');
}
function closeProject(id){
  if(projectTabs.length<=1){showFlash('Cannot close last diagram','#e03131');return;}
  const idx=projectTabs.findIndex(p=>p.id===id);
  projectTabs.splice(idx,1);
  if(activeProjId===id)switchProject(projectTabs[Math.max(0,idx-1)].id);
  else renderTabs();
}

// ── UNDO / REDO ────────────────────────────────────────────
let history=[],historyPtr=-1;
function deepNode(n){return{...n,curvePoints:Array.isArray(n.curvePoints)?n.curvePoints.map(p=>({...p})):[]};}
function snapshot(){
  const s=_packCurrentState();
  history=history.slice(0,historyPtr+1);history.push(s);
  historyPtr=history.length-1;
  if(history.length>HISTORY_LIMIT){history.shift();historyPtr=history.length-1;}
  updateUndoRedo();_autoSave(s);
}
function updateUndoRedo(){
  const u=document.getElementById('bundo'),r=document.getElementById('bredo');
  if(u)u.style.opacity=historyPtr>0?'1':'0.4';
  if(r)r.style.opacity=historyPtr<history.length-1?'1':'0.4';
}
function restoreSnap(s){
  const d=JSON.parse(s);
  nodes=d.nodes.map(deepNode);ncnt=d.ncnt||{};
  pipes=d.pipes.map(p=>{const r={...p};r.nA=nodes.find(n=>n.id===p.nA)||null;r.nB=nodes.find(n=>n.id===p.nB)||null;r.valve=p.valve?nodes.find(n=>n.id===p.valve)||null:null;return r;});
  sel=null;selSet.clear();calc=false;
  const ph=document.getElementById('phint'),pp=document.getElementById('pprops');
  if(ph)ph.style.display='';if(pp)pp.style.display='none';
  scheduleDraw();
}
function undo(){if(historyPtr>0){historyPtr--;restoreSnap(history[historyPtr]);updateUndoRedo();showFlash('↩ Undo','#7048e8');}}
function redo(){if(historyPtr<history.length-1){historyPtr++;restoreSnap(history[historyPtr]);updateUndoRedo();showFlash('↪ Redo','#7048e8');}}

// ── SAVE / LOAD ────────────────────────────────────────────
function _autoSave(s){try{localStorage.setItem(AUTOSAVE_KEY,JSON.stringify({tabs:projectTabs,active:activeProjId,curr:s}));}catch(e){}}
function autoLoad(){
  try{
    const raw=localStorage.getItem(AUTOSAVE_KEY);if(!raw)return;
    const d=JSON.parse(raw);
    if(d.tabs&&d.tabs.length){
      projectTabs=d.tabs;activeProjId=d.active||d.tabs[0].id;
      const curr=d.tabs.find(p=>p.id===activeProjId);
      if(curr?.snap){restoreSnap(d.curr||curr.snap);}
      renderTabs();showFlash('✓ Session restored','#2f9e44');
    }
  }catch(e){}
}
function saveProject(){
  const data={version:14,nodes:nodes.map(deepNode),pipes:pipes.map(p=>({...p,nA:p.nA?.id,nB:p.nB?.id,valve:p.valve?.id})),ncnt:{...ncnt},settings:{calcMethod:document.getElementById('calc-method').value,fric:document.getElementById('fsl').value,hwC:document.getElementById('hw-c').value,pUnit:_pUnit,fUnit:_fUnit}};
  const a=document.createElement('a');a.download=(projectTabs.find(p=>p.id===activeProjId)?.name||'hydraulic')+'.json';a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.click();
  showFlash('💾 Saved','#2f9e44');
}
function loadProject(file){
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(data.settings){
        document.getElementById('calc-method').value=data.settings.calcMethod||'rule';
        document.getElementById('fsl').value=data.settings.fric||8;
        document.getElementById('fval').textContent=(data.settings.fric||8)+'%';
        document.getElementById('hw-c').value=data.settings.hwC||130;
        if(data.settings.unitsSys)applyUnits(data.settings.unitsSys);
        if(data.settings.pUnit)_pUnit=data.settings.pUnit;
        if(data.settings.fUnit)_fUnit=data.settings.fUnit;
        document.getElementById('calc-method').dispatchEvent(new Event('change'));
      }
      restoreSnap(JSON.stringify({nodes:data.nodes,pipes:data.pipes,ncnt:data.ncnt||{}}));
      const curr=projectTabs.find(p=>p.id===activeProjId);
      if(curr)curr.name=file.name.replace('.json','');
      renderTabs();snapshot();showFlash('📂 Loaded','#1971c2');
    }catch(err){showFlash('✗ Invalid file','#e03131');}
  };
  reader.readAsText(file);
}

// ── GLOBAL UNITS ───────────────────────────────────────────
// _pUnit and _fUnit are set directly by the popup (app.js)
let _pUnit='m',_fUnit='ls';
// applyUnits kept for backward compat (load from file)
function applyUnits(sys){
  const map={'si_m':{p:'m',f:'ls'},'si_bar':{p:'bar',f:'m3h'},'si_kpa':{p:'kpa',f:'ls'},'imperial':{p:'psi',f:'gpm'}};
  const pr=map[sys]||map['si_m'];_pUnit=pr.p;_fUnit=pr.f;
  // sync radios if popup exists
  const pu=document.querySelector(`input[name="punit"][value="${_pUnit}"]`);if(pu)pu.checked=true;
  const fu=document.querySelector(`input[name="funit"][value="${_fUnit}"]`);if(fu)fu.checked=true;
}
const gPU=()=>_pUnit;const gFU=()=>_fUnit;
function m2b(m){return m/10.2;}
function pd(bar){
  const u=gPU();
  if(u==='m')   return(bar*10.2).toFixed(2)+' m';
  if(u==='psi') return(bar*14.504).toFixed(2)+' psi';
  if(u==='kpa') return(bar*100).toFixed(1)+' kPa';
  if(u==='mpa') return(bar/10).toFixed(4)+' MPa';
  if(u==='atm') return(bar/1.01325).toFixed(3)+' atm';
  return bar.toFixed(3)+' bar';
}
function pl(){const u=gPU();return u==='m'?'m':u==='psi'?'psi':u==='kpa'?'kPa':u==='mpa'?'MPa':u==='atm'?'atm':'bar';}
function p2d(bar){const u=gPU();return u==='m'?+(bar*10.2).toFixed(2):u==='psi'?+(bar*14.504).toFixed(2):u==='kpa'?+(bar*100).toFixed(1):u==='mpa'?+(bar/10).toFixed(4):u==='atm'?+(bar/1.01325).toFixed(3):+bar.toFixed(3);}
function d2p(v){const u=gPU();return u==='m'?v/10.2:u==='psi'?v/14.504:u==='kpa'?v/100:u==='mpa'?v*10:u==='atm'?v*1.01325:v;}
function fd(ls){const u=gFU();return u==='lm'?(ls*60).toFixed(2)+' L/min':u==='m3h'?(ls*3.6).toFixed(3)+' m³/h':u==='gpm'?(ls*15.850).toFixed(2)+' gpm':u==='m3s'?ls.toFixed(5)+' m³/s':ls.toFixed(3)+' L/s';}
function fl(){const u=gFU();return u==='lm'?'L/min':u==='m3h'?'m³/h':u==='gpm'?'gpm':u==='m3s'?'m³/s':'L/s';}
function f2d(ls){const u=gFU();return u==='lm'?+(ls*60).toFixed(3):u==='m3h'?+(ls*3.6).toFixed(4):u==='gpm'?+(ls*15.850).toFixed(3):u==='m3s'?+ls.toFixed(5):+ls.toFixed(4);}
function d2f(v){const u=gFU();return u==='lm'?v/60:u==='m3h'?v/3.6:u==='gpm'?v/15.850:u==='m3s'?v:v;}

// ── IPC FU TABLE ───────────────────────────────────────────
const FU_T=[[0,0],[1,.05],[2,.07],[4,.11],[6,.14],[10,.18],[20,.27],[30,.33],[50,.42],[100,.60],[200,.85],[500,1.38],[1000,1.95]];
function fu2ls(f){if(f<=0)return 0;for(let i=0;i<FU_T.length-1;i++){const[a,b]=FU_T[i],[c,d]=FU_T[i+1];if(f<=c)return b+(f-a)/(c-a)*(d-b);}return FU_T[FU_T.length-1][1];}

// ── COORDS ─────────────────────────────────────────────────
function w2s(x,y){return{x:x*zoom+panX,y:y*zoom+panY};}
function s2w(x,y){return{x:(x-panX)/zoom,y:(y-panY)/zoom};}
function hwLoss(L,Q_ls,D_mm,C){const Leq=L*1.25,Q=Q_ls/1000,D=D_mm/1000;if(Q<1e-9||D<1e-6)return 0;return 10.67*Leq*Math.pow(Q,1.852)/(Math.pow(C,1.852)*Math.pow(D,4.87));}

// ── NODE TYPES ─────────────────────────────────────────────
// s = stroke color, f = fill color (used in light mode; dark mode adapts)
const TC={
  'tank':{s:'#2f9e44',f:'#ebfbee',label:'T'},
  'pump-booster':{s:'#1971c2',f:'#e7f5ff',label:'P'},
  'pump-lift':{s:'#7048e8',f:'#f3f0ff',label:'P'},
  'pump-circ':{s:'#0c8599',f:'#e3fafc',label:'P'},
  'hex':{s:'#e8590c',f:'#fff4e6',label:'HX'},
  'calorifier':{s:'#e8590c',f:'#fff4e6',label:'CAL'},
  'valve':{s:'#d97706',f:'#fffbeb',label:'V'},
  'outlet':{s:'#2f9e44',f:'#ebfbee',label:'OUT'},
  'junc':{s:'#1971c2',f:'#e7f5ff',label:'·'},
  'note':{s:'#6b7280',f:'#f9fafb',label:'NOTE'},
  'boiler':{s:'#e8590c',f:'#fff4e6',label:'BWB'},
  'filter':{s:'#2f9e44',f:'#ebfbee',label:'FLT'},
  'uv':{s:'#7048e8',f:'#f3f0ff',label:'UV'}
};
function isValveType(t){return t&&(t==='valve'||t.startsWith('valve-'));}
function isPump(t){return t==='pump-booster'||t==='pump-lift'||t==='pump-circ';}
function isHeat(t){return t==='hex'||t==='calorifier'||t==='boiler';}

function mkN(type,wx,wy){
  // valve-gate, valve-ball etc → stored as type='valve', valveType='gate' etc
  let realType=type,valveType='gate';
  if(type.startsWith('valve-')){realType='valve';valveType=type.replace('valve-','');}
  ncnt[type]=(ncnt[type]||0)+1;
  const c=TC[realType]||{label:type};
  const label=(realType==='valve'?valveType.toUpperCase()+'-':c.label)+ncnt[type];
  const b={id:uid(),type:realType,wx,wy,label,cl:'',rP:undefined};
  if(realType==='tank')return{...b,elev:10,pbar:0};
  if(realType==='pump-booster')return{...b,hm:null,fls:1.5,flip:false,rH:undefined,curvePoints:[]};
  if(realType==='pump-lift')return{...b,hm:null,fls:1.5,flip:false,rH:undefined,liftElev:10,curvePoints:[]};
  if(realType==='pump-circ')return{...b,hm:null,flip:false,rH:undefined,circMethod:'fu',circFU:50,circRisers:5,circHeatLoss:500,circFls:undefined,curvePoints:[]};
  if(realType==='valve')return{...b,valveType,kv:25,pdrop:undefined,setP:undefined};
  if(realType==='outlet')return{...b,fm:'manual',fls:.3,fu:6,rbar:1.5,elev:0,sP:undefined,fP:undefined,flowDownstream:undefined};
  if(realType==='hex'||realType==='calorifier')return{...b,pdm:3,Tin:80,Tout:60,mflow:1,cpFluid:4.18,Qkw:undefined};
  if(realType==='junc')return{...b,eqLoss:0};
  if(realType==='note')return{...b,text:'Double-click to edit',fontSize:12};
  if(realType==='boiler')return{...b,pdm:3,Tin:80,Tout:60,mflow:1,cpFluid:4.18,Qkw:undefined};
  if(realType==='filter')return{...b,pdm:1.5,filterType:'sand'};
  if(realType==='uv')return{...b,pdm:0.5};
  return b;
}

function pumpCurveHead(pump,flowLs){
  const pts=pump.curvePoints||[];if(!pts.length)return null;
  const sorted=[...pts].sort((a,bb)=>a.q-bb.q);
  if(flowLs<=sorted[0].q)return sorted[0].h;
  if(flowLs>=sorted[sorted.length-1].q)return sorted[sorted.length-1].h;
  for(let i=0;i<sorted.length-1;i++){const aa=sorted[i],bb=sorted[i+1];if(flowLs>=aa.q&&flowLs<=bb.q){const tt=(flowLs-aa.q)/(bb.q-aa.q);return aa.h+tt*(bb.h-aa.h);}}
  return null;
}

// ── DRAW HELPERS ───────────────────────────────────────────
function nColor(n){
  const c=TC[n.type]||{s:'#888',f:'#eee'};
  // In dark mode invert fill/stroke interpretation
  if(isDark()){
    const dm={'tank':{s:'#a3e635',f:'#081500'},'pump-booster':{s:'#60a5fa',f:'#080f1a'},'pump-lift':{s:'#a78bfa',f:'#0c0a1a'},'pump-circ':{s:'#34d399',f:'#041a10'},'hex':{s:'#f97316',f:'#160800'},'calorifier':{s:'#fb923c',f:'#160a00'},'valve':{s:'#facc15',f:'#161000'},'outlet':{s:'#22c55e',f:'#051a0a'},'junc':{s:'#60a5fa',f:'#001a30'},'note':{s:'#9ca3af',f:'#1a1c20'},'boiler':{s:'#fb923c',f:'#160800'},'filter':{s:'#4ade80',f:'#071a04'},'uv':{s:'#c084fc',f:'#1e1535'}};
    return dm[n.type]||{s:c.s,f:'#111'};
  }
  if(!calc)return c;
  if(n.type==='outlet'){const p=n.rP,r=n.rbar||1.5;if(p===undefined)return{s:'#9ca3af',f:'#f9fafb'};if(p>=r)return{s:'#2f9e44',f:'#ebfbee'};if(p>=r*.7)return{s:'#f08c00',f:'#fff9db'};return{s:'#e03131',f:'#fff5f5'};}
  return c;
}
function velClr(v){
  if(v===undefined||!calc)return isDark()?'#2e3540':'#adb5bd';
  if(v<1.2)return isDark()?'#60a5fa':'#1971c2';
  if(v<=2.4)return isDark()?'#4ade80':'#2f9e44';
  return isDark()?'#f87171':'#e03131';
}
function bgText(text,x,y,align,baseline,fg,bg){
  ctx.save();ctx.font='bold 8.5px "Segoe UI",sans-serif';ctx.textAlign=align;ctx.textBaseline=baseline;
  const m=ctx.measureText(text),pad=2;
  const bx=align==='center'?x-m.width/2:align==='right'?x-m.width:x;
  const by=baseline==='middle'?y-5.5:baseline==='top'?y:y-10;
  ctx.fillStyle=bg;ctx.fillRect(bx-pad,by-pad,m.width+pad*2,12+pad*2);
  ctx.fillStyle=fg;ctx.fillText(text,x,y);ctx.restore();
}
function drawArrow(x,y,ang,clr){
  ctx.save();ctx.translate(x,y);ctx.rotate(ang);ctx.fillStyle=clr;
  ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-6,-3.5);ctx.lineTo(-6,3.5);ctx.closePath();ctx.fill();ctx.restore();
}

// ── VALVE SYMBOL DISPATCHER — CAD P&ID style (matching reference image) ──────
function drawValveSymbol(x,y,ang,vt,isSel,dark){
  ctx.save();ctx.translate(x,y);ctx.rotate(ang);
  const sc =isSel?'#1971c2':(dark?'#facc15':'#374151');
  const sc2=isSel?'#1971c2':(dark?'#f87171':'#e03131'); // red for PRV
  const sc3=isSel?'#1971c2':(dark?'#c084fc':'#7048e8'); // purple for PRS
  const fc =dark?'rgba(8,8,8,.8)':'rgba(255,255,255,.92)';
  ctx.setLineDash([]);

  if(vt==='gate'){
    // ✦ Gate valve — bowtie (two filled triangles, stem + wheel)
    ctx.strokeStyle=sc;ctx.fillStyle=fc;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(-12,-8);ctx.lineTo(0,0);ctx.lineTo(-12,8);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(12,-8);ctx.lineTo(0,0);ctx.lineTo(12,8);ctx.closePath();ctx.fill();ctx.stroke();
    // stem
    ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-13);ctx.stroke();
    // handwheel circle
    ctx.beginPath();ctx.arc(0,-16,4,0,Math.PI*2);ctx.fill();ctx.stroke();
    // wheel spokes
    ctx.beginPath();ctx.moveTo(-4,-16);ctx.lineTo(4,-16);ctx.moveTo(0,-20);ctx.lineTo(0,-12);ctx.stroke();

  } else if(vt==='ball'){
    // ✦ Ball valve — circle with through line + rotary handle
    ctx.strokeStyle=sc;ctx.fillStyle=fc;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.arc(0,0,9,0,Math.PI*2);ctx.fill();ctx.stroke();
    // through-bore (horizontal)
    ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(-9,0);ctx.lineTo(9,0);ctx.stroke();
    // handle (flat bar on top)
    ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(0,-17);ctx.stroke();
    ctx.lineWidth=3;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-6,-17);ctx.lineTo(6,-17);ctx.stroke();
    ctx.lineCap='butt';
    // center fill dot
    ctx.fillStyle=sc;ctx.beginPath();ctx.arc(0,0,2.5,0,Math.PI*2);ctx.fill();

  } else if(vt==='check'){
    // ✦ Check valve — half-moon / clapper style (from image: curved body)
    ctx.strokeStyle=sc;ctx.fillStyle=fc;ctx.lineWidth=1.5;
    // circle body
    ctx.beginPath();ctx.arc(0,0,10,0,Math.PI*2);ctx.fill();ctx.stroke();
    // clapper (diagonal line = flap)
    ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-4,-9);ctx.lineTo(4,9);ctx.stroke();
    // flow arrow inside
    ctx.lineWidth=1;ctx.fillStyle=sc;
    ctx.beginPath();ctx.moveTo(-7,0);ctx.lineTo(-2,-4);ctx.lineTo(-2,4);ctx.closePath();ctx.fill();

  } else if(vt==='butterfly'){
    // ✦ Butterfly valve — circle body + two blade arcs + perpendicular stem
    ctx.strokeStyle=sc;ctx.fillStyle=fc;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.arc(0,0,10,0,Math.PI*2);ctx.fill();ctx.stroke();
    // blades (two S-curves representing disc in 45° position)
    ctx.fillStyle=dark?'rgba(250,204,21,.25)':'rgba(55,65,81,.15)';
    ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(0,-9);ctx.bezierCurveTo(-9,-3,-9,3,0,9);ctx.bezierCurveTo(2,3,2,-3,0,-9);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,-9);ctx.bezierCurveTo(9,-3,9,3,0,9);ctx.bezierCurveTo(-2,3,-2,-3,0,-9);ctx.fill();ctx.stroke();
    // stem + handle
    ctx.strokeStyle=sc;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(0,-10);ctx.lineTo(0,-16);ctx.stroke();
    ctx.lineWidth=2.5;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-5,-16);ctx.lineTo(5,-16);ctx.stroke();
    ctx.lineCap='butt';
    // center axle dot
    ctx.fillStyle=sc;ctx.beginPath();ctx.arc(0,0,2,0,Math.PI*2);ctx.fill();

  } else if(vt==='relief'){
    // ✦ PRV — gate valve body + spring actuator on top
    // body (bowtie)
    ctx.strokeStyle=sc2;ctx.fillStyle=dark?'rgba(30,4,4,.9)':'rgba(255,245,245,.95)';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(-11,-7);ctx.lineTo(0,0);ctx.lineTo(-11,7);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(11,-7);ctx.lineTo(0,0);ctx.lineTo(11,7);ctx.closePath();ctx.fill();ctx.stroke();
    // short stem up
    ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(0,-10);ctx.stroke();
    // spring (zigzag coils)
    ctx.beginPath();ctx.moveTo(0,-10);
    ctx.lineTo(-4,-13);ctx.lineTo(4,-16);ctx.lineTo(-4,-19);ctx.lineTo(4,-22);ctx.lineTo(0,-25);
    ctx.stroke();
    // cap line
    ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-5,-25);ctx.lineTo(5,-25);ctx.stroke();
    // "RV" label inside
    if(zoom>0.6){ctx.font='bold 6px sans-serif';ctx.fillStyle=sc2;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('RV',0,0);}

  } else if(vt==='reducing'){
    // ✦ PRS — dashed rectangle enclosing a gate valve + diaphragm actuator
    ctx.strokeStyle=sc3;ctx.fillStyle=dark?'rgba(30,21,53,.9)':'rgba(243,240,255,.95)';
    ctx.lineWidth=1.3;ctx.setLineDash([3,2]);
    ctx.beginPath();ctx.rect(-18,-14,36,28);ctx.fill();ctx.stroke();
    ctx.setLineDash([]);
    // inner gate valve (smaller, same color)
    ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(-9,-6);ctx.lineTo(0,0);ctx.lineTo(-9,6);ctx.closePath();ctx.fillStyle=dark?'rgba(8,8,8,.8)':'rgba(255,255,255,.9)';ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(9,-6);ctx.lineTo(0,0);ctx.lineTo(9,6);ctx.closePath();ctx.fill();ctx.stroke();
    // diaphragm actuator (circle on stem)
    ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(0,-14);ctx.stroke();
    ctx.beginPath();ctx.arc(0,-17,3,0,Math.PI*2);ctx.fillStyle=sc3;ctx.fill();ctx.stroke();
  }
  ctx.restore();
}

// ── DRAW PIPE ──────────────────────────────────────────────
function drawPipe(p){
  if(!p.nA||!p.nB)return;
  const sa=w2s(p.nA.wx,p.nA.wy),sb=w2s(p.nB.wx,p.nB.wy);
  const clr=velClr(p.vel);const dark=isDark();
  const isSel=sel===p||selSet.has(p);
  ctx.strokeStyle=isSel?'#1971c2':clr;ctx.lineWidth=isSel?3:2;ctx.setLineDash([]);
  ctx.beginPath();ctx.moveTo(sa.x,sa.y);ctx.lineTo(sb.x,sb.y);ctx.stroke();
  const ang=Math.atan2(sb.y-sa.y,sb.x-sa.x),mx=(sa.x+sb.x)/2,my=(sa.y+sb.y)/2;
  drawArrow(mx,my,ang,clr);
  if(zoom>LABEL_ZOOM_MIN){
    const perp=ang-Math.PI/2,ox=Math.cos(perp)*14,oy=Math.sin(perp)*14;
    const lblBg=dark?'rgba(8,10,13,.9)':'rgba(255,255,255,.92)';
    const lblFg=dark?'#3a4555':'#6b7280';
    bgText('Ø'+(p.dia||25)+'/'+(p.len||10)+'m',mx+ox,my+oy,'center','middle',lblFg,lblBg);
    if(calc&&p.fls!==undefined)bgText(fd(p.fls),mx-ox,my-oy,'center','middle',dark?'#60a5fa':'#1971c2',lblBg);
    if(calc){
      const wA=s2w(sa.x,sa.y),wB=s2w(sb.x,sb.y);
      if(p.pA!==undefined)qLbl(pd(p.pA),wA.x,wA.y,dark?'#ca8a04':'#b45309',2);
      if(p.pB!==undefined)qLbl(pd(p.pB),wB.x,wB.y,dark?'#4ade80':'#2f9e44',2);
    }
  }
  if(p.valve){
    const vx=(sa.x+sb.x)/2,vy=(sa.y+sb.y)/2;
    drawValveSymbol(vx,vy,ang,p.valve.valveType||'gate',p.valve===sel,dark);
    if(zoom>0.5){
      const vlbl=p.valve.cl||p.valve.label;
      qLbl(vlbl,s2w(vx,vy).x,s2w(vx,vy).y,dark?'#a8890a':'#b45309',1);
      if(calc&&p.valve.pdrop!==undefined)qLbl('ΔP='+p.valve.pdrop.toFixed(2)+'m',s2w(vx,vy).x,s2w(vx,vy).y,dark?'#facc15':'#d97706',2);
    }
  }
}

// ── DRAW NODE ──────────────────────────────────────────────
function drawNode(n){
  if(n.type==='valve')return;
  const s=w2s(n.wx,n.wy);const{x,y}=s;const t=n.type;
  const c=nColor(n);const fl2=n.flip?-1:1;
  const isSel=n===sel||selSet.has(n);const dark=isDark();

  // NOTE — text box
  if(t==='note'){
    const txt=n.text||'Note';const fs=(n.fontSize||12)*zoom;
    ctx.font=`${fs}px "Segoe UI",sans-serif`;ctx.textBaseline='top';
    const tw=ctx.measureText(txt).width+12,th=fs+10;
    ctx.fillStyle=dark?'rgba(30,32,38,.85)':'rgba(255,255,255,.9)';
    ctx.strokeStyle=isSel?'#1971c2':(dark?'#444c58':'#9ca3af');
    ctx.lineWidth=isSel?1.5:1;ctx.setLineDash(isSel?[]:[4,3]);
    if(ctx.roundRect)ctx.roundRect(x-tw/2,y-th/2,tw,th,4);else ctx.rect(x-tw/2,y-th/2,tw,th);
    ctx.fill();ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle=dark?'#c8cdd6':'#374151';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(txt,x,y);
    return;
  }

  ctx.fillStyle=c.f;ctx.strokeStyle=isSel?'#1971c2':c.s;ctx.lineWidth=isSel?2:1.5;ctx.setLineDash([]);

  if(t==='tank'){
    const w=46,h=32;ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x-w/2,y-h/2,w,h,3);else ctx.rect(x-w/2,y-h/2,w,h);ctx.fill();ctx.stroke();
    ctx.fillStyle=dark?'#0e2000':'#d3f9d8';ctx.fillRect(x-w/2+1,y,w-2,h/2-1);
    ctx.strokeStyle=c.s;ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(x-w/2,y);ctx.lineTo(x+w/2,y);ctx.stroke();
    if(zoom>0.4){ctx.font='bold 7px sans-serif';ctx.fillStyle=c.s;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('TANK',x,y-8);}
  } else if(isPump(t)){
    const r=15,col=c.s;
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.save();ctx.translate(x,y);ctx.rotate(fl2===1?0:Math.PI);
    ctx.fillStyle=col;const hs=r*.52;
    ctx.beginPath();ctx.moveTo(hs,0);ctx.lineTo(-hs,-hs*.88);ctx.lineTo(-hs,hs*.88);ctx.closePath();ctx.fill();
    ctx.restore();
    if(t==='pump-circ'){ctx.strokeStyle=col;ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(x,y,r+5,Math.PI*.7,Math.PI*2.2);ctx.stroke();drawArrow(x+(r+5)*Math.cos(Math.PI*2.2),y+(r+5)*Math.sin(Math.PI*2.2),Math.PI*2.2+Math.PI/2,col);}
    const inX=x+(r+5)*(fl2===1?-1:1),outX=x+(r+5)*(fl2===1?1:-1);
    ctx.fillStyle=dark?'#4ade80':'#2f9e44';ctx.beginPath();ctx.arc(inX,y,2.5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=dark?'#f87171':'#e03131';ctx.beginPath();ctx.arc(outX,y,2.5,0,Math.PI*2);ctx.fill();
  } else if(t==='outlet'){
    const r=13;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-r*.6,y);ctx.lineTo(x+r*.6,y);ctx.moveTo(x,y-r*.6);ctx.lineTo(x,y+r*.6);ctx.stroke();
    ctx.fillStyle=c.s;ctx.beginPath();ctx.arc(x,y,r*.28,0,Math.PI*2);ctx.fill();
  } else if(t==='hex'){
    const w=42,h=26;ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x-w/2,y-h/2,w,h,3);else ctx.rect(x-w/2,y-h/2,w,h);ctx.fill();ctx.stroke();
    ctx.strokeStyle=c.s;ctx.lineWidth=.8;ctx.setLineDash([3,2]);
    ctx.beginPath();ctx.moveTo(x-w/2+5,y-4);ctx.lineTo(x+w/2-5,y-4);ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-w/2+5,y+4);ctx.lineTo(x+w/2-5,y+4);ctx.stroke();
    ctx.setLineDash([]);ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x-w/2,y);ctx.lineTo(x-w/2-5,y);ctx.moveTo(x+w/2,y);ctx.lineTo(x+w/2+5,y);ctx.stroke();
    if(zoom>0.4){ctx.font='bold 7px sans-serif';ctx.fillStyle=c.s;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('HEX',x,y);}
  } else if(t==='calorifier'){
    ctx.beginPath();ctx.ellipse(x,y,18,13,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-8,y+4);ctx.quadraticCurveTo(x,y-8,x+8,y+4);ctx.stroke();
    ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,y-13);ctx.lineTo(x,y-19);ctx.moveTo(x,y+13);ctx.lineTo(x,y+19);ctx.stroke();
  } else if(t==='junc'){
    ctx.fillStyle=c.s;ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();
  } else if(t==='boiler'){
    // Hot water boiler: horizontal cylinder with burner base
    ctx.beginPath();ctx.ellipse(x,y,22,13,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    // top nozzle
    ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x-4,y-13);ctx.lineTo(x-4,y-19);ctx.moveTo(x+4,y-13);ctx.lineTo(x+4,y-19);ctx.stroke();
    // flame symbol
    ctx.lineWidth=1.2;ctx.beginPath();
    ctx.moveTo(x,y+8);ctx.quadraticCurveTo(x-6,y+3,x-3,y-2);ctx.quadraticCurveTo(x,y+1,x,y-5);ctx.quadraticCurveTo(x+3,y+1,x+3,y-2);ctx.quadraticCurveTo(x+6,y+3,x,y+8);
    ctx.fillStyle=isDark()?'#f97316':'#ea580c';ctx.fill();ctx.strokeStyle=c.s;ctx.stroke();
    // base
    ctx.fillStyle=c.f;ctx.strokeStyle=c.s;ctx.lineWidth=1.3;
    ctx.beginPath();ctx.rect(x-14,y+13,28,6);ctx.fill();ctx.stroke();
    // connections
    ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,y-19);ctx.lineTo(x,y-25);ctx.moveTo(x,y+19);ctx.lineTo(x,y+25);ctx.stroke();
    if(zoom>0.4){ctx.font='bold 6px sans-serif';ctx.fillStyle=c.s;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('BWB',x,y+5);}
  } else if(t==='filter'){
    // Sand filter: vertical cylinder with hatching inside
    const fw=16,fh=24;
    ctx.beginPath();ctx.ellipse(x,y-fh/2,fw,5,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-fw,y-fh/2);ctx.lineTo(x-fw,y+fh/2);ctx.moveTo(x+fw,y-fh/2);ctx.lineTo(x+fw,y+fh/2);ctx.stroke();
    ctx.beginPath();ctx.ellipse(x,y+fh/2,fw,5,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    // sand hatch
    ctx.lineWidth=.7;ctx.strokeStyle=isDark()?'#4ade80':'#2f9e44';
    for(let i=-3;i<=3;i++){ctx.beginPath();ctx.moveTo(x+i*4,y-fh/2+6);ctx.lineTo(x+i*4,y+fh/2-6);ctx.stroke();}
    ctx.lineWidth=1.3;ctx.strokeStyle=c.s;
    // pipe connections
    ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x-fw,y-8);ctx.lineTo(x-fw-8,y-8);ctx.moveTo(x-fw,y+8);ctx.lineTo(x-fw-8,y+8);ctx.stroke();
    if(zoom>0.4){ctx.font='bold 6px sans-serif';ctx.fillStyle=c.s;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('FLT',x,y);}
  } else if(t==='uv'){
    // UV unit: tube with radiation lines
    const uw=20,uh=8;
    ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x-uw,y-uh,uw*2,uh*2,uh);else ctx.rect(x-uw,y-uh,uw*2,uh*2);ctx.fill();ctx.stroke();
    // radiation lines
    ctx.strokeStyle=isDark()?'#c084fc':'#7048e8';ctx.lineWidth=1.2;
    const rays=[[-12,-12],[0,-14],[12,-12],[-12,12],[0,14],[12,12]];
    rays.forEach(([dx,dy])=>{ctx.beginPath();ctx.moveTo(x+dx*.5,y+dy*.5);ctx.lineTo(x+dx,y+dy);ctx.stroke();});
    // pipe connectors
    ctx.strokeStyle=c.s;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(x-uw,y);ctx.lineTo(x-uw-8,y);ctx.moveTo(x+uw,y);ctx.lineTo(x+uw+8,y);ctx.stroke();
    if(zoom>0.4){ctx.font='bold 6.5px sans-serif';ctx.fillStyle=c.s;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('UV',x,y);}
  }

  if(isSel&&t!=='note'){
    ctx.strokeStyle=dark?'rgba(59,130,246,.45)':'rgba(25,113,194,.45)';ctx.lineWidth=1;ctx.setLineDash([3,3]);
    const sr=isPump(t)||t==='outlet'?21:t==='junc'?10:t==='hex'?25:22;
    ctx.beginPath();
    if(isPump(t)||t==='outlet'||t==='junc')ctx.arc(x,y,sr,0,Math.PI*2);
    else ctx.rect(x-sr,y-sr*.6,sr*2,sr*1.2);
    ctx.stroke();ctx.setLineDash([]);
  }

  if(zoom>LABEL_ZOOM_SML){
    const lbl=n.cl||n.label;
    qLbl(lbl,n.wx,n.wy,dark?'#5a6475':'#6b7280',0);
    if(calc&&n.rP!==undefined){
      const req=n.rbar||0;
      const pc=t==='outlet'?(n.rP>=req?(dark?'#22c55e':'#2f9e44'):n.rP>=req*.7?(dark?'#eab308':'#f08c00'):(dark?'#ef4444':'#e03131')):(isPump(t)?(dark?'#60a5fa':'#1971c2'):'#888');
      qLbl(pd(n.rP),n.wx,n.wy,pc,1);
    }
    if(isHeat(t)&&calc&&n.Qkw!==undefined)qLbl('Q='+n.Qkw.toFixed(1)+'kW',n.wx,n.wy,dark?'#fb923c':'#e8590c',1);
    if(!calc&&isPump(t)&&n.hm===null&&!(n.curvePoints?.length))qLbl('? head',n.wx,n.wy,dark?'#6a3a00':'#b45309',0);
    if(t==='pump-circ'&&calc&&n.circFls!==undefined)qLbl(fd(n.circFls),n.wx,n.wy,dark?'#34d399':'#0c8599',1);
  }
}

// ── DRAW GRID ──────────────────────────────────────────────
function drawGrid(){
  // Clean canvas — no grid
  const dark=isDark();
  ctx.fillStyle=dark?'#080a0d':'#f8f9fa';
  ctx.fillRect(0,0,W,H);
}

function drawSelBox(){
  if(!boxSelecting)return;
  const el=document.getElementById('sel-box');
  const x1=Math.min(boxStart.x,boxEnd.x),y1=Math.min(boxStart.y,boxEnd.y),x2=Math.max(boxStart.x,boxEnd.x),y2=Math.max(boxStart.y,boxEnd.y);
  el.style.display='block';el.style.left=x1+'px';el.style.top=y1+'px';el.style.width=(x2-x1)+'px';el.style.height=(y2-y1)+'px';
}

function draw(){
  _lblQ=[];
  drawGrid();ctx.setLineDash([]);
  pipes.forEach(drawPipe);
  if(pipeSt&&mode==='pip'){
    const ss=w2s(pipeSt.wx,pipeSt.wy);
    ctx.strokeStyle=isDark()?'#3b82f6':'#1971c2';ctx.lineWidth=1.5;ctx.setLineDash([5,4]);
    ctx.beginPath();ctx.moveTo(ss.x,ss.y);ctx.lineTo(mp.x,mp.y);ctx.stroke();ctx.setLineDash([]);
  }
  nodes.forEach(drawNode);
  flushLabels();
  drawSelBox();
  updateMinimap();updateStatusBar();
}

// ── HIT TESTS ──────────────────────────────────────────────
function hitN(sx,sy,skip){
  const{x:wx,y:wy}=s2w(sx,sy);
  for(let i=nodes.length-1;i>=0;i--){
    const n=nodes[i];if(n===skip||n.type==='valve')continue;
    const r=n.type==='note'?(n.fontSize||12)*zoom*2:HIT_RADIUS;
    if(Math.hypot(wx-n.wx,wy-n.wy)<r/zoom)return n;
  }return null;
}
function hitPipe(sx,sy){
  const{x:wx,y:wy}=s2w(sx,sy);
  for(let i=pipes.length-1;i>=0;i--){
    const p=pipes[i];if(!p.nA||!p.nB)continue;
    const ax=p.nA.wx,ay=p.nA.wy,bx=p.nB.wx,by=p.nB.wy,dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;
    if(l2<1)continue;
    const tt=((wx-ax)*dx+(wy-ay)*dy)/l2;if(tt<PIPE_HIT_T_MIN||tt>PIPE_HIT_T_MAX)continue;
    if(Math.hypot(wx-ax-tt*dx,wy-ay-tt*dy)<PIPE_HIT_W/zoom)return{pipe:p,t:tt,wx:ax+tt*dx,wy:ay+tt*dy};
  }return null;
}
function hitValve(sx,sy){
  const{x:wx,y:wy}=s2w(sx,sy);
  for(const p of pipes){if(p.valve){const vx=(p.nA.wx+p.nB.wx)/2,vy=(p.nA.wy+p.nB.wy)/2;if(Math.hypot(wx-vx,wy-vy)<VALVE_HIT_R/zoom)return p.valve;}}return null;
}
function nodesInBox(x1,y1,x2,y2){
  const w1=s2w(x1,y1),w2=s2w(x2,y2);const minX=Math.min(w1.x,w2.x),maxX=Math.max(w1.x,w2.x),minY=Math.min(w1.y,w2.y),maxY=Math.max(w1.y,w2.y);
  return nodes.filter(n=>n.type!=='valve'&&n.wx>=minX&&n.wx<=maxX&&n.wy>=minY&&n.wy<=maxY);
}
function splitPipe(pipe,jwx,jwy){
  const j=mkN('junc',Math.round(jwx/SNAP_GRID)*SNAP_GRID,Math.round(jwy/SNAP_GRID)*SNAP_GRID);
  nodes.push(j);const oldB=pipe.nB;pipes.push({id:uid(),nA:j,nB:oldB,dia:pipe.dia||25,len:pipe.len||10});pipe.nB=j;return j;
}

// ── CALC ENGINE ────────────────────────────────────────────
function buildAdj(){const adj={};nodes.forEach(n=>{adj[n.id]=[];});pipes.forEach(p=>{if(!p.nA||!p.nB)return;adj[p.nA.id].push({n:p.nB,p});adj[p.nB.id].push({n:p.nA,p});});return adj;}
function bfsLoss(srcId,adj){
  const dist={};nodes.forEach(n=>{dist[n.id]=Infinity;});dist[srcId]=0;
  const q=[srcId],vis=new Set([srcId]);
  while(q.length){const cid=q.shift();(adj[cid]||[]).forEach(({n,p})=>{if(vis.has(n.id))return;vis.add(n.id);const hd=isHeat(n.type)?(n.pdm||0):0;dist[n.id]=dist[cid]+(p.hL||0)+(p.vL||0)+hd;q.push(n.id);});}
  return dist;
}
function circFlow(pump){
  if(pump.circMethod==='fu')return fu2ls(pump.circFU||50);
  if(pump.circMethod==='risers')return fu2ls((pump.circRisers||5)*10);
  if(pump.circMethod==='heat')return (pump.circHeatLoss||500)/(4.18*1000*20);
  return .3;
}
function calculate(){try{_doCalc();}catch(err){showRes('<p style="color:var(--red);font-size:10px;padding:6px">⚠ '+err.message+'</p>');console.error(err);}}
function _doCalc(){
  saveProp();calc=true;
  const method=document.getElementById('calc-method').value,fric=parseFloat(document.getElementById('fsl').value)/100,hwC=parseInt(document.getElementById('hw-c').value)||130;
  const pumps=nodes.filter(n=>isPump(n.type)),tanks=nodes.filter(n=>n.type==='tank'),outlets=nodes.filter(n=>n.type==='outlet'),circPumps=nodes.filter(n=>n.type==='pump-circ');
  nodes.filter(n=>isHeat(n.type)).forEach(n=>{n.Qkw=n.mflow*n.cpFluid*Math.abs((n.Tin||80)-(n.Tout||60));});
  circPumps.forEach(p=>{p.circFls=circFlow(p);});
  outlets.forEach(o=>{if(o.fm==='fu')o.fls=fu2ls(o.fu||6);});
  const totFlow=outlets.reduce((s,o)=>s+(o.fls||.3),0)||1;
  const adj=buildAdj();
  const vis2=new Set(),dFlow={};nodes.forEach(n=>{dFlow[n.id]=0;});outlets.forEach(o=>{dFlow[o.id]=o.fls||.3;});
  function countDown(id){if(vis2.has(id))return dFlow[id];vis2.add(id);(adj[id]||[]).forEach(({n})=>{dFlow[id]+=countDown(n.id);});return dFlow[id];}
  nodes.forEach(n=>{if(!vis2.has(n.id))countDown(n.id);});
  outlets.forEach(o=>{o.flowDownstream=dFlow[o.id]||o.fls||0;});
  pipes.forEach(p=>{
    if(!p.nA||!p.nB)return;p.fls=Math.max(dFlow[p.nB.id],1e-6);
    const D=(p.dia||25)/1e3,Q=p.fls*.001;p.vel=Q/(Math.PI*D*D/4);
    if(method==='hw')p.hL=hwLoss(p.len||10,p.fls,p.dia||25,hwC);else p.hL=(p.len||10)*1.25*fric;
    if(p.valve){const kv=p.valve.kv||25;const dp=Math.pow(p.fls*3.6/kv,2)*10.2;p.vL=dp;p.valve.pdrop=dp;}else p.vL=0;
  });
  const juncLoss={};nodes.filter(n=>n.type==='junc'&&(n.eqLoss||0)>0).forEach(n=>{juncLoss[n.id]=n.eqLoss;});
  const boilDropM=nodes.filter(n=>isHeat(n.type)).reduce((s,b)=>s+(b.pdm||0),0);
  const tank=tanks[0],mainPump=pumps.find(p=>p.type==='pump-booster')||pumps.find(p=>p.type==='pump-lift')||pumps[0];
  const tankElevM=tank?(tank.elev||0):0,tankStatM=tank?(tank.pbar||0)*10.2:0,staticM=tankElevM+tankStatM;
  const src=tank||mainPump;if(!src){showRes('<p style="font-size:10px;color:var(--red);padding:6px">Add a tank or pump.</p>');scheduleDraw();return;}
  const distFromSrc=bfsLoss(src.id,adj);
  const worstFricM=outlets.length?Math.max(...outlets.map(o=>isFinite(distFromSrc[o.id])?distFromSrc[o.id]:0)):0;
  const maxElevM=outlets.length?Math.max(...outlets.map(o=>o.elev||0)):0,maxResM=outlets.length?Math.max(...outlets.map(o=>(o.rbar||1.5)*10.2)):15;
  let pumpHM=0;const pUnk=mainPump&&mainPump.hm===null&&!(mainPump.curvePoints?.length);
  if(mainPump&&mainPump.curvePoints?.length){const ch=pumpCurveHead(mainPump,totFlow);pumpHM=ch!==null?ch:(mainPump.hm||0);mainPump.rH=pumpHM;}
  else if(pUnk){if(mainPump.type==='pump-lift')pumpHM=Math.max(0,(mainPump.liftElev||10)-tankElevM+worstFricM+maxResM-tankStatM);else if(mainPump.type==='pump-circ')pumpHM=worstFricM;else pumpHM=Math.max(0,(maxElevM-tankElevM)+worstFricM+maxResM-tankStatM);mainPump.rH=pumpHM;}
  else{pumpHM=mainPump?(mainPump.hm||0):0;}
  const totSupM=staticM+pumpHM;
  const nodeM={};nodeM[src.id]=totSupM;
  const bq2=[src.id],bv2=new Set([src.id]);
  while(bq2.length){const cid=bq2.shift();(adj[cid]||[]).forEach(({n,p})=>{if(bv2.has(n.id))return;bv2.add(n.id);const jl=juncLoss[cid]||0,hl=isHeat(n.type)?(n.pdm||0):0;nodeM[n.id]=Math.max(0,(nodeM[cid]||0)-(p.hL||0)-(p.vL||0)-hl-jl);bq2.push(n.id);});}
  pipes.forEach(p=>{if(!p.nA||!p.nB)return;p.pA=m2b(nodeM[p.nA.id]||0);p.pB=m2b(nodeM[p.nB.id]||0);});
  nodes.forEach(n=>{const m=nodeM[n.id];n.rP=m!==undefined?m2b(m):undefined;if(n.type==='outlet'&&m!==undefined){n.sP=m2b(staticM+pumpHM);n.fP=m2b(distFromSrc[n.id]||0);}});
  if(mainPump)mainPump.rP=m2b(pumpHM);if(tank)tank.rP=m2b(staticM);
  const resBar=m2b(totSupM-worstFricM);
  const minOutP=outlets.length?Math.min(...outlets.map(o=>o.rP||0)):resBar;
  const minReq=outlets.length?Math.min(...outlets.map(o=>o.rbar||1.5)):1.5;
  const ok=minOutP>=minReq,wn=!ok&&minOutP>=minReq*.7,sc=ok?'ok':wn?'w':'er';
  const methodLbl=method==='hw'?`Hazen-Williams (C=${hwC})`:`Approx. ${(fric*100).toFixed(0)}% +25%`;
  const pR=pipes.map((p,i)=>{const vc=p.vel<1.2?'i':p.vel<=2.4?'ok':'er';return`<div class="rr"><span class="rl">Pipe ${i+1}</span><span class="rv ${vc}" style="font-size:9px">Q=${fd(p.fls||0)} · v=${(p.vel||0).toFixed(2)}m/s · ΔH=${(p.hL||0).toFixed(2)}m</span></div>`;}).join('');
  const circRows=circPumps.map(p=>`<div class="rr"><span class="rl">${p.cl||p.label}</span><span class="rv v">Q=${fd(p.circFls||0)} · h=${p.rH?p.rH.toFixed(2):'?'} m</span></div>`).join('');
  const heatRows=nodes.filter(n=>isHeat(n.type)).map(n=>`<div class="rr"><span class="rl">${n.cl||n.label}</span><span class="rv" style="color:var(--orange)">Q=${n.Qkw!==undefined?n.Qkw.toFixed(1):'-'} kW · ΔP=${n.pdm||0} m</span></div>`).join('');
  showRes(`<div class="rr"><span class="rl">Method</span><span class="rv i" style="font-size:9px">${methodLbl}</span></div>${pUnk&&mainPump?`<div class="rr"><span class="rl" style="color:var(--orange)">Pump head req.</span><span class="rv" style="color:var(--orange)">${pumpHM.toFixed(2)} m</span></div>`:''}<div class="pbox"><div class="pbox-t">Pressure Summary</div><div class="rr"><span class="rl">🔵 Static</span><span class="rv i">${pd(m2b(staticM))}</span></div><div class="rr"><span class="rl">🔵 Pump head</span><span class="rv i">${pd(m2b(pumpHM))}</span></div><div class="rr"><span class="rl">= Total supply</span><span class="rv">${pd(m2b(totSupM))}</span></div><div class="rr"><span class="rl">🔴 Worst loss</span><span class="rv er">${pd(m2b(worstFricM))}</span></div><div class="rr"><span class="rl">🟢 Residual</span><span class="rv ${sc}">${pd(resBar)}</span></div></div>${circRows?`<div class="pbox"><div class="pbox-t">Circulation</div>${circRows}</div>`:''}${heatRows?`<div class="pbox"><div class="pbox-t">Thermal</div>${heatRows}</div>`:''}<div class="rr"><span class="rl">Total demand</span><span class="rv">${fd(totFlow)}</span></div>${pR}<div class="rr" style="margin-top:4px"><span class="rl">Status</span><span class="bdg ${sc}">${ok?'✓ OK':wn?'⚠ Low':'✗ Fail'}</span></div>`);
  // Summary cards
  const avgVelAll=pipes.filter(p=>p.vel!==undefined).reduce((s,p,_,a)=>s+p.vel/a.length,0)||0;
  const pumpPowKw=mainPump&&pumpHM>0?(totFlow*.001*pumpHM*1000*9.81/1000/.75):0;
  updateSummaryCards({totalFlow:fd(totFlow),headLoss:worstFricM.toFixed(2)+' m',pIn:pd(m2b(totSupM)),pOut:pd(minOutP),pOk:ok,pWarn:wn,power:pumpPowKw>0?pumpPowKw.toFixed(2)+' kW':'—',avgVel:avgVelAll.toFixed(2)+' m/s',velOk:avgVelAll<1.2,velWarn:avgVelAll<=2.4});
  // Table
  const tableRows=[];let pIdx=0,vIdx=0;
  pipes.forEach(p=>{if(!p.nA||!p.nB)return;pIdx++;tableRows.push({id:'P-'+String(pIdx).padStart(3,'0'),name:p.cl||('Pipe '+pIdx),type:'Pipe',dia:p.dia||25,len:p.len||10,flow:fd(p.fls||0),flowRaw:p.fls||0,vel:p.vel,hFric:p.hL||0,hValve:0,hTot:p.hL||0,pIn:p.pA,pOut:p.pB});if(p.valve){vIdx++;tableRows.push({id:'V-'+String(vIdx).padStart(3,'0'),name:p.valve.cl||p.valve.label,type:(p.valve.valveType||'gate').charAt(0).toUpperCase()+(p.valve.valveType||'gate').slice(1)+' Valve',dia:p.dia||25,len:undefined,flow:fd(p.fls||0),flowRaw:p.fls||0,vel:undefined,hFric:undefined,hValve:p.vL||0,hTot:p.vL||0,pIn:p.pA,pOut:p.pB});}});
  buildResultsTable({rows:tableRows,totalFlowStr:fd(totFlow),status:ok?'✓ OK':wn?'⚠ Low':'✗ Fail',statusCls:sc});
  switchTab('calc');if(sel)showProp(sel);scheduleDraw();
}

function showRes(html){const el=document.getElementById('rp-results');if(el)el.innerHTML=html||'';}
function updateSummaryCards(data){
  const set=(id,v,cls)=>{const el=document.getElementById(id);if(!el)return;el.textContent=v;el.className='scard-val'+(cls?' '+cls:'');};
  set('sc-flow',data.totalFlow||'—','td-info');set('sc-hloss',data.headLoss||'—','');set('sc-pin',data.pIn||'—','td-info');set('sc-pout',data.pOut||'—',data.pOk?'td-ok':data.pWarn?'td-warn':'td-err');set('sc-power',data.power||'—','');set('sc-vel',data.avgVel||'—',data.velOk?'td-ok':data.velWarn?'td-ok':'td-err');
}
function buildResultsTable(tableData){
  const wrap=document.getElementById('results-table-wrap'),tbody=document.getElementById('rt-tbody'),tfoot=document.getElementById('rt-tfoot'),badge=document.getElementById('rt-status-badge');
  if(!wrap||!tbody)return;wrap.style.display='flex';tbody.innerHTML='';tfoot.innerHTML='';
  let totLen=0,totFric=0,totValve=0,totTot=0,velSum=0,velCnt=0;
  tableData.rows.forEach(r=>{
    const tr=document.createElement('tr');
    const vcls=r.vel!==undefined?(r.vel>2.4?'td-err':'td-ok'):'';
    tr.innerHTML=`<td class="td-id">${r.id}</td><td>${r.name}</td><td>${r.type}</td><td>${r.dia||'—'}</td><td>${r.len||'—'}</td><td class="td-info">${r.flow}</td><td class="${vcls}">${r.vel!==undefined?r.vel.toFixed(2):'—'}</td><td>${r.hFric!==undefined?r.hFric.toFixed(3):'—'}</td><td>${r.hValve!==undefined?r.hValve.toFixed(3):'—'}</td><td class="td-warn">${r.hTot!==undefined?r.hTot.toFixed(3):'—'}</td><td>${r.pIn!==undefined?r.pIn.toFixed(3):'—'}</td><td class="td-ok">${r.pOut!==undefined?r.pOut.toFixed(3):'—'}</td>`;
    tbody.appendChild(tr);
    if(r.len)totLen+=r.len;if(r.hFric)totFric+=r.hFric;if(r.hValve)totValve+=r.hValve;if(r.hTot)totTot+=r.hTot;if(r.vel){velSum+=r.vel;velCnt++;}
  });
  const avgVel=velCnt?velSum/velCnt:0;
  tfoot.innerHTML=`<tr><td colspan="3">Total / Average</td><td>—</td><td>${totLen.toFixed(1)}</td><td class="td-info">${tableData.totalFlowStr||'—'}</td><td class="${avgVel>2.4?'td-err':'td-ok'}">${avgVel.toFixed(2)}</td><td>${totFric.toFixed(3)}</td><td>${totValve.toFixed(3)}</td><td class="td-warn">${totTot.toFixed(3)}</td><td>—</td><td>—</td></tr>`;
  if(badge){badge.textContent=tableData.status||'—';badge.className='bdg '+(tableData.statusCls||'ok');}
}

// Stubs — real implementations in app.js
function updateMinimap(){}
function updateStatusBar(){}
function switchTab(){}
function saveProp(){}
function showProp(){}
