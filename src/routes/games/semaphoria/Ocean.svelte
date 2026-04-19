<script lang="ts">
  import { T, useTask } from "@threlte/core";
  import * as THREE from "three";

  let { cols, rows }: { cols: number; rows: number } = $props();

  let time = $state(0);
  let meshRef: THREE.Mesh | undefined;

  useTask((dt) => {
    time += dt;
    if (meshRef?.material instanceof THREE.ShaderMaterial) {
      const uTime = meshRef.material.uniforms["uTime"];
      if (uTime) uTime.value = time;
    }
  });

  const waterMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x0a1d3a) },
      uShallow: { value: new THREE.Color(0x1a4060) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 pos = position;
        pos.y += sin(pos.x * 0.8 + uTime * 0.9) * 0.06;
        pos.y += cos(pos.z * 0.6 + uTime * 1.1) * 0.04;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float wave = sin(vUv.x * 6.0 + uTime * 0.5) * 0.5 + 0.5;
        wave += cos(vUv.y * 5.0 + uTime * 0.7) * 0.25;
        gl_FragColor = vec4(mix(uDeep, uShallow, wave * 0.4), 1.0);
      }
    `,
  });
</script>

<!-- Water plane covering the whole grid, rotated to lie flat -->
<T.Mesh
  rotation.x={-Math.PI / 2}
  position.x={cols / 2 - 0.5}
  position.y={-0.05}
  position.z={rows / 2 - 0.5}
  oncreate={(ref) => {
    meshRef = ref as THREE.Mesh;
  }}
>
  <T.PlaneGeometry args={[cols, rows, cols * 2, rows * 2]} />
  <T is={waterMaterial} />
</T.Mesh>
