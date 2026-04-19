<script lang="ts">
  import { T, useTask } from "@threlte/core";
  import * as THREE from "three";
  import type { ShipState } from "$lib/semaphoria/navigation";
  import { FOG_RADIUS } from "$lib/semaphoria/constants";

  let { ship }: { ship: ShipState } = $props();

  let meshRef: THREE.Mesh | undefined;

  useTask(() => {
    if (meshRef?.material instanceof THREE.ShaderMaterial) {
      meshRef.material.uniforms["uCenter"]!.value.set(ship.x, ship.y);
    }
  });

  const fogMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uCenter: { value: new THREE.Vector2(0, 0) },
      uRadius: { value: FOG_RADIUS },
      uFogColor: { value: new THREE.Color(0x040c16) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec2 uCenter;
      uniform float uRadius;
      uniform vec3 uFogColor;
      varying vec3 vWorldPos;
      void main() {
        float dist = distance(vec2(vWorldPos.x, vWorldPos.z), uCenter);
        float edge = uRadius * 0.8;
        float alpha = smoothstep(edge, uRadius + 1.0, dist);
        gl_FragColor = vec4(uFogColor, alpha * 0.96);
      }
    `,
  });
</script>

<!--
  A large horizontal plane positioned above the water.
  The shader reveals a circle around the ship, blacking out everything else.
-->
<T.Mesh
  rotation.x={-Math.PI / 2}
  position.x={ship.x}
  position.y={0.5}
  position.z={ship.y}
  oncreate={(ref) => {
    meshRef = ref as THREE.Mesh;
  }}
>
  <T.PlaneGeometry args={[120, 120, 1, 1]} />
  <T is={fogMaterial} />
</T.Mesh>
