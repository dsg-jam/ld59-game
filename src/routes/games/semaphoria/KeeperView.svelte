<script lang="ts">
  import { T } from "@threlte/core";
  import * as THREE from "three";
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

  const LIGHTHOUSE_X = -2.5;
  const LIGHTHOUSE_Z = map.rows / 2;

  // Coarsened ship area shown to keeper (not exact position)
  const areaIndicator = $derived(getKeeperAreaTile(ship));

  // Camera: orthographic overhead view of the whole map
  const camHeight = Math.max(map.cols, map.rows) * 0.9;
  const camX = map.cols / 2 - 0.5;
  const camZ = map.rows / 2 - 0.5;

  // Colour map for tile types
  const TILE_COLORS: Record<string, string> = {
    water: "#0e2240",
    reef: "#1a1410",
    harbor: "#44ff88",
    start: "#ffdd00",
  };

  const allTiles = $derived(map.tiles.flat());
</script>

<!-- Orthographic camera looking straight down -->
<T.OrthographicCamera
  makeDefault
  position.x={camX}
  position.y={camHeight}
  position.z={camZ}
  left={-map.cols / 2}
  right={map.cols / 2}
  top={map.rows / 2}
  bottom={-map.rows / 2}
  near={0.1}
  far={camHeight * 2}
  oncreate={(ref) => {
    const cam = ref as THREE.OrthographicCamera;
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
