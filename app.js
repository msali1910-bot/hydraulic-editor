// ════════════════════════════════════════════════════════
//  app.js — Hydraulic P&ID v14
//  UI + Events + Minimap + StatusBar + Init
//  لو عايز تعدل في الأزرار أو الـ shortcuts → ابعت الملف ده
// ════════════════════════════════════════════════════════

// ── TAB SWITCHER ───────────────────────────────────────────
function switchTab(name){
  ['prop','calc'].forEach(t=>{
    const el=document.getElementById('tab-'+t);
    const btn=document.getElementById('tab-'+t+'-btn');
    if(el)el.style.display=t===name?'flex':'none';
    if(btn)btn.classList.toggle('active',t===name);
  });
}

// ── LIB SECTION COLLAPSE ──────────────────────────────────
function toggleLibSec(id){document.getElementById(id).classList.toggle('collapsed');}

// ── DARK MODE ─────────────────────────────────────────────
function applyDarkMode(dark){
  document.body.classList.toggle('dark',dark);
  localStorage.setItem('hydraulic_dark',dark?'1':'0');
  const icon=document.getElementById('dark-icon');
  const lbl=document.getElementById('dark-lbl');
  if(icon){
    if(dark){
      icon.innerHTML='<path d="M7 1C3.7 1 1 3.7 1 7C1 10.3 3.7 13 7 13C10.3 13 13 10.3 13 7" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/><path d="M7 1C8 3 8 5 7 7C5 8 3 8 1 7" fill="currentColor" opacity=".5"/>';
    } else {
      icon.innerHTML='<path d="M7 2C4.2 2 2 4.2 2 7C2 9.8 4.2 12 7 12C9.8 12 12 9.8 12 7C12 4.2 9.8 2 7 2Z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="7" cy="7" r="2.5" fill="currentColor"/>';
    }
  }
  if(lbl)lbl.textContent=dark?'Dark':'Light';
  scheduleDraw();
}
document.getElementById('bdark').onclick=()=>{
  applyDarkMode(!document.body.classList.contains('dark'));
};

// ── UNITS SYSTEM ──────────────────────────────────────────
// Units popup
function openUnits(){document.getElementById('units-popup').style.display='';}
function closeUnits(){document.getElementById('units-popup').style.display='none';}
function applyUnitsFromPopup(){
  _pUnit=document.querySelector('input[name="punit"]:checked')?.value||'m';
  _fUnit=document.querySelector('input[name="funit"]:checked')?.value||'ls';
  _powUnit=document.querySelector('input[name="powunit"]:checked')?.value||'kw';
  _lenUnit=document.querySelector('input[name="lenunit"]:checked')?.value||'m';
  closeUnits();
  if(sel)showProp(sel);
  scheduleDraw();
  showFlash('Units updated','var(--blue)');
}
// Sync radios to current values when opening
document.getElementById('bunits').onclick=()=>{
  const pu=document.querySelector(`input[name="punit"][value="${_pUnit}"]`);if(pu)pu.checked=true;
  const fu=document.querySelector(`input[name="funit"][value="${_fUnit}"]`);if(fu)fu.checked=true;
  const pw=document.querySelector(`input[name="powunit"][value="${_powUnit||'kw'}"]`);if(pw)pw.checked=true;
  const lu=document.querySelector(`input[name="lenunit"][value="${_lenUnit||'m'}"]`);if(lu)lu.checked=true;
  openUnits();
};

// ── MINIMAP ───────────────────────────────────────────────
const mm=document.getElementById('minimap');
const mCtx=mm?mm.getContext('2d'):null;
function updateMinimap(){
  if(!mCtx)return;
  const mW=mm.width,mH=mm.height,dark=isDark();
  mCtx.clearRect(0,0,mW,mH);
  mCtx.fillStyle=dark?'rgba(8,10,14,.9)':'rgba(244,245,247,.95)';
  mCtx.fillRect(0,0,mW,mH);
  if(!nodes.length)return;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  nodes.forEach(n=>{if(n.type==='valve'||n.type==='note')return;minX=Math.min(minX,n.wx);minY=Math.min(minY,n.wy);maxX=Math.max(maxX,n.wx);maxY=Math.max(maxY,n.wy);});
  if(!isFinite(minX))return;
  const pad=50,ww=Math.max(maxX-minX+pad*2,200),wh=Math.max(maxY-minY+pad*2,140);
  const sc=Math.min(mW/ww,mH/wh),ox=mW/2-(minX+maxX)/2*sc,oy=mH/2-(minY+maxY)/2*sc;
  function mm2s(wx,wy){return{x:wx*sc+ox,y:wy*sc+oy};}
  pipes.forEach(p=>{
    if(!p.nA||!p.nB)return;
    const sa=mm2s(p.nA.wx,p.nA.wy),sb=mm2s(p.nB.wx,p.nB.wy);
    mCtx.strokeStyle=velClr(p.vel);mCtx.lineWidth=1.2;
    mCtx.beginPath();mCtx.moveTo(sa.x,sa.y);mCtx.lineTo(sb.x,sb.y);mCtx.stroke();
  });
  nodes.forEach(n=>{
    if(n.type==='valve'||n.type==='note')return;
    const s=mm2s(n.wx,n.wy),c=(TC[n.type]||{s:'#888'}).s;
    mCtx.fillStyle=c;mCtx.beginPath();mCtx.arc(s.x,s.y,2.5,0,Math.PI*2);mCtx.fill();
  });
  const vx1=(-panX)/zoom,vy1=(-panY)/zoom,vx2=vx1+W/zoom,vy2=vy1+H/zoom;
  const vs1=mm2s(vx1,vy1),vs2=mm2s(vx2,vy2);
  mCtx.strokeStyle=dark?'rgba(59,130,246,.7)':'rgba(25,113,194,.7)';
  mCtx.lineWidth=1.2;mCtx.strokeRect(vs1.x,vs1.y,vs2.x-vs1.x,vs2.y-vs1.y);
}

// ── STATUS BAR ────────────────────────────────────────────
function updateStatusBar(){
  const ns=document.getElementById('sb-nodes'),ps=document.getElementById('sb-pipes');
  if(ns)ns.textContent=nodes.filter(n=>n.type!=='valve').length+' nodes';
  if(ps)ps.textContent=pipes.length+' pipes';
}
function updateCoord(sx,sy){
  const el=document.getElementById('sb-coord');if(!el)return;
  const w=s2w(sx,sy);el.textContent='x:'+Math.round(w.x)+' y:'+Math.round(w.y);
}
function updateZoomPct(){
  const el=document.getElementById('zpct');if(el)el.textContent=Math.round(zoom*100)+'%';
}

// ── PROPERTIES PANEL ──────────────────────────────────────
function showProp(item){
  document.getElementById('phint').style.display='none';
  document.getElementById('pprops').style.display='';
  const tf=document.getElementById('ptit'),f=document.getElementById('pfields'),eb=document.getElementById('pbtns');
  const isP=pipes.includes(item),isV=!isP&&item.type==='valve',t=item.type;
  if(isP)tf.textContent='Pipe';
  else if(isV)tf.textContent=(item.valveType||'gate').charAt(0).toUpperCase()+(item.valveType||'gate').slice(1)+' Valve';
  else if(t==='pump-booster')tf.textContent='Booster Pump';
  else if(t==='pump-lift')tf.textContent='Lift Pump';
  else if(t==='pump-circ')tf.textContent='Circ. Pump';
  else if(t==='note')tf.textContent='Text Note';
  else if(t)tf.textContent=t.charAt(0).toUpperCase()+t.slice(1);
  f.innerHTML='';eb.innerHTML='';
  let fieldDefs=[];

  if(isP){
    fieldDefs=[
      {l:'Label',k:'cl',v:item.cl,tp:'text'},
      {l:'Diameter (mm)',k:'dia',v:item.dia||25},
      {l:'Length (m)',k:'len',v:item.len||10},
      {l:'Flow',k:'_fl',v:calc?fd(item.fls||0):'—',ro:true,out:true},
      {l:'Velocity (m/s)',k:'_v',v:calc?(item.vel||0).toFixed(3):'—',ro:true,out:true,wv:calc&&item.vel>2.4},
      {l:'Head loss (m)',k:'_hl',v:calc?(item.hL||0).toFixed(3):'—',ro:true,out:true},
      {l:`P start (${pl()})`,k:'_pa',v:calc&&item.pA!==undefined?p2d(item.pA):'—',ro:true,out:true,cl:'var(--yellow)'},
      {l:`P end (${pl()})`,k:'_pb',v:calc&&item.pB!==undefined?p2d(item.pB):'—',ro:true,out:true,cl:'var(--green)'}
    ];
  } else if(isV){
    fieldDefs=[
      {l:'Label',k:'cl',v:item.cl,tp:'text'},
      {l:'Kv coefficient',k:'kv',v:item.kv||25},
      {l:'ΔP drop (m)',k:'_vd',v:calc&&item.pdrop!==undefined?item.pdrop.toFixed(3):'—',ro:true,out:true}
    ];
    if(item.valveType==='relief')fieldDefs.push({l:'Set pressure',k:'setP',v:item.setP||3.5});
  } else if(t==='tank'){
    fieldDefs=[
      {l:'Label',k:'cl',v:item.cl,tp:'text'},
      {l:'Elevation (m)',k:'elev',v:item.elev||0},
      {l:`Static P (${pl()})`,k:'_sp',v:p2d(item.pbar||0),cvt:'pb'}
    ];
  } else if(t==='pump-booster'||t==='pump-lift'){
    fieldDefs=[
      {l:'Label',k:'cl',v:item.cl,tp:'text'},
      {l:'Head m (empty = auto)',k:'hm',v:item.hm===null?'':item.hm,unk:item.hm===null,oR:calc&&item.hm===null?item.rH:undefined},
      {l:`Design Flow (${fl()})`,k:'_fl',v:f2d(item.fls||1.5),cvt:'f'}
    ];
    if(t==='pump-lift')fieldDefs.push({l:'Lift elevation (m)',k:'liftElev',v:item.liftElev||10});
    if(calc)fieldDefs.push({l:`Result head (${pl()})`,k:'_ph',v:p2d(m2b(item.rH||item.hm||0)),ro:true,out:true});
    const cb=document.createElement('div');cb.className='curve-box';
    cb.innerHTML='<div class="pbox-t">Pump Curve Points</div>';
    const clist=document.createElement('div');clist.id='curve-list';
    function renderCurve(){
      clist.innerHTML='';
      (item.curvePoints||[]).forEach((pt,i)=>{
        const row=document.createElement('div');row.className='curve-row';
        row.innerHTML=`<span style="font-size:9px;color:var(--txt3);min-width:18px">${i+1}.</span><input type="number" placeholder="Q L/s" value="${pt.q}" step="any" data-ci="${i}" data-cf="q"><input type="number" placeholder="H m" value="${pt.h}" step="any" data-ci="${i}" data-cf="h"><button style="background:transparent;border:none;color:var(--red);cursor:pointer;font-size:12px" data-di="${i}">✕</button>`;
        clist.appendChild(row);
      });
      clist.querySelectorAll('input').forEach(inp=>{inp.addEventListener('input',()=>{const i=parseInt(inp.dataset.ci),cf=inp.dataset.cf;if(!item.curvePoints[i])item.curvePoints[i]={q:0,h:0};item.curvePoints[i][cf]=parseFloat(inp.value)||0;scheduleDraw();});});
      clist.querySelectorAll('button[data-di]').forEach(btn=>{btn.addEventListener('click',()=>{item.curvePoints.splice(parseInt(btn.dataset.di),1);renderCurve();scheduleDraw();});});
    }
    renderCurve();cb.appendChild(clist);
    const addBtn=document.createElement('button');addBtn.className='curve-add';addBtn.textContent='+ Add point';addBtn.onclick=()=>{if(!item.curvePoints)item.curvePoints=[];item.curvePoints.push({q:0,h:0});renderCurve();};
    cb.appendChild(addBtn);
    const flipBtn=document.createElement('button');flipBtn.className='xb g';flipBtn.textContent='⇄ Flip direction';flipBtn.onclick=()=>{item.flip=!item.flip;scheduleDraw();};
    eb.appendChild(cb);eb.appendChild(flipBtn);
  } else if(t==='pump-circ'){
    fieldDefs=[{l:'Label',k:'cl',v:item.cl,tp:'text'},{l:'Head m (empty=auto)',k:'hm',v:item.hm===null?'':item.hm,unk:item.hm===null,oR:calc&&item.hm===null?item.rH:undefined}];
    const mr=document.createElement('div');mr.className='fld';mr.innerHTML=`<label>Flow method</label><select id="circ-m"><option value="fu" ${item.circMethod==='fu'?'selected':''}>Fixture Units</option><option value="risers" ${item.circMethod==='risers'?'selected':''}>No. of Risers</option><option value="heat" ${item.circMethod==='heat'?'selected':''}>Heat Loss (W)</option></select>`;
    f.appendChild(mr);
    document.getElementById('circ-m').onchange=function(){item.circMethod=this.value;saveProp();showProp(item);};
    if(item.circMethod==='fu')fieldDefs.push({l:'Total FU',k:'circFU',v:item.circFU||50});
    else if(item.circMethod==='risers')fieldDefs.push({l:'Risers',k:'circRisers',v:item.circRisers||5});
    else fieldDefs.push({l:'Heat loss (W)',k:'circHeatLoss',v:item.circHeatLoss||500});
    if(calc&&item.circFls!==undefined)fieldDefs.push({l:`Circ flow (${fl()})`,k:'_cf',v:f2d(item.circFls),ro:true,out:true,cl:'var(--green)'});
    const fb=document.createElement('button');fb.className='xb g';fb.textContent='⇄ Flip direction';fb.onclick=()=>{item.flip=!item.flip;scheduleDraw();};eb.appendChild(fb);
  } else if(t==='outlet'){
    const mr=document.createElement('div');mr.className='fld';
    mr.innerHTML=`<label>Flow mode</label><select id="om"><option value="manual" ${item.fm==='manual'?'selected':''}>Manual</option><option value="fu" ${item.fm==='fu'?'selected':''}>Fixture Units (IPC)</option></select>`;
    f.appendChild(mr);
    document.getElementById('om').onchange=function(){item.fm=this.value;saveProp();showProp(item);};
    const fl3=item.fm==='fu'?
      [{l:'Label',k:'cl',v:item.cl,tp:'text'},{l:'Total FU',k:'fu',v:item.fu||6},{l:'Flow downstream',k:'_fc',v:f2d(fu2ls(item.fu||6)),ro:true,out:true},{l:`Min residual (${pl()})`,k:'_r',v:p2d(item.rbar||1.5),cvt:'pr'},{l:'Elevation (m)',k:'elev',v:item.elev||0}]:
      [{l:'Label',k:'cl',v:item.cl,tp:'text'},{l:`Flow downstream (${fl()})`,k:'_fl',v:f2d(item.fls||.3),cvt:'f'},{l:`Min residual (${pl()})`,k:'_r',v:p2d(item.rbar||1.5),cvt:'pr'},{l:'Elevation (m)',k:'elev',v:item.elev||0}];
    if(calc&&item.rP!==undefined){
      const ok2=item.rP>=(item.rbar||1.5);
      fl3.push({l:'──',k:'_s',sep:true},{l:`Static (${pl()})`,k:'_stp',v:item.sP!==undefined?p2d(item.sP):'—',ro:true,out:true,cl:'var(--blue)'},{l:`Friction (${pl()})`,k:'_frl',v:item.fP!==undefined?p2d(item.fP):'—',ro:true,out:true,cl:'var(--red)'},{l:`Residual (${pl()})`,k:'_rp',v:p2d(item.rP),ro:true,out:true,wv:!ok2},{l:'Flow downstream actual',k:'_fda',v:item.flowDownstream!==undefined?f2d(item.flowDownstream):'—',ro:true,out:true,cl:'var(--green)'});
    }
    fieldDefs=fl3;
  } else if(isHeat(t)){
    fieldDefs=[{l:'Label',k:'cl',v:item.cl,tp:'text'},{l:'Pressure drop (m)',k:'pdm',v:item.pdm||3},{l:'T_in (°C)',k:'Tin',v:item.Tin||80},{l:'T_out (°C)',k:'Tout',v:item.Tout||60},{l:'Mass flow ṁ (kg/s)',k:'mflow',v:item.mflow||1},{l:'Cp (kJ/kg·K)',k:'cpFluid',v:item.cpFluid||4.18}];
    if(calc&&item.Qkw!==undefined)fieldDefs.push({l:'Q (kW)',k:'_q',v:item.Qkw.toFixed(2),ro:true,out:true,cl:'var(--orange)'});
  } else if(t==='junc'){
    fieldDefs=[{l:'Label',k:'cl',v:item.cl,tp:'text'},{l:'Branch equip. loss (m)',k:'eqLoss',v:item.eqLoss||0},{l:`P junction (${pl()})`,k:'_jp',v:calc&&item.rP!==undefined?p2d(item.rP):'—',ro:true,out:true}];
  } else if(t==='note'){
    fieldDefs=[{l:'Text',k:'text',v:item.text||'Note',tp:'text'},{l:'Font size (px)',k:'fontSize',v:item.fontSize||12}];
  }

  fieldDefs.forEach(fd2=>{
    if(fd2.sep){const d=document.createElement('div');d.style='margin:4px 0;border-top:1px solid var(--brd);padding-top:4px';f.appendChild(d);return;}
    const d=document.createElement('div');d.className='fld';
    const tag=fd2.out&&calc?'<span class="to">OUT</span>':fd2.unk?'<span class="tu">AUTO</span>':'';
    const cls=fd2.ro?(fd2.wv?'wf':'of'):fd2.unk?'uf':'';
    const val=fd2.oR!==undefined?fd2.oR.toFixed(3):(fd2.v===null||fd2.v===undefined?'':fd2.v);
    const sty=fd2.cl?`style="color:${fd2.cl}"`:'';
    d.innerHTML=`<label ${sty}>${fd2.l} ${tag}</label><input type="${fd2.tp==='text'?'text':'number'}" data-key="${fd2.k}" data-cvt="${fd2.cvt||''}" value="${val}" step="any" ${fd2.ro?'readonly':''} class="${cls}">`;
    f.appendChild(d);
  });

  // Duplicate button for project tabs
  if(!isP&&!isV){
    const db2=document.createElement('button');db2.className='xb';db2.textContent='⎘ Duplicate diagram';db2.style.color='var(--blue)';db2.style.borderColor='var(--blue)';db2.onclick=duplicateProject;eb.appendChild(db2);
  }
  const db=document.createElement('button');db.className='xb r';db.textContent='Delete';
  db.onclick=()=>{
    snapshot();
    if(item.type&&item.type!=='valve'){nodes=nodes.filter(n=>n!==item);pipes.forEach(p=>{if(p.valve===item)p.valve=null;});pipes=pipes.filter(p=>p.nA!==item&&p.nB!==item);}
    else if(pipes.includes(item)){pipes=pipes.filter(p=>p!==item);}
    else{pipes.forEach(p=>{if(p.valve===item)p.valve=null;});nodes=nodes.filter(n=>n!==item);}
    sel=null;selSet.clear();document.getElementById('phint').style.display='';document.getElementById('pprops').style.display='none';calc=false;scheduleDraw();
  };
  eb.appendChild(db);
  document.querySelectorAll('#pfields input:not([readonly])').forEach(i=>i.addEventListener('input',()=>{saveProp();scheduleDraw();}));
  switchTab('prop');
}

function saveProp(){
  if(!sel)return;
  document.querySelectorAll('#pfields input[data-key]:not([readonly])').forEach(inp=>{
    const k=inp.dataset.key,cvt=inp.dataset.cvt,raw=inp.value.trim();
    if(k==='cl'){sel.cl=raw;return;}
    if(k==='text'){sel.text=raw;return;}
    if(raw===''&&k==='hm'){sel.hm=null;return;}
    const v=parseFloat(raw);if(isNaN(v))return;
    if(cvt==='pb')sel.pbar=d2p(v);else if(cvt==='pr')sel.rbar=d2p(v);else if(cvt==='f')sel.fls=d2f(v);else if(k==='fu'){sel.fu=v;sel.fls=fu2ls(v);}else sel[k]=v;
  });
  const om=document.getElementById('om');
  if(om&&sel.type==='outlet'&&sel.fm==='fu')sel.fls=fu2ls(sel.fu||6);
}

function selItem(item){
  saveProp();sel=item;
  if(!item){document.getElementById('phint').style.display='';document.getElementById('pprops').style.display='none';}
  else showProp(item);
  scheduleDraw();
}

// ── NOTE EDITOR ───────────────────────────────────────────
let editingNote=null;
function openNoteEditor(n){
  editingNote=n;
  const s=w2s(n.wx,n.wy);
  const ed=document.getElementById('note-editor');
  const ta=document.getElementById('note-ta');
  ta.value=n.text||'';
  ed.style.display='block';
  ed.style.left=(s.x-80)+'px';ed.style.top=(s.y-30)+'px';
  ta.focus();ta.select();
}
function closeNoteEditor(){
  if(editingNote){
    editingNote.text=document.getElementById('note-ta').value||'Note';
    snapshot();scheduleDraw();
  }
  editingNote=null;
  document.getElementById('note-editor').style.display='none';
}
document.getElementById('note-ta').addEventListener('blur',closeNoteEditor);
document.getElementById('note-ta').addEventListener('keydown',e=>{if(e.key==='Escape')closeNoteEditor();});

// ── MODE CONTROL ──────────────────────────────────────────
function setMode(m){
  mode=m;pipeSt=null;
  ['bsel','bpip'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('on');});
  if(m==='sel'){const el=document.getElementById('bsel');if(el)el.classList.add('on');}
  if(m==='pip'){const el=document.getElementById('bpip');if(el)el.classList.add('on');}
  const labels={sel:'select [S]',pip:'draw pipe [P]'};
  const mt=document.getElementById('mtag');if(mt)mt.textContent=labels[m]||m;
  cv.style.cursor=m==='sel'?'default':'crosshair';
  const mh=document.getElementById('multi-hint');if(mh)mh.style.display=m==='sel'?'block':'none';
}

// ── ZOOM / PAN ────────────────────────────────────────────
function doZoom(delta,cx,cy){
  const bw=s2w(cx,cy);zoom=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,zoom*delta));
  const aw=w2s(bw.x,bw.y);panX+=cx-aw.x;panY+=cy-aw.y;updateZoomPct();scheduleDraw();
}
wrap.addEventListener('wheel',e=>{e.preventDefault();const r=cv.getBoundingClientRect();doZoom(e.deltaY<0?1.12:.9,e.clientX-r.left,e.clientY-r.top);},{passive:false});
document.getElementById('zin').onclick=()=>doZoom(1.2,W/2,H/2);
document.getElementById('zout').onclick=()=>doZoom(1/1.2,W/2,H/2);
document.getElementById('zrst').onclick=()=>{zoom=1;panX=0;panY=0;updateZoomPct();scheduleDraw();};

// ── KEYBOARD ──────────────────────────────────────────────
let spaceHeld=false;
document.addEventListener('keydown',e=>{
  const inp=e.target.matches('input,select,textarea');
  if(e.code==='Space'&&!inp){spaceHeld=true;if(mode==='sel')cv.style.cursor='grab';}
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==='z'&&!inp){e.preventDefault();undo();}
  if((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.shiftKey&&e.key==='z'))&&!inp){e.preventDefault();redo();}
  if(e.key==='Escape'){selSet.clear();selItem(null);closeNoteEditor();}
  if(e.key==='Delete'&&sel&&!inp){document.querySelector('#pbtns .xb.r')?.click();}
  if(!inp&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
    if(e.key==='s'||e.key==='S'){setMode('sel');showFlash('Select [S]');}
    if(e.key==='p'||e.key==='P'){setMode('pip');showFlash('Pipe [P]','var(--blue)');}
  }
  if((e.ctrlKey||e.metaKey)&&e.key==='a'&&!inp){
    e.preventDefault();selSet.clear();nodes.filter(n=>n.type!=='valve').forEach(n=>selSet.add(n));
    sel=null;document.getElementById('phint').style.display='';document.getElementById('pprops').style.display='none';scheduleDraw();showFlash('All selected ('+selSet.size+')','var(--purple)');
  }
  if((e.ctrlKey||e.metaKey)&&e.key==='s'&&!inp){e.preventDefault();saveProject();}
  if((e.ctrlKey||e.metaKey)&&e.key==='d'&&!inp){e.preventDefault();duplicateProject();}
});
document.addEventListener('keyup',e=>{if(e.code==='Space'){spaceHeld=false;if(mode==='sel')cv.style.cursor='default';}});

// ── MOUSE EVENTS ──────────────────────────────────────────
cv.addEventListener('mousemove',e=>{
  const r=cv.getBoundingClientRect();mp={x:e.clientX-r.left,y:e.clientY-r.top};
  updateCoord(mp.x,mp.y);
  if(isPanning){panX+=mp.x-panStart.x;panY+=mp.y-panStart.y;panStart={...mp};scheduleDraw();return;}
  if(mode==='pip'&&pipeSt)scheduleDraw();
  if(drag&&!spaceHeld&&selSet.size<=1){
    const{x:wx,y:wy}=s2w(mp.x-doff.x,mp.y-doff.y);
    drag.wx=Math.round(wx/SNAP_GRID)*SNAP_GRID;drag.wy=Math.round(wy/SNAP_GRID)*SNAP_GRID;
    if(sel===drag)showProp(drag);scheduleDraw();return;
  }
  if(multiDragStart&&selSet.size>1){
    const dx=(mp.x-multiDragStart.x)/zoom,dy=(mp.y-multiDragStart.y)/zoom;
    const arr=[...selSet];
    arr.forEach((item,idx)=>{
      if(!item.type||item.type==='valve')return;
      const off=multiDragOffsets[idx];if(!off)return;
      item.wx=Math.round((off.ox+dx)/SNAP_GRID)*SNAP_GRID;item.wy=Math.round((off.oy+dy)/SNAP_GRID)*SNAP_GRID;
    });
    scheduleDraw();return;
  }
  if(boxSelecting){boxEnd={x:mp.x,y:mp.y};drawSelBox();scheduleDraw();return;}
});

cv.addEventListener('dblclick',e=>{
  const r=cv.getBoundingClientRect();const sx=e.clientX-r.left,sy=e.clientY-r.top;
  const n=hitN(sx,sy);
  if(n&&n.type==='note'){openNoteEditor(n);}
});

cv.addEventListener('mousedown',e=>{
  const r=cv.getBoundingClientRect();const sx=e.clientX-r.left,sy=e.clientY-r.top;
  mp={x:sx,y:sy};
  if(e.button===1||spaceHeld){isPanning=true;panStart={x:sx,y:sy};cv.style.cursor='grabbing';return;}
  if(mode==='sel'){
    const v=hitValve(sx,sy);
    if(v){if(e.shiftKey){selSet.has(v)?selSet.delete(v):selSet.add(v);sel=v;showProp(v);scheduleDraw();}else{selSet.clear();selItem(v);}return;}
    const n=hitN(sx,sy);
    if(n){
      if(e.shiftKey){selSet.has(n)?selSet.delete(n):selSet.add(n);sel=n;showProp(n);scheduleDraw();}
      else{
        if(!selSet.has(n))selSet.clear();selItem(n);
        if(selSet.size>1){multiDragStart={x:sx,y:sy};const arr=[...selSet];multiDragOffsets=arr.map(item=>({ox:item.wx,oy:item.wy}));}
        else{drag=n;const ns=w2s(n.wx,n.wy);doff={x:sx-ns.x,y:sy-ns.y};}
      }return;
    }
    const ph=hitPipe(sx,sy);
    if(ph){if(e.shiftKey){selSet.has(ph.pipe)?selSet.delete(ph.pipe):selSet.add(ph.pipe);}else selSet.clear();selItem(ph.pipe);return;}
    if(!e.shiftKey)selSet.clear();selItem(null);
    boxSelecting=true;boxStart={x:sx,y:sy};boxEnd={x:sx,y:sy};return;
  }
  if(mode==='pip'){
    if(!pipeSt){
      const n=hitN(sx,sy);if(n){pipeSt=n;return;}
      const ph=hitPipe(sx,sy);if(ph){snapshot();const j=splitPipe(ph.pipe,ph.wx,ph.wy);pipeSt=j;scheduleDraw();return;}
      return;
    }
    const n2=hitN(sx,sy,pipeSt);
    if(n2){snapshot();pipes.push({id:uid(),nA:pipeSt,nB:n2,dia:25,len:10});pipeSt=null;setMode('pip');scheduleDraw();return;}
    const ph=hitPipe(sx,sy);
    if(ph){snapshot();const j=splitPipe(ph.pipe,ph.wx,ph.wy);pipes.push({id:uid(),nA:pipeSt,nB:j,dia:25,len:10});pipeSt=null;setMode('pip');scheduleDraw();return;}
    snapshot();const{x:wx,y:wy}=s2w(Math.round(sx/SNAP_GRID)*SNAP_GRID,Math.round(sy/SNAP_GRID)*SNAP_GRID);
    const j=mkN('junc',wx,wy);nodes.push(j);pipes.push({id:uid(),nA:pipeSt,nB:j,dia:25,len:10});pipeSt=j;scheduleDraw();
  }
});

cv.addEventListener('mouseup',()=>{
  if(isPanning){isPanning=false;cv.style.cursor=mode==='sel'?'default':'crosshair';}
  if(multiDragStart){snapshot();multiDragStart=null;multiDragOffsets=[];}
  if(drag)drag=null;
  if(boxSelecting){
    boxSelecting=false;document.getElementById('sel-box').style.display='none';
    const x1=Math.min(boxStart.x,boxEnd.x),y1=Math.min(boxStart.y,boxEnd.y),x2=Math.max(boxStart.x,boxEnd.x),y2=Math.max(boxStart.y,boxEnd.y);
    if(x2-x1>5||y2-y1>5){
      const found=nodesInBox(x1,y1,x2,y2);found.forEach(n=>selSet.add(n));
      if(found.length===1){sel=found[0];showProp(found[0]);}
      else if(found.length>1){sel=null;document.getElementById('phint').style.display='';document.getElementById('pprops').style.display='none';showFlash(found.length+' nodes selected','var(--purple)');}
      scheduleDraw();
    }
  }
});

// ── LIBRARY DRAG & DROP ───────────────────────────────────
let ld=null;
document.querySelectorAll('.li').forEach(el=>{
  el.addEventListener('dragstart',e=>{ld=el.dataset.type;e.dataTransfer.effectAllowed='copy';});
  el.addEventListener('dragend',()=>{ld=null;});
});
const cvW=document.getElementById('cvwrap');
cvW.addEventListener('dragover',e=>e.preventDefault());
cvW.addEventListener('drop',e=>{
  e.preventDefault();if(!ld)return;
  snapshot();
  const r=cv.getBoundingClientRect();const{x:wx,y:wy}=s2w(e.clientX-r.left,e.clientY-r.top);
  // Valve dropped on pipe → attach; else place as node
  if(ld.startsWith('valve-')){
    const ph=hitPipe(e.clientX-r.left,e.clientY-r.top);
    if(ph&&!ph.pipe.valve){
      const vn=mkN(ld,0,0);ph.pipe.valve=vn;nodes.push(vn);
      selSet.clear();selItem(vn);scheduleDraw();ld=null;return;
    }
  }
  const n=mkN(ld,Math.round(wx/SNAP_GRID)*SNAP_GRID,Math.round(wy/SNAP_GRID)*SNAP_GRID);
  nodes.push(n);selSet.clear();selItem(n);scheduleDraw();ld=null;
});

// Library search
document.getElementById('lib-search').addEventListener('input',function(){
  const q=this.value.toLowerCase();
  document.querySelectorAll('.li').forEach(el=>{
    el.style.display=(el.querySelector('span')?.textContent||'').toLowerCase().includes(q)?'':'none';
  });
});

// ── BUTTON BINDINGS ───────────────────────────────────────
document.getElementById('bsel').onclick=()=>setMode('sel');
document.getElementById('bpip').onclick=()=>setMode('pip');
document.getElementById('bcalc').onclick=calculate;
document.getElementById('bundo').onclick=undo;
document.getElementById('bredo').onclick=redo;
document.getElementById('bsave').onclick=saveProject;
document.getElementById('bload').onclick=()=>document.getElementById('file-load').click();
document.getElementById('file-load').onchange=e=>{if(e.target.files[0])loadProject(e.target.files[0]);e.target.value='';};
document.getElementById('bclr').onclick=()=>{
  snapshot();nodes=[];pipes=[];sel=null;selSet.clear();ncnt={};calc=false;
  document.getElementById('phint').style.display='';document.getElementById('pprops').style.display='none';
  const rr=document.getElementById('rp-results');if(rr)rr.innerHTML='<p style="font-size:9px;color:var(--txt3);text-align:center;padding-top:20px">Run Calculate to see results</p>';
  const rtw=document.getElementById('results-table-wrap');if(rtw)rtw.style.display='none';
  scheduleDraw();showFlash('Canvas cleared','var(--red)');
};
document.getElementById('fsl').addEventListener('input',function(){document.getElementById('fval').textContent=this.value+'%';});
document.getElementById('calc-method').addEventListener('change',function(){
  document.getElementById('rot-set').style.display=this.value==='hw'?'none':'';
  document.getElementById('hw-set').style.display=this.value==='hw'?'':'none';
});
// Results table toggle
const rtToggle=document.getElementById('rt-toggle');
if(rtToggle)rtToggle.onclick=function(){
  const body=document.getElementById('rt-body'),hidden=body.style.display==='none';
  body.style.display=hidden?'':'none';this.textContent=hidden?'▲ Hide':'▼ Show';
};

// ── EXPORT PNG ────────────────────────────────────────────
document.getElementById('bexport').onclick=function(){
  const W2=900,H2=1200,off=document.createElement('canvas');off.width=W2;off.height=H2;
  const c2=off.getContext('2d'),dark=isDark();
  c2.fillStyle=dark?'#0b0c0e':'#ffffff';c2.fillRect(0,0,W2,H2);
  const g=c2.createLinearGradient(0,0,W2,0);
  g.addColorStop(0,dark?'#1a3a6e':'#e7f5ff');g.addColorStop(1,dark?'#0b0c0e':'#ffffff');
  c2.fillStyle=g;c2.fillRect(0,0,W2,72);
  c2.fillStyle='#1971c2';c2.fillRect(0,0,5,72);
  c2.font='bold 22px Segoe UI,sans-serif';c2.fillStyle=dark?'#e2e8f0':'#1e293b';c2.textAlign='left';c2.textBaseline='middle';
  const cur=projectTabs.find(p=>p.id===activeProjId);
  c2.fillText('Hydraulic P&ID — '+(cur?.name||'Report'),24,28);
  c2.font='12px Segoe UI,sans-serif';c2.fillStyle='#64748b';c2.fillText('Generated: '+new Date().toLocaleString(),24,52);
  const scale=Math.min((W2-40)/cv.width,340/cv.height),sw=cv.width*scale,sh=cv.height*scale;
  c2.strokeStyle=dark?'#252930':'#dee2e6';c2.lineWidth=1;c2.strokeRect(20,80,W2-40,sh+4);c2.drawImage(cv,20,82,sw,sh);
  let y=82+sh+30;
  function row2(lbl,val,col){c2.fillStyle=dark?'#1e2228':'#f8f9fa';c2.fillRect(20,y-2,W2-40,20);c2.font='11px Segoe UI,sans-serif';c2.fillStyle=dark?'#7a8494':'#6b7280';c2.textAlign='left';c2.textBaseline='middle';c2.fillText(lbl,28,y+8);c2.font='bold 11px Segoe UI,sans-serif';c2.fillStyle=col||'#374151';c2.textAlign='right';c2.fillText(val,W2-28,y+8);y+=22;}
  function sec2(t){y+=8;c2.fillStyle=dark?'#252930':'#e7f5ff';c2.fillRect(20,y,W2-40,22);c2.fillStyle='#1971c2';c2.fillRect(20,y,4,22);c2.font='bold 11px Segoe UI,sans-serif';c2.fillStyle='#1971c2';c2.textAlign='left';c2.textBaseline='middle';c2.fillText(t.toUpperCase(),30,y+11);y+=26;}
  sec2('Nodes');nodes.filter(n=>n.type!=='valve'&&n.type!=='note').forEach(n=>{row2((n.cl||n.label)+' ('+n.type+')',n.rP!==undefined?pd(n.rP):'—',n.type==='outlet'?'#2f9e44':'#374151');});
  sec2('Pipes');pipes.forEach((p,i)=>{if(!p.nA||!p.nB)return;row2(`Pipe ${i+1}: Ø${p.dia||25}mm / ${p.len||10}m`,`${p.fls!==undefined?fd(p.fls):'—'} · v=${p.vel!==undefined?p.vel.toFixed(2):'—'}m/s · ΔH=${(p.hL||0).toFixed(2)}m`,p.vel>2.4?'#e03131':p.vel>1.2?'#2f9e44':'#1971c2');});
  if(calc){sec2('Summary');row2('System Status',nodes.filter(n=>n.type==='outlet').every(o=>o.rP>=(o.rbar||1.5))?'✓ OK':'✗ Check pressure','#2f9e44');}
  c2.fillStyle=dark?'#1e2228':'#f1f3f5';c2.fillRect(0,H2-36,W2,36);c2.font='10px Segoe UI,sans-serif';c2.fillStyle='#9ca3af';c2.textAlign='center';c2.textBaseline='middle';c2.fillText('Hydraulic P&ID v14 — MEP Professional Report',W2/2,H2-18);
  const a=document.createElement('a');a.download=(cur?.name||'hydraulic')+'_report_'+Date.now()+'.png';a.href=off.toDataURL('image/png',1.0);a.click();
  showFlash('⬇ Report exported','var(--orange)');
};

// ── INIT ──────────────────────────────────────────────────
// Restore dark mode preference
if(localStorage.getItem('hydraulic_dark')==='1')applyDarkMode(true);

updateUndoRedo();
setMode('sel');
switchTab('prop');
renderTabs();
autoLoad();
if(!nodes.length)snapshot();
updateZoomPct();
rsz();
