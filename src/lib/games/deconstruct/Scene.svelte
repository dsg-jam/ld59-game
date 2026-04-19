<script lang="ts">
  import { T, useTask, useThrelte } from "@threlte/core";
  import { OrbitControls, interactivity } from "@threlte/extras";
  import * as THREE from "three";
  import { gs } from "./gameState.svelte.js";
  import {
    W,
    H,
    BLOCK_SIZE,
    GAP,
    TABLE_RADIUS,
    COLORS_HEX,
    PLAYER_COLORS_HEX,
    gridToWorld,
  } from "./types.js";

  const { renderer, scene } = useThrelte();
  $effect(() => {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    scene.background = new THREE.Color(0x08080c);
    scene.fog = new THREE.FogExp2(0x08080c, 0.015);
  });

  interactivity();

  const blockSize = BLOCK_SIZE * 0.88;
  const sharedBlockGeo = new THREE.BoxGeometry(blockSize, blockSize, blockSize);
  const sharedEdgeGeo = new THREE.EdgesGeometry(sharedBlockGeo);
  const Primitive = T["primitive"];

  type BlockRiseRuntime = {
    id: string;
    colorKey: string;
    worldX: number;
    worldZ: number;
    posY: number;
    rotX: number;
    rotZ: number;
    vel: number;
    rotXRate: number;
    rotZRate: number;
    opacity: number;
  };
  type SignalRingRuntime = {
    id: string;
    worldX: number;
    worldZ: number;
    worldY: number;
    colorKey: string;
    t: number;
    duration: number;
  };

  let risingBlocks = $state<BlockRiseRuntime[]>([]);
  let signalRings = $state<SignalRingRuntime[]>([]);
  let sweepAngle = $state(0);
  let pulseT = $state(0);

  $effect(() => {
    if (gs.risingBlockTriggers.length > 0) {
      risingBlocks = [
        ...risingBlocks,
        ...gs.risingBlockTriggers.map((t) => ({
          id: t.id,
          colorKey: t.colorKey,
          worldX: t.worldX,
          worldZ: t.worldZ,
          posY: t.worldY,
          rotX: 0,
          rotZ: 0,
          vel: t.vel,
          rotXRate: t.rotXRate,
          rotZRate: t.rotZRate,
          opacity: 1,
        })),
      ];
      gs.risingBlockTriggers = [];
    }
  });

  $effect(() => {
    if (gs.signalRingTriggers.length > 0) {
      signalRings = [
        ...signalRings,
        ...gs.signalRingTriggers.map((t) => ({
          id: t.id,
          worldX: t.worldX,
          worldZ: t.worldZ,
          worldY: t.worldY,
          colorKey: t.colorKey,
          t: 0,
          duration: t.duration,
        })),
      ];
      gs.signalRingTriggers = [];
    }
  });

  useTask((dt) => {
    sweepAngle = sweepAngle + dt * 0.7;
    pulseT += dt;

    risingBlocks = risingBlocks
      .map((b) => ({
        ...b,
        posY: b.posY + b.vel * 60 * dt,
        rotX: b.rotX + b.rotXRate,
        rotZ: b.rotZ + b.rotZRate,
        opacity: Math.max(0, b.opacity - dt),
      }))
      .filter((b) => b.opacity > 0);

    signalRings = signalRings.map((r) => ({ ...r, t: r.t + dt })).filter((r) => r.t < r.duration);
  });

  function isTopBlock(gx: number, gy: number, gz: number): boolean {
    return (gs.grid[gx]?.[gy]?.length ?? 0) === gz + 1;
  }

  function isSelected(gx: number, gy: number): boolean {
    return gs.selected.some((s) => s[0] === gx && s[1] === gy);
  }

  function handleBlockClick(gx: number, gy: number) {
    if (gs.locked) return;
    if (gs.selectedCardIdx == null) {
      gs.msgText = "Select a decode filter first.";
      gs.msgKind = "";
      return;
    }
    const i = gs.selected.findIndex((s) => s[0] === gx && s[1] === gy);
    if (i >= 0) {
      gs.selected = gs.selected.filter((_, idx) => idx !== i);
    } else {
      const card = gs.myHand[gs.selectedCardIdx];
      if (!card) return;
      if (gs.selected.length >= card.shape.cells.length) {
        gs.msgText = "Filter saturated — clear to retarget.";
        gs.msgKind = "";
        return;
      }
      gs.selected = [...gs.selected, [gx, gy] as [number, number]];
    }
    gs.msgText = "";
    gs.msgKind = "";
  }

  function seatPos(i: number, n: number): [number, number, number] {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const dist = TABLE_RADIUS - 0.8;
    return [Math.cos(a) * dist, 0.14, Math.sin(a) * dist];
  }

  const gridOffset = ((W - 1) * (BLOCK_SIZE + GAP)) / 2;
</script>

<!-- Lighting -->
<T.AmbientLight color={0x404060} intensity={0.5} />
<T.DirectionalLight
  color={0xfff5e0}
  intensity={1.6}
  position={[8, 18, 6]}
  castShadow
  shadow.mapSize.width={2048}
  shadow.mapSize.height={2048}
  shadow.camera.near={1}
  shadow.camera.far={45}
  shadow.camera.left={-16}
  shadow.camera.right={16}
  shadow.camera.top={16}
  shadow.camera.bottom={-16}
  shadow.radius={4}
  shadow.bias={-0.0005}
/>
<T.DirectionalLight color={0xaaccff} intensity={0.3} position={[-8, 6, -10]} />
<T.PointLight
  color={0xffeedd}
  intensity={0.6}
  distance={24}
  decay={1.5}
  position={[0, 7, 0]}
  castShadow
/>

<!-- Camera with OrbitControls -->
<T.PerspectiveCamera makeDefault fov={50} near={0.1} far={120} position={[12, 14, 12]}>
  <OrbitControls
    enableDamping
    dampingFactor={0.07}
    target={[0, 1, 0]}
    minDistance={5}
    maxDistance={35}
    maxPolarAngle={Math.PI / 2.1}
  />
</T.PerspectiveCamera>

<!-- Floor -->
<T.Mesh rotation.x={-Math.PI / 2} position.y={-0.02} receiveShadow>
  <T.PlaneGeometry args={[60, 60]} />
  <T.MeshStandardMaterial color={0x101014} roughness={0.95} />
</T.Mesh>

<!-- Table group -->
<T.Group>
  <!-- Table top -->
  <T.Mesh position.y={0} receiveShadow castShadow>
    <T.CylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS, 0.18, 8]} />
    <T.MeshStandardMaterial color={0x1a3a2a} roughness={0.55} metalness={0.05} />
  </T.Mesh>

  <!-- Table legs -->
  {#each Array.from({ length: 4 }, (_, i) => i) as i (i)}
    {@const a = (i / 4) * Math.PI * 2 + Math.PI / 4}
    <T.Mesh position={[Math.cos(a) * 5.5, -1.1, Math.sin(a) * 5.5]} castShadow>
      <T.CylinderGeometry args={[0.15, 0.2, 2.2, 8]} />
      <T.MeshStandardMaterial color={0x2a1a0a} roughness={0.7} />
    </T.Mesh>
  {/each}

  <!-- Felt -->
  <T.Mesh position.y={0.11} receiveShadow>
    <T.CylinderGeometry args={[4.0, 4.0, 0.02, 32]} />
    <T.MeshStandardMaterial color={0x0d2818} roughness={0.8} />
  </T.Mesh>

  <!-- Radar rings -->
  {#each [1, 2, 3] as ri (ri)}
    <T.Mesh rotation.x={-Math.PI / 2} position.y={0.121}>
      <T.RingGeometry args={[ri * 1.1 - 0.012, ri * 1.1 + 0.012, 64]} />
      <T.MeshBasicMaterial
        color={0x4fd0ff}
        transparent
        opacity={0.15}
        side={2}
        depthWrite={false}
      />
    </T.Mesh>
  {/each}

  <!-- Radar crosshairs -->
  <T.Mesh rotation.x={-Math.PI / 2} position.y={0.121}>
    <T.PlaneGeometry args={[0.015, 7.0]} />
    <T.MeshBasicMaterial color={0x4fd0ff} transparent opacity={0.1} side={2} depthWrite={false} />
  </T.Mesh>
  <T.Mesh rotation.x={-Math.PI / 2} position.y={0.121}>
    <T.PlaneGeometry args={[7.0, 0.015]} />
    <T.MeshBasicMaterial color={0x4fd0ff} transparent opacity={0.1} side={2} depthWrite={false} />
  </T.Mesh>

  <!-- Radar sweep -->
  <T.Group position.y={0.122} rotation.y={sweepAngle}>
    <T.Mesh rotation.x={-Math.PI / 2}>
      <T.CircleGeometry args={[3.6, 32, 0, Math.PI / 4]} />
      <T.MeshBasicMaterial
        color={0x4fd0ff}
        transparent
        opacity={0.15}
        side={2}
        depthWrite={false}
      />
    </T.Mesh>
  </T.Group>

  <!-- Block construct grid -->
  <T.Group position={[-gridOffset, 0.22, -gridOffset]}>
    {#each Array.from({ length: W }, (_, i) => i) as gx (gx)}
      {#each Array.from({ length: H }, (_, i) => i) as gy (gy)}
        {#each gs.grid[gx]?.[gy] ?? [] as colorKey, gz (gz)}
          {@const [wx, wy, wz] = gridToWorld(gx, gy, gz)}
          {@const sel = isSelected(gx, gy) && isTopBlock(gx, gy, gz)}
          {@const top = isTopBlock(gx, gy, gz)}
          <!-- Block -->
          <T.Mesh
            position={[wx, wy, wz]}
            castShadow
            receiveShadow
            onclick={top ? () => handleBlockClick(gx, gy) : undefined}
          >
            <T.BoxGeometry args={[blockSize, blockSize, blockSize]} />
            <T.MeshStandardMaterial
              color={COLORS_HEX[colorKey]}
              roughness={0.35}
              metalness={0.15}
              emissive={sel ? 0xffffff : COLORS_HEX[colorKey]}
              emissiveIntensity={sel ? 0.4 + 0.3 * Math.sin(pulseT * 5) : 0}
            />
          </T.Mesh>
          <!-- Edge wireframe -->
          <T.LineSegments position={[wx, wy, wz]}>
            <Primitive object={sharedEdgeGeo} />
            <T.LineBasicMaterial color={0x4fd0ff} transparent opacity={0.25} />
          </T.LineSegments>
          <!-- Antenna on top block -->
          {#if top}
            <T.Mesh position={[wx, wy + BLOCK_SIZE * 0.44 + 0.16, wz]} castShadow>
              <T.CylinderGeometry args={[0.015, 0.015, 0.32, 6]} />
              <T.MeshStandardMaterial color={0x999999} roughness={0.5} metalness={0.7} />
            </T.Mesh>
            <T.Mesh position={[wx, wy + BLOCK_SIZE * 0.44 + 0.35, wz]}>
              <T.SphereGeometry args={[0.055, 10, 10]} />
              <T.MeshStandardMaterial
                color={COLORS_HEX[colorKey]}
                emissive={COLORS_HEX[colorKey]}
                emissiveIntensity={0.55 + Math.sin(pulseT * 4 + gx * 1.37 + gy * 0.91) * 0.45}
                roughness={0.3}
              />
            </T.Mesh>
          {/if}
        {/each}
      {/each}
    {/each}

    <!-- Rising block animations -->
    {#each risingBlocks as block (block.id)}
      <T.Mesh
        position={[block.worldX, block.posY, block.worldZ]}
        rotation={[block.rotX, 0, block.rotZ]}
      >
        <T.BoxGeometry args={[blockSize, blockSize, blockSize]} />
        <T.MeshStandardMaterial
          color={COLORS_HEX[block.colorKey as keyof typeof COLORS_HEX]}
          emissive={COLORS_HEX[block.colorKey as keyof typeof COLORS_HEX]}
          emissiveIntensity={0.3}
          transparent
          opacity={block.opacity}
        />
      </T.Mesh>
    {/each}

    <!-- Signal rings -->
    {#each signalRings as ring (ring.id)}
      {@const p = Math.min(ring.t / ring.duration, 1)}
      {@const scale = 1 + p * 4}
      <T.Mesh position={[ring.worldX, ring.worldY, ring.worldZ]} rotation.x={-Math.PI / 2} {scale}>
        <T.RingGeometry args={[0.16, 0.22, 32]} />
        <T.MeshBasicMaterial
          color={COLORS_HEX[ring.colorKey as keyof typeof COLORS_HEX]}
          transparent
          opacity={0.95 * (1 - p)}
          side={2}
          depthWrite={false}
        />
      </T.Mesh>
    {/each}
  </T.Group>

  <!-- Player seats -->
  {#if gs.playerCount > 0}
    {#each Array.from({ length: gs.playerCount }, (_, i) => i) as i (i)}
      {@const pos = seatPos(i, gs.playerCount)}
      {@const playerColor = PLAYER_COLORS_HEX[i] ?? 0xffffff}
      <T.Mesh position={pos} receiveShadow>
        <T.CylinderGeometry args={[0.5, 0.5, 0.06, 16]} />
        <T.MeshStandardMaterial
          color={playerColor}
          emissive={playerColor}
          emissiveIntensity={0.2 + Math.sin(pulseT * 3 + i) * 0.1}
          roughness={0.4}
        />
      </T.Mesh>
    {/each}
  {/if}
</T.Group>
