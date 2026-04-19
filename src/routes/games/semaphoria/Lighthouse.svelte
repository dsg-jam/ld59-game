<script lang="ts">
  import { T, useTask } from "@threlte/core";
  import * as THREE from "three";
  import { SIG_COLOR_HEX } from "$lib/semaphoria/constants";
  import type { SigColor } from "$lib/semaphoria/constants";

  let {
    x = -2,
    z = 10,
    flashColor = null,
    isFlashing = false,
  }: {
    x?: number;
    z?: number;
    flashColor?: SigColor | null;
    isFlashing?: boolean;
  } = $props();

  let beamRef: THREE.Group | undefined;
  let time = $state(0);

  const beamColor = $derived(
    isFlashing && flashColor
      ? `#${SIG_COLOR_HEX[flashColor].toString(16).padStart(6, "0")}`
      : "#ffffff"
  );

  const spotIntensity = $derived(isFlashing ? 80 : 8);

  useTask((dt) => {
    time += dt;
    // Rotate beam slowly
    if (beamRef) {
      beamRef.rotation.y = time * 0.4;
    }
  });
</script>

<T.Group position.x={x} position.z={z}>
  <!-- Base -->
  <T.Mesh position.y={0.4}>
    <T.CylinderGeometry args={[0.5, 0.7, 0.8, 8]} />
    <T.MeshStandardMaterial color="#ccc9bb" roughness={0.8} />
  </T.Mesh>

  <!-- Tower -->
  <T.Mesh position.y={2.5}>
    <T.CylinderGeometry args={[0.28, 0.38, 3.4, 8]} />
    <T.MeshStandardMaterial color="#e8e4d0" roughness={0.7} />
  </T.Mesh>

  <!-- Lantern room -->
  <T.Mesh position.y={4.5}>
    <T.CylinderGeometry args={[0.4, 0.4, 0.6, 8]} />
    <T.MeshStandardMaterial color="#445566" roughness={0.4} metalness={0.3} />
  </T.Mesh>

  <!-- Lens / light source -->
  <T.Mesh position.y={4.8}>
    <T.SphereGeometry args={[0.22, 12, 12]} />
    <T.MeshStandardMaterial
      color={beamColor}
      emissive={beamColor}
      emissiveIntensity={isFlashing ? 6 : 1}
    />
  </T.Mesh>

  <!-- Spotlight beam -->
  <T.SpotLight
    position.y={4.8}
    color={beamColor}
    intensity={spotIntensity}
    angle={Math.PI / 6}
    penumbra={0.4}
    distance={40}
    castShadow={false}
  />

  <!-- Rotating beam cone (visual) -->
  <T.Group
    position.y={4.6}
    oncreate={(ref) => {
      beamRef = ref as THREE.Group;
    }}
  >
    <T.Mesh rotation.x={Math.PI / 2} position.z={3}>
      <T.ConeGeometry args={[1.2, 6, 8, 1, true]} />
      <T.MeshBasicMaterial
        color={beamColor}
        transparent
        opacity={isFlashing ? 0.18 : 0.04}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </T.Mesh>
  </T.Group>
</T.Group>
