<script lang="ts">
  import { T } from "@threlte/core";

  let {
    x,
    y,
    seed = 0,
  }: {
    x: number;
    y: number;
    seed?: number;
  } = $props();

  // Use a deterministic pseudo-random from tile position + seed for variety
  const rng = (offset: number): number => {
    const s = (x * 31 + y * 97 + seed * 53 + offset * 13) & 0xffff;
    return ((s * 9301 + 49297) % 233280) / 233280;
  };

  const height = 0.4 + rng(1) * 0.5;
  const radius = 0.28 + rng(2) * 0.14;
  const tilt = (rng(3) - 0.5) * 0.3;
  const rotY = rng(4) * Math.PI * 2;
</script>

<!-- Main rock body -->
<T.Mesh
  position.x={x}
  position.y={height / 2 - 0.05}
  position.z={y}
  rotation.x={tilt}
  rotation.y={rotY}
>
  <T.CylinderGeometry args={[radius * 0.7, radius, height, 5, 1]} />
  <T.MeshStandardMaterial color="#2a2520" roughness={0.95} metalness={0.05} />
</T.Mesh>

<!-- Secondary smaller rock -->
<T.Mesh
  position.x={x + (rng(5) - 0.5) * 0.4}
  position.y={(height * 0.5) / 2}
  position.z={y + (rng(6) - 0.5) * 0.4}
  rotation.y={rotY + 1.2}
>
  <T.CylinderGeometry args={[radius * 0.4, radius * 0.55, height * 0.5, 5, 1]} />
  <T.MeshStandardMaterial color="#221e1b" roughness={1} metalness={0} />
</T.Mesh>
