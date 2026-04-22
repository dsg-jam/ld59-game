<script lang="ts">
  import { T, useThrelte } from "@threlte/core";
  import * as THREE from "three";
  import { fromStore } from "svelte/store";
  import type { GameMap } from "$lib/semaphoria/map-generator";
  import type { ShipState } from "$lib/semaphoria/navigation";
  import type { SigColor } from "$lib/semaphoria/constants";
  import { getKeeperAreaTile } from "$lib/semaphoria/navigation";
  import Lighthouse from "./Lighthouse.svelte";
  import Shipwreck from "./Shipwreck.svelte";

  let camRef: THREE.OrthographicCamera | undefined = $state(undefined);

  let {
    map,
    ship,
    rescuedWreckIds,
    flashColor = null,
    isFlashing = false,
  }: {
    map: GameMap;
    ship: ShipState;
    rescuedWreckIds: ReadonlySet<number>;
    flashColor?: SigColor | null;
    isFlashing?: boolean;
  } = $props();

  const LIGHTHOUSE_X = $derived(-2.5);
  const LIGHTHOUSE_Z = $derived(map.rows / 2);

  // Coarsened ship area shown to keeper (not exact position)
  const areaIndicator = $derived(getKeeperAreaTile(ship));

  // ── Camera sizing ─────────────────────────────────────────────────────────
  //
  // The keeper wants an overhead view that frames the ENTIRE map. Using a
  // fixed ±cols/2 × ±rows/2 frustum stretches the map whenever the canvas
  // aspect ratio differs from the map's (e.g. a 16:9 canvas on a 20×20
  // map would squash the map vertically). Instead, compute the frustum from
  // the live canvas aspect so the map is letterboxed or pillarboxed rather
  // than distorted.

  const { size } = useThrelte();
  const canvasSize = fromStore(size);

  const EDGE_MARGIN = 2; // world units of slack around the map
  const mapHalfW = $derived(map.cols / 2 + EDGE_MARGIN);
  const mapHalfH = $derived(map.rows / 2 + EDGE_MARGIN);

  const canvasAspect = $derived.by(() => {
    const s = canvasSize.current;
    if (!s || s.height <= 0) return 1;
    return s.width / s.height;
  });
  const mapAspect = $derived(mapHalfW / mapHalfH);

  // Extend one axis so the map fits inside the frustum without distortion.
  const frustum = $derived.by(() => {
    if (canvasAspect >= mapAspect) {
      const w = mapHalfH * canvasAspect;
      return { left: -w, right: w, top: mapHalfH, bottom: -mapHalfH };
    }
    const h = mapHalfW / canvasAspect;
    return { left: -mapHalfW, right: mapHalfW, top: h, bottom: -h };
  });

  const camHeight = $derived(Math.max(map.cols, map.rows) * 0.9);
  const camX = $derived(map.cols / 2 - 0.5);
  const camZ = $derived(map.rows / 2 - 0.5);

  // ── Tile palette ──────────────────────────────────────────────────────────
  //
  // Pushed water + reef contrast way up vs. the page background so the
  // keeper can actually read the board. Reefs now glow danger-red so they
  // pop against water.

  const TILE_COLORS: Record<string, string> = {
    water: "#14355e",
    reef: "#5a1a1a",
    harbor: "#44ff88",
    start: "#ffdd00",
  };

  const DEFAULT_EMISSIVE = { color: "#1b4a7a", intensity: 0.12 };
  const TILE_EMISSIVE: Record<string, { color: string; intensity: number }> = {
    water: DEFAULT_EMISSIVE,
    reef: { color: "#ff4a4a", intensity: 0.55 },
    harbor: { color: "#44ff88", intensity: 0.45 },
    start: { color: "#ffdd00", intensity: 0.35 },
  };

  const allTiles = $derived(map.tiles.flat());

  // Build a set of [x, z] pairs for vertical / horizontal grid lines so we
  // don't have to recompute them every frame.
  const gridLines = $derived.by(() => {
    const v: { x: number }[] = [];
    for (let x = 0; x <= map.cols; x += 1) v.push({ x: x - 0.5 });
    const h: { z: number }[] = [];
    for (let y = 0; y <= map.rows; y += 1) h.push({ z: y - 0.5 });
    return { v, h };
  });

  const gridCenterX = $derived(map.cols / 2 - 0.5);
  const gridCenterZ = $derived(map.rows / 2 - 0.5);
  const gridSpanX = $derived(map.cols);
  const gridSpanZ = $derived(map.rows);

  // With `manual` set, Threlte stops auto-updating the projection matrix when
  // left/right/top/bottom change. Push the matrix update + a re-render
  // ourselves whenever the frustum recomputes (canvas resize, map swap, …).
  const { invalidate } = useThrelte();
  $effect(() => {
    const cam = camRef;
    if (!cam) return;
    cam.left = frustum.left;
    cam.right = frustum.right;
    cam.top = frustum.top;
    cam.bottom = frustum.bottom;
    cam.near = 0.1;
    cam.far = camHeight * 2;
    cam.position.set(camX, camHeight, camZ);
    cam.lookAt(camX, 0, camZ);
    cam.updateProjectionMatrix();
    invalidate();
  });
</script>

<!--
  Orthographic camera looking straight down.
  `manual` is required: without it Threlte's `updateCamera` overwrites
  left/right/top/bottom with pixel-sized values on every resize. The
  frustum is recomputed from the live canvas aspect so the map fills
  the viewport without stretching.
-->
<T.OrthographicCamera
  makeDefault
  manual
  oncreate={(ref) => {
    const cam = ref as THREE.OrthographicCamera;
    cam.up.set(0, 0, -1); // looking straight down — orient screen-up to world -Z
    cam.position.set(camX, camHeight, camZ);
    cam.left = frustum.left;
    cam.right = frustum.right;
    cam.top = frustum.top;
    cam.bottom = frustum.bottom;
    cam.near = 0.1;
    cam.far = camHeight * 2;
    cam.lookAt(camX, 0, camZ);
    cam.updateProjectionMatrix();
    camRef = cam;
  }}
/>

<T.AmbientLight intensity={1.1} color="#d4e0ff" />
<T.DirectionalLight position={[camX, 20, camZ - 5]} intensity={0.6} />

<!-- Board backplate so the grid reads even when most tiles are water -->
<T.Mesh
  position.x={gridCenterX}
  position.y={-0.02}
  position.z={gridCenterZ}
  rotation.x={-Math.PI / 2}
>
  <T.PlaneGeometry args={[gridSpanX + 1, gridSpanZ + 1]} />
  <T.MeshBasicMaterial color="#07101c" />
</T.Mesh>

<!-- Map tiles as flat planes -->
{#each allTiles as tile (`${tile.x},${tile.y}`)}
  {@const emi = TILE_EMISSIVE[tile.type] ?? DEFAULT_EMISSIVE}
  <T.Mesh position.x={tile.x} position.y={0} position.z={tile.y} rotation.x={-Math.PI / 2}>
    <T.PlaneGeometry args={[0.96, 0.96]} />
    <T.MeshStandardMaterial
      color={TILE_COLORS[tile.type] ?? "#14355e"}
      roughness={0.85}
      emissive={tile.onPath ? "#2a6fa3" : emi.color}
      emissiveIntensity={tile.onPath ? 0.5 : emi.intensity}
    />
  </T.Mesh>
{/each}

<!-- Grid lines — thin dark strips between tiles so the board reads as a grid -->
{#each gridLines.v as line (line.x)}
  <T.Mesh position.x={line.x} position.y={0.005} position.z={gridCenterZ} rotation.x={-Math.PI / 2}>
    <T.PlaneGeometry args={[0.04, gridSpanZ]} />
    <T.MeshBasicMaterial color="#0a1828" transparent opacity={0.9} depthWrite={false} />
  </T.Mesh>
{/each}
{#each gridLines.h as line (line.z)}
  <T.Mesh position.x={gridCenterX} position.y={0.005} position.z={line.z} rotation.x={-Math.PI / 2}>
    <T.PlaneGeometry args={[gridSpanX, 0.04]} />
    <T.MeshBasicMaterial color="#0a1828" transparent opacity={0.9} depthWrite={false} />
  </T.Mesh>
{/each}

<!-- Safe path highlight (thin overlay) -->
{#each map.path as pt, i (i)}
  <T.Mesh position.x={pt.x} position.y={0.01} position.z={pt.y} rotation.x={-Math.PI / 2}>
    <T.PlaneGeometry args={[0.6, 0.6]} />
    <T.MeshBasicMaterial color="#4fa8ff" transparent opacity={0.55} depthWrite={false} />
  </T.Mesh>
{/each}

<!-- Ship area indicator (coarsened position circle) -->
<T.Mesh
  position.x={areaIndicator.x}
  position.y={0.05}
  position.z={areaIndicator.y}
  rotation.x={-Math.PI / 2}
>
  <T.CircleGeometry args={[1.8, 16]} />
  <T.MeshBasicMaterial color="#ffdd00" transparent opacity={0.22} depthWrite={false} />
</T.Mesh>

<!-- Shipwreck markers so the keeper knows where to guide the captain -->
{#each map.wrecks as wreck (wreck.id)}
  <Shipwreck x={wreck.x} y={wreck.y} rescued={rescuedWreckIds.has(wreck.id)} overhead />
{/each}

<!-- Lighthouse model at fixed position -->
<Lighthouse x={LIGHTHOUSE_X} z={LIGHTHOUSE_Z} {flashColor} {isFlashing} />
