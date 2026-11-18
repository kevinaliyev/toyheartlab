import { COMMON_GLSL } from './common.glsl.js';
import { colorSeedParam, GRADIENT_UNIFORMS_GLSL, GRADIENT_SAMPLER_GLSL } from './shader-params.js';

export const bubbleScreenStudy = {
  id: 'bubble-screen',
  name: 'Bubble Screen',
  description:
    'Iridescent thin-film soap bubbles drifting across the screen with studio reflections. In Sandbox, drag or orbit 2D objects (or click) to pop bubbles into mist rings.',
  mode: 'pingpong',
  usesTritone: false,
  usesGradient: true,
  supportsObjects: true,
  params: [
    {
      key: 'u_bgStyle',
      label: 'Backdrop',
      group: 'Stage & Look',
      type: 'select',
      default: 0,
      options: [
        { value: 0, label: 'Iridescent Dusk Sky' },
        { value: 1, label: 'Dark Prism Studio' },
        { value: 2, label: 'Soft Morning Sky' },
      ],
    },
    { key: 'u_density', label: 'Bubble Density', group: 'Bubbles', min: 3.0, max: 12.0, step: 0.5, default: 6.5 },
    { key: 'u_bubbleSize', label: 'Bubble Size', group: 'Bubbles', min: 0.35, max: 1.0, step: 0.05, default: 0.72 },
    { key: 'u_speed', label: 'Drift Speed', group: 'Bubbles', min: 0.1, max: 2.5, step: 0.05, default: 0.85 },
    { key: 'u_iridescence', label: 'Soap Iridescence', group: 'Surface & Light', min: 0.1, max: 1.5, step: 0.05, default: 1.0 },
    { key: 'u_shine', label: 'Bubble Shine', group: 'Surface & Light', min: 0.0, max: 1.5, step: 0.05, default: 0.62 },
    { key: 'u_filmSpeed', label: 'Film Swirl', group: 'Surface & Light', min: 0.1, max: 2.0, step: 0.05, default: 0.75 },
    colorSeedParam({ label: 'Film Phase Offset', group: 'Surface & Light' }),
  ],
  simShader: /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outState;

uniform sampler2D u_prevTex;
uniform float u_time;
uniform vec2 u_resolution;

uniform vec4 u_pointer;     // x, y, down, strength
uniform float u_objectCount;
uniform vec4 u_objectPos[8];

void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));

  // Softly diffuse & decay pop-state (.r = pop energy, .g = expanding mist ring)
  vec4 prev = texture(u_prevTex, v_uv);
  vec4 blur = (
    texture(u_prevTex, v_uv + vec2(px.x * 2.0, 0.0)) +
    texture(u_prevTex, v_uv - vec2(px.x * 2.0, 0.0)) +
    texture(u_prevTex, v_uv + vec2(0.0, px.y * 2.0)) +
    texture(u_prevTex, v_uv - vec2(0.0, px.y * 2.0))
  ) * 0.25;

  float popField = mix(prev.r, blur.r, 0.08) * 0.988;
  float ringWave = mix(prev.g, blur.g, 0.25) * 0.93;

  // Stamp pop triggers from 2D Sandbox objects
  int count = int(u_objectCount + 0.5);
  for (int i = 0; i < 8; i++) {
    if (i >= count) break;
    vec4 obj = u_objectPos[i];
    if (abs(obj.w) < 0.001) continue;
    float d = length((v_uv - obj.xy) * aspect);
    float r = max(obj.z * 0.65, 0.028);
    float hit = smoothstep(r, r * 0.2, d);
    if (hit > 0.01) {
      popField = max(popField, hit);
      ringWave = max(ringWave, hit * 0.9);
    }
  }

  // Stamp pop trigger on cursor click/drag
  if (u_pointer.z > 0.5 && abs(u_pointer.w) > 0.01) {
    float d = length((v_uv - u_pointer.xy) * aspect);
    float hit = smoothstep(0.055, 0.012, d);
    popField = max(popField, hit);
    ringWave = max(ringWave, hit);
  }

  outState = vec4(clamp(popField, 0.0, 1.0), clamp(ringWave, 0.0, 1.0), 0.0, 1.0);
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

uniform float u_bgStyle;
uniform float u_density;
uniform float u_bubbleSize;
uniform float u_speed;
uniform float u_iridescence;
uniform float u_shine;
uniform float u_filmSpeed;
${GRADIENT_UNIFORMS_GLSL}

${COMMON_GLSL}
${GRADIENT_SAMPLER_GLSL}

vec3 sampleFilmPalette(float t, uint seed) {
  if (u_useGradient > 0.5) {
    return evalCosineGradient(t + colorSeedPhase());
  }
  // Thin-film soap interference rainbow spectrum with smooth u_colorSeed phase shift
  vec3 a = vec3(0.55, 0.55, 0.58);
  vec3 b = vec3(0.45, 0.45, 0.45);
  vec3 c = vec3(1.0, 1.0, 1.0);
  vec3 d = vec3(0.00, 0.33, 0.67) + prng3f(seed) * 0.25 + colorSeedPhase();
  return clamp(a + b * cos(6.2831853 * (c * t + d)), 0.0, 1.0);
}

vec3 sampleBackdrop(vec2 uv, vec2 aspect, float t) {
  float radial = length((uv - 0.5) * aspect);
  float vig = smoothstep(1.15, 0.08, radial);

  if (u_bgStyle < 0.5) {
    // 0: Iridescent Dusk Sky (warm rose-peach horizon into soft indigo)
    vec3 horizon = vec3(0.95, 0.72, 0.64);
    vec3 midSky = vec3(0.56, 0.48, 0.68);
    vec3 zenith = vec3(0.16, 0.18, 0.34);
    vec3 sky = mix(horizon, midSky, smoothstep(0.05, 0.52, uv.y));
    sky = mix(sky, zenith, smoothstep(0.45, 0.98, uv.y));
    float sunGlow = exp(-length((uv - vec2(0.5, 0.18)) * aspect) * 2.4);
    return sky + vec3(1.0, 0.88, 0.76) * sunGlow * 0.22;
  }

  if (u_bgStyle < 1.5) {
    // 1: Dark Prism Studio (deep obsidian-navy with soft overhead studio light)
    vec3 studio = mix(vec3(0.02, 0.025, 0.042), vec3(0.09, 0.11, 0.16), vig);
    float glow = exp(-length((uv - vec2(0.38, 0.72)) * aspect) * 2.2);
    return studio + vec3(0.14, 0.18, 0.26) * glow;
  }

  // 2: Soft Morning Sky (clean airy powder-blue into warm cream horizon)
  vec3 low = vec3(0.93, 0.91, 0.87);
  vec3 high = vec3(0.62, 0.78, 0.92);
  return mix(low, high, smoothstep(0.05, 0.95, uv.y));
}

// Render one jittered grid layer of drifting soap bubbles
void renderBubbleLayer(
  vec2 uv,
  vec2 aspect,
  float scale,
  float layerIdx,
  float t,
  uint baseSeed,
  uint colorSeed,
  inout vec3 col
) {
  vec2 p = (uv - 0.5) * aspect * scale;
  // Gentle upward buoyancy + lateral sway
  p.y -= t * (0.28 + 0.14 * layerIdx);
  p.x += sin(t * 0.45 + layerIdx * 2.1) * 0.25;

  vec2 cellId = floor(p);
  vec2 cellUv = fract(p);

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 neighbor = vec2(float(dx), float(dy));
      vec2 id = cellId + neighbor;

      uint cid = uint(abs(id.x * 197.0 + id.y * 733.0 + layerIdx * 911.0)) + baseSeed;
      vec3 rnd = prng3f(cid);

      // Skip ~35% of cells for organic spacing
      if (rnd.x < 0.34) continue;

      // Bobbing bubble center inside cell
      vec2 offset = vec2(0.5) + (rnd.yz - 0.5) * 0.52 + 0.09 * vec2(
        sin(t * (0.9 + rnd.x) + rnd.y * 6.28),
        cos(t * (0.8 + rnd.y) + rnd.z * 6.28)
      );
      vec2 centerCell = neighbor + offset;
      vec2 delta = cellUv - centerCell;
      float dist = length(delta);

      float sizeVar = mix(0.44, 1.12, rnd.z * 0.65 + rnd.x * 0.35);
      float maxR = 0.47 * u_bubbleSize * sizeVar;
      if (dist > maxR * 1.25) continue;

      // Convert bubble center back to screen UV to sample pop state from simTex
      vec2 worldP = id + offset;
      worldP.x -= sin(t * 0.45 + layerIdx * 2.1) * 0.25;
      worldP.y += t * (0.28 + 0.14 * layerIdx);
      vec2 bubbleScreenUv = worldP / (aspect * scale) + 0.5;

      float popVal = 0.0;
      if (bubbleScreenUv.x >= 0.0 && bubbleScreenUv.x <= 1.0 && bubbleScreenUv.y >= 0.0 && bubbleScreenUv.y <= 1.0) {
        popVal = texture(u_simTex, bubbleScreenUv).r;
      }

      // Popped bubble renders an expanding mist ring before respawning
      if (popVal > 0.16) {
        float burstProgress = clamp(1.0 - popVal, 0.0, 1.0);
        float mistR = maxR * (0.85 + burstProgress * 0.75);
        float mistRing = smoothstep(0.055, 0.0, abs(dist - mistR)) * (1.0 - burstProgress);
        float droplets = smoothstep(0.62, 0.95, vnoise(delta * 22.0 + rnd.xy * 10.0));
        vec3 mistCol = sampleFilmPalette(rnd.x + burstProgress, colorSeed);
        col += mistCol * mistRing * droplets * 0.85;
        continue;
      }

      if (dist < maxR) {
        float rNorm = dist / maxR;
        float nz = sqrt(max(0.0, 1.0 - rNorm * rNorm));
        vec3 normal = normalize(vec3(delta / maxR, nz));
        // Soft anti-aliased edge feathering so silhouettes never look harsh
        float edgeAA = smoothstep(1.0, 0.90, rNorm);

        // Hollow clear center + gentle soap-film iridescence rising toward the feathered rim
        float fresnel = pow(1.0 - nz, 2.3);
        float swirl = fbm(normal.xy * 2.2 + vec2(t * 0.30 * u_filmSpeed, -t * 0.22 * u_filmSpeed) + rnd.xy * 9.0);
        float filmPhase = swirl * 1.45 + (1.0 - nz) * 0.65 + rnd.z;
        vec3 filmCol = sampleFilmPalette(filmPhase, colorSeed);

        // Soft studio window reflections on the bubble dome
        vec3 keyDir = normalize(vec3(-0.45, 0.58, 0.68));
        vec3 fillDir = normalize(vec3(0.55, -0.35, 0.75));
        float spec1 = pow(max(dot(normal, keyDir), 0.0), 42.0);
        float spec2 = pow(max(dot(normal, fillDir), 0.0), 24.0) * 0.42;
        float softWindow = smoothstep(0.84, 0.95, dot(normal, normalize(vec3(-0.35, 0.48, 0.80))));

        // Clear refracted center (alpha ~0.04) so bubbles feel hollow rather than solid marbles
        vec3 refractedBg = sampleBackdrop(clamp(uv - normal.xy * 0.030, 0.0, 1.0), aspect, t);
        float shellAlpha = clamp(0.04 + fresnel * 0.44, 0.0, 0.50) * edgeAA;
        vec3 bubbleShell = filmCol * (0.32 + 0.72 * fresnel) * u_iridescence;
        float bubbleGlint = u_shine * mix(0.65, 1.15, rnd.y);
        vec3 specular = vec3(1.0, 0.99, 0.97) * (spec1 * 0.85 + spec2 * 0.42 + softWindow * 0.30) * bubbleGlint * edgeAA;

        vec3 glassBase = mix(col, refractedBg, 0.75 * nz * edgeAA);
        col = mix(glassBase, bubbleShell, shellAlpha) + specular;
      }
    }
  }
}

void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  uint baseSeed = uint(max(u_seed, 0.0) * 1000.0) + 1u;
  uint colorSeed = computeColorSeed(baseSeed);
  float t = u_time * u_speed;

  vec3 col = sampleBackdrop(v_uv, aspect, t);

  // 2 parallax bubble layers (background smaller/softer, foreground larger)
  renderBubbleLayer(v_uv, aspect, u_density * 1.35, 0.0, t * 0.72, baseSeed + 17u, colorSeed, col);
  renderBubbleLayer(v_uv, aspect, u_density * 0.85, 1.0, t, baseSeed + 83u, colorSeed + 19u, col);

  // Subtle expanding ripple ring from recent pop impulses
  float popWave = texture(u_simTex, v_uv).g;
  if (popWave > 0.02) {
    col += vec3(0.85, 0.92, 1.0) * popWave * 0.14;
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
