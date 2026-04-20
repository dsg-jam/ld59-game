<script lang="ts">
  import { T, useThrelte } from "@threlte/core";
  import * as THREE from "three";
  import { fromStore } from "svelte/store";
  import type { GameMap } from "$lib/semaphoria/map-generator";
  import type { ShipState } from "$lib/semaphoria/navigation";
  import type { SigColor } from "$lib/semaphoria/constants";
  import { getKeeperAreaTile } from "$lib/semaphoria/navigation";
  import Lighthouse from "./Lighthouse.svelte";

  let {
    map,
    ship,
    flashColor = null,
    isFlashing = false,
  }: {
    map: GameMap;
    ship: ShipState;
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

  const TILE_COLORS: Record<string, string> = {
    water: "#0e2240",
    reef: "#1a1410",
    harbor: "#44ff88",
    start: "#ffdd00",
  };

  const allTiles = $derived(map.tiles.flat());
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
  position.x={camX}
  position.y={camHeight}
  position.z={camZ}
  left={frustum.left}
  right={frustum.right}
  top={frustum.top}
  bottom={frustum.bottom}
  near={0.1}
  far={camHeight * 2}
  oncreate={(ref) => {
    const cam = ref as THREE.OrthographicCamera;
    cam.up.set(0, 0, -1); // looking straight down — orient screen-up to world -Z
    cam.lookAt(camX, 0, camZ);
  }}
/>

<T.AmbientLight intensity={0.8} color="#c8d8ff" />
<T.DirectionalLight position={[camX, 20, camZ - 5]} intensity={0.4} />

<!-- Map tiles as flat planes -->
{#each allTiles as tile (`${tile.x},${tile.y}`)}
  <T.Mesh position.x={tile.x} position.y={0} position.z={tile.y} rotation.x={-Math.PI / 2}>
    <T.PlaneGeometry args={[0.92, 0.92]} />
    <T.MeshStandardMaterial
      color={TILE_COLORS[tile.type] ?? "#0e2240"}
      roughness={0.9}
      emissive={tile.type === "harbor" ? "#44ff88" : tile.onPath ? "#1a3a55" : "#000000"}
      emissiveIntensity={tile.type === "harbor" ? 0.4 : tile.onPath ? 0.3 : 0}
    />
  </T.Mesh>
{/each}

<!-- Safe path highlight (thin overlay) -->
{#each map.path as pt, i (i)}
  <T.Mesh position.x={pt.x} position.y={0.01} position.z={pt.y} rotation.x={-Math.PI / 2}>
    <T.PlaneGeometry args={[0.5, 0.5]} />
    <T.MeshBasicMaterial color="#2266aa" transparent opacity={0.35} depthWrite={false} />
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

<!-- Lighthouse model at fixed position -->
<Lighthouse x={LIGHTHOUSE_X} z={LIGHTHOUSE_Z} {flashColor} {isFlashing} />
