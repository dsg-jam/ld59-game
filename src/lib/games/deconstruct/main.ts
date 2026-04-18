import * as THREE from 'three';
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import Peer from "peerjs";
import { makeCode } from "$lib/peer";

// ---- Seeded RNG (mulberry32) ----
let _rng = Math.random;
function mulberry32(a) {
    return function () {
        let t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
function setSeed(s) { _rng = mulberry32(s); }
const rand = () => _rng();

// ---- Constants ----
const W = 6, H = 6, D = 4;
const COLORS_HEX = { R: 0xee5555, G: 0x55cc55, B: 0x5599ff, Y: 0xeedd55, P: 0xcc66ff };
const COLORS_CSS = { R: '#ee5555', G: '#55cc55', B: '#5599ff', Y: '#eedd55', P: '#cc66ff' };
const COLOR_NAMES = { R: 'ALPHA', G: 'BETA', B: 'GAMMA', Y: 'DELTA', P: 'EPSILON' };
const COLKEYS = Object.keys(COLORS_HEX);

const SHAPES = [
    { name: "PULSE", cells: [[0, 0]] },
    { name: "PAIR", cells: [[0, 0], [1, 0]] },
    { name: "CARRIER", cells: [[0, 0], [1, 0], [2, 0]] },
    { name: "SKIP", cells: [[0, 0], [0, 1], [1, 1]] },
    { name: "BURST", cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    { name: "BEACON", cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
    { name: "RELAY", cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
    { name: "STREAK", cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
];

const PLAYER_COLORS_HEX = [0x03dac6, 0xcf6679, 0xfdd835, 0x3700b3, 0xff7043, 0x66bb6a];
const PLAYER_CSS = ['#03dac6', '#cf6679', '#fdd835', '#3700b3', '#ff7043', '#66bb6a'];
const MAX_PLAYERS = 6;
const PEER_PREFIX = 'decon-';
const TABLE_RADIUS = 8;
const BLOCK_SIZE = 1;
const GAP = 0.08;
const TOTAL_ROUNDS = 10;
const MAX_INITIATIVE = 30;
const WINNER_TIED = -2;

// ---- Network state ----
let peer = null;
let isHost = false;
let roomCode = '';
let mySlot = 0;
let conns = [];
let isSolo = false;

// Host-authoritative state
let HS = {
    seed: 0,
    grid: [],          // grid[x][y] = array of color keys (stack bottom to top)
    hands: {},         // hands[slot] = array of cards
    picks: {},         // picks[slot] = { cardIdx, sel } or { cardIdx: -1, sel: null } (pass)
    scores: {},
    turn: 1,
    playerIds: [],
    playerNames: {},
    started: false,
    N: 1
};

// Local display state
let S = {
    grid: [],          // same structure as HS.grid
    myHand: [],
    selectedCardIdx: null,
    selected: [],      // array of [x, y] positions selected on grid
    scores: [],
    turn: 1,
    locked: false,
    playerCount: 1,
    playerNames: {}
};

// ---- Three.js Setup ----
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
scene.fog = new THREE.FogExp2(0x08080c, 0.015);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 120);
camera.position.set(12, 14, 12);

const orbitCtl = new OrbitControls(camera, canvas);
orbitCtl.enableDamping = true;
orbitCtl.dampingFactor = 0.07;
orbitCtl.target.set(0, 1, 0);
orbitCtl.minDistance = 5;
orbitCtl.maxDistance = 35;
orbitCtl.maxPolarAngle = Math.PI / 2.1;
orbitCtl.update();

// Lighting
scene.add(new THREE.AmbientLight(0x404060, 0.5));
const sun = new THREE.DirectionalLight(0xfff5e0, 1.6);
sun.position.set(8, 18, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 45;
sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
sun.shadow.radius = 4;
sun.shadow.bias = -0.0005;
scene.add(sun);
const rim = new THREE.DirectionalLight(0xaaccff, 0.3);
rim.position.set(-8, 6, -10);
scene.add(rim);

const tableLamp = new THREE.PointLight(0xffeedd, 0.6, 24, 1.5);
tableLamp.position.set(0, 7, 0);
tableLamp.castShadow = true;
scene.add(tableLamp);

// Floor
const floorGeo = new THREE.PlaneGeometry(60, 60);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.95 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; floor.receiveShadow = true;
scene.add(floor);

// Table
const tableGroup = new THREE.Group();
scene.add(tableGroup);
const tableShape = new THREE.Shape();
const tableSides = 8;
for (let i = 0; i <= tableSides; i++) {
    const a = (i / tableSides) * Math.PI * 2 - Math.PI / tableSides;
    const x = TABLE_RADIUS * Math.cos(a), z = TABLE_RADIUS * Math.sin(a);
    i === 0 ? tableShape.moveTo(x, z) : tableShape.lineTo(x, z);
}
const tableTopGeo = new THREE.ExtrudeGeometry(tableShape, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.06, bevelSegments: 3 });
const tableTopMat = new THREE.MeshStandardMaterial({ color: 0x1a3a2a, roughness: 0.55, metalness: 0.05 });
const tableTop = new THREE.Mesh(tableTopGeo, tableTopMat);
tableTop.rotation.x = -Math.PI / 2; tableTop.position.y = 0;
tableTop.receiveShadow = true; tableTop.castShadow = true;
tableGroup.add(tableTop);

const legGeo = new THREE.CylinderGeometry(0.15, 0.2, 2.2, 8);
const legMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.7 });
for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(Math.cos(a) * 5.5, -1.1, Math.sin(a) * 5.5);
    leg.castShadow = true;
    tableGroup.add(leg);
}

const feltGeo = new THREE.CylinderGeometry(4.0, 4.0, 0.02, 32);
const feltMat = new THREE.MeshStandardMaterial({ color: 0x0d2818, roughness: 0.8 });
const felt = new THREE.Mesh(feltGeo, feltMat);
felt.position.y = 0.11; felt.receiveShadow = true;
tableGroup.add(felt);

// Radar scope overlay
for (let i = 1; i <= 3; i++) {
    const ringGeo = new THREE.RingGeometry(i * 1.1 - 0.012, i * 1.1 + 0.012, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x4fd0ff, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.121;
    tableGroup.add(ring);
}
const crossV = new THREE.Mesh(new THREE.PlaneGeometry(0.015, 7.0), new THREE.MeshBasicMaterial({ color: 0x4fd0ff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
crossV.rotation.x = -Math.PI / 2; crossV.position.y = 0.121; tableGroup.add(crossV);
const crossH = new THREE.Mesh(new THREE.PlaneGeometry(7.0, 0.015), new THREE.MeshBasicMaterial({ color: 0x4fd0ff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
crossH.rotation.x = -Math.PI / 2; crossH.position.y = 0.121; tableGroup.add(crossH);

const sweepGroup = new THREE.Group();
sweepGroup.position.y = 0.122;
tableGroup.add(sweepGroup);
const sweepGeo = new THREE.CircleGeometry(3.6, 32, 0, Math.PI / 4);
const sweepMat = new THREE.MeshBasicMaterial({ color: 0x4fd0ff, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false });
const sweepMesh = new THREE.Mesh(sweepGeo, sweepMat);
sweepMesh.rotation.x = -Math.PI / 2;
sweepGroup.add(sweepMesh);

// ---- Block construct (grid of cubes) ----
const blockGeo = new THREE.BoxGeometry(BLOCK_SIZE * 0.88, BLOCK_SIZE * 0.88, BLOCK_SIZE * 0.88);
const edgeGeo = new THREE.EdgesGeometry(blockGeo);
const constructGroup = new THREE.Group();
const gridOffset = (W - 1) * (BLOCK_SIZE + GAP) / 2;
constructGroup.position.set(-gridOffset, 0.22, -gridOffset);
tableGroup.add(constructGroup);

let meshGrid = [];     // meshGrid[x][y] = array of { mesh, edge }
let antennaTips = [];
let sceneAnims = [];
const antennaRodGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.32, 6);
const antennaRodMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.5, metalness: 0.7 });
const antennaTipGeo = new THREE.SphereGeometry(0.055, 10, 10);

function gridToWorld(x, y, z) {
    return new THREE.Vector3(
        x * (BLOCK_SIZE + GAP),
        z * (BLOCK_SIZE + GAP) + BLOCK_SIZE * 0.44,
        y * (BLOCK_SIZE + GAP)
    );
}

function createBlockMesh(colorKey, x, y, z) {
    const color = COLORS_HEX[colorKey];
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.15, emissive: color, emissiveIntensity: 0 });
    const mesh = new THREE.Mesh(blockGeo, mat);
    const pos = gridToWorld(x, y, z);
    mesh.position.copy(pos);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData = { gx: x, gy: y, gz: z, colorKey };
    constructGroup.add(mesh);

    const edge = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x4fd0ff, transparent: true, opacity: 0.25 }));
    edge.position.copy(pos);
    constructGroup.add(edge);

    return { mesh, edge };
}

function buildGrid() {
    while (constructGroup.children.length) constructGroup.remove(constructGroup.children[0]);
    meshGrid = [];
    antennaTips = [];
    for (let x = 0; x < W; x++) {
        meshGrid[x] = [];
        for (let y = 0; y < H; y++) {
            meshGrid[x][y] = [];
            const stack = S.grid[x] ? (S.grid[x][y] || []) : [];
            for (let z = 0; z < stack.length; z++) {
                meshGrid[x][y].push(createBlockMesh(stack[z], x, y, z));
            }
            // Antenna tip on top block
            if (stack.length > 0) {
                const topZ = stack.length - 1;
                const topColor = stack[topZ];
                const topPos = gridToWorld(x, y, topZ);
                const rod = new THREE.Mesh(antennaRodGeo, antennaRodMat);
                rod.position.set(topPos.x, topPos.y + BLOCK_SIZE * 0.44 + 0.16, topPos.z);
                rod.castShadow = true;
                constructGroup.add(rod);
                const tipMat = new THREE.MeshStandardMaterial({ color: COLORS_HEX[topColor], emissive: COLORS_HEX[topColor], emissiveIntensity: 0.8, roughness: 0.3 });
                const tip = new THREE.Mesh(antennaTipGeo, tipMat);
                tip.position.set(topPos.x, topPos.y + BLOCK_SIZE * 0.44 + 0.35, topPos.z);
                constructGroup.add(tip);
                antennaTips.push({ mesh: tip, phase: (x * 1.37 + y * 0.91) });
            }
        }
    }
}

function animateBlockRemoval(sel) {
    sel.forEach(function (pos) {
        let bx = pos[0], by = pos[1];
        let stack = meshGrid[bx] ? meshGrid[bx][by] : null;
        if (stack && stack.length > 0) {
            let obj = stack.pop();
            let clonedMat = obj.mesh.material.clone();
            clonedMat.transparent = true;
            obj.mesh.material = clonedMat;
            sceneAnims.push({ type: 'blockRise', mesh: obj.mesh, edge: obj.edge, clonedMat: clonedMat, vel: 0.015 + Math.random() * 0.025, rot: (Math.random() - 0.5) * 0.12, opacity: 1, t: 0 });
        }
    });
}

function spawnSignalRipples(sel, colorKey) {
    sel.forEach(function (pos) {
        let bx = pos[0], by = pos[1];
        let curCount = (meshGrid[bx] && meshGrid[bx][by]) ? meshGrid[bx][by].length : 0;
        let wpos = gridToWorld(bx, by, curCount);
        let ringGeo2 = new THREE.RingGeometry(0.16, 0.22, 32);
        let ringMat2 = new THREE.MeshBasicMaterial({ color: COLORS_HEX[colorKey], transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
        let ring2 = new THREE.Mesh(ringGeo2, ringMat2);
        ring2.rotation.x = -Math.PI / 2;
        ring2.position.copy(wpos);
        constructGroup.add(ring2);
        sceneAnims.push({ type: 'signalRing', mesh: ring2, mat: ringMat2, geo: ringGeo2, t: 0, duration: 0.9 });
    });
}

// ---- Player seats ----
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
        const discMat = new THREE.MeshStandardMaterial({ color: PLAYER_COLORS_HEX[i], emissive: PLAYER_COLORS_HEX[i], emissiveIntensity: 0.3, roughness: 0.4 });
        const disc = new THREE.Mesh(discGeo, discMat);
        disc.position.set(x, 0.14, z);
        disc.receiveShadow = true;
        seatGroup.add(disc);

        const canvas2 = document.createElement('canvas');
        canvas2.width = 256; canvas2.height = 64;
        const ctx = canvas2.getContext('2d');
        ctx.fillStyle = PLAYER_CSS[i];
        ctx.font = 'bold 28px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        const name = S.playerNames[i] || (i === mySlot ? 'YOU' : (isSolo && i > 0 ? 'CPU' : 'P' + (i + 1)));
        ctx.fillText(name, 128, 40);
        const tex = new THREE.CanvasTexture(canvas2);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.position.set(x, 0.7, z);
        sprite.scale.set(1.6, 0.4, 1);
        seatGroup.add(sprite);

        seatMeshes.push({ disc, sprite, angle });
    }
}

// ---- Raycaster for tile selection ----
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

canvas.addEventListener('pointerdown', function (ev) {
    if (ev.button !== 0) return;
    if (S.locked) return;
    const r = canvas.getBoundingClientRect();
    mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    // Only intersect block meshes in constructGroup
    const blockMeshes = [];
    constructGroup.traverse(function (obj) {
        if (obj.isMesh && obj.userData.gx !== undefined) blockMeshes.push(obj);
    });
    const hits = raycaster.intersectObjects(blockMeshes, false);
    if (!hits.length) return;

    const obj = hits[0].object;
    const { gx, gy } = obj.userData;
    // Only allow selecting top cube of each stack
    const stack = S.grid[gx] ? S.grid[gx][gy] : [];
    if (stack.length === 0) return;
    const topZ = stack.length - 1;
    const topEntry = meshGrid[gx] && meshGrid[gx][gy] && meshGrid[gx][gy][topZ];
    if (!topEntry || topEntry.mesh !== obj) return;

    toggleSel(gx, gy);
});

function toggleSel(x, y) {
    if (S.selectedCardIdx == null) { showMsg("Select a decode filter first."); return; }
    const i = S.selected.findIndex(function (s) { return s[0] === x && s[1] === y; });
    if (i >= 0) {
        S.selected.splice(i, 1);
    } else {
        const card = S.myHand[S.selectedCardIdx];
        if (S.selected.length >= card.shape.cells.length) { showMsg("Filter saturated — clear to retarget."); return; }
        S.selected.push([x, y]);
    }
    showMsg("");
    updateHighlights();
}

// ---- Game logic ----
function topColor(x, y) {
    const stack = S.grid[x] ? S.grid[x][y] : [];
    return stack.length ? stack[stack.length - 1] : null;
}

function validates(sel, card) {
    if (sel.length !== card.shape.cells.length) return false;
    for (const pos of sel) {
        if (topColor(pos[0], pos[1]) !== card.color) return false;
    }
    const norm = function (a) {
        const mx = Math.min.apply(null, a.map(function (p) { return p[0]; }));
        const my = Math.min.apply(null, a.map(function (p) { return p[1]; }));
        return a.map(function (p) { return [p[0] - mx, p[1] - my]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    };
    const s = JSON.stringify(norm(sel));
    let cells = card.shape.cells.slice();
    for (let r = 0; r < 4; r++) {
        if (JSON.stringify(norm(cells)) === s) return true;
        cells = cells.map(function (c) { return [-c[1], c[0]]; });
    }
    return false;
}

function generateGrid(seed) {
    if (seed != null) setSeed(seed);
    let g = [];
    for (let x = 0; x < W; x++) {
        g[x] = [];
        for (let y = 0; y < H; y++) {
            let col = [];
            for (let z = 0; z < D; z++) {
                col.push(COLKEYS[Math.floor(rand() * COLKEYS.length)]);
            }
            g[x].push(col);
        }
    }
    return g;
}

function generateHand() {
    let h = [];
    const inits = new Set();
    while (h.length < 5) {
        const init = 1 + Math.floor(rand() * MAX_INITIATIVE);
        if (inits.has(init)) continue;
        inits.add(init);
        const maxIdx = Math.min(SHAPES.length - 1, Math.floor(init / 4));
        h.push({
            init,
            shape: SHAPES[Math.floor(rand() * (maxIdx + 1))],
            color: COLKEYS[Math.floor(rand() * COLKEYS.length)]
        });
    }
    return h.sort(function (a, b) { return a.init - b.init; });
}

function cpuFind(card) {
    const tops = [];
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
        if (topColor(x, y) === card.color) tops.push([x, y]);
    }
    let cells = card.shape.cells.slice();
    for (let r = 0; r < 4; r++) {
        for (const anchor of tops) {
            const mx = Math.min.apply(null, cells.map(function (p) { return p[0]; }));
            const my = Math.min.apply(null, cells.map(function (p) { return p[1]; }));
            const placed = cells.map(function (c) { return [c[0] - mx + anchor[0], c[1] - my + anchor[1]]; });
            if (placed.every(function (p) { return p[0] >= 0 && p[0] < W && p[1] >= 0 && p[1] < H && topColor(p[0], p[1]) === card.color; })) return placed;
        }
        cells = cells.map(function (c) { return [-c[1], c[0]]; });
    }
    return null;
}

function removeCubes(sel) {
    for (const pos of sel) {
        const stack = HS.grid[pos[0]][pos[1]];
        if (stack.length) stack.pop();
    }
}

// ---- Turn resolution ----
function resolveTurn(moves, gridAfter) {
    // moves: array of { slot, card, sel, points }
    let delay = 0;

    moves.forEach(function (m) {
        const label = slotName(m.slot);
        setTimeout(function () {
            if (m.points > 0 && m.sel) {
                animateBlockRemoval(m.sel);
                spawnSignalRipples(m.sel, m.card.color);
                log('✓ ' + label + ' Δ' + m.card.init + ' decoded ' + m.card.shape.name + ' on ' + COLOR_NAMES[m.card.color] + ' — +' + m.sel.length, 'ok');
            } else if (m.card) {
                log('✗ ' + label + ' Δ' + m.card.init + ' — channel silent. Signal lost.');
            } else {
                log('· ' + label + ' held carrier.');
            }
        }, delay);
        delay += 450;
    });

    // Update local grid after all animations are queued
    setTimeout(function () {
        if (gridAfter) S.grid = gridAfter;
        buildGrid();
        renderUI();
    }, delay + 200);
}

function slotName(slot) {
    if (slot === mySlot) return 'You';
    return S.playerNames[slot] || (isSolo ? 'CPU' : 'P' + (slot + 1));
}

// ---- Host logic ----
function hostStartRound() {
    if (HS.turn === 1) {
        HS.seed = (Math.random() * 2 ** 32) >>> 0;
        setSeed(HS.seed);
        HS.grid = generateGrid();
    }
    HS.picks = {};
    const n = HS.N;
    for (let i = 0; i < n; i++) {
        HS.hands[i] = generateHand();
    }
    const scores = [];
    for (let i = 0; i < n; i++) {
        scores.push({ slot: i, score: HS.scores[i] || 0 });
    }

    // Send round data to each player
    for (let i = 0; i < n; i++) {
        const msg = { type: 'round-start', grid: HS.grid, hand: HS.hands[i], turn: HS.turn, scores, playerCount: n, yourSlot: i, names: HS.playerNames };
        if (i === 0) onRoundStart(msg);
        else sendTo(i, msg);
    }
}

function hostOnPick(slot, cardIdx, sel) {
    HS.picks[slot] = { cardIdx, sel };

    // Notify other players that this slot has locked in
    const n = HS.N;
    for (let i = 0; i < n; i++) {
        if (i !== slot && i !== 0) sendTo(i, { type: 'player-locked', slot });
    }
    if (slot !== 0) log('· ' + (HS.playerNames[slot] || 'P' + (slot + 1)) + ' transmitted.');

    if (Object.keys(HS.picks).length === n) hostResolveTurn();
}

function hostResolveTurn() {
    const n = HS.N;
    const actions = [];
    for (let i = 0; i < n; i++) {
        const pick = HS.picks[i];
        if (pick.cardIdx < 0) {
            actions.push({ slot: i, card: null, sel: null, init: Infinity });
        } else {
            const card = HS.hands[i][pick.cardIdx];
            actions.push({ slot: i, card, sel: pick.sel, init: card.init });
        }
    }
    actions.sort(function (a, b) { return a.init - b.init || a.slot - b.slot; });

    const results = [];
    for (const act of actions) {
        if (!act.card) {
            results.push({ slot: act.slot, card: null, sel: null, points: 0 });
            continue;
        }
        // Validate and remove
        if (act.sel && validates.call(null, act.sel, act.card)) {
            removeCubes(act.sel);
            const pts = act.sel.length;
            HS.scores[act.slot] = (HS.scores[act.slot] || 0) + pts;
            results.push({ slot: act.slot, card: act.card, sel: act.sel, points: pts });
        } else {
            results.push({ slot: act.slot, card: act.card, sel: act.sel, points: 0 });
        }
    }

    HS.turn++;
    const gameOver = HS.turn > TOTAL_ROUNDS;
    let winnerSlot = -1;
    if (gameOver) {
        let best = -1;
        for (let i = 0; i < n; i++) {
            if ((HS.scores[i] || 0) > best) { best = HS.scores[i]; winnerSlot = i; }
        }
        let tiedCount = 0;
        for (let i = 0; i < n; i++) { if ((HS.scores[i] || 0) === best) tiedCount++; }
        if (tiedCount > 1) winnerSlot = WINNER_TIED;
    }
    const scores = [];
    for (let i = 0; i < n; i++) scores.push({ slot: i, score: HS.scores[i] || 0 });

    for (let j = 0; j < n; j++) {
        const msg = { type: 'turn-result', results, grid: HS.grid, scores, turn: HS.turn, gameOver, winnerSlot, yourSlot: j, names: HS.playerNames };
        if (j === 0) onTurnResult(msg);
        else sendTo(j, msg);
    }
    if (!gameOver) {
        setTimeout(function () { hostStartRound(); }, 2400);
    }
}

// We need to validate on the host side using the host's grid
function hostValidates(sel, card) {
    if (!sel || sel.length !== card.shape.cells.length) return false;
    for (const pos of sel) {
        const stack = HS.grid[pos[0]] ? HS.grid[pos[0]][pos[1]] : [];
        if (!stack.length || stack[stack.length - 1] !== card.color) return false;
    }
    const norm = function (a) {
        const mx = Math.min.apply(null, a.map(function (p) { return p[0]; }));
        const my = Math.min.apply(null, a.map(function (p) { return p[1]; }));
        return a.map(function (p) { return [p[0] - mx, p[1] - my]; }).sort(function (a2, b) { return a2[0] - b[0] || a2[1] - b[1]; });
    };
    const s = JSON.stringify(norm(sel));
    let cells = card.shape.cells.slice();
    for (let r = 0; r < 4; r++) {
        if (JSON.stringify(norm(cells)) === s) return true;
        cells = cells.map(function (c) { return [-c[1], c[0]]; });
    }
    return false;
}

// ---- Client-side handlers ----
function onRoundStart(data) {
    S.grid = JSON.parse(JSON.stringify(data.grid));
    S.myHand = data.hand;
    S.selectedCardIdx = null;
    S.selected = [];
    S.locked = false;
    S.turn = data.turn;
    S.allScores = data.scores;
    S.playerCount = data.playerCount;
    S.playerNames = data.names || {};
    mySlot = data.yourSlot;

    buildGrid();
    buildSeats(data.playerCount);
    renderUI();
    showWait(false);
    if (data.turn === 1) log('▶ Transmission detected. Select a filter card, then click matching tiles on the grid.', 'ok');
}

function onTurnResult(data) {
    S.allScores = data.scores;
    S.turn = data.turn;
    S.playerNames = data.names || S.playerNames;
    S.locked = false;
    S.selectedCardIdx = null;
    S.selected = [];

    resolveTurn(data.results, data.grid);

    if (data.gameOver) {
        const totalDelay = data.results.length * 450 + 1200;
        setTimeout(function () {
            let msg;
            if (data.winnerSlot === WINNER_TIED) msg = 'Signal split — tied transmission!';
            else if (data.winnerSlot === mySlot) msg = 'You intercepted the transmission!';
            else msg = slotName(data.winnerSlot) + ' intercepted the transmission.';
            const scoreText = data.scores.map(function (s) { return slotName(s.slot) + ': ' + s.score; }).join('  |  ');
            log('━━ CARRIER LOST — ' + msg + ' ━━', 'ok');
            log(scoreText);
            showMsg(msg, 'ok');
        }, totalDelay);
    }
}

// ---- Networking ----
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
        log('· ' + slotName(data.slot) + ' transmitted.');
    }
    else if (data.type === 'pick' && isHost) {
        hostOnPick(fromSlot, data.cardIdx, data.sel);
    }
}

// ---- UI rendering ----
function renderUI() {
    const chipsEl = document.getElementById('score-chips');
    chipsEl.innerHTML = '';
    (S.allScores || []).forEach(function (s) {
        const el = document.createElement('span');
        el.className = 'score-chip' + (s.slot === mySlot ? ' me' : '');
        el.style.borderColor = PLAYER_CSS[s.slot];
        el.style.color = PLAYER_CSS[s.slot];
        el.textContent = slotName(s.slot) + ': ' + s.score;
        chipsEl.appendChild(el);
    });

    const handEl = document.getElementById('player-hand');
    handEl.innerHTML = '';
    (S.myHand || []).forEach(function (card, idx) {
        const el = document.createElement('div');
        el.className = 'card' + (S.selectedCardIdx === idx ? ' selected' : '');
        if (!S.locked) el.onclick = function () { selectCard(idx); };
        el.style.borderColor = COLORS_CSS[card.color];

        const num = document.createElement('div');
        num.className = 'card-num';
        num.textContent = 'Δ' + card.init;
        el.appendChild(num);

        const label = document.createElement('div');
        label.className = 'card-label';
        label.textContent = card.shape.name;
        el.appendChild(label);

        const mg = document.createElement('div');
        mg.className = 'mini-grid';
        const mx = Math.max.apply(null, card.shape.cells.map(function (p) { return p[0]; })) + 1;
        const my = Math.max.apply(null, card.shape.cells.map(function (p) { return p[1]; })) + 1;
        mg.style.gridTemplateColumns = 'repeat(' + mx + ', 12px)';
        for (let dy = 0; dy < my; dy++) for (let dx = 0; dx < mx; dx++) {
            const dot = document.createElement('div');
            dot.className = 'mini-dot';
            if (card.shape.cells.some(function (p) { return p[0] === dx && p[1] === dy; })) {
                dot.classList.add('active');
                dot.style.backgroundColor = COLORS_CSS[card.color];
            }
            mg.appendChild(dot);
        }
        el.appendChild(mg);
        handEl.appendChild(el);
    });

    document.getElementById('round-num').innerText = S.turn;

    const confirmBtn = document.getElementById('resolve-btn');
    confirmBtn.disabled = S.locked || S.selectedCardIdx == null || S.selected.length === 0;

    updateHighlights();
}

function selectCard(idx) {
    if (!S.locked) {
        S.selectedCardIdx = idx;
        S.selected = [];
        renderUI();
    }
}

function updateHighlights() {
    if (!meshGrid.length) return;
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
        const stack = S.grid[x] ? S.grid[x][y] : [];
        if (!stack.length) continue;
        const topZ = stack.length - 1;
        const entry = meshGrid[x] && meshGrid[x][y] && meshGrid[x][y][topZ];
        if (!entry) continue;
        const sel = S.selected.some(function (s) { return s[0] === x && s[1] === y; });
        if (sel) {
            entry.mesh.material.emissive.setHex(0xffffff);
            entry.mesh.material.emissiveIntensity = 0.6;
        } else {
            const colorKey = stack[topZ];
            entry.mesh.material.emissive.setHex(COLORS_HEX[colorKey]);
            entry.mesh.material.emissiveIntensity = 0;
        }
    }
}

function log(msg, cls) {
    const el = document.getElementById('log-panel');
    const d = document.createElement('div');
    if (cls === 'ok') d.style.color = '#8dff9d';
    else if (cls === 'bad') d.style.color = '#ff6b6b';
    d.textContent = msg;
    el.prepend(d);
}
function showMsg(m, cls) {
    const el = document.getElementById('msg-bar');
    el.textContent = m;
    el.className = 'msg-bar' + (cls ? ' ' + cls : '');
}
function showWait(show) {
    document.getElementById('wait-banner').classList.toggle('hidden', !show);
}

// ---- Lobby / PeerJS ----
function updatePlayerList() {
    const el = document.getElementById('player-list');
    el.innerHTML = '';
    HS.playerIds.forEach(function (id, i) {
        const div = document.createElement('div');
        div.className = i === 0 ? 'you' : '';
        const name = HS.playerNames[i] || (i === 0 ? 'You (Host)' : 'Player ' + (i + 1));
        div.textContent = (i === 0 ? '★ ' : '') + name + (i === 0 ? '' : ' — connected');
        div.style.color = PLAYER_CSS[i];
        el.appendChild(div);
    });
    document.getElementById('lobby-status').textContent = HS.playerIds.length + '/' + MAX_PLAYERS + ' operators tuned in.';
    document.getElementById('start-btn').disabled = HS.playerIds.length < 2;
}

function startGame() {
    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('ui-overlay').classList.remove('hidden');
}

// Solo mode
window.soloGame = function () {
    isSolo = true;
    isHost = true;
    mySlot = 0;
    HS.playerIds = ['host', 'cpu'];
    HS.scores = { 0: 0, 1: 0 };
    HS.playerNames = { 0: 'You', 1: 'CPU' };
    HS.N = 2;
    HS.turn = 1;
    HS.started = true;
    conns = [null, null];
    S.playerNames = HS.playerNames;

    startGame();
    hostStartRound();
};

window.hostGame = function () {
    roomCode = makeCode();
    isHost = true;
    isSolo = false;
    mySlot = 0;
    HS.playerIds = ['host'];
    HS.scores = { 0: 0 };
    HS.playerNames = { 0: 'You' };
    HS.N = 1;
    HS.turn = 1;
    HS.started = false;
    conns = [null];

    document.getElementById('lobby-menu').style.display = 'none';
    document.getElementById('lobby-waiting').style.display = 'block';
    document.getElementById('room-code-show').textContent = roomCode;
    updatePlayerList();

    peer = new Peer(PEER_PREFIX + roomCode);
    peer.on('open', function () {
        document.getElementById('lobby-status').textContent = 'Broadcasting — awaiting operators (' + HS.playerIds.length + '/' + MAX_PLAYERS + ')';
    });
    peer.on('connection', function (c) {
        if (HS.started || HS.playerIds.length >= MAX_PLAYERS) { c.close(); return; }
        const slot = HS.playerIds.length;
        HS.playerIds.push(c.peer);
        HS.scores[slot] = 0;
        HS.playerNames[slot] = 'P' + (slot + 1);
        conns[slot] = c;
        c.on('open', function () {
            c.send({ type: 'slot-assign', slot });
            updatePlayerList();
        });
        c.on('data', function (data) {
            if (data.type === 'name') {
                HS.playerNames[slot] = (data.name || '').slice(0, 16) || 'P' + (slot + 1);
                updatePlayerList();
            } else {
                onMessage(data, slot);
            }
        });
        c.on('close', function () {
            if (!HS.started) {
                HS.playerIds.splice(slot, 1);
                conns.splice(slot, 1);
                delete HS.scores[slot];
                delete HS.playerNames[slot];
                updatePlayerList();
            }
        });
    });
    peer.on('error', function (err) {
        document.getElementById('lobby-status').textContent = 'Error: ' + err.type;
    });
};

window.hostStartNow = function () {
    if (HS.playerIds.length < 2) return;
    HS.started = true;
    HS.N = HS.playerIds.length;
    for (let i = 1; i < HS.N; i++) {
        sendTo(i, { type: 'game-start', playerCount: HS.N, names: HS.playerNames });
    }
    startGame();
    hostStartRound();
};

window.joinGame = function () {
    const code = document.getElementById('join-code').value.toUpperCase().trim();
    if (!code || code.length < 3) return;
    roomCode = code;
    isHost = false;
    isSolo = false;

    document.getElementById('lobby-menu').style.display = 'none';
    document.getElementById('lobby-joining').style.display = 'block';
    document.getElementById('join-status').textContent = 'Locking onto ' + roomCode + '…';

    peer = new Peer();
    peer.on('open', function () {
        const c = peer.connect(PEER_PREFIX + roomCode, { reliable: true });
        conns = [c];
        c.on('open', function () {
            document.getElementById('join-status').textContent = 'Signal locked. Awaiting transmission…';
        });
        c.on('data', function (data) {
            if (data.type === 'slot-assign') {
                mySlot = data.slot;
            } else if (data.type === 'game-start') {
                S.playerCount = data.playerCount;
                S.playerNames = data.names || {};
                startGame();
            } else {
                onMessage(data, 0);
            }
        });
        c.on('close', function () {
            showMsg('Host disconnected.', 'bad');
        });
    });
    peer.on('error', function (err) {
        document.getElementById('join-status').textContent = 'Failed: ' + err.type + '. Check the code.';
    });
};

window.onPickCard = function () {
    if (S.locked || S.selectedCardIdx == null) return;
    const card = S.myHand[S.selectedCardIdx];
    if (!validates(S.selected, card)) {
        showMsg("Pattern & frequency mismatch — adjust selection.");
        return;
    }
    S.locked = true;
    renderUI();

    const cardIdx = S.selectedCardIdx;
    const sel = S.selected.slice();

    if (isSolo) {
        // CPU picks
        hostOnPick(0, cardIdx, sel);
        const cpuHand = HS.hands[1];
        const ci = Math.floor(rand() * cpuHand.length);
        const cpuSel = cpuFind(cpuHand[ci]);
        if (cpuSel) {
            hostOnPick(1, ci, cpuSel);
        } else {
            hostOnPick(1, -1, null);
        }
    } else if (isHost) {
        hostOnPick(0, cardIdx, sel);
        showWait(true);
    } else {
        sendToHost({ type: 'pick', cardIdx, sel });
        showWait(true);
    }
};

window.onClear = function () {
    S.selected = [];
    updateHighlights();
    renderUI();
};

window.onPass = function () {
    if (S.locked) return;
    S.locked = true;
    renderUI();

    if (isSolo) {
        hostOnPick(0, -1, null);
        const cpuHand = HS.hands[1];
        const ci = Math.floor(rand() * cpuHand.length);
        const cpuSel = cpuFind(cpuHand[ci]);
        if (cpuSel) {
            hostOnPick(1, ci, cpuSel);
        } else {
            hostOnPick(1, -1, null);
        }
    } else if (isHost) {
        hostOnPick(0, -1, null);
        showWait(true);
    } else {
        sendToHost({ type: 'pick', cardIdx: -1, sel: null });
        showWait(true);
    }
};

// ---- Animation loop ----
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    orbitCtl.update();

    // Process animations
    for (let i = sceneAnims.length - 1; i >= 0; i--) {
        const a = sceneAnims[i];
        a.t += dt;

        if (a.type === 'blockRise') {
            a.mesh.position.y += a.vel * 60 * dt;
            a.mesh.rotation.x += a.rot;
            a.mesh.rotation.z += a.rot * 0.7;
            a.edge.position.copy(a.mesh.position);
            a.edge.rotation.copy(a.mesh.rotation);
            a.opacity -= dt * 1.0;
            a.clonedMat.opacity = Math.max(0, a.opacity);
            a.edge.material.opacity = Math.max(0, a.opacity * 0.2);
            if (a.opacity <= 0) {
                constructGroup.remove(a.mesh);
                constructGroup.remove(a.edge);
                a.clonedMat.dispose();
                sceneAnims.splice(i, 1);
            }
        }
        else if (a.type === 'signalRing') {
            const p = Math.min(a.t / a.duration, 1);
            const scale = 1 + p * 4;
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

    // Seat glow pulse
    seatMeshes.forEach(function (s, i) {
        if (s.disc) s.disc.material.emissiveIntensity = 0.2 + Math.sin(Date.now() * 0.003 + i) * 0.1;
    });

    // Antenna tip pulse
    const tNow = Date.now() * 0.004;
    antennaTips.forEach(function (a) {
        a.mesh.material.emissiveIntensity = 0.55 + Math.sin(tNow + a.phase) * 0.45;
    });

    // Selection pulse
    if (S.selected && S.selected.length) {
        const pulseT = Date.now() * 0.005;
        for (const pos of S.selected) {
            const stack = S.grid[pos[0]] ? S.grid[pos[0]][pos[1]] : [];
            if (!stack.length) continue;
            const topZ = stack.length - 1;
            const entry = meshGrid[pos[0]] && meshGrid[pos[0]][pos[1]] && meshGrid[pos[0]][pos[1]][topZ];
            if (entry) entry.mesh.material.emissiveIntensity = 0.4 + 0.3 * Math.sin(pulseT);
        }
    }

    // Radar sweep
    sweepGroup.rotation.y += dt * 0.7;

    renderer.render(scene, camera);
}

window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
