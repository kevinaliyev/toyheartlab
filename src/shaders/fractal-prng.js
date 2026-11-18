import { COMMON_GLSL } from './common.glsl.js';
import { colorSeedParam, GRADIENT_UNIFORMS_GLSL, GRADIENT_SAMPLER_GLSL } from './shader-params.js';

export const fractalPrngStudy = {
  id: 'fractal-prng',
  name: 'Seeded Fractal',
  usesTritone: false,
  usesGradient: true,
  description:
    'Fast single-pass Julia & self-similar Feigenbaum Mandelbrot infinite zoom with 2D PCG PRNG noise, shape-preserving equipotential colouring, and PRNG grain.',
  params: [
    {
      key: 'u_zoomMode',
      label: 'Zoom Preset',
      group: 'Fractal & Zoom',
      type: 'select',
      default: 2,
      options: [
        { value: 0, label: 'Static (Julia Orbit)' },
        { value: 1, label: 'Log-Polar Rebuild' },
        { value: 2, label: 'Mandelbrot Infinite Cascade' },
      ],
    },
    { key: 'u_stackPresets', label: 'Stack Presets (Override)', group: 'Fractal & Zoom', type: 'toggle', default: false },
    { key: 'u_zoomSpeed', label: 'Zoom Speed', group: 'Fractal & Zoom', min: -1.5, max: 1.5, step: 0.05, default: 0.65 },
    { key: 'u_speed', label: 'Orbit / Drift Speed', group: 'Fractal & Zoom', min: 0.05, max: 2.0, step: 0.05, default: 0.45 },
    { key: 'u_zoom', label: 'Base Zoom', group: 'Fractal & Zoom', min: 0.5, max: 4.5, step: 0.05, default: 1.25 },
    { key: 'u_noiseAmt', label: 'PRNG Noise Warp', group: 'PRNG & Colour', min: 0.0, max: 0.6, step: 0.01, default: 0.14 },
    { key: 'u_noiseScale', label: 'Noise Scale', group: 'PRNG & Colour', min: 0.5, max: 6.0, step: 0.1, default: 2.2 },
    { key: 'u_colorSpread', label: 'Colour Spread', group: 'PRNG & Colour', min: 0.2, max: 3.0, step: 0.05, default: 1.15 },
    { key: 'u_colorCycle', label: 'Colour Cycle', group: 'PRNG & Colour', min: 0.0, max: 1.0, step: 0.02, default: 0.18 },
    colorSeedParam({ label: 'Colour Phase Offset', group: 'PRNG & Colour' }),
    { key: 'u_grain', label: 'PRNG Grain', group: 'PRNG & Colour', min: 0.0, max: 0.12, step: 0.005, default: 0.025 },
  ],
  fragmentShader: /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_seed;

uniform float u_zoomMode;
uniform float u_stackPresets;
uniform float u_zoomSpeed;
uniform float u_speed;
uniform float u_zoom;
uniform float u_noiseAmt;
uniform float u_noiseScale;
uniform float u_colorSpread;
uniform float u_colorCycle;
uniform float u_grain;
${GRADIENT_UNIFORMS_GLSL}

${COMMON_GLSL}
${GRADIENT_SAMPLER_GLSL}

vec2 rot2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c) * p;
}

// Original smooth escape-time & orbit-trap shading
vec3 shadeEscape(
  int escapedAt,
  int maxIter,
  vec2 z,
  float minDist,
  float axisTrap,
  uint colorSeed,
  float t,
  float colorPhaseShift
) {
  float cycle = t * u_colorCycle * 0.25 + colorPhaseShift;

  if (escapedAt >= 0) {
    float logZn = log2(max(dot(z, z), 1.0001)) * 0.5;
    float nu = log2(max(logZn, 1e-4));
    float smoothIter = max(0.0, float(escapedAt) + 1.0 - nu);
    float mu = clamp(smoothIter / float(maxIter), 0.0, 1.0);

    float trapGlow = exp(-sqrt(minDist) * 2.2);
    float paletteT = mu * u_colorSpread + trapGlow * 0.18 + cycle;
    vec3 col = sampleShaderPalette(paletteT, colorSeed);

    float edgeBoost = pow(clamp(mu * 2.6, 0.0, 1.0), 1.35);
    return col * mix(0.28, 1.15, edgeBoost);
  }

  float ringTrap = exp(-sqrt(minDist) * 3.2);
  float crossTrap = exp(-axisTrap * 5.5);
  float interiorVal = clamp(ringTrap * 0.65 + crossTrap * 0.45, 0.0, 1.0);
  vec3 innerCol = sampleShaderPalette(interiorVal * u_colorSpread + cycle, colorSeed + 211u);
  return innerCol * (0.18 + 0.85 * interiorVal);
}

vec3 evalJulia(vec2 z, vec2 c, uint colorSeed, float t, float colorPhaseShift) {
  const int MAX_ITER = 48;
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

  return shadeEscape(escapedAt, MAX_ITER, z, minDist, axisTrap, colorSeed, t, colorPhaseShift);
}

vec3 evalMandelbrot(vec2 c, int maxIter, uint colorSeed, float t, float colorPhaseShift) {
  vec2 z = vec2(0.0);
  float minDist = 1e6;
  float axisTrap = 1e6;
  int escapedAt = -1;

  for (int i = 0; i < 160; i++) {
    if (i >= maxIter) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    float d2 = dot(z, z);
    minDist = min(minDist, d2);
    axisTrap = min(axisTrap, min(abs(z.x), abs(z.y)));
    if (d2 > 256.0) {
      escapedAt = i;
      break;
    }
  }

  return shadeEscape(escapedAt, maxIter, z, minDist, axisTrap, colorSeed, t, colorPhaseShift);
}

vec2 getMandelbrotPathTarget(int idx) {
  int k = idx - (idx / 4) * 4;
  if (k == 0) return vec2(-0.74364388, 0.13182590); // Seahorse Valley Spiral
  if (k == 1) return vec2( 0.28171792, 0.57710528); // Elephant Valley Spiral
  if (k == 2) return vec2(-0.74542850, 0.11300890); // Double Spiral Filament
  return vec2(-1.25066000, 0.02012000);              // Period-2 Scepter Valley
}

// Deep single-precision Mandelbrot dive (1x -> ~100,000x) rotating across 4 curated branch targets
vec3 evalMandelbrotInfiniteCascade(
  vec2 uv,
  float baseAngle,
  vec2 warp,
  float effNoiseAmt,
  uint baseSeed,
  uint colorSeed,
  float t,
  out float outPhase
) {
  float speed = abs(u_zoomSpeed) < 0.02 ? 0.02 : u_zoomSpeed;
  float rawCycle = u_time * speed * 0.075;
  float cycleIdx = floor(rawCycle);
  float phase = fract(rawCycle);
  float zoomDepth = u_zoomSpeed >= 0.0 ? phase : (1.0 - phase);
  outPhase = zoomDepth;

  int seedOffset = int(prng1f(baseSeed + 7u) * 4.0);
  int idxA = int(mod(cycleIdx, 4.0)) + seedOffset;
  int idxB = idxA + 1;

  vec2 targetA = getMandelbrotPathTarget(idxA);
  // Keep scale above 32-bit float ULP quantization wall (~2,000x max) so pixels stay razor-sharp
  float scaleA = (1.8 / max(u_zoom, 0.1)) * exp(-zoomDepth * 7.6);
  int iterA = int(mix(64.0, 140.0, zoomDepth));

  vec2 rotUvA = rot2(uv, baseAngle * 0.2 + zoomDepth * 1.1);
  vec2 cA = targetA + rotUvA * scaleA + warp * (effNoiseAmt * scaleA * 0.22);
  vec3 colA = evalMandelbrot(cA, iterA, colorSeed + uint(idxA) * 37u, t, zoomDepth * 0.35);

  // Smoothly blend into the next target path during the final 12% of the dive
  float blend = smoothstep(0.88, 1.0, phase);
  if (blend > 0.001) {
    vec2 targetB = getMandelbrotPathTarget(idxB);
    float depthB = u_zoomSpeed >= 0.0 ? 0.0 : 1.0;
    float scaleB = (1.8 / max(u_zoom, 0.1)) * exp(-depthB * 7.6);
    vec2 rotUvB = rot2(uv, baseAngle * 0.2);
    vec2 cB = targetB + rotUvB * scaleB + warp * (effNoiseAmt * scaleB * 0.22);
    vec3 colB = evalMandelbrot(cB, 64, colorSeed + uint(idxB) * 37u, t, 0.0);
    return mix(colA, colB, blend);
  }
  return colA;
}

vec3 evalLogPolar(
  vec2 uv,
  float baseAngle,
  vec2 warp,
  float effNoiseAmt,
  vec2 juliaC,
  uint colorSeed,
  float t,
  float depth,
  float phaseShift
) {
  float r = max(length(uv), 1e-4);
  float theta = atan(uv.y, uv.x) + baseAngle;
  float logR = log(r) - depth;

  const float P = 2.1;
  float uA = mod(logR, P);
  float uB = mod(logR + 0.5 * P, P);

  float wA = sin(3.14159265 * (uA / P));
  wA *= wA;
  float wB = 1.0 - wA;

  float zoomScale = 1.45 / max(u_zoom, 0.1);
  vec2 dir = vec2(cos(theta), sin(theta));
  vec2 zA = dir * (exp(uA - 0.5 * P) * zoomScale) + warp * effNoiseAmt;
  vec2 zB = dir * (exp(uB - 0.5 * P) * zoomScale) + warp * effNoiseAmt;

  if (wA > 0.98) return evalJulia(zA, juliaC, colorSeed, t, phaseShift);
  if (wB > 0.98) return evalJulia(zB, juliaC, colorSeed, t, phaseShift);

  return evalJulia(zA, juliaC, colorSeed, t, phaseShift) * wA
       + evalJulia(zB, juliaC, colorSeed, t, phaseShift) * wB;
}

void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 uv = (v_uv - 0.5) * aspect;

  uint baseSeed = uint(max(u_seed, 0.0) * 1000.0) + 1u;
  uint colorSeed = computeColorSeed(baseSeed);
  float t = u_time * u_speed;

  vec3 seedVec = prng3f(baseSeed + 3u);
  float baseAngle = (seedVec.x - 0.5) * 3.14159 + t * 0.08;

  // Animated Julia parameter c orbiting near the Mandelbrot boundary
  float radius = mix(0.755, 0.805, seedVec.y);
  float phi = seedVec.z * 6.2831853 + t * 0.35;
  vec2 juliaC = vec2(radius * cos(phi), radius * sin(phi))
              + 0.075 * vec2(cos(2.0 * phi + 1.1), sin(3.0 * phi));

  // Single-evaluation 3-octave PRNG fBm domain warp
  vec2 warp = vec2(
    prngFbm3(uv * u_noiseScale + vec2(t * 0.22, -t * 0.17), baseSeed + 31u),
    prngFbm3(uv * u_noiseScale + vec2(-t * 0.19, t * 0.25) + 7.3, baseSeed + 61u)
  ) - 0.5;

  float depth = u_time * u_zoomSpeed;
  float surge = 0.5 + 0.5 * sin(depth * 1.15);
  float effNoiseAmt = u_noiseAmt * mix(0.45, 1.65, surge);
  float effGrain = u_grain;

  vec3 col;
  bool stacked = u_stackPresets > 0.5;

  if (stacked) {
    float phase = 0.0;
    vec3 mandelCol = evalMandelbrotInfiniteCascade(uv, baseAngle, warp, effNoiseAmt, baseSeed, colorSeed, t, phase);
    vec3 lpJulia = evalLogPolar(uv, -baseAngle * 0.5, warp, effNoiseAmt, juliaC, colorSeed + 53u, t, depth * 0.85, surge * 0.18);
    col = mix(mandelCol, lpJulia, 0.40);
  } else if (u_zoomMode < 0.5) {
    vec2 z = rot2(uv * (2.6 / max(u_zoom, 0.1)), baseAngle) + warp * u_noiseAmt;
    col = evalJulia(z, juliaC, colorSeed, t, 0.0);
  } else if (u_zoomMode < 1.5) {
    effGrain = u_grain * mix(0.45, 2.0, surge);
    col = evalLogPolar(uv, baseAngle, warp, effNoiseAmt, juliaC, colorSeed, t, depth, surge * 0.12);
  } else {
    float phase = 0.0;
    col = evalMandelbrotInfiniteCascade(uv, baseAngle, warp, effNoiseAmt, baseSeed, colorSeed, t, phase);
  }

  // Animated PRNG micro-grain
  float grain = prng2d(ivec2(gl_FragCoord.xy), baseSeed + uint(u_time * 60.0)) - 0.5;
  col += grain * effGrain;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
