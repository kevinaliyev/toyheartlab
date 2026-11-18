import { COMMON_GLSL } from './common.glsl.js';
import { colorSeedParam, GRADIENT_UNIFORMS_GLSL, GRADIENT_SAMPLER_GLSL } from './shader-params.js';

export const fallingObjectsStudy = {
  id: 'falling-objects',
  name: 'Falling 3D Objects',
  dimension: '2.5d',
  description:
    'Ray-sphere culled 3D tumbling objects (polyhedra, 3D hearts, crystals, torus rings) falling through perspective depth with ceramic, chrome, and frosted glass finishes.',
  mode: 'single',
  usesTritone: false,
  usesGradient: true,
  params: [
    {
      key: 'u_bgStyle',
      label: 'Backdrop',
      group: 'Stage & Light',
      type: 'select',
      default: 0,
      options: [
        { value: 0, label: 'Midnight Studio' },
        { value: 1, label: 'Soft Daylight' },
        { value: 2, label: 'Obsidian Void' },
        { value: 3, label: 'Iridescent Dusk' },
        { value: 4, label: 'Gradient Match' },
      ],
    },
    {
      key: 'u_shapeMode',
      label: '3D Object Set',
      group: 'Objects & Motion',
      type: 'select',
      default: 0,
      options: [
        { value: 0, label: 'Mixed Polyhedra' },
        { value: 1, label: '3D Hearts' },
        { value: 2, label: 'Faceted Crystals' },
        { value: 3, label: 'Torus & Spheres' },
      ],
    },
    {
      key: 'u_material',
      label: 'Material Finish',
      group: 'Surface & Light',
      type: 'select',
      default: 0,
      options: [
        { value: 0, label: 'Glossy Palette' },
        { value: 1, label: 'Liquid Chrome' },
        { value: 2, label: 'Frosted Glass' },
      ],
    },
    { key: 'u_speed', label: 'Fall Speed', group: 'Objects & Motion', min: 0.1, max: 2.5, step: 0.05, default: 0.85 },
    { key: 'u_spin', label: 'Tumble Spin', group: 'Objects & Motion', min: 0.0, max: 2.5, step: 0.05, default: 1.0 },
    { key: 'u_objScale', label: 'Object Size', group: 'Objects & Motion', min: 0.45, max: 1.5, step: 0.05, default: 0.95 },
    { key: 'u_wind', label: 'Wind Drift', group: 'Objects & Motion', min: -1.0, max: 1.0, step: 0.05, default: 0.15 },
    colorSeedParam({ label: 'Colour / Chrome Offset', group: 'Surface & Light' }),
  ],
  fragmentShader: /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_seed;

uniform float u_bgStyle;
uniform float u_shapeMode;
uniform float u_material;
uniform float u_speed;
uniform float u_spin;
uniform float u_objScale;
uniform float u_wind;
${GRADIENT_UNIFORMS_GLSL}

${COMMON_GLSL}
${GRADIENT_SAMPLER_GLSL}

mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

vec3 applyEuler(vec3 p, vec3 ang) {
  p.xy = rot2(ang.z) * p.xy;
  p.yz = rot2(ang.x) * p.yz;
  p.xz = rot2(ang.y) * p.xz;
  return p;
}

// 3D SDF Primitives (evaluated in unit/local object space)
float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

float sdOctahedron(vec3 p, float s) {
  p = abs(p);
  return (p.x + p.y + p.z - s) * 0.57735027;
}

float sdHeart3D(vec3 p, float s) {
  p /= s;
  p.y -= 0.14;
  vec3 q = vec3(abs(p.x), p.y, p.z * 1.55);
  float d2 = length(vec2(q.x, q.y - 0.32 * sqrt(max(0.0, q.x)))) - 0.50;
  // Scale by 0.65 to preserve conservative Lipschitz bound for tear-free raymarching
  return (length(vec2(d2, q.z)) - 0.18) * s * 0.65;
}

float evalShapeSDF(vec3 p, float s, int kind) {
  if (u_shapeMode > 0.5 && u_shapeMode < 1.5) {
    return sdHeart3D(p, s * 1.12);
  }
  if (u_shapeMode >= 1.5 && u_shapeMode < 2.5) {
    return sdOctahedron(p * vec3(1.12, 0.82, 1.12), s * 1.02) - 0.02 * s;
  }
  if (u_shapeMode >= 2.5) {
    return (kind % 2 == 0) ? sdTorus(p, vec2(s * 0.72, s * 0.24)) : (length(p) - s * 0.78);
  }
  int m = kind % 4;
  if (m == 0) return sdRoundBox(p, vec3(s * 0.55), s * 0.11);
  if (m == 1) return sdTorus(p, vec2(s * 0.72, s * 0.23));
  if (m == 2) return sdOctahedron(p, s * 0.92) - s * 0.04;
  return sdHeart3D(p, s * 1.05);
}

vec3 calcLocalNormal(vec3 p, float s, int kind, float h) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * evalShapeSDF(p + k.xyy * h, s, kind) +
    k.yyx * evalShapeSDF(p + k.yyx * h, s, kind) +
    k.yxy * evalShapeSDF(p + k.yxy * h, s, kind) +
    k.xxx * evalShapeSDF(p + k.xxx * h, s, kind)
  );
}

vec3 sampleBackdrop(vec2 uv, uint colorSeed) {
  float vig = smoothstep(1.25, 0.08, length(uv));
  if (u_bgStyle < 0.5) {
    // 0: Midnight Studio
    vec3 bot = vec3(0.05, 0.06, 0.09);
    vec3 top = vec3(0.14, 0.17, 0.24);
    return mix(bot, top, smoothstep(-0.6, 0.8, uv.y));
  }
  if (u_bgStyle < 1.5) {
    // 1: Soft Daylight Gallery
    vec3 bot = vec3(0.84, 0.86, 0.90);
    vec3 top = vec3(0.95, 0.96, 0.98);
    return mix(bot, top, smoothstep(-0.6, 0.8, uv.y)) * mix(0.88, 1.0, vig);
  }
  if (u_bgStyle < 2.5) {
    // 2: Obsidian Void
    vec3 edge = vec3(0.015, 0.017, 0.022);
    vec3 center = vec3(0.06, 0.07, 0.09);
    return mix(edge, center, vig);
  }
  if (u_bgStyle < 3.5) {
    // 3: Iridescent Dusk
    vec3 bot = vec3(0.88, 0.64, 0.58);
    vec3 mid = vec3(0.46, 0.36, 0.62);
    vec3 top = vec3(0.15, 0.19, 0.36);
    float y = clamp(uv.y + 0.5, 0.0, 1.0);
    vec3 col = mix(bot, mid, smoothstep(0.0, 0.55, y));
    return mix(col, top, smoothstep(0.45, 1.0, y)) * mix(0.82, 1.0, vig);
  }
  // 4: Gradient Match (softened active gradient/palette backdrop)
  vec3 g0 = sampleShaderPalette(0.15, colorSeed) * 0.42;
  vec3 g1 = sampleShaderPalette(0.72, colorSeed) * 0.62;
  return mix(g0, g1, smoothstep(-0.6, 0.8, uv.y)) * mix(0.80, 1.0, vig);
}

vec3 shadeObject(
  vec3 hitLocal,
  vec3 ang,
  float sc,
  int id,
  float phase,
  float dist,
  vec3 rd,
  vec2 uv,
  vec3 bgCol,
  uint colorSeed,
  float normalEps
) {
  vec3 localN = calcLocalNormal(hitLocal, sc, id, normalEps);
  // Inverse Euler rotation (transpose of rot2 is rot2(-a) in reverse order)
  vec3 normal = localN;
  normal.xz = rot2(-ang.y) * normal.xz;
  normal.yz = rot2(-ang.x) * normal.yz;
  normal.xy = rot2(-ang.z) * normal.xy;
  normal = normalize(normal);

  vec3 viewDir = -rd;
  vec3 refl = reflect(-viewDir, normal);
  float NdotV = clamp(dot(normal, viewDir), 0.0, 1.0);
  float fresnel = pow(1.0 - NdotV, 3.2);

  vec3 lightKey = normalize(vec3(-0.45, 0.72, 0.52));
  vec3 lightFill = normalize(vec3(0.55, -0.35, 0.75));
  float diff = max(dot(normal, lightKey), 0.0) * 0.78 + max(dot(normal, lightFill), 0.0) * 0.28;
  float spec = pow(max(dot(normal, normalize(lightKey + viewDir)), 0.0), 42.0);

  float baseT = phase + float(id) * 0.13;
  vec3 objCol = sampleShaderPalette(baseT, colorSeed);
  vec3 col;

  if (u_material < 0.5) {
    // 0: Glossy Palette — gradients flow across the 3D surface normals & rim
    if (u_useGradient > 0.5) {
      float gradFlow = baseT + dot(normal, vec3(0.30, 0.70, 0.25)) * 0.35 + fresnel * 0.28 + colorSeedPhase();
      objCol = evalCosineGradient(gradFlow);
    }
    col = objCol * (0.22 + diff * 0.85) + vec3(1.0) * (spec * 0.78 + fresnel * 0.28);
  } else if (u_material < 1.5) {
    // 1: Liquid Chrome — u_colorSeed sweeps from glossy obsidian/chrome shine (0) to all-on liquid chrome (100)
    float chromeMix = colorSeedPhase();
    float horizon = smoothstep(-0.07, 0.07, refl.y);
    vec3 groundRefl = mix(vec3(0.02, 0.025, 0.035), vec3(0.24, 0.27, 0.33), smoothstep(-0.85, -0.05, refl.y));
    vec3 skyRefl = mix(vec3(0.86, 0.90, 0.96), vec3(0.28, 0.33, 0.42), smoothstep(0.05, 0.85, refl.y));
    vec3 chromeEnv = mix(groundRefl, skyRefl, horizon);
    float stripA = smoothstep(0.84, 0.96, dot(refl, normalize(vec3(-0.42, 0.62, 0.66))));
    float stripB = smoothstep(0.86, 0.98, dot(refl, normalize(vec3(0.55, 0.45, 0.70))));
    vec3 specBands = vec3(1.0, 0.99, 0.98) * (stripA * 0.95 + stripB * 0.70);

    // Special gradient finish: anodized/dichroic chrome reflection tint
    if (u_useGradient > 0.5) {
      vec3 dichTint = evalCosineGradient(refl.y * 0.45 + 0.5 + fresnel * 0.32 + float(id) * 0.08);
      chromeEnv = mix(chromeEnv, chromeEnv * mix(vec3(1.0), dichTint * 1.45, 0.65), 0.75);
    }

    vec3 fullChrome = chromeEnv * (0.82 + 0.28 * fresnel) + specBands + vec3(1.0) * spec * 0.75;
    vec3 obsidianShine = vec3(0.015, 0.017, 0.022) + (chromeEnv * (0.08 + 0.78 * fresnel)) + specBands * 0.95 + vec3(1.0) * spec * 0.9;
    col = mix(obsidianShine, fullChrome, chromeMix);
  } else {
    // 2: Frosted Glass — gradients get prismatic edge-to-core refraction
    vec3 refrBg = sampleBackdrop(uv - normal.xy * 0.08, colorSeed);
    if (u_useGradient > 0.5) {
      vec3 edgeCol = evalCosineGradient(baseT + fresnel * 0.55 + normal.y * 0.25 + colorSeedPhase());
      objCol = mix(objCol, edgeCol, 0.85);
    }
    col = mix(refrBg * (0.85 + 0.35 * objCol), objCol * 1.15, 0.22 + fresnel * 0.75) + vec3(1.0) * spec * 0.9;
  }

  float fog = smoothstep(2.4, 6.2, dist);
  return mix(col, bgCol, fog * 0.70);
}

void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 uv = (v_uv - 0.5) * aspect;

  uint baseSeed = uint(max(u_seed, 0.0) * 1000.0) + 1u;
  uint colorSeed = computeColorSeed(baseSeed);
  float t = u_time * u_speed;

  vec3 ro = vec3(0.0, 0.0, 0.5);
  vec3 rd = normalize(vec3(uv, -1.55));
  vec3 bgCol = sampleBackdrop(uv, colorSeed);
  float pxFactor = 1.0 / (1.55 * max(u_resolution.y, 1.0));

  float bestDist = 1e6;
  vec3 bestHitLocal = vec3(0.0);
  vec3 bestAng = vec3(0.0);
  float bestScale = 0.25;
  int bestId = -1;
  float bestPhase = 0.0;

  // Closest front-most grazing silhouette for anti-aliased edges during motion
  float edgeDist = 1e6;
  float edgeAlpha = 0.0;
  vec3 edgeHitLocal = vec3(0.0);
  vec3 edgeAng = vec3(0.0);
  float edgeScale = 0.25;
  int edgeId = -1;
  float edgePhase = 0.0;

  // Ray-sphere cull each object ONCE per pixel, then locally raymarch only hit candidates
  for (int i = 0; i < 12; i++) {
    vec3 r0 = prng3f(baseSeed + uint(i) * 59u + 7u);
    vec3 r1 = prng3f(baseSeed + uint(i) * 113u + 29u);

    float z = mix(-1.4, -4.4, r0.z);
    float distFromCam = 0.5 - z;
    float halfH = distFromCam * 0.42;
    float halfW = halfH * aspect.x;

    float fallRate = mix(0.24, 0.44, r0.x);
    float yCycle = fract(r0.y - t * fallRate);
    float y = mix(-halfH - 0.5, halfH + 0.5, yCycle);

    float xRaw = (r1.x - 0.5) * 2.0 * (halfW + 0.35) + sin(t * 0.55 + r1.y * 6.28) * 0.18 + u_wind * (1.0 - yCycle) * 1.4;
    float x = mod(xRaw + halfW + 0.4, (halfW + 0.4) * 2.0) - (halfW + 0.4);

    vec3 objPos = vec3(x, y, z);
    float sc = mix(0.18, 0.33, r1.z) * u_objScale;
    float boundR = sc * 1.35;

    // Exact ray-sphere intersection
    vec3 oc = ro - objPos;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - boundR * boundR;
    float disc = b * b - c;
    if (disc <= 0.0) continue;

    float sq = sqrt(disc);
    float tEntry = max(0.0, -b - sq);
    float tExit = -b + sq;
    if (tEntry >= bestDist || tExit <= 0.0) continue;

    vec3 ang = vec3(
      t * (0.9 + r1.y) * u_spin + r0.x * 6.28,
      t * (0.7 + r1.z) * u_spin + r0.y * 6.28,
      t * (0.5 + r0.z) * u_spin + r1.x * 6.28
    );

    // Transform ray into object's local rotated frame once!
    vec3 localRo = applyEuler(ro - objPos, ang);
    vec3 localRd = applyEuler(rd, ang);

    float tCur = tEntry;
    float minD = 1e6;
    float minT = tEntry;
    vec3 minLp = localRo + localRd * tEntry;
    bool hit = false;

    for (int step = 0; step < 44; step++) {
      if (tCur > tExit || tCur >= bestDist) break;
      vec3 lp = localRo + localRd * tCur;
      float d = evalShapeSDF(lp, sc, i);
      float pxSize = tCur * pxFactor;
      float hitEps = max(0.0008, pxSize * 0.45);
      if (d < minD) {
        minD = d;
        minT = tCur;
        minLp = lp;
      }
      if (d < hitEps) {
        bestDist = tCur;
        bestHitLocal = lp;
        bestAng = ang;
        bestScale = sc;
        bestId = i;
        bestPhase = r1.y;
        hit = true;
        break;
      }
      tCur += max(d * 0.9, max(0.0012, pxSize * 0.6));
    }

    if (!hit && bestId < 0 && minT < edgeDist) {
      float aaWidth = max(0.0014, minT * pxFactor * 1.2);
      if (minD < aaWidth) {
        edgeDist = minT;
        edgeAlpha = 1.0 - smoothstep(0.0, aaWidth, minD);
        edgeHitLocal = minLp;
        edgeAng = ang;
        edgeScale = sc;
        edgeId = i;
        edgePhase = r1.y;
      }
    }
  }

  vec3 col = bgCol;
  if (bestId >= 0) {
    float normalEps = max(0.001, bestDist * pxFactor * 0.75);
    col = shadeObject(bestHitLocal, bestAng, bestScale, bestId, bestPhase, bestDist, rd, uv, bgCol, colorSeed, normalEps);
  } else if (edgeId >= 0 && edgeAlpha > 0.001) {
    float edgeNormalEps = max(0.001, edgeDist * pxFactor * 0.75);
    vec3 edgeCol = shadeObject(edgeHitLocal, edgeAng, edgeScale, edgeId, edgePhase, edgeDist, rd, uv, bgCol, colorSeed, edgeNormalEps);
    col = mix(bgCol, edgeCol, edgeAlpha);
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
