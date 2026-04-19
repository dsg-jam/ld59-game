<script lang="ts">
  import { T, useThrelte, useTask } from "@threlte/core";
  import * as THREE from "three";
  import { gs } from "./gameState.svelte.js";
  import { LANE_COUNT, LANE_WIDTH, TRACK_LENGTH, laneToX } from "./types.js";

  const { renderer, scene } = useThrelte();
  const TRACK_HALF_WIDTH = (LANE_COUNT * LANE_WIDTH) / 2;

  $effect(() => {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    scene.background = new THREE.Color(0x040610);
    scene.fog = new THREE.Fog(0x040610, 60, 260);
  });

  let pulseT = $state(0);
  let camX = 0;
  let camY = 5.2;
  let camZ = -7.5;
  let lookX = 0;
  let lookY = 0.8;
  let lookZ = 6;
  let cameraRef = $state<THREE.PerspectiveCamera | undefined>(undefined);

  const currentSnapshot = $derived(gs.snapshot);

  function colorToHex(css: string): number {
    if (css.startsWith("#")) return parseInt(css.slice(1), 16);
    return 0xffffff;
  }

  useTask((dt) => {
    pulseT += dt;
    const snap = gs.snapshot;
    let targetCamX: number;
    let targetCamY: number;
    let targetCamZ: number;
    let targetLookX: number;
    let targetLookY: number;
    let targetLookZ: number;
    const me = snap?.players.find((p) => p.slot === gs.mySlot);
    if (me) {
      targetCamX = laneToX(me.lane);
      targetCamY = 5.2;
      targetCamZ = me.z - 7.5;
      targetLookX = targetCamX;
      targetLookY = 0.8;
      targetLookZ = me.z + 6;
    } else {
      const overviewZ = TRACK_LENGTH * 0.25;
      targetCamX = 0;
      targetCamY = 14;
      targetCamZ = overviewZ - 28;
      targetLookX = 0;
      targetLookY = 0;
      targetLookZ = overviewZ;
    }
    const easePos = Math.min(1, dt * 5);
    const easeLook = Math.min(1, dt * 5);
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
</script>

<T.PerspectiveCamera bind:ref={cameraRef} makeDefault fov={62} near={0.1} far={400} />

<T.AmbientLight color={0x2a3860} intensity={0.6} />
<T.DirectionalLight
  color={0xbfe0ff}
  intensity={1.1}
  position={[6, 18, -4]}
  castShadow
  shadow.mapSize.width={1024}
  shadow.mapSize.height={1024}
  shadow.camera.near={1}
  shadow.camera.far={60}
  shadow.camera.left={-20}
  shadow.camera.right={20}
  shadow.camera.top={20}
  shadow.camera.bottom={-20}
/>
<T.HemisphereLight args={[0x3344aa, 0x050510, 0.4]} />

<!-- Track plane -->
<T.Mesh rotation.x={-Math.PI / 2} position={[0, 0, TRACK_LENGTH / 2]} receiveShadow>
  <T.PlaneGeometry args={[LANE_COUNT * LANE_WIDTH, TRACK_LENGTH]} />
  <T.MeshStandardMaterial color={0x0a1226} roughness={0.6} metalness={0.2} />
</T.Mesh>

<!-- Lane dividers (glowing lines) -->
{#each Array.from({ length: LANE_COUNT + 1 }, (_, i) => i) as i (i)}
  {@const x = -TRACK_HALF_WIDTH + i * LANE_WIDTH}
  <T.Mesh position={[x, 0.02, TRACK_LENGTH / 2]} rotation.x={-Math.PI / 2}>
    <T.PlaneGeometry args={[0.06, TRACK_LENGTH]} />
    <T.MeshBasicMaterial color={0x1d3a6e} transparent opacity={0.85} depthWrite={false} />
  </T.Mesh>
{/each}

<!-- Track side rails -->
{#each [-1, 1] as side (side)}
  <T.Mesh position={[side * (TRACK_HALF_WIDTH + 0.25), 0.25, TRACK_LENGTH / 2]}>
    <T.BoxGeometry args={[0.18, 0.5, TRACK_LENGTH]} />
    <T.MeshStandardMaterial
      color={0x1a2850}
      emissive={0x79f3ff}
      emissiveIntensity={0.35}
      roughness={0.3}
    />
  </T.Mesh>
{/each}

<!-- Horizon grid rings -->
{#each Array.from({ length: 22 }, (_, i) => i) as i (i)}
  {@const z = i * (TRACK_LENGTH / 22)}
  <T.Mesh position={[0, 0.015, z]} rotation.x={-Math.PI / 2}>
    <T.PlaneGeometry args={[LANE_COUNT * LANE_WIDTH, 0.04]} />
    <T.MeshBasicMaterial color={0x203060} transparent opacity={0.55} depthWrite={false} />
  </T.Mesh>
{/each}

<!-- Start line -->
<T.Mesh position={[0, 0.03, 0]} rotation.x={-Math.PI / 2}>
  <T.PlaneGeometry args={[LANE_COUNT * LANE_WIDTH, 0.6]} />
  <T.MeshBasicMaterial color={0x79f3ff} transparent opacity={0.9} depthWrite={false} />
</T.Mesh>

<!-- Finish arch -->
<T.Group position={[0, 0, TRACK_LENGTH]}>
  <T.Mesh position={[0, 0.03, 0]} rotation.x={-Math.PI / 2}>
    <T.PlaneGeometry args={[LANE_COUNT * LANE_WIDTH, 0.8]} />
    <T.MeshBasicMaterial color={0xff7ccf} transparent opacity={0.95} depthWrite={false} />
  </T.Mesh>
  <T.Mesh position={[0, 2.2, 0]}>
    <T.TorusGeometry args={[TRACK_HALF_WIDTH + 0.3, 0.12, 12, 48]} />
    <T.MeshStandardMaterial
      color={0xff7ccf}
      emissive={0xff7ccf}
      emissiveIntensity={0.9 + Math.sin(pulseT * 4) * 0.2}
      roughness={0.2}
    />
  </T.Mesh>
  {#each [-1, 1] as side (side)}
    <T.Mesh position={[side * (TRACK_HALF_WIDTH + 0.3), 1.1, 0]}>
      <T.CylinderGeometry args={[0.08, 0.08, 2.2, 12]} />
      <T.MeshStandardMaterial color={0xff7ccf} emissive={0xff7ccf} emissiveIntensity={0.7} />
    </T.Mesh>
  {/each}
</T.Group>

{#if currentSnapshot}
  {@const snap = currentSnapshot}
  <!-- Obstacles -->
  {#each snap.obstacles as obs (obs.id)}
    {@const ox = laneToX(obs.lane)}
    {#if obs.kind === "amp"}
      <T.Group position={[ox, 0.6, obs.z]}>
        <T.Mesh rotation.y={pulseT * 1.4}>
          <T.OctahedronGeometry args={[0.36]} />
          <T.MeshStandardMaterial
            color={0x8dff9d}
            emissive={0x8dff9d}
            emissiveIntensity={0.9 + Math.sin(pulseT * 6 + obs.id) * 0.35}
            roughness={0.25}
          />
        </T.Mesh>
        <T.Mesh rotation.x={-Math.PI / 2} position={[0, -0.55, 0]}>
          <T.RingGeometry args={[0.45, 0.55, 24]} />
          <T.MeshBasicMaterial
            color={0x8dff9d}
            transparent
            opacity={0.55}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </T.Mesh>
      </T.Group>
    {:else}
      <T.Group position={[ox, 0.45, obs.z]}>
        {#each [0, 1, 2] as i (i)}
          <T.Mesh position={[0, i * 0.3, 0]} rotation.z={Math.sin(pulseT * 10 + obs.id + i) * 0.3}>
            <T.BoxGeometry args={[0.9, 0.06, 0.28]} />
            <T.MeshStandardMaterial
              color={0xff4fa0}
              emissive={0xff7ccf}
              emissiveIntensity={0.75 + Math.sin(pulseT * 12 + obs.id + i) * 0.25}
              roughness={0.35}
            />
          </T.Mesh>
        {/each}
      </T.Group>
    {/if}
  {/each}

  <!-- Players -->
  {#each snap.players as player (player.slot)}
    {@const px = laneToX(player.lane)}
    {@const color = colorToHex(player.color)}
    {@const boosted = snap.t < player.boostUntil || snap.t < player.burstUntil}
    {@const slowed = snap.t < player.slowUntil}
    {@const hover = 0.7 + Math.sin(pulseT * 6 + player.slot) * 0.08}
    <T.Group position={[px, hover, player.z]}>
      <T.Mesh castShadow rotation.x={Math.PI / 2}>
        <T.ConeGeometry args={[0.34, 1.0, 16]} />
        <T.MeshStandardMaterial
          {color}
          emissive={color}
          emissiveIntensity={boosted ? 1.3 : 0.5}
          roughness={0.25}
          metalness={0.3}
        />
      </T.Mesh>
      <T.Mesh position={[0, 0, -0.65]}>
        <T.SphereGeometry args={[0.18, 14, 14]} />
        <T.MeshStandardMaterial
          {color}
          emissive={color}
          emissiveIntensity={boosted ? 1.8 : 0.8}
          transparent
          opacity={0.75}
        />
      </T.Mesh>
      {#if boosted}
        <T.Mesh position={[0, 0, -1.1]} rotation.x={Math.PI / 2}>
          <T.ConeGeometry args={[0.22, 1.2, 12]} />
          <T.MeshBasicMaterial {color} transparent opacity={0.55} depthWrite={false} />
        </T.Mesh>
      {/if}
      {#if slowed}
        <T.Mesh position={[0, 0, 0]}>
          <T.TorusGeometry args={[0.55, 0.04, 8, 24]} />
          <T.MeshBasicMaterial color={0xff7ccf} transparent opacity={0.7} depthWrite={false} />
        </T.Mesh>
      {/if}
      <T.PointLight {color} intensity={boosted ? 2.4 : 1.2} distance={6} decay={2} />
    </T.Group>
  {/each}
{/if}
