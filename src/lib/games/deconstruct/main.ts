import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import Peer from "peerjs";
import type { DataConnection } from "peerjs";
import { makeCode } from "$lib/peer";

// ---- Type definitions ----
type ColKey = "R" | "G" | "B" | "Y" | "P";
type ShapeDef = { name: string; cells: [number, number][] };
type Card = { init: number; shape: ShapeDef; color: ColKey };
type ScoreEntry = { slot: number; score: number };
type Pick = { cardIdx: number; sel: [number, number][] | null };
type MoveResult = {
  slot: number;
  card: Card | null;
  sel: [number, number][] | null;
  points: number;
};
type GridEntry = { mesh: THREE.Mesh; edge: THREE.LineSegments };
type AntennaTip = { mesh: THREE.Mesh; phase: number };
type SeatEntry = { disc: THREE.Mesh; sprite: THREE.Sprite; angle: number };
type BlockRiseAnim = {
  type: "blockRise";
  mesh: THREE.Mesh;
  edge: THREE.LineSegments;
  clonedMat: THREE.MeshStandardMaterial;
  vel: number;
  rot: number;
  opacity: number;
  t: number;
};
type SignalRingAnim = {
  type: "signalRing";
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  geo: THREE.RingGeometry;
  t: number;
  duration: number;
};
type SceneAnim = BlockRiseAnim | SignalRingAnim;
type GameMsg = { type: string; [key: string]: unknown };

// ---- Seeded RNG (mulberry32) ----
let _rng = Math.random;
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function setSeed(s: number) {
  _rng = mulberry32(s);
}
const rand = () => _rng();

// ---- Constants ----
const W = 6,
  H = 6,
  D = 4;
const COLORS_HEX: Record<ColKey, number> = {
  R: 0xee5555,
  G: 0x55cc55,
  B: 0x5599ff,
  Y: 0xeedd55,
  P: 0xcc66ff,
};
const COLORS_CSS: Record<ColKey, string> = {
  R: "#ee5555",
  G: "#55cc55",
  B: "#5599ff",
  Y: "#eedd55",
  P: "#cc66ff",
};
const COLOR_NAMES: Record<ColKey, string> = {
  R: "ALPHA",
  G: "BETA",
  B: "GAMMA",
  Y: "DELTA",
  P: "EPSILON",
};
const COLKEYS = Object.keys(COLORS_HEX) as ColKey[];

const SHAPES = [
  { name: "PULSE", cells: [[0, 0]] },
  {
    name: "PAIR",
    cells: [
      [0, 0],
      [1, 0],
    ],
  },
  {
    name: "CARRIER",
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
  },
  {
    name: "SKIP",
    cells: [
      [0, 0],
      [0, 1],
      [1, 1],
    ],
  },
  {
    name: "BURST",
    cells: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  },
  {
    name: "BEACON",
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
      [1, 1],
    ],
  },
  {
    name: "RELAY",
    cells: [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
  },
  {
    name: "STREAK",
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
  },
];

const PLAYER_COLORS_HEX = [0x03dac6, 0xcf6679, 0xfdd835, 0x3700b3, 0xff7043, 0x66bb6a];
const PLAYER_CSS = ["#03dac6", "#cf6679", "#fdd835", "#3700b3", "#ff7043", "#66bb6a"];
const MAX_PLAYERS = 6;
const PEER_PREFIX = "decon-";
const TABLE_RADIUS = 8;
const BLOCK_SIZE = 1;
const GAP = 0.08;
const TOTAL_ROUNDS = 10;
const MAX_INITIATIVE = 30;
const WINNER_TIED = -2;

// ---- Network state ----
let peer: InstanceType<typeof Peer> | null = null;
let isHost = false;
let roomCode = "";
let mySlot = 0;
let conns: Array<DataConnection | null> = [];
let isSolo = false;

// Host-authoritative state
const HS: {
  seed: number;
  grid: ColKey[][][];
  hands: Record<number, Card[]>;
  picks: Record<number, Pick>;
  scores: Record<number, number>;
  turn: number;
  playerIds: string[];
  playerNames: Record<number, string>;
  started: boolean;
  N: number;
} = {
  seed: 0,
  grid: [], // grid[x][y] = array of color keys (stack bottom to top)
  hands: {}, // hands[slot] = array of cards
  picks: {}, // picks[slot] = { cardIdx, sel } or { cardIdx: -1, sel: null } (pass)
  scores: {},
  turn: 1,
  playerIds: [],
  playerNames: {},
  started: false,
  N: 1,
};

// Local display state
const S: {
  grid: ColKey[][][];
  myHand: Card[];
  selectedCardIdx: number | null;
  selected: [number, number][];
  allScores: ScoreEntry[];
  turn: number;
  locked: boolean;
  playerCount: number;
  playerNames: Record<number, string>;
} = {
  grid: [], // same structure as HS.grid
  myHand: [],
  selectedCardIdx: null,
  selected: [], // array of [x, y] positions selected on grid
  allScores: [],
  turn: 1,
  locked: false,
  playerCount: 1,
  playerNames: {},
};

// ---- Three.js Setup ----
const canvas = document.getElementById("three-canvas") as HTMLCanvasElement;
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
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 45;
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
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
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.02;
floor.receiveShadow = true;
scene.add(floor);

// Table
const tableGroup = new THREE.Group();
scene.add(tableGroup);
const tableShape = new THREE.Shape();
const tableSides = 8;
for (let i = 0; i <= tableSides; i++) {
  const a = (i / tableSides) * Math.PI * 2 - Math.PI / tableSides;
  const x = TABLE_RADIUS * Math.cos(a),
    z = TABLE_RADIUS * Math.sin(a);
  if (i === 0) {
    tableShape.moveTo(x, z);
  } else {
    tableShape.lineTo(x, z);
  }
}
const tableTopGeo = new THREE.ExtrudeGeometry(tableShape, {
  depth: 0.18,
  bevelEnabled: true,
  bevelThickness: 0.04,
  bevelSize: 0.06,
  bevelSegments: 3,
});
const tableTopMat = new THREE.MeshStandardMaterial({
  color: 0x1a3a2a,
  roughness: 0.55,
  metalness: 0.05,
});
const tableTop = new THREE.Mesh(tableTopGeo, tableTopMat);
tableTop.rotation.x = -Math.PI / 2;
tableTop.position.y = 0;
tableTop.receiveShadow = true;
tableTop.castShadow = true;
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
felt.position.y = 0.11;
felt.receiveShadow = true;
tableGroup.add(felt);

// Radar scope overlay
for (let i = 1; i <= 3; i++) {
  const ringGeo = new THREE.RingGeometry(i * 1.1 - 0.012, i * 1.1 + 0.012, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x4fd0ff,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.121;
  tableGroup.add(ring);
}
const crossV = new THREE.Mesh(
  new THREE.PlaneGeometry(0.015, 7.0),
  new THREE.MeshBasicMaterial({
    color: 0x4fd0ff,
    transparent: true,
    opacity: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
);
crossV.rotation.x = -Math.PI / 2;
crossV.position.y = 0.121;
tableGroup.add(crossV);
const crossH = new THREE.Mesh(
  new THREE.PlaneGeometry(7.0, 0.015),
  new THREE.MeshBasicMaterial({
    color: 0x4fd0ff,
    transparent: true,
    opacity: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
);
crossH.rotation.x = -Math.PI / 2;
crossH.position.y = 0.121;
tableGroup.add(crossH);

const sweepGroup = new THREE.Group();
sweepGroup.position.y = 0.122;
tableGroup.add(sweepGroup);
const sweepGeo = new THREE.CircleGeometry(3.6, 32, 0, Math.PI / 4);
const sweepMat = new THREE.MeshBasicMaterial({
  color: 0x4fd0ff,
  transparent: true,
  opacity: 0.15,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const sweepMesh = new THREE.Mesh(sweepGeo, sweepMat);
sweepMesh.rotation.x = -Math.PI / 2;
sweepGroup.add(sweepMesh);

// ---- Block construct (grid of cubes) ----
const blockGeo = new THREE.BoxGeometry(BLOCK_SIZE * 0.88, BLOCK_SIZE * 0.88, BLOCK_SIZE * 0.88);
const edgeGeo = new THREE.EdgesGeometry(blockGeo);
const constructGroup = new THREE.Group();
const gridOffset = ((W - 1) * (BLOCK_SIZE + GAP)) / 2;
constructGroup.position.set(-gridOffset, 0.22, -gridOffset);
tableGroup.add(constructGroup);

let meshGrid: GridEntry[][][] = []; // meshGrid[x][y] = array of { mesh, edge }
let antennaTips: AntennaTip[] = [];
const sceneAnims: SceneAnim[] = [];
const antennaRodGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.32, 6);
const antennaRodMat = new THREE.MeshStandardMaterial({
  color: 0x999999,
  roughness: 0.5,
  metalness: 0.7,
});
const antennaTipGeo = new THREE.SphereGeometry(0.055, 10, 10);

function gridToWorld(x: number, y: number, z: number) {
  return new THREE.Vector3(
    x * (BLOCK_SIZE + GAP),
    z * (BLOCK_SIZE + GAP) + BLOCK_SIZE * 0.44,
    y * (BLOCK_SIZE + GAP)
  );
}

function createBlockMesh(colorKey: ColKey, x: number, y: number, z: number) {
  const color = COLORS_HEX[colorKey];
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.35,
    metalness: 0.15,
    emissive: color,
    emissiveIntensity: 0,
  });
  const mesh = new THREE.Mesh(blockGeo, mat);
  const pos = gridToWorld(x, y, z);
  mesh.position.copy(pos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { gx: x, gy: y, gz: z, colorKey };
  constructGroup.add(mesh);

  const edge = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({ color: 0x4fd0ff, transparent: true, opacity: 0.25 })
  );
  edge.position.copy(pos);
  constructGroup.add(edge);

  return { mesh, edge };
}

function buildGrid() {
  while (constructGroup.children.length > 0) {
    const child = constructGroup.children[0];
    if (child) constructGroup.remove(child);
    else break;
  }
  meshGrid = [];
  antennaTips = [];
  for (let x = 0; x < W; x++) {
    const col: GridEntry[][] = [];
    meshGrid[x] = col;
    for (let y = 0; y < H; y++) {
      const cell: GridEntry[] = [];
      col[y] = cell;
      const stack: ColKey[] = S.grid[x]?.[y] ?? [];
      for (let z = 0; z < stack.length; z++) {
        cell.push(createBlockMesh(stack[z] ?? "R", x, y, z));
      }
      // Antenna tip on top block
      if (stack.length > 0) {
        const topZ = stack.length - 1;
        const topColor: ColKey = stack[topZ] ?? "R";
        const topPos = gridToWorld(x, y, topZ);
        const rod = new THREE.Mesh(antennaRodGeo, antennaRodMat);
        rod.position.set(topPos.x, topPos.y + BLOCK_SIZE * 0.44 + 0.16, topPos.z);
        rod.castShadow = true;
        constructGroup.add(rod);
        const tipMat = new THREE.MeshStandardMaterial({
          color: COLORS_HEX[topColor],
          emissive: COLORS_HEX[topColor],
          emissiveIntensity: 0.8,
          roughness: 0.3,
        });
        const tip = new THREE.Mesh(antennaTipGeo, tipMat);
        tip.position.set(topPos.x, topPos.y + BLOCK_SIZE * 0.44 + 0.35, topPos.z);
        constructGroup.add(tip);
        antennaTips.push({ mesh: tip, phase: x * 1.37 + y * 0.91 });
      }
    }
  }
}

function animateBlockRemoval(sel: [number, number][]) {
  sel.forEach(function (pos) {
    const bx = pos[0] ?? 0,
      by = pos[1] ?? 0;
    const stack = meshGrid[bx]?.[by];
    if (stack && stack.length > 0) {
      const obj = stack.pop();
      if (!obj) return;
      const clonedMat = (obj.mesh.material as THREE.MeshStandardMaterial).clone();
      clonedMat.transparent = true;
      obj.mesh.material = clonedMat;
      sceneAnims.push({
        type: "blockRise",
        mesh: obj.mesh,
        edge: obj.edge,
        clonedMat: clonedMat,
        vel: 0.015 + Math.random() * 0.025,
        rot: (Math.random() - 0.5) * 0.12,
        opacity: 1,
        t: 0,
      });
    }
  });
}

function spawnSignalRipples(sel: [number, number][], colorKey: ColKey) {
  sel.forEach(function (pos) {
    const bx = pos[0] ?? 0,
      by = pos[1] ?? 0;
    const curCount = meshGrid[bx]?.[by]?.length ?? 0;
    const wpos = gridToWorld(bx, by, curCount);
    const ringGeo2 = new THREE.RingGeometry(0.16, 0.22, 32);
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: COLORS_HEX[colorKey],
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring2 = new THREE.Mesh(ringGeo2, ringMat2);
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.copy(wpos);
    constructGroup.add(ring2);
    sceneAnims.push({
      type: "signalRing",
      mesh: ring2,
      mat: ringMat2,
      geo: ringGeo2,
      t: 0,
      duration: 0.9,
    });
  });
}

// ---- Player seats ----
const seatGroup = new THREE.Group();
tableGroup.add(seatGroup);
let seatMeshes: SeatEntry[] = [];

function buildSeats(n: number) {
  while (seatGroup.children.length > 0) {
    const child = seatGroup.children[0];
    if (child) seatGroup.remove(child);
    else break;
  }
  seatMeshes = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const dist = TABLE_RADIUS - 0.8;
    const x = Math.cos(angle) * dist,
      z = Math.sin(angle) * dist;

    const discGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.06, 16);
    const discMat = new THREE.MeshStandardMaterial({
      color: PLAYER_COLORS_HEX[i],
      emissive: PLAYER_COLORS_HEX[i],
      emissiveIntensity: 0.3,
      roughness: 0.4,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.set(x, 0.14, z);
    disc.receiveShadow = true;
    seatGroup.add(disc);

    const canvas2 = document.createElement("canvas");
    canvas2.width = 256;
    canvas2.height = 64;
    const rawCtx = canvas2.getContext("2d");
    if (!rawCtx) return;
    const ctx: CanvasRenderingContext2D = rawCtx;
    ctx.fillStyle = PLAYER_CSS[i] ?? "#ffffff";
    ctx.font = "bold 28px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    const name =
      S.playerNames[i] ?? (i === mySlot ? "YOU" : isSolo && i > 0 ? "CPU" : "P" + (i + 1));
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

canvas.addEventListener("pointerdown", function (ev) {
  if (ev.button !== 0) return;
  if (S.locked) return;
  const r = canvas.getBoundingClientRect();
  mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  mouse.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  // Only intersect block meshes in constructGroup
  const blockMeshes: THREE.Mesh[] = [];
  constructGroup.traverse(function (obj) {
    if (obj instanceof THREE.Mesh && obj.userData.gx !== undefined) blockMeshes.push(obj);
  });
  const hits = raycaster.intersectObjects(blockMeshes, false);
  if (!hits.length) return;

  const hit = hits[0];
  if (!hit) return;
  const obj = hit.object;
  const { gx, gy } = obj.userData as { gx: number; gy: number };
  // Only allow selecting top cube of each stack
  const stack = S.grid[gx]?.[gy] ?? [];
  if (stack.length === 0) return;
  const topZ = stack.length - 1;
  const topEntry = meshGrid[gx]?.[gy]?.[topZ];
  if (!topEntry || topEntry.mesh !== obj) return;

  toggleSel(gx, gy);
});

function toggleSel(x: number, y: number) {
  if (S.selectedCardIdx == null) {
    showMsg("Select a decode filter first.");
    return;
  }
  const i = S.selected.findIndex(function (s) {
    return s[0] === x && s[1] === y;
  });
  if (i >= 0) {
    S.selected.splice(i, 1);
  } else {
    const card = S.myHand[S.selectedCardIdx];
    if (!card) return;
    if (S.selected.length >= card.shape.cells.length) {
      showMsg("Filter saturated — clear to retarget.");
      return;
    }
    S.selected.push([x, y]);
  }
  showMsg("");
  updateHighlights();
}

// ---- Game logic ----
function topColor(x: number, y: number): ColKey | null {
  const stack = S.grid[x]?.[y] ?? [];
  return stack.length ? (stack[stack.length - 1] ?? null) : null;
}

function validates(sel: [number, number][], card: Card): boolean {
  if (sel.length !== card.shape.cells.length) return false;
  for (const pos of sel) {
    if (topColor(pos[0] ?? 0, pos[1] ?? 0) !== card.color) return false;
  }
  const norm = function (a: [number, number][]) {
    const mx = Math.min.apply(
      null,
      a.map(function (p) {
        return p[0] ?? 0;
      })
    );
    const my = Math.min.apply(
      null,
      a.map(function (p) {
        return p[1] ?? 0;
      })
    );
    return a
      .map(function (p) {
        return [(p[0] ?? 0) - mx, (p[1] ?? 0) - my] as [number, number];
      })
      .sort(function (a, b) {
        return (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0);
      });
  };
  const s = JSON.stringify(norm(sel));
  let cells: [number, number][] = card.shape.cells.slice() as [number, number][];
  for (let r = 0; r < 4; r++) {
    if (JSON.stringify(norm(cells)) === s) return true;
    cells = cells.map(function (c) {
      return [-(c[1] ?? 0), c[0] ?? 0] as [number, number];
    });
  }
  return false;
}

function generateGrid(): ColKey[][][] {
  const g: ColKey[][][] = [];
  for (let x = 0; x < W; x++) {
    const row: ColKey[][] = [];
    g[x] = row;
    for (let y = 0; y < H; y++) {
      const col: ColKey[] = [];
      for (let z = 0; z < D; z++) {
        col.push(COLKEYS[Math.floor(rand() * COLKEYS.length)] ?? "R");
      }
      row.push(col);
    }
  }
  return g;
}

function generateHand(): Card[] {
  const h: Card[] = [];
  const inits = new Set<number>();
  while (h.length < 5) {
    const init = 1 + Math.floor(rand() * MAX_INITIATIVE);
    if (inits.has(init)) continue;
    inits.add(init);
    const maxIdx = Math.min(SHAPES.length - 1, Math.floor(init / 4));
    h.push({
      init,
      shape: SHAPES[Math.floor(rand() * (maxIdx + 1))] ?? SHAPES[0],
      color: COLKEYS[Math.floor(rand() * COLKEYS.length)] ?? "R",
    } as Card);
  }
  return h.sort(function (a, b) {
    return a.init - b.init;
  });
}

function cpuFind(card: Card): [number, number][] | null {
  const tops: [number, number][] = [];
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++) {
      if (topColor(x, y) === card.color) tops.push([x, y]);
    }
  let cells: [number, number][] = card.shape.cells.slice() as [number, number][];
  for (let r = 0; r < 4; r++) {
    for (const anchor of tops) {
      const mx = Math.min.apply(
        null,
        cells.map(function (p) {
          return p[0] ?? 0;
        })
      );
      const my = Math.min.apply(
        null,
        cells.map(function (p) {
          return p[1] ?? 0;
        })
      );
      const placed: [number, number][] = cells.map(function (c) {
        return [(c[0] ?? 0) - mx + (anchor[0] ?? 0), (c[1] ?? 0) - my + (anchor[1] ?? 0)];
      });
      if (
        placed.every(function (p) {
          return (
            (p[0] ?? 0) >= 0 &&
            (p[0] ?? 0) < W &&
            (p[1] ?? 0) >= 0 &&
            (p[1] ?? 0) < H &&
            topColor(p[0] ?? 0, p[1] ?? 0) === card.color
          );
        })
      )
        return placed;
    }
    cells = cells.map(function (c) {
      return [-(c[1] ?? 0), c[0] ?? 0];
    });
  }
  return null;
}

function removeCubes(sel: [number, number][]) {
  for (const pos of sel) {
    const stack = HS.grid[pos[0] ?? 0]?.[pos[1] ?? 0];
    if (stack && stack.length) stack.pop();
  }
}

// ---- Turn resolution ----
function resolveTurn(moves: MoveResult[], gridAfter: ColKey[][][] | null) {
  // moves: array of { slot, card, sel, points }
  let delay = 0;

  moves.forEach(function (m: MoveResult) {
    const label = slotName(m.slot);
    setTimeout(function () {
      if (m.points > 0 && m.sel && m.card) {
        animateBlockRemoval(m.sel);
        spawnSignalRipples(m.sel, m.card.color);
        log(
          "✓ " +
            label +
            " Δ" +
            m.card.init +
            " decoded " +
            m.card.shape.name +
            " on " +
            COLOR_NAMES[m.card.color] +
            " — +" +
            m.sel.length,
          "ok"
        );
      } else if (m.card) {
        log("✗ " + label + " Δ" + m.card.init + " — channel silent. Signal lost.");
      } else {
        log("· " + label + " held carrier.");
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

function slotName(slot: number): string {
  if (slot === mySlot) return "You";
  return S.playerNames[slot] || (isSolo ? "CPU" : "P" + (slot + 1));
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
    const msg: RoundStartMsg = {
      type: "round-start",
      grid: HS.grid,
      hand: HS.hands[i] ?? [],
      turn: HS.turn,
      scores,
      playerCount: n,
      yourSlot: i,
      names: HS.playerNames,
    };
    if (i === 0) onRoundStart(msg);
    else sendTo(i, msg);
  }
}

function hostOnPick(slot: number, cardIdx: number, sel: [number, number][] | null) {
  HS.picks[slot] = { cardIdx, sel };

  // Notify other players that this slot has locked in
  const n = HS.N;
  for (let i = 0; i < n; i++) {
    if (i !== slot && i !== 0) sendTo(i, { type: "player-locked", slot });
  }
  if (slot !== 0) log("· " + (HS.playerNames[slot] || "P" + (slot + 1)) + " transmitted.");

  if (Object.keys(HS.picks).length === n) hostResolveTurn();
}

function hostResolveTurn() {
  const n = HS.N;
  const actions: Array<{
    slot: number;
    card: Card | null;
    sel: [number, number][] | null;
    init: number;
  }> = [];
  for (let i = 0; i < n; i++) {
    const pick = HS.picks[i];
    if (!pick || pick.cardIdx < 0) {
      actions.push({ slot: i, card: null, sel: null, init: Infinity });
    } else {
      const hand = HS.hands[i] ?? [];
      const card = hand[pick.cardIdx] ?? null;
      if (card) actions.push({ slot: i, card, sel: pick.sel, init: card.init });
      else actions.push({ slot: i, card: null, sel: null, init: Infinity });
    }
  }
  actions.sort(function (a, b) {
    return a.init - b.init || a.slot - b.slot;
  });

  const results: MoveResult[] = [];
  for (const act of actions) {
    if (!act.card) {
      results.push({ slot: act.slot, card: null, sel: null, points: 0 });
      continue;
    }
    // Validate and remove
    if (act.sel && validates(act.sel, act.card)) {
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
      if ((HS.scores[i] ?? 0) > best) {
        best = HS.scores[i] ?? 0;
        winnerSlot = i;
      }
    }
    let tiedCount = 0;
    for (let i = 0; i < n; i++) {
      if ((HS.scores[i] || 0) === best) tiedCount++;
    }
    if (tiedCount > 1) winnerSlot = WINNER_TIED;
  }
  const scores = [];
  for (let i = 0; i < n; i++) scores.push({ slot: i, score: HS.scores[i] || 0 });

  for (let j = 0; j < n; j++) {
    const msg = {
      type: "turn-result",
      results,
      grid: HS.grid,
      scores,
      turn: HS.turn,
      gameOver,
      winnerSlot,
      yourSlot: j,
      names: HS.playerNames,
    };
    if (j === 0) onTurnResult(msg);
    else sendTo(j, msg);
  }
  if (!gameOver) {
    setTimeout(function () {
      hostStartRound();
    }, 2400);
  }
}

// ---- Client-side handlers ----
type RoundStartMsg = {
  type: string;
  grid: ColKey[][][];
  hand: Card[];
  turn: number;
  scores: ScoreEntry[];
  playerCount: number;
  names: Record<number, string>;
  yourSlot: number;
};
type TurnResultMsg = {
  results: MoveResult[];
  grid: ColKey[][][];
  scores: ScoreEntry[];
  turn: number;
  gameOver: boolean;
  winnerSlot: number;
  yourSlot: number;
  names: Record<number, string>;
};

function onRoundStart(data: RoundStartMsg) {
  S.grid = JSON.parse(JSON.stringify(data.grid)) as ColKey[][][];
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
  if (data.turn === 1)
    log(
      "▶ Transmission detected. Select a filter card, then click matching tiles on the grid.",
      "ok"
    );
}

function onTurnResult(data: TurnResultMsg) {
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
      let msg: string;
      if (data.winnerSlot === WINNER_TIED) msg = "Signal split — tied transmission!";
      else if (data.winnerSlot === mySlot) msg = "You intercepted the transmission!";
      else msg = slotName(data.winnerSlot) + " intercepted the transmission.";
      const scoreText = data.scores
        .map(function (s) {
          return slotName(s.slot) + ": " + s.score;
        })
        .join("  |  ");
      log("━━ CARRIER LOST — " + msg + " ━━", "ok");
      log(scoreText);
      showMsg(msg, "ok");
    }, totalDelay);
  }
}

// ---- Networking ----
function sendTo(slot: number, data: unknown) {
  const conn = conns[slot];
  if (isHost && conn && conn.open) conn.send(data);
}
function sendToHost(data: unknown) {
  if (isHost) return;
  const conn = conns[0];
  if (conn && conn.open) conn.send(data);
}

function onMessage(data: unknown, fromSlot: number) {
  const msg = data as GameMsg;
  if (msg.type === "round-start") onRoundStart(msg as unknown as RoundStartMsg);
  else if (msg.type === "turn-result") onTurnResult(msg as unknown as TurnResultMsg);
  else if (msg.type === "player-locked") {
    log("· " + slotName(msg.slot as number) + " transmitted.");
  } else if (msg.type === "pick" && isHost) {
    hostOnPick(fromSlot, msg.cardIdx as number, msg.sel as [number, number][] | null);
  }
}

// ---- UI rendering ----
function $e(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

function renderUI() {
  const chipsEl = $e("score-chips");
  chipsEl.innerHTML = "";
  (S.allScores || []).forEach(function (s) {
    const el = document.createElement("span");
    el.className = "score-chip" + (s.slot === mySlot ? " me" : "");
    el.style.borderColor = PLAYER_CSS[s.slot] ?? "";
    el.style.color = PLAYER_CSS[s.slot] ?? "";
    el.textContent = slotName(s.slot) + ": " + s.score;
    chipsEl.appendChild(el);
  });

  const handEl = $e("player-hand");
  handEl.innerHTML = "";
  (S.myHand || []).forEach(function (card, idx) {
    const el = document.createElement("div");
    el.className = "card" + (S.selectedCardIdx === idx ? " selected" : "");
    if (!S.locked)
      el.onclick = function () {
        selectCard(idx);
      };
    el.style.borderColor = COLORS_CSS[card.color];

    const num = document.createElement("div");
    num.className = "card-num";
    num.textContent = "Δ" + card.init;
    el.appendChild(num);

    const label = document.createElement("div");
    label.className = "card-label";
    label.textContent = card.shape.name;
    el.appendChild(label);

    const mg = document.createElement("div");
    mg.className = "mini-grid";
    const mx =
      Math.max.apply(
        null,
        card.shape.cells.map(function (p) {
          return p[0] ?? 0;
        })
      ) + 1;
    const my =
      Math.max.apply(
        null,
        card.shape.cells.map(function (p) {
          return p[1] ?? 0;
        })
      ) + 1;
    mg.style.gridTemplateColumns = "repeat(" + mx + ", 12px)";
    for (let dy = 0; dy < my; dy++)
      for (let dx = 0; dx < mx; dx++) {
        const dot = document.createElement("div");
        dot.className = "mini-dot";
        if (
          card.shape.cells.some(function (p) {
            return p[0] === dx && p[1] === dy;
          })
        ) {
          dot.classList.add("active");
          dot.style.backgroundColor = COLORS_CSS[card.color];
        }
        mg.appendChild(dot);
      }
    el.appendChild(mg);
    handEl.appendChild(el);
  });

  $e("round-num").innerText = String(S.turn);

  const confirmBtn = $e("resolve-btn") as HTMLButtonElement;
  confirmBtn.disabled = S.locked || S.selectedCardIdx == null || S.selected.length === 0;

  updateHighlights();
}

function selectCard(idx: number) {
  if (!S.locked) {
    S.selectedCardIdx = idx;
    S.selected = [];
    renderUI();
  }
}

function updateHighlights() {
  if (!meshGrid.length) return;
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++) {
      const stack: ColKey[] = S.grid[x]?.[y] ?? [];
      if (!stack.length) continue;
      const topZ = stack.length - 1;
      const entry = meshGrid[x]?.[y]?.[topZ];
      if (!entry) continue;
      const sel = S.selected.some(function (s) {
        return s[0] === x && s[1] === y;
      });
      const mat = entry.mesh.material as THREE.MeshStandardMaterial;
      if (sel) {
        mat.emissive.setHex(0xffffff);
        mat.emissiveIntensity = 0.6;
      } else {
        const colorKey: ColKey = stack[topZ] ?? "R";
        mat.emissive.setHex(COLORS_HEX[colorKey]);
        mat.emissiveIntensity = 0;
      }
    }
}

function log(msg: string, cls?: string) {
  const el = document.getElementById("log-panel");
  if (!el) return;
  const d = document.createElement("div");
  if (cls === "ok") d.style.color = "#8dff9d";
  else if (cls === "bad") d.style.color = "#ff6b6b";
  d.textContent = msg;
  el.prepend(d);
}
function showMsg(m: string, cls?: string) {
  const el = document.getElementById("msg-bar");
  if (!el) return;
  el.textContent = m;
  el.className = "msg-bar" + (cls ? " " + cls : "");
}
function showWait(show: boolean) {
  document.getElementById("wait-banner")?.classList.toggle("hidden", !show);
}

// ---- Lobby / PeerJS ----
function updatePlayerList() {
  const el = document.getElementById("player-list");
  if (!el) return;
  el.innerHTML = "";
  HS.playerIds.forEach(function (id, i) {
    const div = document.createElement("div");
    div.className = i === 0 ? "you" : "";
    const name = HS.playerNames[i] ?? (i === 0 ? "You (Host)" : "Player " + (i + 1));
    div.textContent = (i === 0 ? "★ " : "") + name + (i === 0 ? "" : " — connected");
    div.style.color = PLAYER_CSS[i] ?? "";
    el.appendChild(div);
  });
  const lobbyStatus = document.getElementById("lobby-status");
  if (lobbyStatus)
    lobbyStatus.textContent = HS.playerIds.length + "/" + MAX_PLAYERS + " operators tuned in.";
  const startBtn = document.getElementById("start-btn") as HTMLButtonElement | null;
  if (startBtn) startBtn.disabled = HS.playerIds.length < 2;
}

function startGame() {
  document.getElementById("lobby")?.classList.add("hidden");
  document.getElementById("ui-overlay")?.classList.remove("hidden");
}

type DeconWin = Window &
  typeof globalThis & {
    soloGame: () => void;
    hostGame: () => void;
    hostStartNow: () => void;
    joinGame: () => void;
    onPickCard: () => void;
    onClear: () => void;
    onPass: () => void;
  };
const dw = window as DeconWin;

// Solo mode
dw.soloGame = function () {
  isSolo = true;
  isHost = true;
  mySlot = 0;
  HS.playerIds = ["host", "cpu"];
  HS.scores = { 0: 0, 1: 0 };
  HS.playerNames = { 0: "You", 1: "CPU" };
  HS.N = 2;
  HS.turn = 1;
  HS.started = true;
  conns = [null, null];
  S.playerNames = HS.playerNames;

  startGame();
  hostStartRound();
};

dw.hostGame = function () {
  roomCode = makeCode();
  isHost = true;
  isSolo = false;
  mySlot = 0;
  HS.playerIds = ["host"];
  HS.scores = { 0: 0 };
  HS.playerNames = { 0: "You" };
  HS.N = 1;
  HS.turn = 1;
  HS.started = false;
  conns = [null];

  const lobbyMenu = document.getElementById("lobby-menu");
  const lobbyWaiting = document.getElementById("lobby-waiting");
  const roomCodeShow = document.getElementById("room-code-show");
  if (lobbyMenu) lobbyMenu.style.display = "none";
  if (lobbyWaiting) lobbyWaiting.style.display = "block";
  if (roomCodeShow) roomCodeShow.textContent = roomCode;
  updatePlayerList();

  peer = new Peer(PEER_PREFIX + roomCode);
  peer.on("open", function () {
    const lobbyStatus = document.getElementById("lobby-status");
    if (lobbyStatus)
      lobbyStatus.textContent =
        "Broadcasting — awaiting operators (" + HS.playerIds.length + "/" + MAX_PLAYERS + ")";
  });
  peer.on("connection", function (c) {
    if (HS.started || HS.playerIds.length >= MAX_PLAYERS) {
      c.close();
      return;
    }
    const slot = HS.playerIds.length;
    HS.playerIds.push(c.peer);
    HS.scores[slot] = 0;
    HS.playerNames[slot] = "P" + (slot + 1);
    conns[slot] = c;
    c.on("open", function () {
      c.send({ type: "slot-assign", slot });
      updatePlayerList();
    });
    c.on("data", function (data: unknown) {
      const msg = data as GameMsg;
      if (msg.type === "name") {
        HS.playerNames[slot] =
          ((msg.name as string | undefined) ?? "").slice(0, 16) || "P" + (slot + 1);
        updatePlayerList();
      } else {
        onMessage(data, slot);
      }
    });
    c.on("close", function () {
      if (!HS.started) {
        HS.playerIds.splice(slot, 1);
        conns.splice(slot, 1);
        HS.scores = Object.fromEntries(
          Object.entries(HS.scores).filter(([k]) => k !== String(slot))
        );
        HS.playerNames = Object.fromEntries(
          Object.entries(HS.playerNames).filter(([k]) => k !== String(slot))
        );
        updatePlayerList();
      }
    });
  });
  peer.on("error", function (err) {
    const lobbyStatus = document.getElementById("lobby-status");
    if (lobbyStatus) lobbyStatus.textContent = "Error: " + err.type;
  });
};

dw.hostStartNow = function () {
  if (HS.playerIds.length < 2) return;
  HS.started = true;
  HS.N = HS.playerIds.length;
  for (let i = 1; i < HS.N; i++) {
    sendTo(i, { type: "game-start", playerCount: HS.N, names: HS.playerNames });
  }
  startGame();
  hostStartRound();
};

dw.joinGame = function () {
  const joinCodeEl = document.getElementById("join-code") as HTMLInputElement | null;
  const code = (joinCodeEl?.value ?? "").toUpperCase().trim();
  if (!code || code.length < 3) return;
  roomCode = code;
  isHost = false;
  isSolo = false;

  const lobbyMenu = document.getElementById("lobby-menu");
  const lobbyJoining = document.getElementById("lobby-joining");
  const joinStatus = document.getElementById("join-status");
  if (lobbyMenu) lobbyMenu.style.display = "none";
  if (lobbyJoining) lobbyJoining.style.display = "block";
  if (joinStatus) joinStatus.textContent = "Locking onto " + roomCode + "…";

  peer = new Peer();
  peer.on("open", function () {
    if (!peer) return;
    const c = peer.connect(PEER_PREFIX + roomCode, { reliable: true });
    conns = [c];
    c.on("open", function () {
      const js = document.getElementById("join-status");
      if (js) js.textContent = "Signal locked. Awaiting transmission…";
    });
    c.on("data", function (data: unknown) {
      const msg = data as GameMsg;
      if (msg.type === "slot-assign") {
        mySlot = msg.slot as number;
      } else if (msg.type === "game-start") {
        S.playerCount = msg.playerCount as number;
        S.playerNames = (msg.names as Record<number, string>) || {};
        startGame();
      } else {
        onMessage(data, 0);
      }
    });
    c.on("close", function () {
      showMsg("Host disconnected.", "bad");
    });
  });
  peer.on("error", function (err) {
    const js = document.getElementById("join-status");
    if (js) js.textContent = "Failed: " + err.type + ". Check the code.";
  });
};

dw.onPickCard = function () {
  if (S.locked || S.selectedCardIdx == null) return;
  const card = S.myHand[S.selectedCardIdx];
  if (!card || !validates(S.selected, card)) {
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
    const cpuHand = HS.hands[1] ?? [];
    const ci = Math.floor(rand() * cpuHand.length);
    const cpuCard = cpuHand[ci];
    const cpuSel = cpuCard ? cpuFind(cpuCard) : null;
    if (cpuSel) {
      hostOnPick(1, ci, cpuSel);
    } else {
      hostOnPick(1, -1, null);
    }
  } else if (isHost) {
    hostOnPick(0, cardIdx, sel);
    showWait(true);
  } else {
    sendToHost({ type: "pick", cardIdx, sel });
    showWait(true);
  }
};

dw.onClear = function () {
  S.selected = [];
  updateHighlights();
  renderUI();
};

dw.onPass = function () {
  if (S.locked) return;
  S.locked = true;
  renderUI();

  if (isSolo) {
    hostOnPick(0, -1, null);
    const cpuHand = HS.hands[1] ?? [];
    const ci = Math.floor(rand() * cpuHand.length);
    const cpuCard = cpuHand[ci];
    const cpuSel = cpuCard ? cpuFind(cpuCard) : null;
    if (cpuSel) {
      hostOnPick(1, ci, cpuSel);
    } else {
      hostOnPick(1, -1, null);
    }
  } else if (isHost) {
    hostOnPick(0, -1, null);
    showWait(true);
  } else {
    sendToHost({ type: "pick", cardIdx: -1, sel: null });
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
    if (!a) continue;
    a.t += dt;

    if (a.type === "blockRise") {
      a.mesh.position.y += a.vel * 60 * dt;
      a.mesh.rotation.x += a.rot;
      a.mesh.rotation.z += a.rot * 0.7;
      a.edge.position.copy(a.mesh.position);
      a.edge.rotation.copy(a.mesh.rotation);
      a.opacity -= dt * 1.0;
      a.clonedMat.opacity = Math.max(0, a.opacity);
      (a.edge.material as THREE.LineBasicMaterial).opacity = Math.max(0, a.opacity * 0.2);
      if (a.opacity <= 0) {
        constructGroup.remove(a.mesh);
        constructGroup.remove(a.edge);
        a.clonedMat.dispose();
        sceneAnims.splice(i, 1);
      }
    } else if (a.type === "signalRing") {
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
    if (s.disc)
      (s.disc.material as THREE.MeshStandardMaterial).emissiveIntensity =
        0.2 + Math.sin(Date.now() * 0.003 + i) * 0.1;
  });

  // Antenna tip pulse
  const tNow = Date.now() * 0.004;
  antennaTips.forEach(function (a) {
    (a.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity =
      0.55 + Math.sin(tNow + a.phase) * 0.45;
  });

  // Selection pulse
  if (S.selected && S.selected.length) {
    const pulseT = Date.now() * 0.005;
    for (const pos of S.selected) {
      const stack: ColKey[] = S.grid[pos[0] ?? 0]?.[pos[1] ?? 0] ?? [];
      if (!stack.length) continue;
      const topZ = stack.length - 1;
      const entry = meshGrid[pos[0] ?? 0]?.[pos[1] ?? 0]?.[topZ];
      if (entry)
        (entry.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity =
          0.4 + 0.3 * Math.sin(pulseT);
    }
  }

  // Radar sweep
  sweepGroup.rotation.y += dt * 0.7;

  renderer.render(scene, camera);
}

window.addEventListener("resize", function () {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
