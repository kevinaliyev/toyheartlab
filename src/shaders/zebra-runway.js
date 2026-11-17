import { COMMON_GLSL } from './common.glsl.js';

export const zebraRunwayStudy = {
  id: 'zebra-runway',
  name: 'Study B — Runway Zebra',
  description:
    'Fast-moving kinetic zebra isolines with directional brush-stroke color diffs and a sweeping tritone gradient.',
  params: [
    { key: 'u_speed', label: 'Speed', min: 0.1, max: 2.5, step: 0.05, default: 0.85 },
    { key: 'u_scale', label: 'Scale', min: 1.5, max: 8.0, step: 0.1, default: 3.6 },
    { key: 'u_brushDiff', label: 'Brush Diff', min: 0.0, max: 1.0, step: 0.02, default: 0.55 },
    { key: 'u_contrast', label: 'Edge Crispness', min: 0.0, max: 1.0, step: 0.02, default: 0.72 },
    { key: 'u_grain', label: 'Paper Grain', min: 0.0, max: 0.15, step: 0.005, default: 0.045 },
  ],
  fragmentShader: /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_seed;

uniform vec3 u_colorDark;
uniform vec3 u_colorMid;
uniform vec3 u_colorLight;

uniform float u_speed;
uniform float u_scale;
uniform float u_brushDiff;
uniform float u_contrast;
uniform float u_grain;

${COMMON_GLSL}

void main() {
  // Aspect-corrected coordinates centered at origin
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 uv = (v_uv - 0.5) * aspect * u_scale;
  float t = u_time * u_speed + u_seed * 13.37;

  // 1. Domain-warped flow field for fluid runway-fabric zebra ribbons
  vec2 flow = vec2(
    fbm(uv * 0.65 + vec2(t * 0.28, -t * 0.18)),
    fbm(uv * 0.65 + vec2(-t * 0.21, t * 0.24) + 5.2)
  );
  vec2 warped = uv + (flow - 0.5) * 2.6;

  // 2. Fast-moving directional brush-stroke noise (color-diff perturbation)
  float strokeAngle = 0.45 + 0.35 * sin(t * 0.25 + flow.x * 3.14);
  float bristles = brushNoise(warped * 3.2 + vec2(t * 1.15, -t * 0.55), strokeAngle, 3.8);
  float fineDiff = brushNoise(warped * 7.5 - vec2(t * 1.8, t * 0.7), strokeAngle + 0.2, 5.0);
  float brushField = mix(bristles, fineDiff, 0.42);

  // 3. Kinetic zebra isolines (warped contour waves)
  float waveCoord = warped.x * 2.2 + sin(warped.y * 1.4 - t * 0.9) * 1.35;
  float zebra = 0.5 + 0.5 * sin(waveCoord * 3.2 + (brushField - 0.5) * 4.5 * u_brushDiff);

  // 4. Sweeping tonal gradient so the composition breathes between dark-heavy and light-heavy
  float gradientSweep = 0.5 + 0.32 * sin(v_uv.x * 2.1 - t * 0.45 + v_uv.y * 1.3);

  // Combine zebra bands, gradient sweep, and brush-stroke color diffs
  float value = mix(zebra, gradientSweep, 0.38);
  value += (brushField - 0.5) * 0.42 * u_brushDiff;
  value = clamp(value, 0.0, 1.0);

  // 5. Map onto the active tritone palette + subtle paper/canvas grain
  vec3 col = tritoneMap(value, u_colorDark, u_colorMid, u_colorLight, u_contrast);
  col += paperGrain(gl_FragCoord.xy) * u_grain;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
