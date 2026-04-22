<script lang="ts">
  import { T, useTask, useThrelte } from "@threlte/core";
  import * as THREE from "three";
  import type { ShipState } from "$lib/semaphoria/navigation";
  import type { GameMap } from "$lib/semaphoria/map-generator";
  import { SIG_COLOR_HEX } from "$lib/semaphoria/constants";
  import type { SigColor } from "$lib/semaphoria/constants";
  import Ocean from "./Ocean.svelte";
  import Ship from "./Ship.svelte";
  import Reef from "./Reef.svelte";
  import Fog from "./Fog.svelte";
  import Lighthouse from "./Lighthouse.svelte";
  import Shipwreck from "./Shipwreck.svelte";

  let {
    ship,
    map,
    revealedTileKeys,
    rescuedWreckIds,
    flashColor = null,
    isFlashing = false,
  }: {
    ship: ShipState;
    map: GameMap;
    revealedTileKeys: ReadonlySet<string>;
    rescuedWreckIds: ReadonlySet<number>;
    flashColor?: SigColor | null;
    isFlashing?: boolean;
  } = $props();

  let camRef: THREE.PerspectiveCamera | undefined;

  // The lighthouse position is outside the grid, static per map
  const LIGHTHOUSE_X = $derived(-2.5);
  const LIGHTHOUSE_Z = $derived(map.rows / 2);

  // Collect visible reef tiles
  const visibleReefs = $derived(
    map.tiles.flat().filter((t) => t.type === "reef" && revealedTileKeys.has(`${t.x},${t.y}`))
  );

  // Smooth camera follow — initialise from current ship position
  let camX = $state(0);
  let camZ = $state(0);
  let camInitialised = false;

  // ── Lighthouse-tinted ambient/fog ───────────────────────────────────────────
  //
  // When the lighthouse is flashing, we want the world to *feel* lit by it —
  // fog colour, ambient and the scene background all drift toward the flash
  // colour. When dark, we settle back to deep-blue moonlight.

  const MOON_FOG = new THREE.Color(0x04080f);
  const MOON_AMBIENT = new THREE.Color(0x2040a0);
  const MOON_BACKGROUND = new THREE.Color(0x04080f);

  // Reused per-tick scratch colours so the useTask loop doesn't allocate.
  const scratchA = new THREE.Color();
  const scratchB = new THREE.Color();

  // Animated targets — lerp toward the flash colour when isFlashing, else back to moon.
  const fogColor = new THREE.Color().copy(MOON_FOG);
  const ambientColor = new THREE.Color().copy(MOON_AMBIENT);
  const bgColor = new THREE.Color().copy(MOON_BACKGROUND);

  // Expose reactive hex strings so Threlte re-binds material colours each frame
  // (we mutate the same THREE.Color instance and also expose a scalar trigger).
  let ambientHex = $state("#2040a0");
  let ambientIntensity = $state(0.25);

  // Create the scene fog once and attach it — Threlte exposes the raw scene.
  const { scene } = useThrelte();
  const sceneFog = new THREE.FogExp2(MOON_FOG.getHex(), 0.055);
  scene.fog = sceneFog;
  scene.background = bgColor;

  useTask((dt) => {
    // Camera follow
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

    // Lighthouse tint — when flashing, pull fog + ambient toward the beam colour.
    const tintK = 1 - Math.exp(-dt * (isFlashing ? 10 : 3));
    if (isFlashing && flashColor) {
      scratchA.setHex(SIG_COLOR_HEX[flashColor]);
      // Fog: mostly base fog with a hint of the beam colour (prevents whiteout).
      scratchB.copy(scratchA).lerp(MOON_FOG, 0.65);
      fogColor.lerp(scratchB, tintK);
      // Ambient: stronger pull toward the beam colour.
      scratchB.copy(scratchA).lerp(MOON_AMBIENT, 0.4);
      ambientColor.lerp(scratchB, tintK);
      // Background: near-black with a faint beam tint.
      scratchB.copy(scratchA).lerp(MOON_BACKGROUND, 0.7);
      bgColor.lerp(scratchB, tintK);
    } else {
      fogColor.lerp(MOON_FOG, tintK);
      ambientColor.lerp(MOON_AMBIENT, tintK);
      bgColor.lerp(MOON_BACKGROUND, tintK);
    }

    sceneFog.color.copy(fogColor);
    ambientHex = `#${ambientColor.getHexString()}`;
    ambientIntensity = isFlashing ? 0.55 : 0.28;
  });
</script>

<T.PerspectiveCamera
  makeDefault
  fov={55}
  near={0.1}
  far={120}
  oncreate={(ref) => {
    camRef = ref as THREE.PerspectiveCamera;
    camRef.position.set(ship.x, 14, ship.y + 9);
    camRef.lookAt(ship.x, 0, ship.y);
  }}
/>

<!-- Moonlight ambient — colour + intensity is modulated every tick by the lighthouse -->
<T.AmbientLight color={ambientHex} intensity={ambientIntensity} />

<!-- Distant moon directional light -->
<T.DirectionalLight color="#c8d8ff" intensity={0.6} position={[-10, 20, -15]} />

<!-- Ocean floor -->
<Ocean cols={map.cols} rows={map.rows} />

<!-- Visible reef tiles within fog radius -->
{#each visibleReefs as tile (`${tile.x},${tile.y}`)}
  <Reef x={tile.x} y={tile.y} />
{/each}

<!-- Shipwrecks the captain must rescue — only those within fog radius -->
{#each map.wrecks as wreck (wreck.id)}
  {#if revealedTileKeys.has(`${wreck.x},${wreck.y}`)}
    <Shipwreck x={wreck.x} y={wreck.y} rescued={rescuedWreckIds.has(wreck.id)} />
  {/if}
{/each}

<!-- Lighthouse visible at edge of fog -->
<Lighthouse x={LIGHTHOUSE_X} z={LIGHTHOUSE_Z} {flashColor} {isFlashing} />

<!-- The ship -->
<Ship {ship} {isFlashing} />

<!-- Fog of war (vignette around ship, tinted by lighthouse beam) -->
<Fog {ship} {flashColor} {isFlashing} />
