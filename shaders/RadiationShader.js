export const RadiationShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0.0 },
    intensity: { value: 0.0 }, // Conectado al Dosímetro / TensionSystem
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float intensity;
    varying vec2 vUv;

    // Función rápida de ruido pseudoaleatorio para la estática radiactiva
    float random(vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;

      // Distorsión espacial (onda de radiación) activa solo en alta intensidad
      float distortion = sin(uv.y * 20.0 + time * 5.0) * (intensity * 0.005);
      uv.x += distortion;

      // Aberración cromática direccional basada en intensidad
      float offset = intensity * 0.008;
      float r = texture2D(tDiffuse, uv + vec2(offset, 0.0)).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - vec2(offset, 0.0)).b;

      vec3 color = vec3(r, g, b);

      // Desaturación periférica (Efecto túnel por miedo)
      float distToCenter = distance(uv, vec2(0.5));
      float vignette = smoothstep(0.8, 0.2, distToCenter * (1.0 + intensity));
      color = mix(vec3(dot(color, vec3(0.299, 0.587, 0.114))), color, vignette);

      // Ruido de radiación (Film Grain)
      float noise = (random(uv + time) - 0.5) * (intensity * 0.5);
      color += noise;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};
