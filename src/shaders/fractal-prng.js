import { COMMON_GLSL } from './common.glsl.js';

export const fractalPrngStudy = {
  id: 'fractal-prng',
  name: 'Study C — Seeded Fractal',
  description:
    'Animated Julia & Mandelbrot fractals with 2D PCG PRNG noise, colour seeding, exclusive zoom presets, and optional preset stacking.',
  params: [
    {
      key: 'u_zoomMode',
      label: 'Zoom Preset',
      type: 'select',
      default: 2,
      options: [
        { value: 0, label: 'Static (Julia Orbit)' },
        { value: 1, label: 'Log-Polar Rebuild' },
        { value: 2, label: 'Mandelbrot Deep Zoom' },
      ],
    },
    { key: 'u_stackPresets', label: 'Stack Presets (Override)', type: 'toggle', default: false },
    { key: 'u_zoomSpeed', label: 'Zoom Speed', min: -1.5, max: 1.5, step: 0.05, default: 0.65 },
    { key: 'u_speed', label: 'Orbit / Drift Speed', min: 0.05, max: 2.0, step: 0.05, default: 0.45 },
    { key: 'u_zoom', label: 'Base Zoom', min: 0.5, max: 4.5, step: 0.05, default: 1.25 },
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

uniform float u_zoomMode;
uniform float u_stackPresets;
uniform float u_zoomSpeed;
uniform float u_speed;
uniform float u_zoom;
uniform float u_noiseAmt;
uniform float u_noiseScale;
uniform float u_colorSpread;
uniform float u_colorCycle;
uniform float u_colorSeed;
uniform float u_grain;

uniform float u_useGradient;
uniform vec3 u_gradA;
uniform vec3 u_gradB;
uniform vec3 u_gradC;
uniform vec3 u_gradD;

${COMMON_GLSL}

vec3 sampleGradient(float t, uint colorSeed) {
  if (u_useGradient > 0.5) {
    return clamp(u_gradA + u_gradB * cos(6.2831853 * (u_gradC * t + u_gradD)), 0.0, 1.0);
  }
  return seededCosinePalette(t, colorSeed);
}

vec2 rot2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c) * p;
}

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
    float logZn = log2(dot(z, z)) * 0.5;
    float nu = log2(max(logZn, 1e-4));
    float smoothIter = float(escapedAt) + 1.0 - nu;
    float mu = clamp(smoothIter / float(maxIter), 0.0, 1.0);

    float trapGlow = exp(-sqrt(minDist) * 2.2);
    float paletteT = mu * u_colorSpread + trapGlow * 0.18 + cycle;
    vec3 col = sampleGradient(paletteT, colorSeed);

    float edgeBoost = pow(clamp(mu * 2.6, 0.0, 1.0), 1.35);
    return col * mix(0.28, 1.15, edgeBoost);
  }

  float ringTrap = exp(-sqrt(minDist) * 3.2);
  float crossTrap = exp(-axisTrap * 5.5);
  float interiorVal = clamp(ringTrap * 0.65 + crossTrap * 0.45, 0.0, 1.0);
  vec3 innerCol = sampleGradient(interiorVal * u_colorSpread + cycle, colorSeed + 211u);
  return innerCol * (0.18 + 0.85 * interiorVal);
}

vec3 evalJulia(vec2 z, vec2 c, uint colorSeed, float t, float colorPhaseShift) {
  const int MAX_ITER = 36;
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
  // Cardioid & period-2 bulb early-out to save GPU cycles
  float q = (c.x - 0.25) * (c.x - 0.25) + c.y * c.y;
  bool inCardioid = q * (q + (c.x - 0.25)) < 0.25 * c.y * c.y;
  bool inBulb = (c.x + 1.0) * (c.x + 1.0) + c.y * c.y < 0.0625;
  if (inCardioid || inBulb) {
    return shadeEscape(-1, maxIter, vec2(0.0), 0.15, 0.15, colorSeed, t, colorPhaseShift);
  }

  vec2 z = vec2(0.0);
  float minDist = 1e6;
  float axisTrap = 1e6;
  int escapedAt = -1;

  for (int i = 0; i < 96; i++) {
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

vec2 getMandelbrotTarget(float sel) {
  if (sel < 0.25) return vec2(-0.74364388, 0.13182590); // Seahorse Valley
  if (sel < 0.50) return vec2(-0.74529000, 0.11307500); // Mini-Mandelbrot Spiral
  if (sel < 0.75) return vec2( 0.28171792, 0.57710528); // Elephant Spiral
  return vec2(-1.25066000, 0.02012000);                 // Period-2 Tendril
}

vec3 evalLogPolar(
  vec2 uv,
  float baseAngle,
  vec2 warp,
  float effNoiseAmt,
  vec2 juliaC,
  vec2 mandelTarget,
  bool useMandelbrot,
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

  if (useMandelbrot) {
    zA = mandelTarget + zA * 0.18;
    zB = mandelTarget + zB * 0.18;
  }

  if (wA > 0.98) {
    return useMandelbrot
      ? evalMandelbrot(zA, 64, colorSeed, t, phaseShift)
      : evalJulia(zA, juliaC, colorSeed, t, phaseShift);
  }
  if (wB > 0.98) {
    return useMandelbrot
      ? evalMandelbrot(zB, 64, colorSeed, t, phaseShift)
      : evalJulia(zB, juliaC, colorSeed, t, phaseShift);
  }

  vec3 colA = useMandelbrot
    ? evalMandelbrot(zA, 64, colorSeed, t, phaseShift)
    : evalJulia(zA, juliaC, colorSeed, t, phaseShift);
  vec3 colB = useMandelbrot
    ? evalMandelbrot(zB, 64, colorSeed, t, phaseShift)
    : evalJulia(zB, juliaC, colorSeed, t, phaseShift);
  return colA * wA + colB * wB;
}

void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 uv = (v_uv - 0.5) * aspect;

  uint baseSeed = uint(max(u_seed, 0.0) * 1000.0) + 1u;
  uint colorSeed = baseSeed + uint(max(u_colorSeed, 0.0)) * 97u;
  float t = u_time * u_speed;

  vec3 seedVec = prng3f(baseSeed + 3u);
  float baseAngle = (seedVec.x - 0.5) * 3.14159 + t * 0.08;

  // Animated Julia parameter c orbiting near the Mandelbrot boundary
  float radius = mix(0.755, 0.805, seedVec.y);
  float phi = seedVec.z * 6.2831853 + t * 0.35;
  vec2 juliaC = vec2(radius * cos(phi), radius * sin(phi))
              + 0.075 * vec2(cos(2.0 * phi + 1.1), sin(3.0 * phi));

  vec2 mandelTarget = getMandelbrotTarget(seedVec.y);

  // Single-evaluation 3-octave PRNG fBm domain warp
  vec2 warp = vec2(
    prngFbm3(uv * u_noiseScale + vec2(t * 0.22, -t * 0.17), baseSeed + 31u),
    prngFbm3(uv * u_noiseScale + vec2(-t * 0.19, t * 0.25) + 7.3, baseSeed + 61u)
  ) - 0.5;

  float depth = u_time * u_zoomSpeed;
  float surge = 0.5 + 0.5 * sin(depth * 1.15);
  float dirBoost = smoothstep(-1.5, 1.5, u_zoomSpeed);
  float prngMult = mix(0.30, 2.20, surge) * mix(0.65, 1.35, dirBoost);
  float effNoiseAmt = u_noiseAmt * prngMult;
  float effGrain = u_grain;

  vec3 col;
  bool stacked = u_stackPresets > 0.5;

  if (stacked) {
    // Experimental override: stack Log-Polar Rebuild onto Mandelbrot Deep Zoom + Julia Orbit
    effGrain = u_grain * mix(0.45, 2.0, surge);
    vec3 lpMandel = evalLogPolar(
      uv, baseAngle, warp, effNoiseAmt, juliaC, mandelTarget,
      true, colorSeed, t, depth, surge * 0.12
    );
    vec3 lpJulia = evalLogPolar(
      uv, -baseAngle * 0.5, warp, effNoiseAmt, juliaC, mandelTarget,
      false, colorSeed + 53u, t, depth * 0.85, surge * 0.18
    );
    col = mix(lpMandel, lpJulia, 0.38);
  } else if (u_zoomMode < 0.5) {
    // Preset 0: Static Julia Orbit
    vec2 z = rot2(uv * (2.6 / max(u_zoom, 0.1)), baseAngle) + warp * u_noiseAmt;
    col = evalJulia(z, juliaC, colorSeed, t, 0.0);
  } else if (u_zoomMode < 1.5) {
    // Preset 1: Log-Polar Rebuild (Julia)
    effGrain = u_grain * mix(0.45, 2.0, surge);
    col = evalLogPolar(
      uv, baseAngle, warp, effNoiseAmt, juliaC, mandelTarget,
      false, colorSeed, t, depth, surge * 0.12
    );
  } else {
    // Preset 2: Crisp single-pass one-way Mandelbrot Deep Zoom (1x -> ~36,000x)
    float zoomPhase = fract(u_time * max(abs(u_zoomSpeed), 0.05) * 0.10);
    float zoomDepth = u_zoomSpeed >= 0.0 ? zoomPhase : (1.0 - zoomPhase);
    float mandelScale = exp(-zoomDepth * 10.5) * (2.5 / max(u_zoom, 0.1));
    int dynIter = int(mix(48.0, 96.0, zoomDepth));

    // PRNG effects intensify as the camera dives deeper
    float mandelPrng = mix(0.25, 2.25, zoomDepth);
    effGrain = u_grain * mix(0.4, 1.9, zoomDepth);

    vec2 c = mandelTarget
           + rot2(uv, baseAngle * 0.25 + zoomDepth * 0.6) * mandelScale
           + warp * (u_noiseAmt * mandelPrng * mandelScale * 0.32);
    col = evalMandelbrot(c, dynIter, colorSeed, t, zoomDepth * 0.18);

    // Subtle transition only at the very end of the 36,000x dive before wrapping
    float wrapFade = smoothstep(0.93, 1.0, zoomPhase);
    if (wrapFade > 0.001) {
      vec2 cStart = mandelTarget + rot2(uv, baseAngle * 0.25) * (2.5 / max(u_zoom, 0.1));
      vec3 colStart = evalMandelbrot(cStart, 48, colorSeed, t, 0.0);
      col = mix(col, colStart, wrapFade);
    }
  }

  // Animated PRNG micro-grain
  float grain = prng2d(ivec2(gl_FragCoord.xy), baseSeed + uint(u_time * 60.0)) - 0.5;
  col += grain * effGrain;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
