import { COMMON_GLSL } from './common.glsl.js';
import { sampleToyheartBrush } from './toyheart-paths.js';

export function hexToAbsorption(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  // Convert reflectance RGB to physical Beer-Lambert absorption
  return [
    -Math.log(Math.max(r, 0.06)),
    -Math.log(Math.max(g, 0.06)),
    -Math.log(Math.max(b, 0.06)),
  ];
}

export const watercolorStudy = {
  id: 'watercolor',
  name: 'Study A — Watercolour (toyheart)',
  description:
    'Soft watercolour paintbrushes writing "toyheart" with declarative per-brush pigments, physical colour intersection, and wet fisheye refraction.',
  mode: 'pingpong',
  // Declarative pigment scale: GUI dynamically renders color pickers matching u_brushCount
  pigmentScale: {
    countParam: 'u_brushCount',
    uniformPrefix: 'u_brushColor',
    defaults: [
      { label: 'Brush 1 (Indigo)', hex: '#23488a' },
      { label: 'Brush 2 (Ochre)', hex: '#d99b26' },
      { label: 'Brush 3 (Sienna)', hex: '#c85528' },
      { label: 'Brush 4 (Viridian)', hex: '#2e7d5b' },
      { label: 'Brush 5 (Rose)', hex: '#b83b5e' },
      { label: 'Brush 6 (Payne Grey)', hex: '#464b52' },
    ],
    toUniform: hexToAbsorption,
  },
  params: [
    { key: 'u_brushCount', label: 'Brushes', min: 1, max: 6, step: 1, default: 3 },
    { key: 'u_speed', label: 'Stroke Speed', min: 0.1, max: 2.0, step: 0.05, default: 0.65 },
    { key: 'u_brushSize', label: 'Brush Size', min: 0.02, max: 0.11, step: 0.005, default: 0.052 },
    { key: 'u_bleed', label: 'Water Bleed', min: 0.05, max: 0.85, step: 0.02, default: 0.42 },
    { key: 'u_refraction', label: 'Water Fisheye', min: 0.0, max: 1.0, step: 0.05, default: 0.55 },
    { key: 'u_fade', label: 'Slow Fade', min: 0.0, max: 0.005, step: 0.0002, default: 0.0 },
    { key: 'u_grain', label: 'Paper Tooth', min: 0.0, max: 0.14, step: 0.005, default: 0.05 },
  ],
  onFrame(engine, elapsed, params, seed) {
    const count = Math.round(params.u_brushCount ?? 3);
    const speed = params.u_speed ?? 0.65;
    const t = elapsed * speed;
    const dt = 0.02 * Math.max(speed, 0.15);

    for (let i = 0; i < 6; i++) {
      if (i < count) {
        const sample = sampleToyheartBrush(t, i, seed, dt);
        engine.setUniform(`u_brushPos${i}`, sample.pos);
        engine.setUniform(`u_brushPrev${i}`, sample.prev);
        engine.setUniform(`u_brushLift${i}`, sample.lift);
      } else {
        engine.setUniform(`u_brushLift${i}`, 0.0);
      }
    }
  },
  simShader: /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outState;

uniform sampler2D u_prevTex;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_seed;

uniform float u_brushCount;
uniform float u_brushSize;
uniform float u_bleed;
uniform float u_fade;

uniform vec2 u_brushPos0;  uniform vec2 u_brushPrev0;  uniform float u_brushLift0;  uniform vec3 u_brushColor0;
uniform vec2 u_brushPos1;  uniform vec2 u_brushPrev1;  uniform float u_brushLift1;  uniform vec3 u_brushColor1;
uniform vec2 u_brushPos2;  uniform vec2 u_brushPrev2;  uniform float u_brushLift2;  uniform vec3 u_brushColor2;
uniform vec2 u_brushPos3;  uniform vec2 u_brushPrev3;  uniform float u_brushLift3;  uniform vec3 u_brushColor3;
uniform vec2 u_brushPos4;  uniform vec2 u_brushPrev4;  uniform float u_brushLift4;  uniform vec3 u_brushColor4;
uniform vec2 u_brushPos5;  uniform vec2 u_brushPrev5;  uniform float u_brushLift5;  uniform vec3 u_brushColor5;

${COMMON_GLSL}

// Soft round/filbert paintbrush tuft aligned with the stroke movement direction
float sdPaintbrushSegment(vec2 p, vec2 a, vec2 b, out float strokeAngle) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float lenSq = dot(ba, ba);
  float h = (lenSq > 1e-7) ? clamp(dot(pa, ba) / lenSq, 0.0, 1.0) : 0.0;
  vec2 d = pa - ba * h;

  strokeAngle = (lenSq > 1e-7) ? atan(ba.y, ba.x) : 0.0;
  float c = cos(strokeAngle);
  float s = sin(strokeAngle);
  // Align brush tuft along stroke direction (slightly elongated oval, soft round belly)
  vec2 local = vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
  local.x *= 0.85;
  local.y *= 1.15;
  return length(local);
}

vec4 applyBrush(vec2 p, vec2 pos, vec2 prev, float lift, vec3 absColor, float radius, float idx, vec3 curPigment) {
  if (lift <= 0.01) return vec4(0.0);

  float strokeAngle = 0.0;
  float dist = sdPaintbrushSegment(p, prev, pos, strokeAngle);
  if (dist > radius * 1.45) return vec4(0.0);

  // Soft, loaded paintbrush falloff (feathered edge, never razor-hard)
  float radial = smoothstep(radius, radius * 0.05, dist);
  float tuft = 0.72 + 0.28 * brushNoise(p * 24.0 + vec2(idx * 4.1, 0.0), strokeAngle, 2.8);
  float deposit = radial * tuft * lift;

  // True subtractive pigment accumulation so intersecting colours mix physically (e.g. blue + ochre -> green)
  float strength = 0.042 * deposit;
  vec3 headroom = max(vec3(0.0), vec3(3.6) - curPigment);
  vec3 addedPigment = absColor * strength * (headroom / 3.6);
  float addedWet = radial * lift * 0.92;

  return vec4(addedPigment, addedWet);
}

void main() {
  vec2 texel = 1.0 / max(u_resolution, vec2(1.0));
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);

  vec4 center = texture(u_prevTex, v_uv);
  vec3 pigment = center.rgb;
  float wetness = center.a;

  // 1. Paper heightmap
  vec2 paperCoord = v_uv * aspect * 15.0 + u_seed * 3.1;
  float paperHeight = fbm(paperCoord) * 0.65 + vnoise(paperCoord * 3.6) * 0.35;

  // 2. Capillary diffusion while wet
  vec4 n = texture(u_prevTex, v_uv + vec2(0.0, texel.y));
  vec4 s = texture(u_prevTex, v_uv - vec2(0.0, texel.y));
  vec4 e = texture(u_prevTex, v_uv + vec2(texel.x, 0.0));
  vec4 w = texture(u_prevTex, v_uv - vec2(texel.x, 0.0));
  vec4 avgN = (n + s + e + w) * 0.25;

  float flowRate = u_bleed * mix(0.20, 1.0, 1.0 - paperHeight);
  // Water spreads briefly and dries so settled pigment locks into the paper
  wetness = mix(wetness, avgN.a, flowRate * 0.55);
  wetness = max(0.0, wetness * 0.962 - 0.004);

  // Quadratic wetness falloff: only freshly wet strokes bloom; settled layers stay crisp
  float activeWet = wetness * wetness;
  float diffStrength = clamp(activeWet * flowRate * 0.24, 0.0, 0.18);
  pigment = mix(pigment, avgN.rgb, diffStrength);

  // Subtle wet-edge pooling as paint dries
  float edgeGrad = length(avgN.rgb - pigment);
  float dryingRim = smoothstep(0.45, 0.05, wetness) * wetness * 3.0;
  pigment += normalize(pigment + 1e-4) * edgeGrad * dryingRim * 0.028;

  pigment = max(vec3(0.0), pigment * (1.0 - u_fade));

  // 3. Apply active "toyheart" brushes
  // Normalize canvas coordinates so "toyheart" fits comfortably across aspect ratios
  vec2 p = (v_uv - 0.5) * vec2(aspect.x / max(aspect.x, 1.15), 1.0) * 1.1;
  // Re-scale p into [-1, 1] matching toyheart-paths.js
  vec2 normP = (v_uv - 0.5) * 2.0;
  normP.y /= max(aspect.x / aspect.y, 1.0) * 0.85;
  // Actually keep uniform aspect scaling centered:
  vec2 paintP = (v_uv - 0.5) * vec2(2.0, 2.0 / aspect.x);

  vec4 res;
  res = applyBrush(paintP, u_brushPos0, u_brushPrev0, u_brushLift0, u_brushColor0, u_brushSize, 0.0, pigment);
  pigment += res.rgb; wetness = max(wetness, res.a);

  res = applyBrush(paintP, u_brushPos1, u_brushPrev1, u_brushLift1, u_brushColor1, u_brushSize, 1.0, pigment);
  pigment += res.rgb; wetness = max(wetness, res.a);

  res = applyBrush(paintP, u_brushPos2, u_brushPrev2, u_brushLift2, u_brushColor2, u_brushSize, 2.0, pigment);
  pigment += res.rgb; wetness = max(wetness, res.a);

  res = applyBrush(paintP, u_brushPos3, u_brushPrev3, u_brushLift3, u_brushColor3, u_brushSize, 3.0, pigment);
  pigment += res.rgb; wetness = max(wetness, res.a);

  res = applyBrush(paintP, u_brushPos4, u_brushPrev4, u_brushLift4, u_brushColor4, u_brushSize, 4.0, pigment);
  pigment += res.rgb; wetness = max(wetness, res.a);

  res = applyBrush(paintP, u_brushPos5, u_brushPrev5, u_brushLift5, u_brushColor5, u_brushSize, 5.0, pigment);
  pigment += res.rgb; wetness = max(wetness, res.a);

  outState = vec4(clamp(pigment, 0.0, 3.6), clamp(wetness, 0.0, 1.0));
}
`,
  displayShader: /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_simTex;
uniform vec2 u_resolution;

uniform vec3 u_colorLight;
uniform float u_refraction;
uniform float u_grain;

${COMMON_GLSL}

void main() {
  vec2 texel = 1.0 / max(u_resolution, vec2(1.0));

  // Wetness dome gradient for water-droplet fisheye refraction
  float wL = texture(u_simTex, v_uv - vec2(texel.x, 0.0)).a;
  float wR = texture(u_simTex, v_uv + vec2(texel.x, 0.0)).a;
  float wD = texture(u_simTex, v_uv - vec2(0.0, texel.y)).a;
  float wU = texture(u_simTex, v_uv + vec2(0.0, texel.y)).a;

  vec2 wetNormal = vec2(wR - wL, wU - wD);
  float wetness = texture(u_simTex, v_uv).a;

  vec2 refractedUV = clamp(v_uv - wetNormal * wetness * 0.045 * u_refraction, 0.0, 1.0);
  vec3 pigment = texture(u_simTex, refractedUV).rgb;

  vec2 refractedFrag = refractedUV * u_resolution;
  float grain = paperGrain(refractedFrag);

  // Paper-valley granulation
  vec3 modulatedPigment = pigment * (1.0 + grain * u_grain * 4.2);

  // Progressive opacity: translucent washes lose transparency as intersecting layers accumulate
  float density = dot(modulatedPigment, vec3(0.333));
  vec3 translucent = u_colorLight * exp(-modulatedPigment * 1.15);
  vec3 opaqueBody = exp(-modulatedPigment * 1.75) * 0.90;
  float opacity = smoothstep(0.45, 2.2, density);
  vec3 col = mix(translucent, opaqueBody, opacity * 0.72);

  col += grain * u_grain * 0.65;

  // Subtle wet-dome specular highlight
  float rimHighlight = clamp(length(wetNormal) * 3.5 * wetness * u_refraction, 0.0, 0.14);
  col = mix(col, vec3(1.0), rimHighlight);

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
