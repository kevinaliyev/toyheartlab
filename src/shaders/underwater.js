import { COMMON_GLSL } from './common.glsl.js';
import { colorSeedParam, GRADIENT_UNIFORMS_GLSL, GRADIENT_SAMPLER_GLSL } from './shader-params.js';

export const underwaterStudy = {
  id: 'underwater',
  name: 'Underwater Caustics',
  description:
    'Sunlit oceanic depth with volumetric god-rays streaming from the surface, dancing refraction caustics, gentle current sway, and drifting marine particulates.',
  mode: 'single',
  usesTritone: false,
  usesGradient: true,
  params: [
    { key: 'u_speed', label: 'Current Speed', group: 'Water & Light', min: 0.1, max: 2.5, step: 0.05, default: 0.75 },
    { key: 'u_causticScale', label: 'Caustic Scale', group: 'Water & Light', min: 1.5, max: 9.0, step: 0.1, default: 4.2 },
    { key: 'u_causticAmt', label: 'Caustic Intensity', group: 'Water & Light', min: 0.0, max: 1.5, step: 0.05, default: 0.85 },
    { key: 'u_godRays', label: 'Sun God-Rays', group: 'Water & Light', min: 0.0, max: 1.5, step: 0.05, default: 0.80 },
    { key: 'u_depth', label: 'Abyss Depth', group: 'Atmosphere', min: 0.1, max: 1.0, step: 0.05, default: 0.52 },
    { key: 'u_particulate', label: 'Marine Snow / Specks', group: 'Atmosphere', min: 0.0, max: 1.0, step: 0.05, default: 0.55 },
    colorSeedParam({ label: 'Water Hue Offset', group: 'Atmosphere' }),
  ],
  fragmentShader: /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_seed;

uniform float u_speed;
uniform float u_causticScale;
uniform float u_causticAmt;
uniform float u_godRays;
uniform float u_depth;
uniform float u_particulate;
${GRADIENT_UNIFORMS_GLSL}

${COMMON_GLSL}
${GRADIENT_SAMPLER_GLSL}

// Dual-layer interference caustic web
float evalCaustic(vec2 p, float t) {
  vec2 q = p;
  float accum = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 shift = vec2(
      sin(q.y * 1.7 + t * (0.65 + 0.15 * fi) + fi * 2.1),
      cos(q.x * 1.9 - t * (0.55 + 0.12 * fi) + fi * 1.4)
    ) * 0.45;
    float w = abs(vnoise((q + shift) * (1.2 + 0.35 * fi) + vec2(t * 0.15, -t * 0.12)) - 0.5) * 2.0;
    accum += pow(clamp(1.0 - w, 0.0, 1.0), 4.0);
    q *= 1.32;
  }
  return accum * 0.42;
}

// Floating soft marine particulates / plankton motes
float evalParticulate(vec2 uv, vec2 aspect, float scale, float t, uint seed) {
  vec2 p = (uv - 0.5) * aspect * scale;
  p.y -= t * 0.18;
  p.x += sin(t * 0.35 + p.y * 0.6) * 0.25;
  vec2 id = floor(p);
  vec2 f = fract(p);
  vec3 r = prng3f(uint(abs(id.x * 313.0 + id.y * 797.0)) + seed);
  if (r.x < 0.62) return 0.0;
  vec2 c = vec2(0.5) + (r.yz - 0.5) * 0.6;
  float d = length(f - c);
  float sz = mix(0.03, 0.08, r.z);
  return smoothstep(sz, 0.0, d) * (0.4 + 0.6 * sin(t * 1.6 + r.x * 6.28));
}

void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  uint baseSeed = uint(max(u_seed, 0.0) * 1000.0) + 1u;
  float waterPhase = colorSeedPhase();
  float t = u_time * u_speed;

  // Gentle underwater current sway
  vec2 sway = vec2(
    sin(v_uv.y * 5.0 + t * 0.9),
    cos(v_uv.x * 4.5 - t * 0.7)
  ) * 0.012;
  vec2 uv = v_uv + sway;

  // Ocean depth gradient: u_colorSeed shifts smoothly across turquoise -> cobalt -> bioluminescent emerald
  vec3 tintShift = 0.5 + 0.5 * cos(6.2831853 * (waterPhase + vec3(0.0, 0.28, 0.58)));
  vec3 abyssCol = mix(vec3(0.012, 0.045, 0.095), vec3(0.015, 0.032, 0.085) + tintShift * 0.03, smoothstep(0.0, 0.35, waterPhase));
  vec3 midCol = mix(vec3(0.035, 0.22, 0.34), mix(vec3(0.03, 0.16, 0.36), vec3(0.05, 0.28, 0.26), tintShift.g), smoothstep(0.0, 0.35, waterPhase));
  vec3 surfCol = mix(vec3(0.28, 0.74, 0.82), mix(vec3(0.22, 0.55, 0.90), vec3(0.24, 0.82, 0.72), tintShift.g), smoothstep(0.0, 0.35, waterPhase));

  if (u_useGradient > 0.5) {
    vec3 g0 = evalCosineGradient(0.15 + waterPhase);
    vec3 g1 = evalCosineGradient(0.65 + waterPhase);
    abyssCol = g0 * 0.18;
    midCol = mix(g0, g1, 0.5) * 0.62;
    surfCol = g1 * 1.05;
  }

  float depthCurve = pow(clamp(uv.y, 0.0, 1.0), mix(0.55, 1.65, u_depth));
  vec3 col = mix(abyssCol, midCol, smoothstep(0.0, 0.65, depthCurve));
  col = mix(col, surfCol, smoothstep(0.50, 1.0, depthCurve));

  // Volumetric angled god-rays streaming down from surface waves
  vec2 rayCoord = vec2((uv.x - 0.5) * aspect.x - (1.0 - uv.y) * 0.38, uv.y * 0.35);
  float rayNoise1 = vnoise(vec2(rayCoord.x * 4.2 + t * 0.22, rayCoord.y * 1.4 - t * 0.15) + u_seed);
  float rayNoise2 = vnoise(vec2(rayCoord.x * 8.5 - t * 0.18, rayCoord.y * 2.1 + t * 0.10) + u_seed * 2.3);
  float rays = pow(clamp(rayNoise1 * 0.65 + rayNoise2 * 0.35, 0.0, 1.0), 2.1);
  float rayFade = smoothstep(0.05, 0.92, uv.y);
  col += surfCol * rays * rayFade * u_godRays * 0.55;

  // Dancing underwater caustic web
  vec2 causticP = (uv - 0.5) * aspect * u_causticScale + u_seed * 3.1;
  float caustic = evalCaustic(causticP, t);
  float causticMask = smoothstep(0.05, 0.85, uv.y) * 0.7 + 0.3;
  col += mix(surfCol, vec3(0.88, 0.98, 1.0), 0.55) * caustic * causticMask * u_causticAmt * 0.52;

  // Drifting marine snow / sunlit plankton motes
  if (u_particulate > 0.01) {
    float p1 = evalParticulate(uv, aspect, 14.0, t, baseSeed + 11u);
    float p2 = evalParticulate(uv, aspect, 24.0, t * 0.65, baseSeed + 47u);
    col += vec3(0.75, 0.94, 0.98) * (p1 * 0.55 + p2 * 0.35) * u_particulate;
  }

  // Subtle surface shimmer band right at top edge
  float surfaceRip = smoothstep(0.88, 1.0, uv.y) * (0.5 + 0.5 * vnoise(vec2(uv.x * 14.0 + t * 1.2, t * 0.4)));
  col += vec3(0.75, 0.96, 1.0) * surfaceRip * 0.22;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
