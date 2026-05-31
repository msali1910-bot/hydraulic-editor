// ════════════════════════════════════════════════════════
//  engine.js — Hydraulic P&ID v12
// ════════════════════════════════════════════════════════
//
//  محتويات الملف ده:
//  ┌─────────────────────────────────────────────────────┐
//  │ 1. CONSTANTS     — أرقام ثابتة (SNAP_GRID, zoom…) │
//  │ 2. STATE         — nodes, pipes, sel, history       │
//  │ 3. UNDO / REDO   — snapshot, restoreSnap            │
//  │ 4. SAVE / LOAD   — saveProject, loadProject         │
//  │ 5. UNITS         — تحويل bar/psi/m, L/s/m³h        │
//  │ 6. NODE TYPES    — mkN, isPump, isHeat, TC colors   │
//  │ 7. DRAW ENGINE   — drawNode, drawPipe, drawGrid     │
//  │ 8. CALC ENGINE   — _doCalc, bfsLoss, hwLoss         │
//  └─────────────────────────────────────────────────────┘
//
//  لو عايز تعدل في الحسابات أو الألوان أو بنية الـ nodes
//  → ابعت الملف ده بس (650 سطر)
//
// ════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
//  FIX #10 — NAMED CONSTANTS
// ═══════════════════════════════════════════════════
const SNAP_GRID       = 20;
const HIT_RADIUS      = 28;
const VALVE_HIT_R     = 18;
const PIPE_HIT_W      = 13;
const PIPE_HIT_T_MIN  = 0.08;
const PIPE_HIT_T_MAX  = 0.92;
const LABEL_ZOOM_MIN  = 0.45;
const LABEL_ZOOM_SML  = 0.32;
const GRID_STEP       = 40;
const ZOOM_MIN        = 0.08;
const ZOOM_MAX        = 8;
const HISTORY_LIMIT   = 30;
const AUTOSAVE_KEY    = 'hydraulic_pid_v12';

// ═══════════════════════════════════════════════════
//  CORE SETUP
// ═══════════════════════════════════════════════════
const cv=document.getElementById('cv'),ctx=cv.getContext('2d'),wrap=document.getElementById('cvwrap');
let W,H,zoom=1,panX=0,panY=0,isPanning=false,panStart={x:0,y:0};

// FIX #5 — requestAnimationFrame scheduler (no more 200 redraws/sec on drag)
let rafPending=false;
function scheduleDraw(){
  if(!rafPending){rafPending=true;requestAnimationFrame(()=>{draw();rafPending=false;});}
}
function rsz(){W=wrap.clientWidth;H=wrap.clientHeight;cv.width=W;cv.height=H;scheduleDraw();}
const ro=new ResizeObserver(rsz);ro.observe(wrap);

function toggleGroup(id){document.getElementById(id).classList.toggle('collapsed');}

// Flash helper
let _flashT=null;
function showFlash(msg,col){
  const el=document.getElementById('flash');
  el.textContent=msg;el.style.color=col||'#c8cdd6';el.style.opacity='1';
  if(_flashT)clearTimeout(_flashT);
  _flashT=setTimeout(()=>{el.style.opacity='0';},1500);
}

// FIX #11 — reliable UID
const uid=()=>Math.random().toString(36).slice(2,9)+Date.now().toString(36);

// ═══════════════════════════════════════════════════
//  LABEL QUEUE — anti-overlap system
//  Labels are collected during drawNode/drawPipe then
//  drawn in one final pass so they never hide behind symbols.
// ═══════════════════════════════════════════════════
let _lblQ=[];
function qLbl(text,wx,wy,clr,pri){_lblQ.push({text,wx,wy,clr:clr||'#c8cdd6',pri:pri||0});}

function flushLabels(){
  if(!_lblQ.length)return;
  _lblQ.sort((a,b)=>a.pri-b.pri);
  // Seed placed boxes with all node symbol footprints
  const placed=[];
  nodes.forEach(n=>{
    if(n.type==='valve')return;
    const s=w2s(n.wx,n.wy);
    const r=n.type==='junc'?8:n.type==='outlet'?16:n.type==='hex'?24:18;
    placed.push({x1:s.x-r,y1:s.y-r,x2:s.x+r,y2:s.y+r});
  });
  // Also seed pipe lines as rough boxes to avoid
  pipes.forEach(p=>{
    if(!p.nA||!p.nB)return;
    const sa=w2s(p.nA.wx,p.nA.wy),sb=w2s(p.nB.wx,p.nB.wy);
    placed.push({x1:Math.min(sa.x,sb.x)-4,y1:Math.min(sa.y,sb.y)-4,x2:Math.max(sa.x,sb.x)+4,y2:Math.max(sa.y,sb.y)+4});
  });

  _lblQ.forEach(({text,wx,wy,clr})=>{
    const s=w2s(wx,wy);
    ctx.save();ctx.font='bold 8.5px "Segoe UI",sans-serif';
    const tw=ctx.measureText(text).width+8,th=14;ctx.restore();
    // 8 candidate offsets — prefer below then above, then sides
    const cands=[
      {dx:0,dy:26},{dx:0,dy:-26},{dx:34,dy:0},{dx:-34,dy:0},
      {dx:26,dy:24},{dx:-26,dy:24},{dx:26,dy:-24},{dx:-26,dy:-24},
      {dx:0,dy:40},{dx:0,dy:-40},{dx:48,dy:0},{dx:-48,dy:0}
    ];
    let bestX=s.x,bestY=s.y+26,minOvlp=999;
    for(const {dx,dy} of cands){
      const tx=Math.max(tw/2+3,Math.min(W-tw/2-3,s.x+dx));
      const ty=Math.max(th/2+3,Math.min(H-th/2-3,s.y+dy));
      const box={x1:tx-tw/2,y1:ty-th/2,x2:tx+tw/2,y2:ty+th/2};
      let ovlp=0;for(const p of placed)if(box.x1<p.x2&&box.x2>p.x1&&box.y1<p.y2&&box.y2>p.y1)ovlp++;
      if(ovlp<minOvlp){minOvlp=ovlp;bestX=tx;bestY=ty;if(ovlp===0)break;}
    }
    placed.push({x1:bestX-tw/2,y1:bestY-th/2,x2:bestX+tw/2,y2:bestY+th/2});
    bgText(text,bestX,bestY,'center','middle',clr,'rgba(8,10,13,.94)');
  });
  _lblQ=[];
}

// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
let nodes=[],pipes=[],sel=null,selSet=new Set(),mode='sel',pipeSt=null;
let drag=null,doff={x:0,y:0},mp={x:0,y:0};
let calc=false,ncnt={};
let boxSelecting=false,boxStart={x:0,y:0},boxEnd={x:0,y:0};
let multiDragStart=null,multiDragOffsets=[];

// ═══════════════════════════════════════════════════
//  FIX #2 & #3 — UNDO/REDO with deep copy curvePoints + ncnt save
// ═══════════════════════════════════════════════════
let history=[],historyPtr=-1;
function deepNode(n){
  return{...n,curvePoints:Array.isArray(n.curvePoints)?n.curvePoints.map(p=>({...p})):[]};
}
function snapshot(){
  const s=JSON.stringify({
    nodes:nodes.map(deepNode),
    pipes:pipes.map(p=>({...p,nA:p.nA?.id,nB:p.nB?.id,valve:p.valve?.id})),
    ncnt:{...ncnt}
  });
  history=history.slice(0,historyPtr+1);
  history.push(s);
  historyPtr=history.length-1;
  if(history.length>HISTORY_LIMIT){history.shift();historyPtr=history.length-1;}
  updateUndoRedo();
  _autoSave(s);
}
function updateUndoRedo(){
  document.getElementById('bundo').style.opacity=historyPtr>0?'1':'0.4';
  document.getElementById('bredo').style.opacity=historyPtr<history.length-1?'1':'0.4';
}
function restoreSnap(s){
  const d=JSON.parse(s);
  nodes=d.nodes.map(deepNode);
  ncnt=d.ncnt||{};
  pipes=d.pipes.map(p=>{
    const r={...p};
    r.nA=nodes.find(n=>n.id===p.nA)||null;
    r.nB=nodes.find(n=>n.id===p.nB)||null;
    r.valve=p.valve?nodes.find(n=>n.id===p.valve)||null:null;
    return r;
  });
  sel=null;selSet.clear();calc=false;
  document.getElementById('phint').style.display='';
  document.getElementById('pprops').style.display='none';
  scheduleDraw();
}
function undo(){
  if(historyPtr>0){historyPtr--;restoreSnap(history[historyPtr]);updateUndoRedo();showFlash('↩ Undo','#a78bfa');}
}
function redo(){
  if(historyPtr<history.length-1){historyPtr++;restoreSnap(history[historyPtr]);updateUndoRedo();showFlash('↪ Redo','#a78bfa');}
}

// ═══════════════════════════════════════════════════
//  FIX #6 — AUTO-SAVE + SAVE/LOAD PROJECT JSON
// ═══════════════════════════════════════════════════
function _autoSave(snapStr){
  try{localStorage.setItem(AUTOSAVE_KEY,snapStr);}catch(e){}
}
function autoLoad(){
  try{
    const raw=localStorage.getItem(AUTOSAVE_KEY);
    if(raw){restoreSnap(raw);showFlash('✓ Last session restored','#22c55e');}
  }catch(e){}
}
function saveProject(){
  const data={
    version:12,
    nodes:nodes.map(deepNode),
    pipes:pipes.map(p=>({...p,nA:p.nA?.id,nB:p.nB?.id,valve:p.valve?.id})),
    ncnt:{...ncnt},
    settings:{
      calcMethod:document.getElementById('calc-method').value,
      fric:document.getElementById('fsl').value,
      hwC:document.getElementById('hw-c').value,
      up:document.getElementById('up').value,
      uf2:document.getElementById('uf').value
    }
  };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.download='hydraulic_'+Date.now()+'.json';
  a.href=URL.createObjectURL(blob);a.click();
  showFlash('💾 Project saved','#34d399');
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
        document.getElementById('up').value=data.settings.up||'m';
        document.getElementById('uf').value=data.settings.uf2||'ls';
        document.getElementById('calc-method').dispatchEvent(new Event('change'));
      }
      restoreSnap(JSON.stringify({nodes:data.nodes,pipes:data.pipes,ncnt:data.ncnt||{}}));
      snapshot();
      showFlash('📂 Project loaded','#7dd3fc');
    }catch(err){showFlash('✗ Invalid file','#ef4444');}
  };
  reader.readAsText(file);
}

// ═══════════════════════════════════════════════════
//  IPC FIXTURE UNITS
// ═══════════════════════════════════════════════════
const FU_T=[[0,0],[1,.05],[2,.07],[4,.11],[6,.14],[10,.18],[20,.27],[30,.33],[50,.42],[100,.60],[200,.85],[500,1.38],[1000,1.95]];
function fu2ls(f){
  if(f<=0)return 0;
  for(let i=0;i<FU_T.length-1;i++){
    const[a,b]=FU_T[i],[c,d]=FU_T[i+1];
    if(f<=c)return b+(f-a)/(c-a)*(d-b);
  }
  return FU_T[FU_T.length-1][1];
}

// ═══════════════════════════════════════════════════
//  UNIT CONVERSIONS
// ═══════════════════════════════════════════════════
const gPU=()=>document.getElementById('up').value;
const gFU=()=>document.getElementById('uf').value;
function m2b(m){return m/10.2;}
function pd(bar){const u=gPU(),v=u==='m'?bar*10.2:u==='psi'?bar*14.504:u==='kpa'?bar*100:bar;return v.toFixed(2)+' '+(u==='m'?'m':u);}
function pl(){const u=gPU();return u==='m'?'m H₂O':u==='psi'?'psi':u==='kpa'?'kPa':'bar';}
function p2d(bar){const u=gPU();return u==='m'?+(bar*10.2).toFixed(2):u==='psi'?+(bar*14.504).toFixed(2):u==='kpa'?+(bar*100).toFixed(1):+bar.toFixed(3);}
function d2p(v){const u=gPU();return u==='m'?v/10.2:u==='psi'?v/14.504:u==='kpa'?v/100:v;}
function fd(ls){const u=gFU();return u==='lm'?(ls*60).toFixed(2)+' L/m':u==='m3h'?(ls*3.6).toFixed(3)+' m³/h':ls.toFixed(3)+' L/s';}
function fl(){const u=gFU();return u==='lm'?'L/min':u==='m3h'?'m³/h':'L/s';}
function f2d(ls){const u=gFU();return u==='lm'?+(ls*60).toFixed(3):u==='m3h'?+(ls*3.6).toFixed(4):+ls.toFixed(4);}
function d2f(v){const u=gFU();return u==='lm'?v/60:u==='m3h'?v/3.6:v;}

// ═══════════════════════════════════════════════════
//  COORDINATE TRANSFORMS
// ═══════════════════════════════════════════════════
function w2s(x,y){return{x:x*zoom+panX,y:y*zoom+panY};}
function s2w(x,y){return{x:(x-panX)/zoom,y:(y-panY)/zoom};}
function hwLoss(L,Q_ls,D_mm,C){
  const Leq=L*1.25,Q=Q_ls/1000,D=D_mm/1000;
  if(Q<1e-9||D<1e-6)return 0;
  return 10.67*Leq*Math.pow(Q,1.852)/(Math.pow(C,1.852)*Math.pow(D,4.87));
}

// ═══════════════════════════════════════════════════
//  NODE TYPES
// ═══════════════════════════════════════════════════
const TC={
  'tank':{s:'#a3e635',f:'#081500',label:'TANK'},
  'pump-booster':{s:'#60a5fa',f:'#080f1a',label:'BST'},
  'pump-lift':{s:'#818cf8',f:'#0c0a1a',label:'LIFT'},
  'pump-circ':{s:'#34d399',f:'#041a10',label:'CIRC'},
  'hex':{s:'#f97316',f:'#160800',label:'HEX'},
  'calorifier':{s:'#fb923c',f:'#160a00',label:'CAL'},
  'valve':{s:'#facc15',f:'#161000',label:'V'},
  'outlet':{s:'#22c55e',f:'#051a0a',label:'OUT'},
  'junc':{s:'#7dd3fc',f:'#001620',label:'·'}
};
function isPump(t){return t==='pump-booster'||t==='pump-lift'||t==='pump-circ';}
function isHeat(t){return t==='hex'||t==='calorifier';}
function mkN(type,wx,wy){
  ncnt[type]=(ncnt[type]||0)+1;
  const c=TC[type]||{label:type};
  const L=c.label+ncnt[type];
  const b={id:uid(),type,wx,wy,label:L,cl:'',rP:undefined};
  if(type==='tank')return{...b,elev:10,pbar:0};
  if(type==='pump-booster')return{...b,hm:null,fls:1.5,flip:false,rH:undefined,pumpType:'booster',curvePoints:[]};
  if(type==='pump-lift')return{...b,hm:null,fls:1.5,flip:false,rH:undefined,pumpType:'lift',liftElev:10,curvePoints:[]};
  if(type==='pump-circ')return{...b,hm:null,flip:false,rH:undefined,pumpType:'circ',circMethod:'fu',circFU:50,circRisers:5,circHeatLoss:500,circFls:undefined,curvePoints:[]};
  if(type==='valve')return{...b,kv:25,pdrop:undefined};
  if(type==='outlet')return{...b,fm:'manual',fls:.3,fu:6,rbar:1.5,elev:0,sP:undefined,fP:undefined,flowDownstream:undefined};
  if(type==='hex')return{...b,pdm:3,Tin:80,Tout:60,mflow:1,cpFluid:4.18,Qkw:undefined};
  if(type==='calorifier')return{...b,pdm:3,Tin:80,Tout:60,mflow:1,cpFluid:4.18,Qkw:undefined};
  if(type==='junc')return{...b,eqLoss:0};
  return b;
}

// Pump curve interpolation
function pumpCurveHead(pump,flowLs){
  const pts=pump.curvePoints||[];if(!pts.length)return null;
  const sorted=[...pts].sort((a,bb)=>a.q-bb.q);
  if(flowLs<=sorted[0].q)return sorted[0].h;
  if(flowLs>=sorted[sorted.length-1].q)return sorted[sorted.length-1].h;
  for(let i=0;i<sorted.length-1;i++){
    const aa=sorted[i],bb=sorted[i+1];
    if(flowLs>=aa.q&&flowLs<=bb.q){const tt=(flowLs-aa.q)/(bb.q-aa.q);return aa.h+tt*(bb.h-aa.h);}
  }
  return null;
}

// ═══════════════════════════════════════════════════
//  DRAW COLORS
// ═══════════════════════════════════════════════════
function velClr(v){if(v===undefined||!calc)return'#2e3540';if(v<1.2)return'#60a5fa';if(v<=2.4)return'#4ade80';return'#f87171';}
function nClr(n){
  const base=TC[n.type]||{s:'#888',f:'#1a1a1a'};
  if(!calc)return base;
  if(n.type==='outlet'){
    const p=n.rP,r=n.rbar||1.5;
    if(p===undefined)return{...base,s:'#444'};
    if(p>=r)return{...base,s:'#22c55e',f:'#041a04'};
    if(p>=r*.7)return{...base,s:'#eab308',f:'#141000'};
    return{...base,s:'#ef4444',f:'#1a0404'};
  }
  return base;
}

// ═══════════════════════════════════════════════════
//  DRAW HELPERS
// ═══════════════════════════════════════════════════
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
function drawValveOnPipe(x,y,ang,isSel){
  ctx.save();ctx.translate(x,y);ctx.rotate(ang);
  ctx.strokeStyle=isSel?'#fff':'#facc15';ctx.lineWidth=1.4;
  ctx.beginPath();ctx.moveTo(-9,-5);ctx.lineTo(0,0);ctx.lineTo(-9,5);ctx.closePath();ctx.stroke();
  ctx.beginPath();ctx.moveTo(9,-5);ctx.lineTo(0,0);ctx.lineTo(9,5);ctx.closePath();ctx.stroke();
  ctx.beginPath();ctx.moveTo(0,-3);ctx.lineTo(0,-9);ctx.moveTo(-4,-9);ctx.lineTo(4,-9);ctx.stroke();
  ctx.restore();
}

function drawPipe(p){
  if(!p.nA||!p.nB)return;
  const sa=w2s(p.nA.wx,p.nA.wy),sb=w2s(p.nB.wx,p.nB.wy);
  const clr=velClr(p.vel);
  const isSel=sel===p||selSet.has(p);
  ctx.strokeStyle=isSel?'#fff':clr;ctx.lineWidth=isSel?3:2.2;ctx.setLineDash([]);
  ctx.beginPath();ctx.moveTo(sa.x,sa.y);ctx.lineTo(sb.x,sb.y);ctx.stroke();
  const ang=Math.atan2(sb.y-sa.y,sb.x-sa.x);
  const mx=(sa.x+sb.x)/2,my=(sa.y+sb.y)/2;
  drawArrow(mx,my,ang,clr);
  if(zoom>LABEL_ZOOM_MIN){
    const perp=ang-Math.PI/2,ox=Math.cos(perp)*14,oy=Math.sin(perp)*14;
    bgText('Ø'+(p.dia||25)+'/'+(p.len||10)+'m',mx+ox,my+oy,'center','middle','#3a4555','rgba(0,0,0,.92)');
    if(calc&&p.fls!==undefined)bgText(fd(p.fls),mx-ox,my-oy,'center','middle','#60a5fa','rgba(0,0,0,.92)');
    // Endpoint pressures queued (not drawn inline) so they don't overlap nodes
    if(calc){
      const wA=s2w(sa.x,sa.y),wB=s2w(sb.x,sb.y);
      if(p.pA!==undefined)qLbl(pd(p.pA),wA.x,wA.y,'#ca8a04',2);
      if(p.pB!==undefined)qLbl(pd(p.pB),wB.x,wB.y,'#4ade80',2);
    }
  }
  // valve drawn only on pipe — never as standalone node
  if(p.valve){
    const vx=(sa.x+sb.x)/2,vy=(sa.y+sb.y)/2;
    drawValveOnPipe(vx,vy,ang,p.valve===sel);
    if(zoom>0.5){
      const vlbl=p.valve.cl||p.valve.label;
      bgText(vlbl,vx,vy+16,'center','middle','#a8890a','rgba(0,0,0,.88)');
      if(calc&&p.valve.pdrop!==undefined)
        bgText('ΔP='+p.valve.pdrop.toFixed(2)+'m',vx,vy+26,'center','middle','#facc15','rgba(0,0,0,.88)');
    }
  }
}

function drawNode(n){
  if(n.type==='valve')return; // rendered on pipe only — never standalone
  const s=w2s(n.wx,n.wy);const{x,y}=s;
  const c=nClr(n);const t=n.type;const fl2=n.flip?-1:1;
  const isSel=n===sel||selSet.has(n);
  ctx.fillStyle=c.f;ctx.strokeStyle=isSel?'#fff':c.s;ctx.lineWidth=isSel?2.2:1.5;ctx.setLineDash([]);

  if(t==='tank'){
    const w=46,h=30;
    ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x-w/2,y-h/2,w,h,3);else ctx.rect(x-w/2,y-h/2,w,h);
    ctx.fill();ctx.stroke();
    ctx.fillStyle='#0e2000';ctx.fillRect(x-w/2+1,y,w-2,h/2-1);
    ctx.strokeStyle=c.s;ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(x-w/2,y);ctx.lineTo(x+w/2,y);ctx.stroke();
    if(zoom>0.4){ctx.font='bold 7px sans-serif';ctx.fillStyle=c.s;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('TANK',x,y-7);}
  } else if(isPump(t)){
    const r=15,col=c.s;
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.save();ctx.translate(x,y);ctx.rotate(fl2===1?0:Math.PI);
    ctx.fillStyle=col;const hs=r*.52;
    ctx.beginPath();ctx.moveTo(hs,0);ctx.lineTo(-hs,-hs*.88);ctx.lineTo(-hs,hs*.88);ctx.closePath();ctx.fill();
    ctx.restore();
    if(t==='pump-circ'){
      ctx.strokeStyle=col;ctx.lineWidth=1.2;
      ctx.beginPath();ctx.arc(x,y,r+5,Math.PI*.7,Math.PI*2.2);ctx.stroke();
      drawArrow(x+(r+5)*Math.cos(Math.PI*2.2),y+(r+5)*Math.sin(Math.PI*2.2),Math.PI*2.2+Math.PI/2,col);
    }
    const inX=x+(r+5)*(fl2===1?-1:1),outX=x+(r+5)*(fl2===1?1:-1);
    ctx.fillStyle='#4ade80';ctx.beginPath();ctx.arc(inX,y,2.5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#f87171';ctx.beginPath();ctx.arc(outX,y,2.5,0,Math.PI*2);ctx.fill();
    if(zoom>0.55){
      ctx.font='7px sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';
      ctx.fillStyle='#4ade80';ctx.fillText('IN',inX,y-5);
      ctx.fillStyle='#f87171';ctx.fillText('OUT',outX,y-5);
    }
  } else if(t==='outlet'){
    const r=13;
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-r*.6,y);ctx.lineTo(x+r*.6,y);ctx.moveTo(x,y-r*.6);ctx.lineTo(x,y+r*.6);ctx.stroke();
    ctx.fillStyle=c.s;ctx.beginPath();ctx.arc(x,y,r*.28,0,Math.PI*2);ctx.fill();
  } else if(t==='hex'){
    const w=40,h=26;
    ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x-w/2,y-h/2,w,h,3);else ctx.rect(x-w/2,y-h/2,w,h);
    ctx.fill();ctx.stroke();
    ctx.strokeStyle=c.s;ctx.lineWidth=.7;ctx.setLineDash([3,2]);
    ctx.beginPath();ctx.moveTo(x-w/2+5,y-4);ctx.lineTo(x+w/2-5,y-4);ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-w/2+5,y+4);ctx.lineTo(x+w/2-5,y+4);ctx.stroke();
    ctx.setLineDash([]);ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(x-w/2,y);ctx.lineTo(x-w/2-5,y);ctx.moveTo(x+w/2,y);ctx.lineTo(x+w/2+5,y);ctx.stroke();
    if(zoom>0.4){ctx.font='bold 6.5px sans-serif';ctx.fillStyle=c.s;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('HEX',x,y);}
  } else if(t==='calorifier'){
    ctx.beginPath();ctx.ellipse(x,y,18,13,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-8,y+4);ctx.quadraticCurveTo(x,y-8,x+8,y+4);ctx.stroke();
    ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,y-13);ctx.lineTo(x,y-19);ctx.moveTo(x,y+13);ctx.lineTo(x,y+19);ctx.stroke();
  } else if(t==='junc'){
    ctx.fillStyle=c.s;ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();
  }

  if(isSel){
    ctx.strokeStyle='rgba(255,255,255,.28)';ctx.lineWidth=1;ctx.setLineDash([3,3]);
    const sr=isPump(t)||t==='outlet'?21:t==='junc'?10:t==='hex'?24:22;
    ctx.beginPath();
    if(isPump(t)||t==='outlet'||t==='junc')ctx.arc(x,y,sr,0,Math.PI*2);
    else ctx.rect(x-sr,y-sr*.65,sr*2,sr*1.3);
    ctx.stroke();ctx.setLineDash([]);
  }

  // Queue labels — drawn later in flushLabels() to avoid overlap
  if(zoom>LABEL_ZOOM_SML){
    const lbl=n.cl||n.label;
    // Component name (lowest priority — drawn first so others can push it)
    qLbl(lbl,n.wx,n.wy,'#5a6475',0);
    if(calc&&n.rP!==undefined){
      const req=n.rbar||0;
      const pc=t==='outlet'?(n.rP>=req?'#22c55e':n.rP>=req*.7?'#eab308':'#ef4444'):(isPump(t)?'#60a5fa':'#888');
      qLbl(pd(n.rP),n.wx,n.wy,pc,1);
    }
    if(isHeat(n.type)&&calc&&n.Qkw!==undefined)qLbl('Q='+n.Qkw.toFixed(1)+'kW',n.wx,n.wy,'#fb923c',1);
    if(!calc&&isPump(t)&&n.hm===null&&!(n.curvePoints&&n.curvePoints.length))qLbl('? head',n.wx,n.wy,'#6a3a00',0);
    if(t==='pump-circ'&&calc&&n.circFls!==undefined)qLbl(fd(n.circFls),n.wx,n.wy,'#34d399',1);
  }
}

// FIX #4 — fillRect grid (5x faster than arc per dot)
function drawGrid(){
  const step=GRID_STEP*zoom;
  const ox=((panX%step)+step)%step,oy=((panY%step)+step)%step;
  ctx.fillStyle='#1e2530';
  for(let x=ox;x<W;x+=step){
    for(let y=oy;y<H;y+=step){
      ctx.fillRect(x-1,y-1,2,2);
    }
  }
  const step5=step*5;
  const ox5=((panX%step5)+step5)%step5,oy5=((panY%step5)+step5)%step5;
  ctx.strokeStyle='#181e28';ctx.lineWidth=.5;ctx.setLineDash([]);
  for(let x=ox5;x<W;x+=step5){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let y=oy5;y<H;y+=step5){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
}

function drawSelBox(){
  if(!boxSelecting)return;
  const el=document.getElementById('sel-box');
  const x1=Math.min(boxStart.x,boxEnd.x),y1=Math.min(boxStart.y,boxEnd.y);
  const x2=Math.max(boxStart.x,boxEnd.x),y2=Math.max(boxStart.y,boxEnd.y);
  el.style.display='block';el.style.left=x1+'px';el.style.top=y1+'px';
  el.style.width=(x2-x1)+'px';el.style.height=(y2-y1)+'px';
}

function draw(){
  _lblQ=[];  // reset label queue each frame
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#080a0d';ctx.fillRect(0,0,W,H);
  drawGrid();ctx.setLineDash([]);
  pipes.forEach(drawPipe);
  if(pipeSt&&mode==='pip'){
    const ss=w2s(pipeSt.wx,pipeSt.wy);
    ctx.strokeStyle='#3b82f6';ctx.lineWidth=1.5;ctx.setLineDash([5,4]);
    ctx.beginPath();ctx.moveTo(ss.x,ss.y);ctx.lineTo(mp.x,mp.y);ctx.stroke();ctx.setLineDash([]);
  }
  nodes.forEach(drawNode);
  flushLabels();  // draw ALL labels last — never hidden behind symbols
  drawSelBox();
  updateMinimap();  // update minimap
  updateStatusBar();
}

// ═══════════════════════════════════════════════════
//  HIT TESTS — FIX #12: pipe detection via pipes.includes()
// ═══════════════════════════════════════════════════
function hitN(sx,sy,skip){
  const{x:wx,y:wy}=s2w(sx,sy);
  for(let i=nodes.length-1;i>=0;i--){
    const n=nodes[i];
    if(n===skip||n.type==='valve')continue;
    if(Math.hypot(wx-n.wx,wy-n.wy)<HIT_RADIUS/zoom)return n;
  }return null;
}
function hitPipe(sx,sy){
  const{x:wx,y:wy}=s2w(sx,sy);
  for(let i=pipes.length-1;i>=0;i--){
    const p=pipes[i];if(!p.nA||!p.nB)continue;
    const ax=p.nA.wx,ay=p.nA.wy,bx=p.nB.wx,by=p.nB.wy,dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;
    if(l2<1)continue;
    const tt=((wx-ax)*dx+(wy-ay)*dy)/l2;
    if(tt<PIPE_HIT_T_MIN||tt>PIPE_HIT_T_MAX)continue;
    if(Math.hypot(wx-ax-tt*dx,wy-ay-tt*dy)<PIPE_HIT_W/zoom)return{pipe:p,t:tt,wx:ax+tt*dx,wy:ay+tt*dy};
  }return null;
}
function hitValve(sx,sy){
  const{x:wx,y:wy}=s2w(sx,sy);
  for(const p of pipes){
    if(p.valve){
      const vx=(p.nA.wx+p.nB.wx)/2,vy=(p.nA.wy+p.nB.wy)/2;
      if(Math.hypot(wx-vx,wy-vy)<VALVE_HIT_R/zoom)return p.valve;
    }
  }return null;
}
function nodesInBox(x1,y1,x2,y2){
  const w1=s2w(x1,y1),w2=s2w(x2,y2);
  const minX=Math.min(w1.x,w2.x),maxX=Math.max(w1.x,w2.x);
  const minY=Math.min(w1.y,w2.y),maxY=Math.max(w1.y,w2.y);
  return nodes.filter(n=>n.type!=='valve'&&n.wx>=minX&&n.wx<=maxX&&n.wy>=minY&&n.wy<=maxY);
}
function splitPipe(pipe,jwx,jwy){
  const j=mkN('junc',Math.round(jwx/SNAP_GRID)*SNAP_GRID,Math.round(jwy/SNAP_GRID)*SNAP_GRID);
  nodes.push(j);const oldB=pipe.nB;
  pipes.push({id:uid(),nA:j,nB:oldB,dia:pipe.dia||25,len:pipe.len||10});
  pipe.nB=j;return j;
}

// ═══════════════════════════════════════════════════
//  CALCULATION ENGINE
//  FIX #1: boilDropM applied at heat node only (not every BFS step)
//  FIX #8: try/catch wrapper
// ═══════════════════════════════════════════════════
function buildAdj(){
  const adj={};nodes.forEach(n=>{adj[n.id]=[];});
  pipes.forEach(p=>{
    if(!p.nA||!p.nB)return;
    adj[p.nA.id].push({n:p.nB,p});
    adj[p.nB.id].push({n:p.nA,p});
  });
  return adj;
}
// FIX #1: heat node pressure drop applied when arriving at that node
function bfsLoss(srcId,adj){
  const dist={};nodes.forEach(n=>{dist[n.id]=Infinity;});dist[srcId]=0;
  const q=[srcId],vis=new Set([srcId]);
  while(q.length){
    const cid=q.shift();
    (adj[cid]||[]).forEach(({n,p})=>{
      if(vis.has(n.id))return;vis.add(n.id);
      const heatDrop=isHeat(n.type)?(n.pdm||0):0;
      dist[n.id]=dist[cid]+(p.hL||0)+(p.vL||0)+heatDrop;
      q.push(n.id);
    });
  }return dist;
}
function circFlow(pump){
  if(pump.circMethod==='fu')return fu2ls(pump.circFU||50);
  if(pump.circMethod==='risers')return fu2ls((pump.circRisers||5)*10);
  if(pump.circMethod==='heat')return (pump.circHeatLoss||500)/(4.18*1000*20);
  return .3;
}
// FIX #8: outer try/catch
function calculate(){
  try{_doCalc();}
  catch(err){
    showRes(`<p style="font-size:10px;color:#ef4444;padding:4px">⚠ Calc error: ${err.message}</p>`);
    console.error('Hydraulic calc error:',err);
  }
}
function _doCalc(){
  saveProp();calc=true;
  const method=document.getElementById('calc-method').value;
  const fric=parseFloat(document.getElementById('fsl').value)/100;
  const hwC=parseInt(document.getElementById('hw-c').value)||130;
  const pumps=nodes.filter(n=>isPump(n.type));
  const tanks=nodes.filter(n=>n.type==='tank');
  const outlets=nodes.filter(n=>n.type==='outlet');
  const circPumps=nodes.filter(n=>n.type==='pump-circ');
  // Thermal
  nodes.filter(n=>isHeat(n.type)).forEach(n=>{
    n.Qkw=n.mflow*n.cpFluid*Math.abs((n.Tin||80)-(n.Tout||60));
  });
  // Circ flow
  circPumps.forEach(p=>{p.circFls=circFlow(p);});
  // Outlet flow
  outlets.forEach(o=>{if(o.fm==='fu')o.fls=fu2ls(o.fu||6);});
  const totFlow=outlets.reduce((s,o)=>s+(o.fls||.3),0)||1;
  const adj=buildAdj();
  // Downstream flow
  const vis2=new Set(),dFlow={};
  nodes.forEach(n=>{dFlow[n.id]=0;});
  outlets.forEach(o=>{dFlow[o.id]=o.fls||.3;});
  function countDown(id){
    if(vis2.has(id))return dFlow[id];vis2.add(id);
    (adj[id]||[]).forEach(({n})=>{dFlow[id]+=countDown(n.id);});
    return dFlow[id];
  }
  nodes.forEach(n=>{if(!vis2.has(n.id))countDown(n.id);});
  outlets.forEach(o=>{o.flowDownstream=dFlow[o.id]||o.fls||0;});
  // Pipe hydraulics
  pipes.forEach(p=>{
    if(!p.nA||!p.nB)return;
    p.fls=Math.max(dFlow[p.nB.id],1e-6);
    const D=(p.dia||25)/1e3,Q=p.fls*.001;
    p.vel=Q/(Math.PI*D*D/4);
    if(method==='hw')p.hL=hwLoss(p.len||10,p.fls,p.dia||25,hwC);
    else p.hL=(p.len||10)*1.25*fric;
    if(p.valve){const kv=p.valve.kv||25;const dp=Math.pow(p.fls*3.6/kv,2)*10.2;p.vL=dp;p.valve.pdrop=dp;}
    else p.vL=0;
  });
  // Junction equipment loss (branch only)
  const juncLoss={};
  nodes.filter(n=>n.type==='junc'&&(n.eqLoss||0)>0).forEach(n=>{juncLoss[n.id]=n.eqLoss;});
  // FIX #1: boilDropM only for display — bfsLoss already handles it per-node
  const boilDropM=nodes.filter(n=>isHeat(n.type)).reduce((s,b)=>s+(b.pdm||0),0);
  const tank=tanks[0];
  const mainPump=pumps.find(p=>p.type==='pump-booster')||pumps.find(p=>p.type==='pump-lift')||pumps[0];
  const tankElevM=tank?(tank.elev||0):0,tankStatM=tank?(tank.pbar||0)*10.2:0,staticM=tankElevM+tankStatM;
  const src=tank||mainPump;
  if(!src){showRes('<p style="font-size:10px;color:#ef4444">Add a tank or pump.</p>');scheduleDraw();return;}
  const distFromSrc=bfsLoss(src.id,adj);
  const worstFricM=outlets.length?Math.max(...outlets.map(o=>isFinite(distFromSrc[o.id])?distFromSrc[o.id]:0)):0;
  const maxElevM=outlets.length?Math.max(...outlets.map(o=>o.elev||0)):0;
  const maxResM=outlets.length?Math.max(...outlets.map(o=>(o.rbar||1.5)*10.2)):15;
  let pumpHM=0;
  const pUnk=mainPump&&mainPump.hm===null&&!(mainPump.curvePoints&&mainPump.curvePoints.length);
  if(mainPump&&mainPump.curvePoints&&mainPump.curvePoints.length){
    const ch=pumpCurveHead(mainPump,totFlow);
    pumpHM=ch!==null?ch:(mainPump.hm||0);
    mainPump.rH=pumpHM;
  } else if(pUnk){
    // worstFricM now includes heat drops via bfsLoss
    if(mainPump.type==='pump-lift')pumpHM=Math.max(0,(mainPump.liftElev||10)-tankElevM+worstFricM+maxResM-tankStatM);
    else if(mainPump.type==='pump-circ')pumpHM=worstFricM;
    else pumpHM=Math.max(0,(maxElevM-tankElevM)+worstFricM+maxResM-tankStatM);
    mainPump.rH=pumpHM;
  } else{pumpHM=mainPump?(mainPump.hm||0):0;}
  const totSupM=staticM+pumpHM;
  const nodeM={};nodeM[src.id]=totSupM;
  const bq2=[src.id],bv2=new Set([src.id]);
  while(bq2.length){
    const cid=bq2.shift();
    (adj[cid]||[]).forEach(({n,p})=>{
      if(bv2.has(n.id))return;bv2.add(n.id);
      const jl=juncLoss[cid]||0;
      // FIX #1: heat drop only when arriving at heat node (not every pipe)
      const heatNodeLoss=isHeat(n.type)?(n.pdm||0):0;
      nodeM[n.id]=Math.max(0,(nodeM[cid]||0)-(p.hL||0)-(p.vL||0)-heatNodeLoss-jl);
      bq2.push(n.id);
    });
  }
  pipes.forEach(p=>{if(!p.nA||!p.nB)return;p.pA=m2b(nodeM[p.nA.id]||0);p.pB=m2b(nodeM[p.nB.id]||0);});
  nodes.forEach(n=>{
    const m=nodeM[n.id];n.rP=m!==undefined?m2b(m):undefined;
    if(n.type==='outlet'&&m!==undefined){
      n.sP=m2b(staticM+pumpHM);
      n.fP=m2b(distFromSrc[n.id]||0);
    }
  });
  if(mainPump)mainPump.rP=m2b(pumpHM);
  if(tank)tank.rP=m2b(staticM);
  const resBar=m2b(totSupM-worstFricM);
  const minOutP=outlets.length?Math.min(...outlets.map(o=>o.rP||0)):resBar;
  const minReq=outlets.length?Math.min(...outlets.map(o=>o.rbar||1.5)):1.5;
  const ok=minOutP>=minReq,wn=!ok&&minOutP>=minReq*.7,sc=ok?'ok':wn?'w':'er';
  const methodLbl=method==='hw'?`Hazen-Williams (C=${hwC})`:`Approx. ${(fric*100).toFixed(0)}% +25%`;
  const pR=pipes.map((p,i)=>{const vc=p.vel<1.2?'i':p.vel<=2.4?'ok':'er';return`<div class="rr"><span class="rl">Pipe ${i+1}</span><span class="rv ${vc}" style="font-size:9px">Q=${fd(p.fls||0)} · v=${(p.vel||0).toFixed(2)}m/s · ΔH=${(p.hL||0).toFixed(2)}m</span></div>`;}).join('');
  const circRows=circPumps.map(p=>`<div class="rr"><span class="rl">${p.cl||p.label}</span><span class="rv v">Q=${fd(p.circFls||0)} · h=${p.rH?p.rH.toFixed(2):'?'} m</span></div>`).join('');
  const heatRows=nodes.filter(n=>isHeat(n.type)).map(n=>`<div class="rr"><span class="rl">${n.cl||n.label}</span><span class="rv" style="color:#fb923c">Q=${n.Qkw!==undefined?n.Qkw.toFixed(1):'-'} kW · ΔP=${n.pdm||0} m</span></div>`).join('');
  // ── Side panel results ──────────────────────────────
  showRes(`
    <div class="rr"><span class="rl">Method</span><span class="rv i" style="font-size:9px">${methodLbl}</span></div>
    ${(pUnk||mainPump?.curvePoints?.length)&&mainPump?`<div class="rr"><span class="rl" style="color:#fb923c">Pump head req.</span><span class="rv" style="color:#fb923c">${pumpHM.toFixed(2)} m</span></div>`:''}
    <div class="pbox"><div class="pbox-t">Pressure Summary</div>
      <div class="rr"><span class="rl">🔵 Static</span><span class="rv i">${pd(m2b(staticM))}</span></div>
      <div class="rr"><span class="rl">🔵 Pump head</span><span class="rv i">${pd(m2b(pumpHM))}</span></div>
      <div class="rr"><span class="rl">= Total supply</span><span class="rv">${pd(m2b(totSupM))}</span></div>
      <div class="rr"><span class="rl">🔴 Worst path loss</span><span class="rv er">${pd(m2b(worstFricM))}</span></div>
      ${boilDropM?`<div class="rr"><span class="rl">&nbsp;&nbsp;incl. equip. ΔP</span><span class="rv er" style="font-size:9px">${pd(m2b(boilDropM))}</span></div>`:''}
      <div class="rr"><span class="rl">🟢 Residual</span><span class="rv ${sc}">${pd(resBar)}</span></div>
    </div>
    ${circRows?`<div class="pbox"><div class="pbox-t">Circulation</div>${circRows}</div>`:''}
    ${heatRows?`<div class="pbox"><div class="pbox-t">Thermal</div>${heatRows}</div>`:''}
    <div class="rr"><span class="rl">Total demand</span><span class="rv">${fd(totFlow)}</span></div>
    ${pR}
    <div class="rr" style="margin-top:4px"><span class="rl">Status</span><span class="bdg ${sc}">${ok?'✓ OK':wn?'⚠ Low':'✗ Fail'}</span></div>
  `);

  // ── Summary cards ────────────────────────────────────
  const avgVelAll=pipes.filter(p=>p.vel!==undefined).reduce((s,p,_,a)=>s+p.vel/a.length,0);
  const pumpPowKw=mainPump&&pumpHM>0?(totFlow*.001*pumpHM*1000*9.81/1000/.75):0;
  const srcPbar=m2b(totSupM),minPbar=outlets.length?Math.min(...outlets.map(o=>o.rP||0)):resBar;
  updateSummaryCards({
    totalFlow:fd(totFlow),flowOk:true,
    headLoss:worstFricM.toFixed(2)+' m',
    pIn:pd(srcPbar),
    pOut:pd(minPbar),pOk:ok,pWarn:wn,
    power:pumpPowKw>0?pumpPowKw.toFixed(2)+' kW':'—',
    avgVel:avgVelAll.toFixed(2)+' m/s',velOk:avgVelAll<1.2,velWarn:avgVelAll<=2.4
  });

  // ── Bottom results table ─────────────────────────────
  const tableRows=[];let pIdx=0,vIdx=0;
  pipes.forEach(p=>{
    if(!p.nA||!p.nB)return;
    pIdx++;
    tableRows.push({
      id:'P-'+String(pIdx).padStart(3,'0'),
      name:(p.cl||('Pipe '+pIdx)),type:'Pipe Straight',
      dia:p.dia||25,len:p.len||10,
      flow:fd(p.fls||0),flowRaw:p.fls||0,
      vel:p.vel,
      hFric:p.hL||0,hValve:0,hTot:(p.hL||0),
      pIn:p.pA,pOut:p.pB
    });
    if(p.valve){
      vIdx++;
      tableRows.push({
        id:'V-'+String(vIdx).padStart(3,'0'),
        name:(p.valve.cl||p.valve.label),type:'Gate Valve',
        dia:p.dia||25,len:undefined,
        flow:fd(p.fls||0),flowRaw:p.fls||0,
        vel:undefined,
        hFric:undefined,hValve:p.vL||0,hTot:p.vL||0,
        pIn:p.pA,pOut:p.pB
      });
    }
  });
  buildResultsTable({
    rows:tableRows,
    totalFlowStr:fd(totFlow),
    status:ok?'✓ OK':wn?'⚠ Low':'✗ Fail',
    statusCls:sc
  });

  // Switch to Calculation tab automatically
  switchTab('calc');

  if(sel)showProp(sel);scheduleDraw();
}
function showRes(html){
  document.getElementById('rp-results').innerHTML=html||'';
}

// Update summary cards (top of Calculation tab)
function updateSummaryCards(data){
  const set=(id,v,cls)=>{const el=document.getElementById(id);if(!el)return;el.textContent=v;el.className='scard-val'+(cls?' '+cls:'');};
  set('sc-flow', data.totalFlow||'—', data.flowOk?'td-ok':'');
  set('sc-hloss', data.headLoss||'—', '');
  set('sc-pin',  data.pIn||'—',  'td-info');
  set('sc-pout', data.pOut||'—', data.pOk?'td-ok':data.pWarn?'td-warn':'td-err');
  set('sc-power',data.power||'—','');
  set('sc-vel',  data.avgVel||'—', data.velOk?'td-ok':data.velWarn?'td-warn':'td-err');
}

// Build the bottom results table
function buildResultsTable(tableData){
  const wrap=document.getElementById('results-table-wrap');
  const tbody=document.getElementById('rt-tbody');
  const tfoot=document.getElementById('rt-tfoot');
  const badge=document.getElementById('rt-status-badge');
  if(!wrap||!tbody)return;
  wrap.style.display='flex';
  tbody.innerHTML='';tfoot.innerHTML='';

  // Rows
  let totLen=0,totFric=0,totValve=0,totTot=0,totFlow=0,velSum=0,velCnt=0;
  tableData.rows.forEach(r=>{
    const tr=document.createElement('tr');
    const vcls=r.vel>2.4?'td-err':r.vel>1.2?'td-ok':'td-info';
    const pcls=r.pIn>=0.5?'td-ok':'td-warn';
    tr.innerHTML=`
      <td class="td-id">${r.id}</td>
      <td>${r.name}</td>
      <td>${r.type}</td>
      <td>${r.dia||'—'}</td>
      <td>${r.len||'—'}</td>
      <td class="td-info">${r.flow}</td>
      <td class="${vcls}">${r.vel!==undefined?r.vel.toFixed(2):'—'}</td>
      <td>${r.hFric!==undefined?r.hFric.toFixed(3):'—'}</td>
      <td>${r.hValve!==undefined?r.hValve.toFixed(3):'—'}</td>
      <td class="td-warn">${r.hTot!==undefined?r.hTot.toFixed(3):'—'}</td>
      <td class="${pcls}">${r.pIn!==undefined?r.pIn.toFixed(3):'—'}</td>
      <td class="td-ok">${r.pOut!==undefined?r.pOut.toFixed(3):'—'}</td>`;
    tbody.appendChild(tr);
    if(r.len)totLen+=r.len;
    if(r.hFric)totFric+=r.hFric;
    if(r.hValve)totValve+=r.hValve;
    if(r.hTot)totTot+=r.hTot;
    if(r.flowRaw)totFlow=Math.max(totFlow,r.flowRaw);
    if(r.vel){velSum+=r.vel;velCnt++;}
  });

  // Footer totals
  const avgVel=velCnt?velSum/velCnt:0;
  tfoot.innerHTML=`<tr>
    <td colspan="3" style="text-align:left">Total / Average</td>
    <td>—</td><td>${totLen.toFixed(1)}</td>
    <td class="td-info">${tableData.totalFlowStr||'—'}</td>
    <td class="${avgVel>2.4?'td-err':'td-ok'}">${avgVel.toFixed(2)}</td>
    <td>${totFric.toFixed(3)}</td><td>${totValve.toFixed(3)}</td>
    <td class="td-warn">${totTot.toFixed(3)}</td>
    <td>—</td><td>—</td>
  </tr>`;

  // Status badge
  if(badge){badge.textContent=tableData.status||'—';badge.className='bdg '+(tableData.statusCls||'ok');}
}
// Stubs — real implementations in app.js
function updateMinimap(){}
function updateStatusBar(){}
function switchTab(){}
