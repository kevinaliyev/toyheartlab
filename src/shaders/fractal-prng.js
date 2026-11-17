import { COMMON_GLSL } from './common.glsl.js';

export const fractalPrngStudy = {
  id: 'fractal-prng',
  name: 'Study C — Seeded Fractal',
  description:
    'Animated Julia fractal warped by 2D PCG PRNG noise with deterministic colour seeding and orbit-trap shading.',
  params: [
    { key: 'u_speed', label: 'Speed', min: 0.05, max: 2.0, step: 0.05, default: 0.45 },
    { key: 'u_zoom', label: 'Zoom', min: 0.5, max: 4.5, step: 0.05, default: 1.35 },
    { key: 'u_noiseAmt', label: 'PRNG Noise Warp', min: 0.0, max: 0.6, step: 0.01, default: 0.14 },
    { key: 'u_noiseScale', label: 'Noise Scale', min: 0.5, max: 6.0, step: 0.1, default: 2.2 },
    { key: 'u_colorSpread', label: 'Colour Spread', min: 0.2, max: 3.0, step: 0.05, default: 1.15 },
    { key: 'u_colorCycle', label: 'Colour Cycle', min: 0.0, max: 1.0, step: 0.02, default: 0.18 },
    { key: 'u_colorSeed', label: 'Colour Seed Offset', min: 0.0, max: 100.0, step: 1.0, default: 0.0 },
    { key: 'u_grain', label: 'PRNG Grain', min: 0.0, max: 0.12, step: 0.005, default: 0.025 },
  ],
  fragmentShader: /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_seed;

uniform float u_speed;
uniform float u_zoom;
uniform float u_noiseAmt;
uniform float u_noiseScale;
uniform float u_colorSpread;
uniform float u_colorCycle;
uniform float u_colorSeed;
uniform float u_grain;

${COMMON_GLSL}

void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 uv = (v_uv - 0.5) * aspect * (2.6 / max(u_zoom, 0.1));

  uint baseSeed = uint(max(u_seed, 0.0) * 1000.0) + 1u;
  uint colorSeed = baseSeed + uint(max(u_colorSeed, 0.0)) * 97u;
  float t = u_time * u_speed;

  // Seeded rotation and gentle breathing of the complex plane
  vec3 seedVec = prng3f(baseSeed + 3u);
  float angle = (seedVec.x - 0.5) * 3.14159 + t * 0.08;
  float ca = cos(angle);
  float sa = sin(angle);
  vec2 z = mat2(ca, -sa, sa, ca) * uv;

  // 2D PCG PRNG fBm domain warp
  vec2 warp = vec2(
    prngFbm(z * u_noiseScale + vec2(t * 0.22, -t * 0.17), baseSeed + 31u),
    prngFbm(z * u_noiseScale + vec2(-t * 0.19, t * 0.25) + 7.3, baseSeed + 61u)
  ) - 0.5;
  z += warp * u_noiseAmt;

  // Animated Julia parameter c orbiting near the Mandelbrot boundary
  float radius = mix(0.755, 0.805, seedVec.y);
  float phi = seedVec.z * 6.2831853 + t * 0.35;
  vec2 c = vec2(radius * cos(phi), radius * sin(phi))
         + 0.075 * vec2(cos(2.0 * phi + 1.1), sin(3.0 * phi));

  const int MAX_ITER = 80;
  float minDist = 1e6;
  float axisTrap = 1e6;
  int escapedAt = -1;

  for (int i = 0; i < MAX_ITER; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    float d2 = dot(z, z);
    minDist = min(minDist, d2);
    axisTrap = min(axisTrap, min(abs(z.x), abs(z.y)));

    if (d2 > 256.0) {
      escapedAt = i;
      break;
    }
  }

  vec3 col;
  float cycle = t * u_colorCycle * 0.25;

  if (escapedAt >= 0) {
    // Smooth continuous escape-time potential
    float logZn = log2(dot(z, z)) * 0.5;
    float nu = log2(max(logZn, 1e-4));
    float smoothIter = float(escapedAt) + 1.0 - nu;
    float mu = clamp(smoothIter / float(MAX_ITER), 0.0, 1.0);

    float trapGlow = exp(-sqrt(minDist) * 2.2);
    float paletteT = mu * u_colorSpread + trapGlow * 0.18 + cycle;
    col = seededCosinePalette(paletteT, colorSeed);

    // Subtle filament highlight near the fractal boundary
    float edgeBoost = pow(clamp(mu * 2.6, 0.0, 1.0), 1.35);
    col *= mix(0.28, 1.15, edgeBoost);
  } else {
    // Interior orbit-trap shading with secondary seeded palette
    float ringTrap = exp(-sqrt(minDist) * 3.2);
    float crossTrap = exp(-axisTrap * 5.5);
    float interiorVal = clamp(ringTrap * 0.65 + crossTrap * 0.45, 0.0, 1.0);

    vec3 innerCol = seededCosinePalette(interiorVal * u_colorSpread + cycle, colorSeed + 211u);
    col = innerCol * (0.18 + 0.85 * interiorVal);
  }

  // Subtle animated PRNG micro-grain
  float grain = prng2d(ivec2(gl_FragCoord.xy), baseSeed + uint(u_time * 60.0)) - 0.5;
  col += grain * u_grain;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
