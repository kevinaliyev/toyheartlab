import { COMMON_GLSL } from './common.glsl.js';

export const fractalPrngStudy = {
  id: 'fractal-prng',
  name: 'Seeded Fractal',
  usesTritone: false,
  usesGradient: true,
  description:
    'Animated Julia & Mandelbrot fractals with 2D PCG PRNG noise, logarithmic colour seeding, seamless deep-zoom looping, and optional preset stacking.',
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
        { value: 2, label: 'Mandelbrot Deep Zoom' },
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
    { key: 'u_colorSeed', label: 'Colour Seed Offset', group: 'PRNG & Colour', min: 0.0, max: 100.0, step: 1.0, default: 0.0 },
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

// Scale-invariant logarithmic escape shading + stripe-average interior orbit traps
vec3 shadeEscape(
  int escapedAt,
  vec2 z,
  float minDist,
  float axisTrap,
  float stripeAccum,
  uint colorSeed,
  float t,
  float colorPhaseShift
) {
  float cycle = t * u_colorCycle * 0.25 + colorPhaseShift;

  if (escapedAt >= 0) {
    float logZn = log2(max(dot(z, z), 1.0001)) * 0.5;
    float nu = log2(max(logZn, 1e-4));
    float smoothIter = max(1.0, float(escapedAt) + 1.0 - nu);

    // Logarithmic potential never saturates at deep zoom levels and never jumps with maxIter
    float logMu = log2(smoothIter + 1.0) * 0.26;
    float trapGlow = exp(-sqrt(minDist) * 2.2);
    float stripeMod = stripeAccum * 0.08;
    float paletteT = logMu * u_colorSpread + trapGlow * 0.16 + stripeMod + cycle;
    vec3 col = sampleGradient(paletteT, colorSeed);

    // Crisp filament contrast along high-iteration boundaries
    float band = 0.5 + 0.5 * sin(logMu * 12.5);
    float edgeBoost = mix(0.45, 1.18, smoothstep(0.0, 3.2, logMu) * (0.72 + 0.28 * band));
    return col * edgeBoost;
  }

  // Interior shading with angular stripe average + geometric orbit traps
  float ringTrap = exp(-sqrt(minDist) * 3.0);
  float crossTrap = exp(-axisTrap * 5.0);
  float interiorVal = clamp(ringTrap * 0.55 + crossTrap * 0.35 + stripeAccum * 0.35, 0.0, 1.0);
  vec3 innerCol = sampleGradient(interiorVal * u_colorSpread + cycle, colorSeed + 211u);
  return innerCol * (0.20 + 0.82 * interiorVal);
}

vec3 evalJulia(vec2 z, vec2 c, uint colorSeed, float t, float colorPhaseShift) {
  const int MAX_ITER = 48;
  float minDist = 1e6;
  float axisTrap = 1e6;
  float stripeAccum = 0.0;
  int escapedAt = -1;

  for (int i = 0; i < MAX_ITER; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    float d2 = dot(z, z);
    minDist = min(minDist, d2);
    axisTrap = min(axisTrap, min(abs(z.x), abs(z.y)));
    stripeAccum = mix(stripeAccum, 0.5 + 0.5 * sin(3.0 * atan(z.y, z.x)), 0.25);
    if (d2 > 256.0) {
      escapedAt = i;
      break;
    }
  }

  return shadeEscape(escapedAt, z, minDist, axisTrap, stripeAccum, colorSeed, t, colorPhaseShift);
}

vec3 evalMandelbrot(vec2 c, int maxIter, uint colorSeed, float t, float colorPhaseShift) {
  vec2 z = vec2(0.0);
  float minDist = 1e6;
  float axisTrap = 1e6;
  float stripeAccum = 0.0;
  int escapedAt = -1;

  for (int i = 0; i < 160; i++) {
    if (i >= maxIter) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    float d2 = dot(z, z);
    minDist = min(minDist, abs(d2 - 0.35));
    axisTrap = min(axisTrap, min(abs(z.x), abs(z.y)));
    if (i > 2) {
      stripeAccum = mix(stripeAccum, 0.5 + 0.5 * sin(4.0 * atan(z.y, z.x)), 0.22);
    }
    if (d2 > 256.0) {
      escapedAt = i;
      break;
    }
  }

  return shadeEscape(escapedAt, z, minDist, axisTrap, stripeAccum, colorSeed, t, colorPhaseShift);
}

// High-detail self-similar Mandelbrot boundary targets (Seahorse, Spiral, Scepter, Tendril)
vec2 getMandelbrotTarget(float sel) {
  if (sel < 0.25) return vec2(-0.74364388, 0.13182590); // Seahorse Valley Spiral
  if (sel < 0.50) return vec2(-0.74542800, 0.11300900); // Double Spiral Filament
  if (sel < 0.75) return vec2(-1.25066000, 0.02012000); // Period-2 Scepter Valley
  return vec2(-0.10109636, 0.95628651);                 // Top Lightning Dendrite
}

// Evaluate one octave of the Mandelbrot Deep Zoom at normalized depth in [0, 1]
vec3 sampleMandelbrotOctave(
  vec2 uv,
  float normDepth,
  float baseAngle,
  vec2 mandelTarget,
  uint baseSeed,
  uint colorSeed,
  float t
) {
  // Exponential zoom over e^6.4 (~600x per octave, well within 32-bit float & 160 iterations)
  const float OCTAVE_SPAN = 6.4;
  float expDepth = normDepth * OCTAVE_SPAN;
  float mandelScale = exp(-expDepth) * (2.4 / max(u_zoom, 0.1));
  int dynIter = int(mix(64.0, 160.0, normDepth));

  // Rotate and evaluate PRNG warp in the zooming coordinate frame so noise zooms with the fractal
  vec2 rotUv = rot2(uv, baseAngle * 0.25 + normDepth * 0.85);
  float mandelPrng = mix(0.35, 1.85, normDepth);
  vec2 localWarp = vec2(
    prngFbm3(rotUv * u_noiseScale + vec2(t * 0.18, -t * 0.14), baseSeed + 31u),
    prngFbm3(rotUv * u_noiseScale + vec2(-t * 0.15, t * 0.20) + 7.3, baseSeed + 61u)
  ) - 0.5;

  vec2 c = mandelTarget + (rotUv + localWarp * (u_noiseAmt * mandelPrng * 0.35)) * mandelScale;
  return evalMandelbrot(c, dynIter, colorSeed, t, normDepth * 0.24);
}

// Seamless 2-octave exponential Mandelbrot Deep Zoom (works forward & reverse with zero loop jump)
vec3 evalMandelbrotDeepZoom(
  vec2 uv,
  float baseAngle,
  vec2 mandelTarget,
  uint baseSeed,
  uint colorSeed,
  float t,
  out float outSurge
) {
  float speed = abs(u_zoomSpeed) < 0.02 ? 0.02 : u_zoomSpeed;
  float rawCycle = u_time * speed * 0.11;

  // Two overlapping exponential zoom phases offset by 0.5 cycle
  float phaseA = fract(rawCycle);
  float phaseB = fract(rawCycle + 0.5);

  // Smooth C1 Hann window weights: wA = 0 at phaseA = 0 and phaseA = 1
  float wA = sin(3.14159265 * phaseA);
  wA *= wA;
  float wB = 1.0 - wA;

  outSurge = 0.5 + 0.5 * sin(rawCycle * 6.2831853);

  if (wA > 0.985) {
    return sampleMandelbrotOctave(uv, phaseA, baseAngle, mandelTarget, baseSeed, colorSeed, t);
  }
  if (wB > 0.985) {
    return sampleMandelbrotOctave(uv, phaseB, baseAngle + 0.425, mandelTarget, baseSeed + 19u, colorSeed, t);
  }

  vec3 colA = sampleMandelbrotOctave(uv, phaseA, baseAngle, mandelTarget, baseSeed, colorSeed, t);
  vec3 colB = sampleMandelbrotOctave(uv, phaseB, baseAngle + 0.425, mandelTarget, baseSeed + 19u, colorSeed, t);
  return colA * wA + colB * wB;
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
      ? evalMandelbrot(zA, 96, colorSeed, t, phaseShift)
      : evalJulia(zA, juliaC, colorSeed, t, phaseShift);
  }
  if (wB > 0.98) {
    return useMandelbrot
      ? evalMandelbrot(zB, 96, colorSeed, t, phaseShift)
      : evalJulia(zB, juliaC, colorSeed, t, phaseShift);
  }

  vec3 colA = useMandelbrot
    ? evalMandelbrot(zA, 96, colorSeed, t, phaseShift)
    : evalJulia(zA, juliaC, colorSeed, t, phaseShift);
  vec3 colB = useMandelbrot
    ? evalMandelbrot(zB, 96, colorSeed, t, phaseShift)
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
    // Stack Log-Polar Rebuild onto seamless Mandelbrot Deep Zoom
    float mandelSurge = 0.0;
    vec3 deepMandel = evalMandelbrotDeepZoom(uv, baseAngle, mandelTarget, baseSeed, colorSeed, t, mandelSurge);
    vec3 lpJulia = evalLogPolar(
      uv, -baseAngle * 0.5, warp, effNoiseAmt, juliaC, mandelTarget,
      false, colorSeed + 53u, t, depth * 0.85, surge * 0.18
    );
    effGrain = u_grain * mix(0.45, 1.8, mandelSurge);
    col = mix(deepMandel, lpJulia, 0.42);
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
    // Preset 2: Seamless 2-Octave Mandelbrot Deep Zoom
    float mandelSurge = 0.0;
    col = evalMandelbrotDeepZoom(uv, baseAngle, mandelTarget, baseSeed, colorSeed, t, mandelSurge);
    effGrain = u_grain * mix(0.4, 1.75, mandelSurge);
  }

  // Animated PRNG micro-grain
  float grain = prng2d(ivec2(gl_FragCoord.xy), baseSeed + uint(u_time * 60.0)) - 0.5;
  col += grain * effGrain;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
