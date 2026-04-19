<script lang="ts">
  import { T, useTask } from "@threlte/core";
  import * as THREE from "three";
  import type { ShipState } from "$lib/semaphoria/navigation";
  import type { GameMap } from "$lib/semaphoria/map-generator";
  import type { SigColor } from "$lib/semaphoria/constants";
  import Ocean from "./Ocean.svelte";
  import Ship from "./Ship.svelte";
  import Reef from "./Reef.svelte";
  import Fog from "./Fog.svelte";
  import Lighthouse from "./Lighthouse.svelte";

  let {
    ship,
    map,
    revealedTileKeys,
    flashColor = null,
    isFlashing = false,
  }: {
    ship: ShipState;
    map: GameMap;
    revealedTileKeys: ReadonlySet<string>;
    flashColor?: SigColor | null;
    isFlashing?: boolean;
  } = $props();

  let camRef: THREE.PerspectiveCamera | undefined;

  // The lighthouse position is outside the grid, static per map
  const LIGHTHOUSE_X = $derived(-2.5);
  const LIGHTHOUSE_Z = $derived(map.rows / 2);

  // Collect visible reef tiles
  const visibleReefs = $derived(
    map.tiles
      .flat()
      .filter((t) => t.type === "reef" && revealedTileKeys.has(`${t.x},${t.y}`))
  );

  // Smooth camera follow — initialise from current ship position
  let camX = $state(0);
  let camZ = $state(0);
  let camInitialised = false;

  useTask((dt) => {
    if (!camInitialised) {
      camX = ship.x;
      camZ = ship.y;
      camInitialised = true;
    }
    const k = 1 - Math.exp(-dt * 5);
    camX += (ship.x - camX) * k;
    camZ += (ship.y - camZ) * k;

    if (camRef) {
      camRef.position.set(camX, 14, camZ + 9);
      camRef.lookAt(camX, 0, camZ);
    }
  });
</script>

<T.PerspectiveCamera
  makeDefault
  fov={55}
  near={0.1}
  far={200}
  oncreate={(ref) => {
    camRef = ref as THREE.PerspectiveCamera;
    camRef.position.set(ship.x, 14, ship.y + 9);
    camRef.lookAt(ship.x, 0, ship.y);
  }}
/>

<!-- Moonlight ambient -->
<T.AmbientLight color="#2040a0" intensity={0.25} />

<!-- Distant moon directional light -->
<T.DirectionalLight color="#c8d8ff" intensity={0.6} position={[-10, 20, -15]} />

<!-- Ocean floor -->
<Ocean cols={map.cols} rows={map.rows} />

<!-- Visible reef tiles within fog radius -->
{#each visibleReefs as tile (`${tile.x},${tile.y}`)}
  <Reef x={tile.x} y={tile.y} />
{/each}

<!-- Lighthouse visible at edge of fog -->
<Lighthouse x={LIGHTHOUSE_X} z={LIGHTHOUSE_Z} {flashColor} {isFlashing} />

<!-- The ship -->
<Ship {ship} {isFlashing} />

<!-- Fog of war -->
<Fog {ship} />
