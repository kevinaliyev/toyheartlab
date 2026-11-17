import { COMMON_GLSL } from './common.glsl.js';

export const fluidAdvectStudy = {
  id: 'fluid-advect',
  name: 'Fluid Advection',
  description:
    'Divergence-free curl-noise fluid simulation with semi-Lagrangian dye advection, orbiting emitters, and liquid surface sheen.',
  mode: 'pingpong',
  usesTritone: false,
  usesGradient: true,
  params: [
    { key: 'u_flowSpeed', label: 'Flow Speed', min: 0.1, max: 2.5, step: 0.05, default: 0.85 },
    { key: 'u_scale', label: 'Curl Scale', min: 1.0, max: 8.0, step: 0.1, default: 3.2 },
    { key: 'u_turbulence', label: 'Turbulence', min: 0.1, max: 2.0, step: 0.05, default: 0.95 },
    { key: 'u_dissipation', label: 'Dissipation', min: 0.94, max: 0.998, step: 0.002, default: 0.986 },
    { key: 'u_emitters', label: 'Emitters', min: 1, max: 4, step: 1, default: 2 },
    { key: 'u_sheen', label: 'Liquid Sheen', min: 0.0, max: 1.0, step: 0.02, default: 0.45 },
    { key: 'u_colorSpread', label: 'Colour Spread', min: 0.4, max: 3.0, step: 0.05, default: 1.35 },
    { key: 'u_colorSeed', label: 'Colour Seed Offset', min: 0.0, max: 100.0, step: 1.0, default: 0.0 },
  ],
  simShader: /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outState;

uniform sampler2D u_prevTex;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_seed;

uniform float u_flowSpeed;
uniform float u_scale;
uniform float u_turbulence;
uniform float u_dissipation;
uniform float u_emitters;

${COMMON_GLSL}

// Divergence-free 2D curl velocity from smooth value-noise streamfunction
vec2 curlVelocity(vec2 p, float t) {
  const float eps = 0.015;
  float n1 = fbm(p + vec2(0.0, eps) + vec2(t * 0.14, -t * 0.11));
  float n2 = fbm(p - vec2(0.0, eps) + vec2(t * 0.14, -t * 0.11));
  float n3 = fbm(p + vec2(eps, 0.0) + vec2(t * 0.14, -t * 0.11));
  float n4 = fbm(p - vec2(eps, 0.0) + vec2(t * 0.14, -t * 0.11));
  float dPsiDy = (n1 - n2) / (2.0 * eps);
  float dPsiDx = (n3 - n4) / (2.0 * eps);
  return vec2(dPsiDy, -dPsiDx);
}

void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 p = (v_uv - 0.5) * aspect * u_scale + u_seed * 7.13;
  float t = u_time * u_flowSpeed;

  // 1. Curl-noise velocity field (divergence-free)
  vec2 vel = curlVelocity(p, t) * u_turbulence * 0.0045 * u_flowSpeed;
  vec2 prevUv = clamp(v_uv - vel / aspect, vec2(0.001), vec2(0.999));

  // 2. Semi-Lagrangian advection + gentle 4-tap viscous diffusion
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  vec4 advected = texture(u_prevTex, prevUv);
  vec4 blur = (
    texture(u_prevTex, prevUv + vec2(px.x, 0.0)) +
    texture(u_prevTex, prevUv - vec2(px.x, 0.0)) +
    texture(u_prevTex, prevUv + vec2(0.0, px.y)) +
    texture(u_prevTex, prevUv - vec2(0.0, px.y))
  ) * 0.25;
  vec4 state = mix(advected, blur, 0.08) * u_dissipation;

  // 3. Seeded orbiting fluid dye emitters
  uint baseSeed = uint(max(u_seed, 0.0) * 1000.0) + 1u;
  int count = int(clamp(u_emitters, 1.0, 4.0) + 0.5);

  for (int i = 0; i < 4; i++) {
    if (i >= count) break;
    vec3 r = prng3f(baseSeed + uint(i) * 43u + 11u);
    float ang = t * (0.45 + 0.35 * r.x) * (i % 2 == 0 ? 1.0 : -1.0) + r.y * 6.28318;
    float rad = 0.16 + 0.14 * sin(t * (0.3 + 0.2 * r.z) + r.x * 6.28318);
    vec2 emitterPos = vec2(0.5) + vec2(cos(ang), sin(ang * 1.15)) * rad / aspect;

    float d = length((v_uv - emitterPos) * aspect);
    float inject = exp(-d * d * 520.0);
    float huePhase = fract(r.z + t * 0.04 + float(i) * 0.27);
    state.r = min(1.5, state.r + inject * 0.26);
    state.g = mix(state.g, huePhase, clamp(inject * 0.65, 0.0, 1.0));
  }

  // Store curl magnitude in .b for vorticity shading
  state.b = mix(state.b, clamp(length(vel) * 120.0, 0.0, 1.0), 0.25);
  outState = vec4(clamp(state.rgb, 0.0, 1.5), 1.0);
}
`,
  displayShader: /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_simTex;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_seed;

uniform float u_sheen;
uniform float u_colorSpread;
uniform float u_colorSeed;
uniform float u_useGradient;
uniform vec3 u_gradA;
uniform vec3 u_gradB;
uniform vec3 u_gradC;
uniform vec3 u_gradD;

${COMMON_GLSL}

vec3 sampleFluidGradient(float t, uint colorSeed) {
  if (u_useGradient > 0.5) {
    return clamp(u_gradA + u_gradB * cos(6.2831853 * (u_gradC * t + u_gradD)), 0.0, 1.0);
  }
  return seededCosinePalette(t, colorSeed);
}

void main() {
  vec2 px = 1.5 / max(u_resolution, vec2(1.0));
  vec4 s = texture(u_simTex, v_uv);
  float density = clamp(s.r, 0.0, 1.0);
  float phase = s.g;
  float vort = s.b;

  // Finite-difference surface normal for liquid sheen
  float dx = texture(u_simTex, v_uv + vec2(px.x, 0.0)).r - texture(u_simTex, v_uv - vec2(px.x, 0.0)).r;
  float dy = texture(u_simTex, v_uv + vec2(0.0, px.y)).r - texture(u_simTex, v_uv - vec2(0.0, px.y)).r;
  vec3 normal = normalize(vec3(-dx * 6.0, -dy * 6.0, 0.35));
  vec3 lightDir = normalize(vec3(0.45, 0.65, 0.60));
  float spec = pow(max(dot(normal, lightDir), 0.0), 18.0) * u_sheen;

  uint baseSeed = uint(max(u_seed, 0.0) * 1000.0) + 1u;
  uint colorSeed = baseSeed + uint(max(u_colorSeed, 0.0)) * 97u;

  float gradT = density * u_colorSpread + phase * 0.85 + vort * 0.25;
  vec3 fluidCol = sampleFluidGradient(gradT, colorSeed);

  // Dark fluid substrate with glowing dye filaments and specular highlight
  vec3 bg = sampleFluidGradient(0.05, colorSeed) * 0.08;
  vec3 col = mix(bg, fluidCol, smoothstep(0.02, 0.72, density));
  col += vec3(0.95, 0.97, 1.0) * spec * smoothstep(0.08, 0.6, density);

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
