// @ts-nocheck
import * as THREE from 'three';
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import Peer, { type DataConnection } from "peerjs";

// ---- Seeded RNG (mulberry32) ----
let _rng=Math.random;
function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function setSeed(s){_rng=mulberry32(s);}
const rand=()=>_rng();

// ---- Multiplayer state ----
// mode: 'solo' | 'host' | 'guest'
let net={mode:'solo',peer:null,conns:[],conn:null,myIdx:0,N:2,pending:null,started:false,names:['Player','CPU']};
function myName(){return (document.getElementById('pname').value||'Player').slice(0,16);}
function setNetStatus(s){document.getElementById('netStatus').textContent=s;}
function showWaiting(info){
  document.getElementById('waiting').style.display='flex';
  document.getElementById('waitingInfo').textContent=info||'';
}
function hideWaiting(){document.getElementById('waiting').style.display='none';}
const PLAYER_COLORS=['#6cf','#fc6','#c6f','#6fc','#f6c','#cf6'];

const W=6,H=6,D=4;
const COLORS={R:0xee5555,G:0x55cc55,B:0x5599ff,Y:0xeedd55,P:0xcc66ff};
const COLKEYS=Object.keys(COLORS);
const SHAPES=[
  {name:"•",cells:[[0,0]]},
  {name:"II",cells:[[0,0],[1,0]]},
  {name:"I3",cells:[[0,0],[1,0],[2,0]]},
  {name:"L",cells:[[0,0],[0,1],[1,1]]},
  {name:"O",cells:[[0,0],[1,0],[0,1],[1,1]]},
  {name:"T",cells:[[0,0],[1,0],[2,0],[1,1]]},
  {name:"S",cells:[[0,0],[1,0],[1,1],[2,1]]},
  {name:"I4",cells:[[0,0],[1,0],[2,0],[3,0]]},
];

// ---- Three.js setup ----
const wrap=document.getElementById('canvas-wrap');
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x04080e);
scene.fog=new THREE.Fog(0x04080e,18,55);
const camera=new THREE.PerspectiveCamera(50,1,0.1,200);
camera.position.set(10,12,12);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
wrap.appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);
controls.target.set(W/2-0.5,D/2,H/2-0.5);
controls.enableDamping=true;

scene.add(new THREE.AmbientLight(0xffffff,0.5));
const dl=new THREE.DirectionalLight(0xffffff,0.9);
dl.position.set(10,20,8);
dl.castShadow=true;
dl.shadow.mapSize.set(2048,2048);
dl.shadow.camera.left=-15; dl.shadow.camera.right=15;
dl.shadow.camera.top=15; dl.shadow.camera.bottom=-15;
dl.shadow.camera.near=1; dl.shadow.camera.far=50;
dl.shadow.bias=-0.0005;
scene.add(dl);
const dl2=new THREE.DirectionalLight(0xaaccff,0.3);
dl2.position.set(-8,5,-10); scene.add(dl2);

// floor
const floor=new THREE.Mesh(
  new THREE.PlaneGeometry(30,30),
  new THREE.MeshStandardMaterial({color:0x070e18,roughness:1,metalness:0.2})
);
floor.rotation.x=-Math.PI/2;
floor.position.set(W/2-0.5,-0.5,H/2-0.5);
floor.receiveShadow=true;
scene.add(floor);

// grid — radar style
const grid=new THREE.GridHelper(20,20,0x1f5a7a,0x0d2636);
grid.position.set(W/2-0.5,-0.499,H/2-0.5);
scene.add(grid);

// radar sweep ring on floor
const ringGeo=new THREE.RingGeometry(4.2,4.35,64);
const ringMat=new THREE.MeshBasicMaterial({color:0x4fd0ff,transparent:true,opacity:0.25,side:THREE.DoubleSide});
const ring=new THREE.Mesh(ringGeo,ringMat);
ring.rotation.x=-Math.PI/2;
ring.position.set(W/2-0.5,-0.49,H/2-0.5);
scene.add(ring);

function resize(){
  const r=wrap.getBoundingClientRect();
  renderer.setSize(r.width,r.height,false);
  camera.aspect=r.width/r.height; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(wrap); resize();

const cubeGeo=new THREE.BoxGeometry(0.96,0.96,0.96);
const edgeGeo=new THREE.EdgesGeometry(cubeGeo);

// ---- Game state ----
let pile; // pile[x][y] = array of {color, mesh, edge}
let hands,scores,round,chosenCard,selected;
const pileGroup=new THREE.Group(); scene.add(pileGroup);
function myHand(){return hands[net.myIdx];}

function makeCube(x,y,z,color){
  const mat=new THREE.MeshStandardMaterial({color:COLORS[color],roughness:0.35,metalness:0.25,emissive:COLORS[color],emissiveIntensity:0});
  const m=new THREE.Mesh(cubeGeo,mat);
  m.position.set(x,z,y);
  m.castShadow=true; m.receiveShadow=true;
  const e=new THREE.LineSegments(edgeGeo,new THREE.LineBasicMaterial({color:0x4fd0ff,transparent:true,opacity:0.35}));
  m.add(e);
  m.userData={x,y,color};
  pileGroup.add(m);
  return m;
}

function init(seed){
  if(seed==null) seed=(Math.random()*2**32)>>>0;
  setSeed(seed);
  while(pileGroup.children.length) pileGroup.remove(pileGroup.children[0]);
  pile=[];
  for(let x=0;x<W;x++){pile.push([]);for(let y=0;y<H;y++){
    const col=[];
    for(let z=0;z<D;z++){
      const c=COLKEYS[Math.floor(rand()*COLKEYS.length)];
      col.push({color:c,mesh:makeCube(x,y,z,c)});
    }
    pile[x].push(col);
  }}
  round=1;
  hands=[]; for(let i=0;i<net.N;i++) hands.push(genHand());
  scores=new Array(net.N).fill(0);
  chosenCard=null; selected=[]; net.pending=null;
  document.getElementById('log').innerHTML="";
  log(`▶ Carrier online. ${net.N} operators. You are OP-${net.myIdx+1}.`);
  render();
}

function genHand(){
  const h=[]; const inits=new Set();
  while(h.length<5){
    const init=1+Math.floor(rand()*30);
    if(inits.has(init))continue; inits.add(init);
    const maxIdx=Math.min(SHAPES.length-1,Math.floor(init/4));
    h.push({init,shape:SHAPES[Math.floor(rand()*(maxIdx+1))],color:COLKEYS[Math.floor(rand()*COLKEYS.length)]});
  }
  return h.sort((a,b)=>a.init-b.init);
}

function topEntry(x,y){const c=pile[x][y];return c.length?c[c.length-1]:null;}
function topColor(x,y){const e=topEntry(x,y);return e?e.color:null;}

function log(m,cls){const l=document.getElementById('log');const d=document.createElement('div');if(cls)d.style.color=cls==='ok'?'#6f6':'#f66';d.textContent=m;l.prepend(d);}
function msg(m,cls){const e=document.getElementById('msg');e.textContent=m;e.className='msg'+(cls?' '+cls:'');}

// Highlight selection via emissive color; intensity is driven by the anim loop.
function updateHighlights(){
  for(let x=0;x<W;x++)for(let y=0;y<H;y++){
    const e=topEntry(x,y); if(!e)continue;
    const sel=selected.some(s=>s[0]===x&&s[1]===y);
    e.mesh.material.emissive.setHex(sel?0xffffff:COLORS[e.color]);
  }
}

function render(){
  document.getElementById('round').textContent=round;
  const sEl=document.getElementById('scores'); sEl.innerHTML='';
  for(let i=0;i<net.N;i++){
    const d=document.createElement('div'); d.className='stat';
    const name=(net.names&&net.names[i])||`P${i+1}`;
    const tag=i===net.myIdx?' (you)':'';
    d.innerHTML=`<span style="color:${PLAYER_COLORS[i]}">${name}${tag}</span> <b>${scores[i]}</b>`;
    sEl.appendChild(d);
  }
  const hEl=document.getElementById('hand'); hEl.innerHTML='';
  myHand().forEach((c,i)=>{
    const el=document.createElement('div');
    el.className='card'+(chosenCard===i?' chosen':'');
    el.style.color='#'+COLORS[c.color].toString(16).padStart(6,'0');
    el.innerHTML=`<div class="init">Δ${c.init}</div>`;
    const sh=document.createElement('div'); sh.className='shape';
    const mx=Math.max(...c.shape.cells.map(p=>p[0]))+1;
    const my=Math.max(...c.shape.cells.map(p=>p[1]))+1;
    sh.style.gridTemplateColumns=`repeat(${mx},9px)`;
    for(let y=0;y<my;y++)for(let x=0;x<mx;x++){
      const b=document.createElement('div');
      if(c.shape.cells.some(p=>p[0]===x&&p[1]===y))b.className='on';
      sh.appendChild(b);
    }
    el.appendChild(sh);
    el.onclick=()=>{chosenCard=i;selected=[];render();updateHighlights();};
    hEl.appendChild(el);
  });
  updateHighlights();
}

// ---- Raycaster picking ----
const raycaster=new THREE.Raycaster();
const mouse=new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown',ev=>{
  if(ev.button!==0)return;
  const r=renderer.domElement.getBoundingClientRect();
  mouse.x=((ev.clientX-r.left)/r.width)*2-1;
  mouse.y=-((ev.clientY-r.top)/r.height)*2+1;
  raycaster.setFromCamera(mouse,camera);
  const hits=raycaster.intersectObjects(pileGroup.children,false);
  if(!hits.length)return;
  const obj=hits[0].object;
  const {x,y}=obj.userData;
  const top=topEntry(x,y);
  if(!top||top.mesh!==obj)return; // only top cubes selectable
  toggleSel(x,y);
});

function toggleSel(x,y){
  if(chosenCard==null){msg("Select a decode filter first.");return;}
  const i=selected.findIndex(s=>s[0]===x&&s[1]===y);
  if(i>=0)selected.splice(i,1);
  else{
    const card=myHand()[chosenCard];
    if(selected.length>=card.shape.cells.length){msg("Filter saturated — clear to retarget.");return;}
    selected.push([x,y]);
  }
  msg(""); updateHighlights();
}

function validates(sel,card){
  if(sel.length!==card.shape.cells.length)return false;
  for(const [x,y] of sel)if(topColor(x,y)!==card.color)return false;
  const norm=a=>{const mx=Math.min(...a.map(p=>p[0])),my=Math.min(...a.map(p=>p[1]));return a.map(p=>[p[0]-mx,p[1]-my]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);};
  const s=JSON.stringify(norm(sel));
  let cells=card.shape.cells.slice();
  for(let r=0;r<4;r++){
    if(JSON.stringify(norm(cells))===s)return true;
    cells=cells.map(([x,y])=>[-y,x]);
  }
  return false;
}

function removeCubes(sel){
  for(const [x,y] of sel){
    const e=pile[x][y].pop();
    if(e)pileGroup.remove(e.mesh);
  }
}

function cpuFind(card){
  const tops=[];
  for(let x=0;x<W;x++)for(let y=0;y<H;y++)if(topColor(x,y)===card.color)tops.push([x,y]);
  let cells=card.shape.cells.slice();
  for(let r=0;r<4;r++){
    for(const [ax,ay] of tops){
      const mx=Math.min(...cells.map(p=>p[0])),my=Math.min(...cells.map(p=>p[1]));
      const placed=cells.map(([x,y])=>[x-mx+ax,y-my+ay]);
      if(placed.every(([x,y])=>x>=0&&x<W&&y>=0&&y<H&&topColor(x,y)===card.color))return placed;
    }
    cells=cells.map(([x,y])=>[-y,x]);
  }
  return null;
}

function resolveTurn(moves){
  // moves: array length N of {cardIdx, sel} (sel may be null = no valid play)
  const acts=[];
  for(let i=0;i<net.N;i++){
    const m=moves[i]; if(!m)continue;
    acts.push({idx:i,card:hands[i][m.cardIdx],sel:m.sel});
  }
  acts.sort((a,b)=>{
    const ai=a.card?a.card.init:Infinity, bi=b.card?b.card.init:Infinity;
    return ai-bi || a.idx-b.idx;
  });
  for(const a of acts){
    const name=(net.names&&net.names[a.idx])||`P${a.idx+1}`;
    if(!a.card){log(`· ${name} held carrier.`);continue;}
    if(a.sel && validates(a.sel,a.card)){
      removeCubes(a.sel); scores[a.idx]+=a.sel.length;
      log(`✓ ${name} Δ${a.card.init} captured ${a.sel.length}× ${a.card.color} (+${a.sel.length})`,'ok');
    } else log(`✗ ${name} Δ${a.card.init} jammed — signal lost.`);
  }
  // discard + draw (deterministic, in player order)
  for(let i=0;i<net.N;i++){
    const m=moves[i]; if(!m||m.cardIdx<0)continue;
    hands[i].splice(m.cardIdx,1);
    hands[i].push(...genHand().slice(0,1));
    hands[i].sort((a,b)=>a.init-b.init);
  }
  chosenCard=null; selected=[]; net.pending=null;
  round++;
  if(round>10){
    const max=Math.max(...scores);
    const winners=scores.map((s,i)=>s===max?i:-1).filter(i=>i>=0);
    const w=winners.length>1?`Split signal: ${winners.map(i=>'OP-'+(i+1)).join(', ')}`:(winners[0]===net.myIdx?'You own the band!':`OP-${winners[0]+1} owns the band.`);
    log(`━━ CARRIER LOST — ${w} ━━`,'ok'); msg(`Transmission ended. ${w}`,'ok');
  } else msg("");
  render();
}

function ensurePending(){if(!net.pending)net.pending=new Array(net.N).fill(null);}
function tryResolve(){
  if(!net.pending)return;
  if(net.mode==='guest')return; // guest waits for host broadcast
  if(net.pending.some(p=>p===null))return;
  if(net.mode==='host') broadcast({t:'resolve',moves:net.pending});
  resolveTurn(net.pending);
}
function broadcast(msg){for(const c of net.conns) if(c.open) c.send(msg);}

document.getElementById('confirm').onclick=()=>{
  if(chosenCard==null){msg("Select a filter.");return;}
  const pCard=myHand()[chosenCard];
  if(!validates(selected,pCard)){msg("Packet geometry & frequency mismatch.");return;}
  ensurePending();
  const myMove={cardIdx:chosenCard,sel:selected.slice()};
  net.pending[net.myIdx]=myMove;
  if(net.mode==='solo'){
    // CPUs fill remaining slots
    for(let i=0;i<net.N;i++) if(i!==net.myIdx){
      const h=hands[i]; const ci=Math.floor(rand()*h.length);
      net.pending[i]={cardIdx:ci,sel:cpuFind(h[ci])};
    }
    tryResolve();
  } else if(net.mode==='host'){
    msg("Transmitting… awaiting other operators.",'ok');
    tryResolve();
  } else { // guest
    msg("Transmitting… awaiting other operators.",'ok');
    net.conn.send({t:'move',idx:net.myIdx,cardIdx:chosenCard,sel:selected.slice()});
  }
};
document.getElementById('clear').onclick=()=>{selected=[];updateHighlights();};
document.getElementById('pass').onclick=()=>{
  ensurePending();
  net.pending[net.myIdx]={cardIdx:-1,sel:null};
  if(net.mode==='solo'){
    for(let i=0;i<net.N;i++) if(i!==net.myIdx){
      const h=hands[i]; const ci=Math.floor(rand()*h.length);
      const f=cpuFind(h[ci]);
      net.pending[i]=f?{cardIdx:ci,sel:f}:{cardIdx:-1,sel:null};
    }
    tryResolve();
  } else if(net.mode==='host'){
    msg("Holding carrier. Awaiting other operators.",'ok'); tryResolve();
  } else {
    msg("Holding carrier. Awaiting other operators.",'ok');
    net.conn.send({t:'move',idx:net.myIdx,cardIdx:-1,sel:null});
  }
};
function resetNet(){
  if(net.peer){try{net.peer.destroy();}catch(e){}}
  net.peer=null; net.conns=[]; net.conn=null; net.started=false;
}

document.getElementById('newgame').onclick=()=>{
  resetNet();
  net.mode='solo'; net.myIdx=0; net.N=2;
  net.names=[myName(),'CPU'];
  setNetStatus(''); init();
};

// Host: manages N-1 guest connections
document.getElementById('host').onclick=()=>{
  if(typeof Peer==='undefined'){msg('PeerJS failed to load.');return;}
  resetNet();
  net.mode='host'; net.myIdx=0; net.N=1; net.conns=[];
  net.names=[myName()];
  setNetStatus('creating room…');
  const peer=new Peer(); net.peer=peer;
  peer.on('open',id=>{
    prompt('Share this channel ID. Click Start when all operators are patched in.',id);
    setNetStatus('channel: '+id+' — 1 operator (you). Listening…');
  });
  peer.on('connection',conn=>{
    conn.on('open',()=>{
      if(net.started){conn.send({t:'full'});conn.close();return;}
      net.conns.push(conn);
      const idx=net.conns.length; // guest's player index
      conn.playerIdx=idx;
      net.names[idx]=`P${idx+1}`;
      setNetStatus(`room open — ${net.conns.length+1} players`);
      conn.send({t:'hello',yourIdx:idx,names:net.names});
    });
    conn.on('data',d=>{
      if(d.t==='name'){
        net.names[conn.playerIdx]=(d.name||'').slice(0,16)||`P${conn.playerIdx+1}`;
        setNetStatus(`room open — ${net.conns.length+1} players: ${net.names.join(', ')}`);
        // live-broadcast name list so other guests see it (if already started, no-op)
        broadcast({t:'names',names:net.names});
      } else if(d.t==='move'){
        ensurePending();
        net.pending[d.idx]={cardIdx:d.cardIdx,sel:d.sel};
        tryResolve();
      }
    });
    conn.on('close',()=>{setNetStatus('a player disconnected');});
  });
  peer.on('error',e=>setNetStatus('peer error: '+e.type));
};

document.getElementById('startmp').onclick=()=>{
  if(net.mode!=='host'){msg('Only host can start.');return;}
  if(net.conns.length<1){msg('Need at least 1 guest.');return;}
  net.started=true;
  net.N=1+net.conns.length;
  const seed=(Math.random()*2**32)>>>0;
  broadcast({t:'start',seed,N:net.N,names:net.names});
  setNetStatus(`playing · ${net.N} players: ${net.names.join(', ')}`);
  init(seed);
  log('━━ CARRIER LOCKED — decode window open ━━','ok');
};

// Guest
document.getElementById('join').onclick=()=>{
  if(typeof Peer==='undefined'){msg('PeerJS failed to load.');return;}
  const id=prompt('Enter channel ID:');
  if(!id)return;
  resetNet();
  net.mode='guest';
  showWaiting('connecting…');
  setNetStatus('connecting…');
  const peer=new Peer(); net.peer=peer;
  peer.on('open',()=>{
    const conn=peer.connect(id,{reliable:true});
    net.conn=conn;
    conn.on('open',()=>{
      setNetStatus('connected · waiting for host to start');
      conn.send({t:'name',name:myName()});
    });
    conn.on('data',d=>{
      if(d.t==='hello'){
        net.myIdx=d.yourIdx;
        net.names=d.names||[];
        net.names[d.yourIdx]=myName();
        setNetStatus(`in lobby · you are P${d.yourIdx+1}`);
        showWaiting('Players: '+net.names.filter(Boolean).join(', '));
      }
      else if(d.t==='names'){
        net.names=d.names;
        showWaiting('Players: '+net.names.filter(Boolean).join(', '));
      }
      else if(d.t==='start'){
        net.N=d.N; net.names=d.names||[];
        hideWaiting();
        setNetStatus(`playing · ${net.N} players: ${net.names.join(', ')}`);
        init(d.seed);
        log('━━ Host opened the channel — lock acquired ━━','ok');
      }
      else if(d.t==='resolve'){ resolveTurn(d.moves);}
      else if(d.t==='full'){ setNetStatus('room full'); }
    });
    conn.on('close',()=>setNetStatus('disconnected'));
  });
  peer.on('error',e=>setNetStatus('peer error: '+e.type));
};
document.getElementById('topview').onclick=()=>{
  camera.position.set(W/2-0.5,18,H/2-0.5+0.01);
  controls.target.set(W/2-0.5,0,H/2-0.5); controls.update();
};

let _t0=performance.now();
function loop(){
  requestAnimationFrame(loop);
  const t=(performance.now()-_t0)/1000;
  // radar ring breathes
  const s=1+0.15*Math.sin(t*1.6);
  ring.scale.set(s,s,1);
  ringMat.opacity=0.18+0.12*(0.5+0.5*Math.sin(t*1.6));
  // live (top) signals pulse; selected stay bright
  if(pile){
    for(let x=0;x<W;x++)for(let y=0;y<H;y++){
      const e=topEntry(x,y); if(!e)continue;
      const sel=selected&&selected.some(s=>s[0]===x&&s[1]===y);
      if(sel){ e.mesh.material.emissiveIntensity=0.75; }
      else { e.mesh.material.emissiveIntensity=0.18+0.12*Math.sin(t*2.4+(x*0.7+y*0.9)); }
    }
  }
  controls.update(); renderer.render(scene,camera);
}
init(); loop();
