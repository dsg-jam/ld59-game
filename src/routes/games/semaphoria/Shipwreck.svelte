<script lang="ts">
  import { T } from "@threlte/core";

  let {
    x,
    y,
    rescued = false,
    overhead = false,
  }: {
    x: number;
    y: number;
    rescued?: boolean;
    /** Rendered from the keeper's top-down view — use flatter, more legible markers. */
    overhead?: boolean;
  } = $props();

  // A deterministic jitter so each wreck has a distinct silhouette.
  const rng = (offset: number): number => {
    const s = (x * 37 + y * 101 + offset * 17) & 0xffff;
    return ((s * 9301 + 49297) % 233280) / 233280;
  };

  const tilt = (rng(1) - 0.5) * 0.8;
  const rotY = rng(2) * Math.PI * 2;
</script>

{#if overhead}
  <!-- Keeper view: a glowing ring + cross so wrecks stand out on the map -->
  <T.Mesh position.x={x} position.y={0.03} position.z={y} rotation.x={-Math.PI / 2}>
    <T.RingGeometry args={[0.45, 0.6, 16]} />
    <T.MeshBasicMaterial
      color={rescued ? "#44ff88" : "#ffae00"}
      transparent
      opacity={rescued ? 0.45 : 0.9}
      depthWrite={false}
    />
  </T.Mesh>
  <T.Mesh position.x={x} position.y={0.04} position.z={y} rotation.x={-Math.PI / 2}>
    <T.PlaneGeometry args={[0.12, 0.7]} />
    <T.MeshBasicMaterial
      color={rescued ? "#44ff88" : "#ffae00"}
      transparent
      opacity={rescued ? 0.5 : 0.85}
      depthWrite={false}
    />
  </T.Mesh>
  <T.Mesh
    position.x={x}
    position.y={0.04}
    position.z={y}
    rotation.x={-Math.PI / 2}
    rotation.z={Math.PI / 2}
  >
    <T.PlaneGeometry args={[0.12, 0.7]} />
    <T.MeshBasicMaterial
      color={rescued ? "#44ff88" : "#ffae00"}
      transparent
      opacity={rescued ? 0.5 : 0.85}
      depthWrite={false}
    />
  </T.Mesh>
{:else}
  <!-- Captain view: an actual broken-hull silhouette -->
  <T.Group position.x={x} position.y={0.08} position.z={y} rotation.y={rotY} rotation.z={tilt}>
    <!-- Half-sunk hull -->
    <T.Mesh position.y={0.12}>
      <T.BoxGeometry args={[0.9, 0.25, 0.45]} />
      <T.MeshStandardMaterial color={rescued ? "#3a5a3a" : "#4a2e1a"} roughness={0.95} />
    </T.Mesh>
    <!-- Broken mast -->
    <T.Mesh position.y={0.5} position.x={-0.15} rotation.z={0.6}>
      <T.CylinderGeometry args={[0.035, 0.04, 0.9, 6]} />
      <T.MeshStandardMaterial color="#2a1a10" roughness={1} />
    </T.Mesh>
    <!-- Distress lantern (dim while survivors remain, green when rescued) -->
    <T.Mesh position.y={0.3} position.x={0.2}>
      <T.SphereGeometry args={[0.07, 8, 8]} />
      <T.MeshStandardMaterial
        color={rescued ? "#44ff88" : "#ffae00"}
        emissive={rescued ? "#44ff88" : "#ffae00"}
        emissiveIntensity={rescued ? 1.2 : 2.6}
      />
    </T.Mesh>
    <!-- Low point light so the wreck glows through fog -->
    <T.PointLight
      position.y={0.3}
      position.x={0.2}
      color={rescued ? "#44ff88" : "#ffae00"}
      intensity={rescued ? 1.5 : 2.5}
      distance={4}
      decay={2}
    />
  </T.Group>
{/if}
