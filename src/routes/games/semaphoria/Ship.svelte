<script lang="ts">
  import { T, useTask } from "@threlte/core";
  import * as THREE from "three";
  import type { ShipState } from "$lib/semaphoria/navigation";

  let {
    ship,
    isFlashing = false,
  }: {
    ship: ShipState;
    isFlashing?: boolean;
  } = $props();

  let groupRef: THREE.Group | undefined;

  // Smooth lerp — initialised to 0 and set on first useTask frame
  let smoothX = $state(0);
  let smoothY = $state(0);
  let shipInitialised = false;

  useTask((dt) => {
    if (!shipInitialised) {
      smoothX = ship.x;
      smoothY = ship.y;
      shipInitialised = true;
    }
    const lerpK = 1 - Math.exp(-dt * 8);
    smoothX += (ship.x - smoothX) * lerpK;
    smoothY += (ship.y - smoothY) * lerpK;

    if (groupRef) {
      groupRef.position.set(smoothX, 0, smoothY);
      // Smooth rotation toward heading
      const target = Math.PI - ship.heading;
      let diff = target - groupRef.rotation.y;
      // Normalise difference to [-π, π]
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      groupRef.rotation.y += diff * lerpK;
    }
  });
</script>

<T.Group
  position={[ship.x, 0, ship.y]}
  oncreate={(ref) => {
    groupRef = ref as THREE.Group;
  }}
>
  <!-- Hull -->
  <T.Mesh position.y={0.25}>
    <T.BoxGeometry args={[0.55, 0.35, 1.1]} />
    <T.MeshStandardMaterial color={isFlashing ? "#fffccc" : "#7a3e1a"} roughness={0.8} />
  </T.Mesh>

  <!-- Cabin / wheelhouse -->
  <T.Mesh position.y={0.55} position.z={0.1}>
    <T.BoxGeometry args={[0.3, 0.2, 0.35]} />
    <T.MeshStandardMaterial color="#5a2e10" roughness={0.9} />
  </T.Mesh>

  <!-- Mast -->
  <T.Mesh position.y={0.9} position.z={-0.15}>
    <T.CylinderGeometry args={[0.025, 0.03, 0.9, 6]} />
    <T.MeshStandardMaterial color="#3a2a18" roughness={0.95} />
  </T.Mesh>

  <!-- Lantern on mast (captain's light) -->
  <T.Mesh position.y={1.38} position.z={-0.15}>
    <T.SphereGeometry args={[0.06, 8, 8]} />
    <T.MeshStandardMaterial color="#fffce0" emissive="#fffcc0" emissiveIntensity={3} />
  </T.Mesh>

  <!-- Point light from lantern -->
  <T.PointLight
    position.y={1.4}
    position.z={-0.15}
    color="#fffce0"
    intensity={4}
    distance={8}
    decay={2}
  />
</T.Group>
