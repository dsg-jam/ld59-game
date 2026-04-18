// @ts-nocheck
import * as THREE from 'three';
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import Peer, { type DataConnection } from "peerjs";

// Constants
const COLORS_HEX = [0xcf6679, 0x3700b3, 0x03dac6, 0xfdd835];
const COLORS_CSS = ['#cf6679','#3700b3','#03dac6','#fdd835'];
const COLOR_NAMES = ['ALPHA','BETA','GAMMA','DELTA'];
const CHANNEL_FREQS = ['91.1','87.3','98.7','104.5'];
const PLAYER_COLORS = [0x03dac6, 0xcf6679, 0xfdd835, 0x3700b3, 0xff7043, 0x66bb6a];
const PLAYER_CSS = ['#03dac6','#cf6679','#fdd835','#3700b3','#ff7043','#66bb6a'];
const PLAYER_NAMES_DEFAULT = ['P1','P2','P3','P4','P5','P6'];
const BLOCK_SIZE = 1;
const GAP = 0.08;
const GRID_N = 5;
const MAX_PLAYERS = 6;
const PEER_PREFIX = 'decon6-';
const TABLE_RADIUS = 7;

const SHAPES = [
    { name:'PULSE',   points:2, pattern:[[0,0],[0,1]] },
    { name:'CARRIER', points:3, pattern:[[0,0],[0,1],[0,2]] },
    { name:'SKIP',    points:3, pattern:[[0,0],[1,0],[1,1]] },
    { name:'BURST',   points:4, pattern:[[0,0],[0,1],[1,0],[1,1]] },
    { name:'BEACON',  points:4, pattern:[[0,0],[0,1],[0,2],[1,1]] },
    { name:'RELAY',   points:4, pattern:[[0,0],[0,1],[1,1],[1,2]] }
];

// Network state
let peer = null;
let isHost = false;
let roomCode = '';
let mySlot = 0;
let conns = [];
let playerCount = 1;

// Host-authoritative state
let H = {
    grid: [], hands: {}, picks: {}, scores: {},
    turn: 1, playerIds: [], started: false
};

// Local display
let S = {
    grid: [], myHand: [], selectedCardIdx: null,
    scores: {}, turn: 1, locked: false,
    playerSlots: 1, allScores: []
};

// Three.js scene
const canvas = document.getElementById('three-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x08080c);
scene.fog = new THREE.FogExp2(0x08080c, 0.018);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 120);
camera.position.set(10, 12, 10);

const orbitCtl = new OrbitControls(camera, canvas);
orbitCtl.enableDamping = true;
orbitCtl.dampingFactor = 0.07;
orbitCtl.target.set(0, 1, 0);
orbitCtl.minDistance = 5;
orbitCtl.maxDistance = 30;
orbitCtl.maxPolarAngle = Math.PI / 2.15;
orbitCtl.update();

// Lighting
scene.add(new THREE.AmbientLight(0x404060, 0.5));
const sun = new THREE.DirectionalLight(0xfff5e0, 1.6);
sun.position.set(6, 14, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 40;
sun.shadow.camera.left = -14; sun.shadow.camera.right = 14;
sun.shadow.camera.top = 14; sun.shadow.camera.bottom = -14;
sun.shadow.radius = 4;
scene.add(sun);
const rim = new THREE.DirectionalLight(0xbb86fc, 0.25);
rim.position.set(-6, 8, -6);
scene.add(rim);

const tableLamp = new THREE.PointLight(0xffeedd, 0.6, 20, 1.5);
tableLamp.position.set(0, 6, 0);
tableLamp.castShadow = true;
scene.add(tableLamp);

// Floor
const floorGeo = new THREE.PlaneGeometry(50, 50);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.95 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI/2; floor.position.y = -0.02; floor.receiveShadow = true;
scene.add(floor);

// Table
const tableGroup = new THREE.Group();
scene.add(tableGroup);

const tableShape = new THREE.Shape();
const sides = 8;
for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / sides;
    const x = TABLE_RADIUS * Math.cos(a), z = TABLE_RADIUS * Math.sin(a);
    i === 0 ? tableShape.moveTo(x, z) : tableShape.lineTo(x, z);
}
const tableTopGeo = new THREE.ExtrudeGeometry(tableShape, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.06, bevelSegments: 3 });
const tableTopMat = new THREE.MeshStandardMaterial({ color: 0x1a3a2a, roughness: 0.55, metalness: 0.05 });
const tableTop = new THREE.Mesh(tableTopGeo, tableTopMat);
tableTop.rotation.x = -Math.PI/2;
tableTop.position.y = 0;
tableTop.receiveShadow = true; tableTop.castShadow = true;
tableGroup.add(tableTop);

const legGeo = new THREE.CylinderGeometry(0.15, 0.2, 2.2, 8);
const legMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.7 });
for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI/4;
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(Math.cos(a) * 4.5, -1.1, Math.sin(a) * 4.5);
    leg.castShadow = true;
    tableGroup.add(leg);
}

const feltGeo = new THREE.CylinderGeometry(3.2, 3.2, 0.02, 32);
const feltMat = new THREE.MeshStandardMaterial({ color: 0x0d2818, roughness: 0.8 });
const felt = new THREE.Mesh(feltGeo, feltMat);
felt.position.y = 0.11; felt.receiveShadow = true;
tableGroup.add(felt);

// Radar scope overlay
for (let i = 1; i <= 3; i++) {
    const ringGeo = new THREE.RingGeometry(i * 0.95 - 0.012, i * 0.95 + 0.012, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x03dac6, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.121;
    tableGroup.add(ring);
}
const crossV = new THREE.Mesh(new THREE.PlaneGeometry(0.015, 6.0), new THREE.MeshBasicMaterial({ color: 0x03dac6, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
crossV.rotation.x = -Math.PI / 2; crossV.position.y = 0.121; tableGroup.add(crossV);
const crossH = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 0.015), new THREE.MeshBasicMaterial({ color: 0x03dac6, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
crossH.rotation.x = -Math.PI / 2; crossH.position.y = 0.121; tableGroup.add(crossH);

const sweepGroup = new THREE.Group();
sweepGroup.position.y = 0.122;
tableGroup.add(sweepGroup);
const sweepGeo = new THREE.CircleGeometry(3.05, 32, 0, Math.PI / 4);
const sweepMat = new THREE.MeshBasicMaterial({ color: 0x03dac6, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
const sweep = new THREE.Mesh(sweepGeo, sweepMat);
sweep.rotation.x = -Math.PI / 2;
sweepGroup.add(sweep);

// Block construct
const blockMaterials = COLORS_HEX.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.15 }));
const blockGeo = new THREE.BoxGeometry(BLOCK_SIZE * 0.88, BLOCK_SIZE * 0.88, BLOCK_SIZE * 0.88);
const edgeGeo = new THREE.EdgesGeometry(blockGeo);
const constructGroup = new THREE.Group();
const gridOffset = (GRID_N - 1) * (BLOCK_SIZE + GAP) / 2;
constructGroup.position.set(-gridOffset, 0.22, -gridOffset);
tableGroup.add(constructGroup);

let meshGrid = [];
let antennaTips = [];
let sceneAnims = [];
const antennaRodGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.32, 6);
const antennaRodMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.5, metalness: 0.7 });
const antennaTipGeo = new THREE.SphereGeometry(0.055, 10, 10);

function gridToWorld(r, c, y) {
    return new THREE.Vector3(c * (BLOCK_SIZE + GAP), y * (BLOCK_SIZE + GAP) + BLOCK_SIZE * 0.44, r * (BLOCK_SIZE + GAP));
}
function createBlockMesh(colorIdx, r, c, y) {
    const mesh = new THREE.Mesh(blockGeo, blockMaterials[colorIdx]);
    const pos = gridToWorld(r, c, y);
    mesh.position.copy(pos); mesh.castShadow = true; mesh.receiveShadow = true;
    constructGroup.add(mesh);
    const edge = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.2, transparent: true }));
    edge.position.copy(pos); constructGroup.add(edge);
    return { mesh, edge };
}
function buildGrid() {
    while (constructGroup.children.length) constructGroup.remove(constructGroup.children[0]);
    meshGrid = [];
    antennaTips = [];
    for (let r = 0; r < GRID_N; r++) {
        meshGrid[r] = [];
        for (let c = 0; c < GRID_N; c++) {
            meshGrid[r][c] = [];
            const stack = S.grid[r] ? (S.grid[r][c] || []) : [];
            for (let y = 0; y < stack.length; y++) meshGrid[r][c].push(createBlockMesh(stack[y], r, c, y));
            if (stack.length > 0) {
                const topIdx = stack.length - 1;
                const topColor = stack[topIdx];
                const topPos = gridToWorld(r, c, topIdx);
                const rod = new THREE.Mesh(antennaRodGeo, antennaRodMat);
                rod.position.set(topPos.x, topPos.y + BLOCK_SIZE * 0.44 + 0.16, topPos.z);
                rod.castShadow = true;
                constructGroup.add(rod);
                const tipMat = new THREE.MeshStandardMaterial({ color: COLORS_HEX[topColor], emissive: COLORS_HEX[topColor], emissiveIntensity: 0.8, roughness: 0.3 });
                const tip = new THREE.Mesh(antennaTipGeo, tipMat);
                tip.position.set(topPos.x, topPos.y + BLOCK_SIZE * 0.44 + 0.35, topPos.z);
                constructGroup.add(tip);
                antennaTips.push({ mesh: tip, phase: (r * 1.37 + c * 0.91) });
            }
        }
    }
}
function animateBlockRemoval(blocksToRemove) {
    blocksToRemove.forEach(function(b) {
        let br = b[0], bc = b[1];
        let stack = meshGrid[br] ? meshGrid[br][bc] : null;
        if (stack && stack.length > 0) {
            let obj = stack.pop();
            sceneAnims.push({ type:'blockRise', mesh:obj.mesh, edge:obj.edge, vel:0.015+Math.random()*0.025, rot:(Math.random()-0.5)*0.12, opacity:1, t:0 });
        }
    });
}

function spawnSignalRipples(blocks, colorIdx) {
    blocks.forEach(function(b) {
        let br = b[0], bc = b[1];
        let curCount = (meshGrid[br] && meshGrid[br][bc]) ? meshGrid[br][bc].length : 0;
        let pos = gridToWorld(br, bc, curCount);
        let ringGeo = new THREE.RingGeometry(0.16, 0.22, 32);
        let ringMat = new THREE.MeshBasicMaterial({ color: COLORS_HEX[colorIdx], transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
        let ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(pos);
        constructGroup.add(ring);
        sceneAnims.push({ type:'signalRing', mesh:ring, mat:ringMat, geo:ringGeo, t:0, duration:0.9 });
    });
}

// Player seats
const seatGroup = new THREE.Group();
tableGroup.add(seatGroup);
let seatMeshes = [];

function buildSeats(n) {
    while (seatGroup.children.length) seatGroup.remove(seatGroup.children[0]);
    seatMeshes = [];
    for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const dist = TABLE_RADIUS - 0.8;
        const x = Math.cos(angle) * dist, z = Math.sin(angle) * dist;

        const discGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.06, 16);
        const discMat = new THREE.MeshStandardMaterial({ color: PLAYER_COLORS[i], emissive: PLAYER_COLORS[i], emissiveIntensity: 0.3, roughness: 0.4 });
        const disc = new THREE.Mesh(discGeo, discMat);
        disc.position.set(x, 0.14, z);
        disc.receiveShadow = true;
        seatGroup.add(disc);

        const canvas2 = document.createElement('canvas');
        canvas2.width = 256; canvas2.height = 64;
        const ctx = canvas2.getContext('2d');
        ctx.fillStyle = PLAYER_CSS[i];
        ctx.font = 'bold 32px Segoe UI';
        ctx.textAlign = 'center';
        ctx.fillText(i === mySlot ? 'YOU' : PLAYER_NAMES_DEFAULT[i], 128, 40);
        const tex = new THREE.CanvasTexture(canvas2);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.position.set(x, 0.7, z);
        sprite.scale.set(1.6, 0.4, 1);
        seatGroup.add(sprite);

        const cardDist = dist - 1.8;
        const cx = Math.cos(angle) * cardDist, cz = Math.sin(angle) * cardDist;
        seatMeshes.push({ disc:disc, sprite:sprite, angle:angle, cardPos: new THREE.Vector3(cx, 0.2, cz), playedCard: null });
    }
}

// 3D Card objects
const CARD_W = 0.7, CARD_H = 0.95, CARD_D = 0.03;
const cardGeo = new THREE.BoxGeometry(CARD_W, CARD_D, CARD_H);

function createCard3D(card, faceUp) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: faceUp ? 0x2a2a2a : 0x1a1a2e, roughness: 0.5 });
    const body = new THREE.Mesh(cardGeo, bodyMat);
    body.castShadow = true; body.receiveShadow = true;
    group.add(body);

    if (faceUp && card) {
        const stripeGeo = new THREE.PlaneGeometry(CARD_W * 0.8, CARD_H * 0.5);
        const stripeMat = new THREE.MeshStandardMaterial({ color: COLORS_HEX[card.colorIdx], roughness: 0.3, side: THREE.DoubleSide });
        const stripe = new THREE.Mesh(stripeGeo, stripeMat);
        stripe.rotation.x = -Math.PI/2;
        stripe.position.y = CARD_D/2 + 0.002;
        group.add(stripe);

        const dotGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.01, 8);
        const dotMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.3 });
        card.shape.pattern.forEach(function(p) {
            const dot = new THREE.Mesh(dotGeo, dotMat);
            dot.position.set((p[1] - 1) * 0.12, CARD_D/2 + 0.008, (p[0] - 0.5) * 0.12);
            group.add(dot);
        });
    } else {
        const backGeo = new THREE.PlaneGeometry(CARD_W * 0.65, CARD_H * 0.65);
        const backMat = new THREE.MeshStandardMaterial({ color: 0xbb86fc, roughness: 0.5, side: THREE.DoubleSide });
        const back = new THREE.Mesh(backGeo, backMat);
        back.rotation.x = -Math.PI/2;
        back.position.y = CARD_D/2 + 0.002;
        group.add(back);
    }
    return group;
}

let playedCardMeshes = [];
function clearPlayedCards() {
    playedCardMeshes.forEach(function(m) { tableGroup.remove(m); });
    playedCardMeshes = [];
}

function showPlayedCard(slot, card, faceUp) {
    if (seatMeshes[slot] == null) return;
    const mesh = createCard3D(card, faceUp);
    const p = seatMeshes[slot].cardPos;
    mesh.position.set(p.x, 0.3, p.z);
    mesh.lookAt(0, 0.3, 0);
    mesh.rotation.x = 0;
    tableGroup.add(mesh);
    playedCardMeshes.push(mesh);
    seatMeshes[slot].playedCard = mesh;
    return mesh;
}

function animateCardFlip(slot) {
    let sm = seatMeshes[slot];
    if (sm == null || sm.playedCard == null) return;
    sceneAnims.push({ type:'cardFlip', mesh:sm.playedCard, t:0, duration:0.5, startRot: Math.PI, endRot: 0 });
}

function animateCardToCenter(slot, targetPos) {
    let sm = seatMeshes[slot];
    if (sm == null || sm.playedCard == null) return;
    let start = sm.playedCard.position.clone();
    let end = new THREE.Vector3(targetPos.x, 0.5, targetPos.z);
    sceneAnims.push({ type:'cardSlide', mesh:sm.playedCard, t:0, duration:0.6, start:start, end:end });
}

// UI rendering
function renderUI() {
    let chipsEl = document.getElementById('score-chips');
    chipsEl.innerHTML = '';
    (S.allScores || []).forEach(function(s) {
        let el = document.createElement('span');
        el.className = 'score-chip' + (s.slot === mySlot ? ' me' : '');
        el.style.borderColor = PLAYER_CSS[s.slot];
        el.style.color = PLAYER_CSS[s.slot];
        el.textContent = (s.slot === mySlot ? 'You' : PLAYER_NAMES_DEFAULT[s.slot]) + ': ' + s.score;
        chipsEl.appendChild(el);
    });

    let handEl = document.getElementById('player-hand');
    handEl.innerHTML = '';
    (S.myHand || []).forEach(function(card, idx) {
        let el = document.createElement('div');
        el.className = 'card' + (S.selectedCardIdx === idx ? ' selected' : '');
        if (S.locked === false) el.onclick = function() { selectCard(idx); };
        let mg = document.createElement('div');
        mg.className = 'mini-grid';
        for (let i = 0; i < 9; i++) {
            let dot = document.createElement('div');
            dot.className = 'mini-dot';
            let row = Math.floor(i/3), col = i%3;
            if (card.shape.pattern.some(function(p) { return p[0]===row && p[1]===col; })) {
                dot.classList.add('active');
                dot.style.backgroundColor = COLORS_CSS[card.colorIdx];
            }
            mg.appendChild(dot);
        }
        el.innerHTML = '<div class="card-num">' + card.initiative + '</div><div style="font-size:9px">' + card.shape.name + '</div>';
        el.insertBefore(mg, el.firstChild);
        handEl.appendChild(el);
    });

    document.getElementById('round-num').innerText = S.turn;
    document.getElementById('resolve-btn').disabled = S.locked || S.selectedCardIdx === null;
}

function selectCard(idx) { if (S.locked === false) { S.selectedCardIdx = idx; renderUI(); } }
function log(msg) { let el = document.getElementById('log-panel'); el.innerHTML = '<div>> ' + msg + '</div>' + el.innerHTML; }
function showWait(show) { document.getElementById('wait-banner').classList.toggle('hidden', show === false); }

// Host game logic
function generateGrid() {
    let g = [];
    for (let r = 0; r < GRID_N; r++) { g[r] = []; for (let c = 0; c < GRID_N; c++) { let h = Math.floor(Math.random()*3)+2; g[r][c] = Array.from({length:h}, function(){ return Math.floor(Math.random()*4); }); } }
    return g;
}
function generateHand() {
    let hand = [];
    for (let i = 0; i < 4; i++) {
        let shape = SHAPES[Math.floor(Math.random()*SHAPES.length)];
        let colorIdx = Math.floor(Math.random()*4);
        let initiative = Math.floor(Math.random()*20) + (shape.points*10) - 10;
        hand.push({ shape:shape, colorIdx:colorIdx, initiative:initiative });
    }
    return hand;
}
function getOrientations(pattern) {
    let seen = new Set(), out = []; let cur = pattern;
    for (let rot = 0; rot < 4; rot++) {
        let minR = Math.min.apply(null, cur.map(function(p){return p[0];}));
        let minC = Math.min.apply(null, cur.map(function(p){return p[1];}));
        let norm = cur.map(function(p){return [p[0]-minR, p[1]-minC];}).sort(function(a,b){return a[0]-b[0]||a[1]-b[1];});
        let key = JSON.stringify(norm);
        if (seen.has(key) === false) { seen.add(key); out.push(norm); }
        cur = cur.map(function(p){return [p[1],-p[0]];});
    }
    return out;
}
function hostAttemptRemoval(grid, card) {
    let color = card.colorIdx;
    let orientations = getOrientations(card.shape.pattern);
    for (let oi = 0; oi < orientations.length; oi++) {
        let pat = orientations[oi];
        for (let r = 0; r < GRID_N; r++) for (let c = 0; c < GRID_N; c++) {
            let ok = true; let blocks = [];
            for (let pi = 0; pi < pat.length; pi++) {
                let p = pat[pi];
                let nr = r+p[0], nc = c+p[1];
                if (nr<0||nr>=GRID_N||nc<0||nc>=GRID_N) { ok=false; break; }
                let st = grid[nr][nc];
                if (st.length === 0 || st[st.length-1]!==color) { ok=false; break; }
                blocks.push([nr,nc]);
            }
            if (ok) { blocks.forEach(function(b){grid[b[0]][b[1]].pop();}); return {points:card.shape.points, removed:blocks}; }
        }
    }
    return {points:0, removed:[]};
}

function hostStartRound() {
    if (H.turn === 1) H.grid = generateGrid();
    H.picks = {};
    let n = H.playerIds.length;
    for (let i = 0; i < n; i++) H.hands[i] = generateHand();

    let scores = H.playerIds.map(function(_,i){ return { slot:i, score:H.scores[i]||0 }; });
    for (let i = 0; i < n; i++) {
        let msg = { type:'round-start', grid:H.grid, hand:H.hands[i], turn:H.turn, scores:scores, playerCount:n, yourSlot:i };
        if (i === 0) onRoundStart(msg);
        else sendTo(i, msg);
    }
}

function hostOnPick(slot, cardIdx) {
    H.picks[slot] = cardIdx;
    let n = H.playerIds.length;
    for (let i = 0; i < n; i++) {
        let msg = { type:'player-locked', slot:slot };
        if (i !== 0) sendTo(i, msg);
    }
    if (Object.keys(H.picks).length === n) hostResolveTurn();
}

function hostResolveTurn() {
    let n = H.playerIds.length;
    let actions = [];
    for (let i = 0; i < n; i++) {
        actions.push({ slot:i, card:H.hands[i][H.picks[i]] });
    }
    actions.sort(function(a,b){ return a.card.initiative - b.card.initiative; });

    let results = [];
    for (let ai = 0; ai < actions.length; ai++) {
        let act = actions[ai];
        let res = hostAttemptRemoval(H.grid, act.card);
        H.scores[act.slot] = (H.scores[act.slot]||0) + res.points;
        results.push({ slot:act.slot, card:act.card, points:res.points, removed:res.removed });
    }

    H.turn++;
    let gameOver = H.turn > 10;
    let winnerSlot = -1;
    if (gameOver) {
        let best = -1;
        for (let si=0; si<n; si++) { if ((H.scores[si]||0)>best) { best=H.scores[si]; winnerSlot=si; } }
        let tiedCount = 0;
        for (let sk in H.scores) { if (H.scores[sk]===best) tiedCount++; }
        if (tiedCount > 1) winnerSlot = -2;
    }
    let scores = H.playerIds.map(function(_,i){ return { slot:i, score:H.scores[i]||0 }; });

    for (let j = 0; j < n; j++) {
        let msg = { type:'turn-result', results:results, grid:H.grid, scores:scores, turn:H.turn, gameOver:gameOver, winnerSlot:winnerSlot, yourSlot:j };
        if (j === 0) onTurnResult(msg);
        else sendTo(j, msg);
    }
    if (gameOver === false) setTimeout(function(){ hostStartRound(); }, 2200);
}

// Networking
function sendTo(slot, data) {
    if (isHost && conns[slot] && conns[slot].open) conns[slot].send(data);
}
function sendToHost(data) {
    if (isHost) return;
    if (conns[0] && conns[0].open) conns[0].send(data);
}

function onMessage(data, fromSlot) {
    if (data.type === 'round-start') onRoundStart(data);
    else if (data.type === 'turn-result') onTurnResult(data);
    else if (data.type === 'player-locked') {
        log((data.slot === mySlot ? 'You' : PLAYER_NAMES_DEFAULT[data.slot]) + ' transmitted.');
    }
    else if (data.type === 'pick' && isHost) {
        hostOnPick(fromSlot, data.cardIdx);
    }
}

function onRoundStart(data) {
    S.grid = data.grid;
    S.myHand = data.hand;
    S.selectedCardIdx = null;
    S.locked = false;
    S.turn = data.turn;
    S.allScores = data.scores;
    S.playerSlots = data.playerCount;
    mySlot = data.yourSlot;

    clearPlayedCards();
    buildGrid();
    buildSeats(data.playerCount);
    renderUI();
    showWait(false);
    if (data.turn === 1) log('Transmission detected. Tune a frequency and TRANSMIT.');
}

function onTurnResult(data) {
    clearPlayedCards();
    S.allScores = data.scores;
    S.turn = data.turn;
    S.grid = data.grid;

    data.results.forEach(function(r) {
        showPlayedCard(r.slot, r.card, false);
    });

    setTimeout(function() {
        clearPlayedCards();
        data.results.forEach(function(r) {
            showPlayedCard(r.slot, r.card, true);
        });

        let delay = 400;
        data.results.forEach(function(r) {
            let label = r.slot === mySlot ? 'You' : PLAYER_NAMES_DEFAULT[r.slot];
            let cName = COLOR_NAMES[r.card.colorIdx];
            setTimeout(function() {
                if (r.points > 0) {
                    animateBlockRemoval(r.removed);
                    spawnSignalRipples(r.removed, r.card.colorIdx);
                    log('<span style="color:' + PLAYER_CSS[r.slot] + '">' + label + ' decoded ' + r.card.shape.name + ' on ' + cName + ' \u2014 +' + r.points + ' signal.</span>');
                } else {
                    log('<span style="color:let(--red)">' + label + ' \u2014 ' + cName + ' channel silent. Signal lost.</span>');
                }
            }, delay);
            delay += 500;
        });
    }, 700);

    S.selectedCardIdx = null;
    S.locked = false;
    renderUI();

    if (data.gameOver) {
        let totalDelay = 700 + data.results.length * 500 + 800;
        setTimeout(function() {
            let msg;
            if (data.winnerSlot === -2) msg = 'Signal split \u2014 tied transmission!';
            else if (data.winnerSlot === mySlot) msg = 'You intercepted the transmission!';
            else msg = PLAYER_NAMES_DEFAULT[data.winnerSlot] + ' intercepted the transmission.';
            let scoreText = data.scores.map(function(s){ return (s.slot===mySlot?'You':PLAYER_NAMES_DEFAULT[s.slot]) + ': ' + s.score; }).join('  |  ');
            alert('// TRANSMISSION ENDED\n' + msg + '\n' + scoreText);
            location.reload();
        }, totalDelay);
    }
}

// Lobby / PeerJS
function makeCode() {
    let ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = '';
    for (let i=0; i<5; i++) c += ch[Math.floor(Math.random()*ch.length)];
    return c;
}

function updatePlayerList() {
    let el = document.getElementById('player-list');
    el.innerHTML = '';
    H.playerIds.forEach(function(id, i) {
        let div = document.createElement('div');
        div.className = i===0 ? 'you' : '';
        div.textContent = (i===0 ? '\u2605 You (Host)' : 'Player ' + (i+1) + ' \u2014 connected');
        div.style.color = PLAYER_CSS[i];
        el.appendChild(div);
    });
    document.getElementById('lobby-status').textContent = H.playerIds.length + '/' + MAX_PLAYERS + ' operators tuned in. Ready when you are.';
    document.getElementById('start-btn').disabled = H.playerIds.length < 2;
}

function startGame() {
    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('ui-overlay').classList.remove('hidden');
}

window.hostGame = function() {
    roomCode = makeCode();
    isHost = true; mySlot = 0;
    H.playerIds = ['host'];
    H.scores = { 0: 0 };
    conns = [null];

    document.getElementById('lobby-menu').style.display = 'none';
    document.getElementById('lobby-waiting').style.display = 'block';
    document.getElementById('room-code-show').textContent = roomCode;
    updatePlayerList();

    peer = new Peer(PEER_PREFIX + roomCode);
    peer.on('open', function() {
        document.getElementById('lobby-status').textContent = 'Broadcasting \u2014 awaiting operators (' + H.playerIds.length + '/' + MAX_PLAYERS + ')';
    });
    peer.on('connection', function(c) {
        if (H.started || H.playerIds.length >= MAX_PLAYERS) { c.close(); return; }
        let slot = H.playerIds.length;
        H.playerIds.push(c.peer);
        H.scores[slot] = 0;
        conns[slot] = c;
        c.on('open', function() {
            c.send({ type:'slot-assign', slot:slot });
            updatePlayerList();
        });
        c.on('data', function(data) { onMessage(data, slot); });
        c.on('close', function() {
            if (H.started === false) {
                H.playerIds.splice(slot, 1);
                conns.splice(slot, 1);
                updatePlayerList();
            }
        });
    });
    peer.on('error', function(err) {
        document.getElementById('lobby-status').textContent = 'Error: ' + err.type;
    });
};

window.hostStartNow = function() {
    if (H.playerIds.length < 2) return;
    H.started = true;
    for (let i = 1; i < H.playerIds.length; i++) {
        sendTo(i, { type:'game-start', playerCount: H.playerIds.length });
    }
    playerCount = H.playerIds.length;
    startGame();
    hostStartRound();
};

window.joinGame = function() {
    let code = document.getElementById('join-code').value.toUpperCase().trim();
    if (code === '' || code.length < 3) return;
    roomCode = code; isHost = false;

    document.getElementById('lobby-menu').style.display = 'none';
    document.getElementById('lobby-joining').style.display = 'block';
    document.getElementById('join-status').textContent = 'Locking onto ' + roomCode + '&hellip;';

    peer = new Peer();
    peer.on('open', function() {
        let c = peer.connect(PEER_PREFIX + roomCode, { reliable: true });
        conns = [c];
        c.on('open', function() {
            document.getElementById('join-status').textContent = 'Signal locked. Awaiting transmission&hellip;';
        });
        c.on('data', function(data) {
            if (data.type === 'slot-assign') {
                mySlot = data.slot;
            } else if (data.type === 'game-start') {
                playerCount = data.playerCount;
                startGame();
            } else {
                onMessage(data, 0);
            }
        });
        c.on('close', function() { alert('Host disconnected.'); location.reload(); });
    });
    peer.on('error', function(err) {
        document.getElementById('join-status').textContent = 'Failed: ' + err.type + '. Check the code.';
    });
};

window.onPickCard = function() {
    if (S.locked || S.selectedCardIdx === null) return;
    S.locked = true;
    renderUI();
    let cardIdx = S.selectedCardIdx;

    showPlayedCard(mySlot, S.myHand[cardIdx], false);

    if (isHost) {
        hostOnPick(0, cardIdx);
    } else {
        sendToHost({ type:'pick', cardIdx:cardIdx });
    }
    showWait(true);
};

// Animation loop
let clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    let dt = clock.getDelta();
    orbitCtl.update();

    for (let i = sceneAnims.length - 1; i >= 0; i--) {
        let a = sceneAnims[i];
        a.t += dt;

        if (a.type === 'blockRise') {
            a.mesh.position.y += a.vel * 60 * dt;
            a.mesh.rotation.x += a.rot;
            a.mesh.rotation.z += a.rot * 0.7;
            a.edge.position.copy(a.mesh.position);
            a.edge.rotation.copy(a.mesh.rotation);
            a.opacity -= dt * 1.0;
            a.mesh.material = a.mesh.material.clone();
            a.mesh.material.transparent = true;
            a.mesh.material.opacity = Math.max(0, a.opacity);
            a.edge.material.opacity = Math.max(0, a.opacity * 0.2);
            if (a.opacity <= 0) {
                constructGroup.remove(a.mesh); constructGroup.remove(a.edge);
                a.mesh.material.dispose();
                sceneAnims.splice(i, 1);
            }
        }
        else if (a.type === 'cardFlip') {
            let progress = Math.min(a.t / a.duration, 1);
            let ease = 1 - Math.pow(1 - progress, 3);
            a.mesh.rotation.x = a.startRot + (a.endRot - a.startRot) * ease;
            if (progress >= 1) sceneAnims.splice(i, 1);
        }
        else if (a.type === 'cardSlide') {
            let progress2 = Math.min(a.t / a.duration, 1);
            let ease2 = 1 - Math.pow(1 - progress2, 2);
            a.mesh.position.lerpVectors(a.start, a.end, ease2);
            a.mesh.position.y = a.start.y + Math.sin(progress2 * Math.PI) * 0.5;
            if (progress2 >= 1) sceneAnims.splice(i, 1);
        }
        else if (a.type === 'signalRing') {
            let p = Math.min(a.t / a.duration, 1);
            let scale = 1 + p * 4;
            a.mesh.scale.set(scale, scale, 1);
            a.mat.opacity = 0.95 * (1 - p);
            if (p >= 1) {
                constructGroup.remove(a.mesh);
                a.geo.dispose();
                a.mat.dispose();
                sceneAnims.splice(i, 1);
            }
        }
    }

    seatMeshes.forEach(function(s, i) {
        if (s.disc) {
            s.disc.material.emissiveIntensity = 0.2 + Math.sin(Date.now() * 0.003 + i) * 0.1;
        }
    });

    let tNow = Date.now() * 0.004;
    antennaTips.forEach(function(a) {
        a.mesh.material.emissiveIntensity = 0.55 + Math.sin(tNow + a.phase) * 0.45;
    });
    sweepGroup.rotation.y += dt * 0.7;

    renderer.render(scene, camera);
}

window.addEventListener('resize', function() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
