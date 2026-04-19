<script lang="ts">
  import { T, useThrelte, useTask } from "@threlte/core";
  import * as THREE from "three";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { gs } from "./gameState.svelte.js";
  import type { PlayerSnap, TrackVariant } from "./types.js";
  import {
    LANE_COUNT,
    LANE_WIDTH,
    centerlineSlope,
    centerlineX,
    getTrackVariant,
    laneToX,
    worldPosForLane,
  } from "./types.js";

  const { renderer, scene } = useThrelte();
  const TRACK_HALF_WIDTH = (LANE_COUNT * LANE_WIDTH) / 2;
  const TRACK_SEGMENTS = 48;

  const activeVariant = $derived(getTrackVariant(gs.snapshot?.trackId ?? gs.activeTrackId));

  $effect(() => {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    scene.background = new THREE.Color(activeVariant.fogColor);
    scene.fog = new THREE.Fog(activeVariant.fogColor, activeVariant.fogNear, activeVariant.fogFar);
  });

  let pulseT = $state(0);
  let camX = 0;
  let camY = 5.2;
  let camZ = -7.5;
  let lookX = 0;
  let lookY = 0.8;
  let lookZ = 6;
  let cameraRef = $state<THREE.PerspectiveCamera>(new THREE.PerspectiveCamera());

  interface Smoothed {
    z: number;
    laneX: number;
    boostUntil: number;
    burstUntil: number;
    slowUntil: number;
  }
  interface RenderedPlayer extends PlayerSnap {
    renderZ: number;
    renderLaneX: number;
    worldX: number;
    worldZ: number;
    angleY: number;
  }
  const smoothed = new SvelteMap<number, Smoothed>();
  let renderedPlayers = $state<RenderedPlayer[]>([]);

  const currentSnapshot = $derived(gs.snapshot);

  function colorToHex(css: string): number {
    if (css.startsWith("#")) return parseInt(css.slice(1), 16);
    return 0xffffff;
  }

  // Host speed approximation for client-side extrapolation; mirrors main.ts speedFor().
  const BASE = 14;
  const NOISE = 0.35;
  const AMP = 24;
  const BURST = 34;
  function estimateSpeed(p: PlayerSnap, now: number): number {
    if (now < p.burstUntil) return BURST;
    if (now < p.boostUntil) return AMP;
    let s = BASE;
    if (now < p.slowUntil) s *= NOISE;
    return s;
  }

  useTask((dt) => {
    pulseT += dt;
    const snap = gs.snapshot;
    const variant = activeVariant;

    if (snap) {
      const lerpZ = Math.min(1, dt * 18);
      const lerpLane = Math.min(1, dt * 14);
      const next: RenderedPlayer[] = [];
      const activeSlots = new SvelteSet<number>();
      for (const p of snap.players) {
        activeSlots.add(p.slot);
        const laneXTarget = laneToX(p.lane);
        let s = smoothed.get(p.slot);
        if (!s) {
          s = {
            z: p.z,
            laneX: laneXTarget,
            boostUntil: p.boostUntil,
            burstUntil: p.burstUntil,
            slowUntil: p.slowUntil,
          };
          smoothed.set(p.slot, s);
        }
        const gapBudget = 1 / 15;
        const lookaheadZ =
          p.finished || snap.countdown > 0 ? p.z : p.z + estimateSpeed(p, snap.t) * gapBudget;
        s.z += (lookaheadZ - s.z) * lerpZ;
        if (s.z > snap.trackLength) s.z = snap.trackLength;
        if (s.z < p.z - 0.5) s.z = p.z - 0.5;
        s.laneX += (laneXTarget - s.laneX) * lerpLane;
        s.boostUntil = p.boostUntil;
        s.burstUntil = p.burstUntil;
        s.slowUntil = p.slowUntil;
        const wp = worldPosForLane(s.z, s.laneX, variant);
        next.push({
          ...p,
          renderZ: s.z,
          renderLaneX: s.laneX,
          worldX: wp.x,
          worldZ: wp.z,
          angleY: wp.angleY,
        });
      }
      for (const slot of smoothed.keys()) if (!activeSlots.has(slot)) smoothed.delete(slot);
      renderedPlayers = next;
    } else if (renderedPlayers.length > 0) {
      renderedPlayers = [];
      smoothed.clear();
    }

    // Camera: follow curve tangent for a proper chase cam on bends.
    let targetCamX: number;
    let targetCamY: number;
    let targetCamZ: number;
    let targetLookX: number;
    let targetLookY: number;
    let targetLookZ: number;
    const me = renderedPlayers.find((p) => p.slot === gs.mySlot);
    if (me) {
      const behind = worldPosForLane(me.renderZ - 7.5, me.renderLaneX, variant);
      const ahead = worldPosForLane(me.renderZ + 6, me.renderLaneX, variant);
      targetCamX = behind.x;
      targetCamY = 5.2;
      targetCamZ = behind.z;
      targetLookX = ahead.x;
      targetLookY = 0.8;
      targetLookZ = ahead.z;
    } else {
      const overviewZ = variant.trackLength * 0.25;
      const overview = worldPosForLane(overviewZ, 0, variant);
      targetCamX = overview.x;
      targetCamY = 14;
      targetCamZ = overview.z - 28;
      targetLookX = overview.x;
      targetLookY = 0;
      targetLookZ = overview.z;
    }
    const easePos = Math.min(1, dt * 6);
    const easeLook = Math.min(1, dt * 6);
    camX += (targetCamX - camX) * easePos;
    camY += (targetCamY - camY) * easePos;
    camZ += (targetCamZ - camZ) * easePos;
    lookX += (targetLookX - lookX) * easeLook;
    lookY += (targetLookY - lookY) * easeLook;
    lookZ += (targetLookZ - lookZ) * easeLook;

    if (cameraRef) {
      cameraRef.position.set(camX, camY, camZ);
      cameraRef.lookAt(lookX, lookY, lookZ);
    }
  });

  interface RailSegment {
    id: number;
    x: number;
    z: number;
    angleY: number;
    length: number;
  }
  interface MarkerSegment {
    id: number;
    x: number;
    z: number;
    angleY: number;
  }
  interface PropItem {
    id: number;
    x: number;
    z: number;
    angleY: number;
    side: number;
  }
  interface ArchItem {
    id: number;
    x: number;
    z: number;
    angleY: number;
  }
  interface DividerGeo {
    id: number;
    geo: THREE.BufferGeometry;
    edge: boolean;
  }
  interface TrackGeoSet {
    track: THREE.BufferGeometry;
    dividers: DividerGeo[];
  }

  /**
   * Build a flat XZ ribbon geometry that follows the variant's centerline.
   * laneX is the offset from the centerline; thickness is the strip width.
   */
  function buildStrip(v: TrackVariant, laneX: number, thickness: number): THREE.BufferGeometry {
    const n = 160;
    const half = thickness / 2;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const z = t * v.trackLength;
      const slope = centerlineSlope(z, v);
      const cx = centerlineX(z, v);
      const invLen = 1 / Math.sqrt(1 + slope * slope);
      const nx = invLen;
      const nz = -slope * invLen;
      positions.push(cx + (laneX - half) * nx, 0, z + (laneX - half) * nz);
      uvs.push(0, t);
      positions.push(cx + (laneX + half) * nx, 0, z + (laneX + half) * nz);
      uvs.push(1, t);
      if (i < n) {
        const b = i * 2;
        // CCW winding when viewed from +Y so normals point up.
        indices.push(b, b + 2, b + 1);
        indices.push(b + 1, b + 2, b + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  // Intentionally non-reactive: this cache is populated from inside $derived,
  // which a SvelteMap would reject as state_unsafe_mutation.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const trackGeoCache = new Map<string, TrackGeoSet>();
  function getTrackGeos(v: TrackVariant): TrackGeoSet {
    let cached = trackGeoCache.get(v.id);
    if (!cached) {
      const trackWidth = LANE_COUNT * LANE_WIDTH;
      const track = buildStrip(v, 0, trackWidth);
      const dividers: DividerGeo[] = [];
      for (let i = 0; i <= LANE_COUNT; i += 1) {
        const laneX = -trackWidth / 2 + i * LANE_WIDTH;
        const edge = i === 0 || i === LANE_COUNT;
        dividers.push({ id: i, geo: buildStrip(v, laneX, edge ? 0.12 : 0.05), edge });
      }
      cached = { track, dividers };
      trackGeoCache.set(v.id, cached);
    }
    return cached;
  }

  function buildRailSegments(v: TrackVariant): RailSegment[] {
    const out: RailSegment[] = [];
    const n = TRACK_SEGMENTS;
    const L = v.trackLength;
    for (let i = 0; i < n; i += 1) {
      const z0 = (i * L) / n;
      const z1 = ((i + 1) * L) / n;
      const mid = (z0 + z1) / 2;
      const pos = worldPosForLane(mid, 0, v);
      const dz = z1 - z0;
      const arc = dz / Math.cos(pos.angleY);
      out.push({ id: i, x: pos.x, z: pos.z, angleY: pos.angleY, length: arc * 1.08 });
    }
    return out;
  }

  function buildMarkers(v: TrackVariant): MarkerSegment[] {
    const out: MarkerSegment[] = [];
    const stride = 20;
    let id = 0;
    for (let z = stride; z < v.trackLength; z += stride) {
      const pos = worldPosForLane(z, 0, v);
      out.push({ id: id++, x: pos.x, z: pos.z, angleY: pos.angleY });
    }
    return out;
  }

  function buildProps(v: TrackVariant): PropItem[] {
    const out: PropItem[] = [];
    let id = 0;
    const offset = TRACK_HALF_WIDTH + v.propOffset;
    for (let z = 4; z < v.trackLength - 4; z += v.propStride) {
      for (const side of [-1, 1]) {
        const pos = worldPosForLane(z, side * offset, v);
        out.push({ id: id++, x: pos.x, z: pos.z, angleY: pos.angleY, side });
      }
    }
    return out;
  }

  function buildArches(v: TrackVariant): ArchItem[] {
    const out: ArchItem[] = [];
    let id = 0;
    for (let z = v.archStride; z < v.trackLength - v.archStride * 0.5; z += v.archStride) {
      const pos = worldPosForLane(z, 0, v);
      out.push({ id: id++, x: pos.x, z: pos.z, angleY: pos.angleY });
    }
    return out;
  }

  const trackGeos = $derived(getTrackGeos(activeVariant));
  const railSegments = $derived(buildRailSegments(activeVariant));
  const markerSegments = $derived(buildMarkers(activeVariant));
  const trackProps = $derived(buildProps(activeVariant));
  const trackArches = $derived(buildArches(activeVariant));
  const startPos = $derived(worldPosForLane(0, 0, activeVariant));
  const finishPos = $derived(worldPosForLane(activeVariant.trackLength, 0, activeVariant));
</script>

<T.PerspectiveCamera bind:ref={cameraRef} makeDefault fov={62} near={0.1} far={500} />

<T.AmbientLight color={0x2a3860} intensity={0.55} />
<T.DirectionalLight
  color={0xbfe0ff}
  intensity={1.1}
  position={[6, 22, -4]}
  castShadow
  shadow.mapSize.width={1024}
  shadow.mapSize.height={1024}
  shadow.camera.near={1}
  shadow.camera.far={80}
  shadow.camera.left={-30}
  shadow.camera.right={30}
  shadow.camera.top={30}
  shadow.camera.bottom={-30}
/>
<T.HemisphereLight args={[0x3344aa, 0x050510, 0.4]} />

<!-- Continuous curved track surface -->
<T.Mesh receiveShadow geometry={trackGeos.track}>
  <T.MeshStandardMaterial
    color={activeVariant.trackColor}
    roughness={0.6}
    metalness={0.2}
    side={THREE.DoubleSide}
  />
</T.Mesh>

<!-- Lane dividers (continuous ribbons, raised slightly to avoid z-fighting) -->
{#each trackGeos.dividers as divider (divider.id)}
  <T.Mesh position.y={0.025} geometry={divider.geo}>
    <T.MeshBasicMaterial
      color={activeVariant.railColor}
      transparent
      opacity={divider.edge ? 0.9 : 0.32}
      depthWrite={false}
      side={THREE.DoubleSide}
    />
  </T.Mesh>
{/each}

<!-- Side rails: segmented raised boxes with slight overlap for continuity -->
{#each railSegments as seg (seg.id)}
  <T.Group position={[seg.x, 0, seg.z]} rotation.y={seg.angleY}>
    {#each [-1, 1] as side (side)}
      <T.Mesh position={[side * (TRACK_HALF_WIDTH + 0.25), 0.32, 0]}>
        <T.BoxGeometry args={[0.2, 0.6, seg.length]} />
        <T.MeshStandardMaterial
          color={activeVariant.accentColor}
          emissive={activeVariant.railColor}
          emissiveIntensity={0.6}
          roughness={0.25}
          metalness={0.2}
        />
      </T.Mesh>
    {/each}
  </T.Group>
{/each}

<!-- Distance markers across the track -->
{#each markerSegments as m (m.id)}
  <T.Group position={[m.x, 0.025, m.z]} rotation.y={m.angleY}>
    <T.Mesh rotation.x={-Math.PI / 2}>
      <T.PlaneGeometry args={[LANE_COUNT * LANE_WIDTH * 0.95, 0.12]} />
      <T.MeshBasicMaterial
        color={activeVariant.railColor}
        transparent
        opacity={0.35 + Math.abs(Math.sin(pulseT * 2 + m.id * 0.3)) * 0.25}
        depthWrite={false}
      />
    </T.Mesh>
  </T.Group>
{/each}

<!-- Overhead arches (true half-torus) every archStride -->
{#each trackArches as arch (arch.id)}
  <T.Group position={[arch.x, 0.1, arch.z]} rotation.y={arch.angleY}>
    <T.Mesh>
      <T.TorusGeometry args={[TRACK_HALF_WIDTH + 0.6, 0.14, 12, 40, Math.PI]} />
      <T.MeshStandardMaterial
        color={activeVariant.archColor}
        emissive={activeVariant.archColor}
        emissiveIntensity={0.7 + Math.sin(pulseT * 3 + arch.id) * 0.3}
        roughness={0.2}
        metalness={0.35}
      />
    </T.Mesh>
    <T.Mesh position={[0, 0.15, 0]}>
      <T.BoxGeometry args={[TRACK_HALF_WIDTH * 2, 0.04, 0.04]} />
      <T.MeshBasicMaterial
        color={activeVariant.archColor}
        transparent
        opacity={0.55}
        depthWrite={false}
      />
    </T.Mesh>
  </T.Group>
{/each}

<!-- Side props (per-variant silhouette) -->
{#each trackProps as prop (prop.id)}
  <T.Group position={[prop.x, 0, prop.z]} rotation.y={prop.angleY}>
    {#if activeVariant.propStyle === "antenna"}
      <T.Mesh position={[0, 1.4, 0]}>
        <T.CylinderGeometry args={[0.04, 0.06, 2.8, 8]} />
        <T.MeshStandardMaterial
          color={activeVariant.accentColor}
          emissive={activeVariant.propColor}
          emissiveIntensity={0.2}
          roughness={0.5}
        />
      </T.Mesh>
      <T.Mesh position={[0, 2.9, 0]}>
        <T.SphereGeometry args={[0.11, 10, 10]} />
        <T.MeshStandardMaterial
          color={activeVariant.propColor}
          emissive={activeVariant.propColor}
          emissiveIntensity={0.9 + Math.sin(pulseT * 4 + prop.id) * 0.25}
        />
      </T.Mesh>
    {:else if activeVariant.propStyle === "crystal"}
      <T.Mesh position={[0, 0.9, 0]} rotation.y={prop.id * 0.5}>
        <T.ConeGeometry args={[0.45, 1.8, 4]} />
        <T.MeshStandardMaterial
          color={activeVariant.propColor}
          emissive={activeVariant.propColor}
          emissiveIntensity={0.55 + Math.abs(Math.sin(pulseT * 2.5 + prop.id * 0.6)) * 0.45}
          roughness={0.15}
          metalness={0.4}
        />
      </T.Mesh>
      <T.Mesh position={[0, 0.15, 0]}>
        <T.BoxGeometry args={[0.55, 0.12, 0.55]} />
        <T.MeshStandardMaterial color={activeVariant.accentColor} roughness={0.6} />
      </T.Mesh>
    {:else if activeVariant.propStyle === "ring"}
      <T.Mesh position={[0, 1.6, 0]} rotation.z={Math.PI / 2} rotation.y={pulseT * 0.6}>
        <T.TorusGeometry args={[0.55, 0.07, 10, 28]} />
        <T.MeshStandardMaterial
          color={activeVariant.propColor}
          emissive={activeVariant.propColor}
          emissiveIntensity={0.7 + Math.sin(pulseT * 3 + prop.id) * 0.3}
          roughness={0.2}
        />
      </T.Mesh>
      <T.Mesh position={[0, 0.8, 0]}>
        <T.CylinderGeometry args={[0.05, 0.07, 1.6, 8]} />
        <T.MeshStandardMaterial color={activeVariant.accentColor} roughness={0.6} />
      </T.Mesh>
    {:else}
      <T.Mesh position={[0, 2.2, 0]}>
        <T.BoxGeometry args={[0.45, 4.4, 0.45]} />
        <T.MeshStandardMaterial
          color={activeVariant.accentColor}
          emissive={activeVariant.propColor}
          emissiveIntensity={0.12}
          roughness={0.6}
        />
      </T.Mesh>
      <T.Mesh position={[0, 4.45, 0]}>
        <T.SphereGeometry args={[0.18, 12, 12]} />
        <T.MeshStandardMaterial
          color={activeVariant.propColor}
          emissive={activeVariant.propColor}
          emissiveIntensity={0.8 + Math.sin(pulseT * 2 + prop.id * 0.7) * 0.35}
        />
      </T.Mesh>
    {/if}
  </T.Group>
{/each}

<!-- Start line, curve-aligned -->
<T.Group position={[startPos.x, 0.035, startPos.z]} rotation.y={startPos.angleY}>
  <T.Mesh rotation.x={-Math.PI / 2}>
    <T.PlaneGeometry args={[LANE_COUNT * LANE_WIDTH, 0.7]} />
    <T.MeshBasicMaterial
      color={activeVariant.railColor}
      transparent
      opacity={0.9}
      depthWrite={false}
    />
  </T.Mesh>
</T.Group>

<!-- Finish arch: half-torus standing on the track, curve-aligned -->
<T.Group position={[finishPos.x, 0.1, finishPos.z]} rotation.y={finishPos.angleY}>
  <T.Mesh position={[0, -0.06, 0]} rotation.x={-Math.PI / 2}>
    <T.PlaneGeometry args={[LANE_COUNT * LANE_WIDTH, 1.0]} />
    <T.MeshBasicMaterial color={0xff7ccf} transparent opacity={0.95} depthWrite={false} />
  </T.Mesh>
  <T.Mesh>
    <T.TorusGeometry args={[TRACK_HALF_WIDTH + 0.5, 0.2, 16, 48, Math.PI]} />
    <T.MeshStandardMaterial
      color={0xff7ccf}
      emissive={0xff7ccf}
      emissiveIntensity={1.05 + Math.sin(pulseT * 4) * 0.25}
      roughness={0.18}
      metalness={0.3}
    />
  </T.Mesh>
  <T.Mesh position={[0, 1.6, 0]}>
    <T.BoxGeometry args={[TRACK_HALF_WIDTH * 1.6, 0.18, 0.06]} />
    <T.MeshStandardMaterial color={0xff7ccf} emissive={0xff7ccf} emissiveIntensity={0.75} />
  </T.Mesh>
  <T.PointLight color={0xff7ccf} intensity={2.5} distance={14} decay={2} position={[0, 3, 0]} />
</T.Group>

{#if currentSnapshot}
  {@const snap = currentSnapshot}
  <!-- Obstacles -->
  {#each snap.obstacles as obs (obs.id)}
    {@const ox = laneToX(obs.lane)}
    {@const wp = worldPosForLane(obs.z, ox, activeVariant)}
    {#if obs.kind === "amp"}
      <T.Group position={[wp.x, 0.6, wp.z]} rotation.y={wp.angleY}>
        <T.Mesh rotation.y={pulseT * 1.4}>
          <T.OctahedronGeometry args={[0.42]} />
          <T.MeshStandardMaterial
            color={0x8dff9d}
            emissive={0x8dff9d}
            emissiveIntensity={0.95 + Math.sin(pulseT * 6 + obs.id) * 0.35}
            roughness={0.2}
          />
        </T.Mesh>
        <T.Mesh rotation.x={-Math.PI / 2} position={[0, -0.55, 0]}>
          <T.RingGeometry args={[0.5, 0.6, 24]} />
          <T.MeshBasicMaterial
            color={0x8dff9d}
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </T.Mesh>
        <T.PointLight color={0x8dff9d} intensity={0.9} distance={4} decay={2} />
      </T.Group>
    {:else}
      <T.Group position={[wp.x, 0.45, wp.z]} rotation.y={wp.angleY}>
        {#each [0, 1, 2] as i (i)}
          <T.Mesh
            position={[0, i * 0.32, 0]}
            rotation.z={Math.sin(pulseT * 10 + obs.id + i) * 0.35}
          >
            <T.BoxGeometry args={[1.0, 0.06, 0.3]} />
            <T.MeshStandardMaterial
              color={0xff4fa0}
              emissive={0xff7ccf}
              emissiveIntensity={0.8 + Math.sin(pulseT * 12 + obs.id + i) * 0.3}
              roughness={0.3}
            />
          </T.Mesh>
        {/each}
        <T.Mesh position={[0, 0.4, 0]}>
          <T.SphereGeometry args={[0.1, 10, 10]} />
          <T.MeshBasicMaterial color={0xff7ccf} transparent opacity={0.8} />
        </T.Mesh>
      </T.Group>
    {/if}
  {/each}

  <!-- Players -->
  {#each renderedPlayers as player (player.slot)}
    {@const color = colorToHex(player.color)}
    {@const boosted = snap.t < player.boostUntil || snap.t < player.burstUntil}
    {@const slowed = snap.t < player.slowUntil}
    {@const hover = 0.75 + Math.sin(pulseT * 6 + player.slot) * 0.08}
    <T.Group position={[player.worldX, hover, player.worldZ]} rotation.y={player.angleY}>
      <T.Mesh castShadow rotation.x={Math.PI / 2}>
        <T.ConeGeometry args={[0.36, 1.1, 18]} />
        <T.MeshStandardMaterial
          {color}
          emissive={color}
          emissiveIntensity={boosted ? 1.4 : 0.55}
          roughness={0.25}
          metalness={0.3}
        />
      </T.Mesh>
      <T.Mesh position={[0, 0, -0.7]}>
        <T.SphereGeometry args={[0.2, 14, 14]} />
        <T.MeshStandardMaterial
          {color}
          emissive={color}
          emissiveIntensity={boosted ? 1.9 : 0.9}
          transparent
          opacity={0.8}
        />
      </T.Mesh>
      {#if boosted}
        <T.Mesh position={[0, 0, -1.2]} rotation.x={Math.PI / 2}>
          <T.ConeGeometry args={[0.24, 1.3, 12]} />
          <T.MeshBasicMaterial {color} transparent opacity={0.55} depthWrite={false} />
        </T.Mesh>
      {/if}
      {#if slowed}
        <T.Mesh position={[0, 0, 0]}>
          <T.TorusGeometry args={[0.6, 0.05, 8, 24]} />
          <T.MeshBasicMaterial color={0xff7ccf} transparent opacity={0.75} depthWrite={false} />
        </T.Mesh>
      {/if}
      {#if player.slot === gs.mySlot}
        <T.Mesh position={[0, 1.1, 0]} rotation.x={Math.PI}>
          <T.ConeGeometry args={[0.16, 0.3, 12]} />
          <T.MeshBasicMaterial {color} transparent opacity={0.8} depthWrite={false} />
        </T.Mesh>
      {/if}
      <T.PointLight {color} intensity={boosted ? 2.6 : 1.3} distance={7} decay={2} />
    </T.Group>
  {/each}
{/if}
