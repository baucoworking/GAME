export const RadiationShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0.0 },
    intensity: { value: 0.0 },
    chromatic: { value: 0.008 },
    desaturation: { value: 0.0 },
    distortion: { value: 0.005 },
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
    uniform float chromatic;
    uniform float desaturation;
    uniform float distortion;
    varying vec2 vUv;

    float random(vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;

      float wave = sin(uv.y * 24.0 + time * 6.0) * (intensity * distortion);
      uv.x += wave;

      float offset = intensity * chromatic;
      float r = texture2D(tDiffuse, uv + vec2(offset, 0.0)).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - vec2(offset, 0.0)).b;
      vec3 color = vec3(r, g, b);

      float distToCenter = distance(uv, vec2(0.5));
      float edge = smoothstep(0.2, 0.9, distToCenter);
      float gray = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(color, vec3(gray), edge * desaturation);

      float noise = (random(uv + time) - 0.5) * (intensity * 0.35);
      color += noise;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};
