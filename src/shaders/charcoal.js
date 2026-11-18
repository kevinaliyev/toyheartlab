import { COMMON_GLSL } from './common.glsl.js';
import { sampleToyheartBrush } from './toyheart-paths.js';

export const charcoalStudy = {
  id: 'charcoal',
  name: 'Charcoal Sketch (toyheart)',
  dimension: '2d',
  description:
    'Dry vine-charcoal sketching and directional finger smudging over textured laid paper along the "toyheart" calligraphy path.',
  mode: 'pingpong',
  usesTritone: true,
  usesGradient: false,
  params: [
    {
      key: 'u_paperTone',
      label: 'Paper Tone',
      group: 'Paper & Charcoal',
      type: 'select',
      default: 0,
      options: [
        { value: 0, label: 'Archival Cotton (Palette)' },
        { value: 1, label: 'Warm Kraft Paper' },
        { value: 2, label: 'Toned Slate Grey' },
        { value: 3, label: 'Chalk on Black Board' },
      ],
    },
    { key: 'u_brushCount', label: 'Charcoal Sticks', group: 'Sketch Motion', min: 1, max: 6, step: 1, default: 3 },
    { key: 'u_speed', label: 'Sketch Speed', group: 'Sketch Motion', min: 0.1, max: 2.0, step: 0.05, default: 0.75 },
    { key: 'u_stickSize', label: 'Stick Width', group: 'Paper & Charcoal', min: 0.014, max: 0.08, step: 0.002, default: 0.036 },
    { key: 'u_pressure', label: 'Charcoal Density', group: 'Paper & Charcoal', min: 0.2, max: 1.8, step: 0.05, default: 0.95 },
    { key: 'u_smudge', label: 'Finger Smudge', group: 'Paper & Charcoal', min: 0.0, max: 0.85, step: 0.02, default: 0.18 },
    { key: 'u_tooth', label: 'Paper Tooth', group: 'Paper & Charcoal', min: 0.05, max: 1.0, step: 0.05, default: 0.75 },
    { key: 'u_fade', label: 'Dust Blow-Off', group: 'Paper & Charcoal', min: 0.0, max: 0.006, step: 0.0002, default: 0.0 },
  ],
  onFrame(engine, elapsed, params, seed) {
    const count = Math.round(params.u_brushCount ?? 3);
    const speed = params.u_speed ?? 0.75;
    const t = elapsed * speed;
    const dt = 0.022 * Math.max(speed, 0.15);

    for (let i = 0; i < 6; i++) {
      if (i < count) {
        const sample = sampleToyheartBrush(t, i, seed, dt, count);
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

uniform float u_stickSize;
uniform float u_pressure;
uniform float u_smudge;
uniform float u_tooth;
uniform float u_fade;

uniform vec2 u_brushPos0;
uniform vec2 u_brushPrev0;
uniform float u_brushLift0;
uniform vec2 u_brushPos1;
uniform vec2 u_brushPrev1;
uniform float u_brushLift1;
uniform vec2 u_brushPos2;
uniform vec2 u_brushPrev2;
uniform float u_brushLift2;
uniform vec2 u_brushPos3;
uniform vec2 u_brushPrev3;
uniform float u_brushLift3;
uniform vec2 u_brushPos4;
uniform vec2 u_brushPrev4;
uniform float u_brushLift4;
uniform vec2 u_brushPos5;
uniform vec2 u_brushPrev5;
uniform float u_brushLift5;

${COMMON_GLSL}

// Laid-paper peak height: charcoal catches on raised fibers and skips deep valleys
float evalPaperPeaks(vec2 uv, vec2 aspect) {
  vec2 p = uv * aspect;
  float laid = sin(p.y * 260.0 + vnoise(p * 18.0) * 2.2) * 0.5 + 0.5;
  float coarse = fbm(p * 14.0 + u_seed * 2.7);
  float grit = hash12(floor(uv * u_resolution * 0.9));
  return mix(0.5, coarse * 0.55 + laid * 0.25 + grit * 0.20, u_tooth);
}

float sdSegment(vec2 p, vec2 a, vec2 b, out vec2 dirOut) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float lenSq = dot(ba, ba);
  float h = (lenSq > 1e-7) ? clamp(dot(pa, ba) / lenSq, 0.0, 1.0) : 0.0;
  dirOut = (lenSq > 1e-7) ? normalize(ba) : vec2(1.0, 0.0);
  return length(pa - ba * h);
}

// Returns vec3(addedCharcoal, smudgeX, smudgeY)
vec3 applyCharcoalStick(vec2 p, vec2 pos, vec2 prev, float lift, float radius, float idx, float peaks) {
  if (lift <= 0.01) return vec3(0.0);

  vec2 dir = vec2(1.0, 0.0);
  float dist = sdSegment(p, prev, pos, dir);
  if (dist > radius * 1.4) return vec3(0.0);

  float angle = atan(dir.y, dir.x);
  // Crisp dry-stick grit along stroke angle + sharp paper-peak catch
  float grain = brushNoise(p * 42.0 + vec2(idx * 5.3, u_seed), angle, 4.2);
  float core = smoothstep(radius, radius * 0.22, dist);
  float dustEdge = smoothstep(radius * 1.25, radius * 0.55, dist) * 0.18;
  float toothMask = smoothstep(0.28 - 0.18 * core, 0.72, peaks * 0.70 + grain * 0.48);

  float deposit = (core * toothMask + dustEdge * grain) * lift * u_pressure * 0.26;
  float smudgeWeight = smoothstep(radius * 1.15, 0.0, dist) * lift;
  return vec3(deposit, dir.x * smudgeWeight, dir.y * smudgeWeight);
}

void main() {
  vec2 texel = 1.0 / max(u_resolution, vec2(1.0));
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  float peaks = evalPaperPeaks(v_uv, aspect);

  vec4 prevState = texture(u_prevTex, v_uv);
  float charcoal = prevState.r;
  float smudgeEnergy = prevState.g;
  vec2 smudgeDir = prevState.ba;

  // Dry directional smudge: drags only loose surface dust without wet isotropic blurring
  if (smudgeEnergy > 0.02 && u_smudge > 0.005) {
    vec2 advect = smudgeDir * texel * (1.2 * u_smudge * smudgeEnergy);
    float smeared = texture(u_prevTex, clamp(v_uv - advect, 0.0, 1.0)).r;
    float looseDust = max(0.0, smeared - charcoal * 0.65);
    charcoal += looseDust * clamp(smudgeEnergy * u_smudge * 0.16, 0.0, 0.14);
  }

  // Smudge energy decays rapidly so charcoal bites and stains dry into the paper
  smudgeEnergy = max(0.0, smudgeEnergy * 0.74 - 0.03);
  charcoal = max(0.0, charcoal * (1.0 - u_fade));

  vec2 paintP = (v_uv - 0.5) * vec2(2.0, 2.0 / aspect.x);
  vec2 accumDir = vec2(0.0);
  float added = 0.0;
  float addedSmudge = 0.0;

  vec3 s;
  s = applyCharcoalStick(paintP, u_brushPos0, u_brushPrev0, u_brushLift0, u_stickSize, 0.0, peaks);
  added += s.x; accumDir += s.yz; addedSmudge += length(s.yz);

  s = applyCharcoalStick(paintP, u_brushPos1, u_brushPrev1, u_brushLift1, u_stickSize, 1.0, peaks);
  added += s.x; accumDir += s.yz; addedSmudge += length(s.yz);

  s = applyCharcoalStick(paintP, u_brushPos2, u_brushPrev2, u_brushLift2, u_stickSize, 2.0, peaks);
  added += s.x; accumDir += s.yz; addedSmudge += length(s.yz);

  s = applyCharcoalStick(paintP, u_brushPos3, u_brushPrev3, u_brushLift3, u_stickSize, 3.0, peaks);
  added += s.x; accumDir += s.yz; addedSmudge += length(s.yz);

  s = applyCharcoalStick(paintP, u_brushPos4, u_brushPrev4, u_brushLift4, u_stickSize, 4.0, peaks);
  added += s.x; accumDir += s.yz; addedSmudge += length(s.yz);

  s = applyCharcoalStick(paintP, u_brushPos5, u_brushPrev5, u_brushLift5, u_stickSize, 5.0, peaks);
  added += s.x; accumDir += s.yz; addedSmudge += length(s.yz);

  // Softly saturate toward 1.6 so heavy strokes build rich velvety darks without clipping
  float headroom = max(0.0, 1.6 - charcoal) / 1.6;
  charcoal = clamp(charcoal + added * headroom, 0.0, 1.6);
  smudgeEnergy = clamp(max(smudgeEnergy, addedSmudge * 0.85), 0.0, 1.0);
  if (length(accumDir) > 1e-4) {
    smudgeDir = normalize(mix(smudgeDir, normalize(accumDir), 0.7));
  }

  outState = vec4(charcoal, smudgeEnergy, smudgeDir);
}
`,
  displayShader: /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_simTex;
uniform vec2 u_resolution;
uniform float u_seed;

uniform float u_paperTone;
uniform float u_tooth;
uniform vec3 u_colorDark;
uniform vec3 u_colorMid;
uniform vec3 u_colorLight;

${COMMON_GLSL}

void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  float charcoal = texture(u_simTex, v_uv).r;

  vec2 p = v_uv * aspect;
  float laid = sin(p.y * 260.0 + vnoise(p * 18.0) * 2.2) * 0.5 + 0.5;
  float grain = paperGrain(v_uv * u_resolution);
  float fiber = fbm(p * 14.0 + u_seed * 2.7);

  vec3 paperCol = u_colorLight;
  vec3 midCol = u_colorMid;
  vec3 strokeCol = u_colorDark;

  if (u_paperTone > 0.5 && u_paperTone < 1.5) {
    // 1: Warm Kraft Paper
    paperCol = vec3(0.82, 0.73, 0.59);
    midCol = vec3(0.42, 0.36, 0.29);
    strokeCol = vec3(0.08, 0.07, 0.065);
  } else if (u_paperTone >= 1.5 && u_paperTone < 2.5) {
    // 2: Toned Slate Grey
    paperCol = vec3(0.64, 0.66, 0.68);
    midCol = vec3(0.32, 0.34, 0.37);
    strokeCol = vec3(0.06, 0.065, 0.075);
  } else if (u_paperTone >= 2.5) {
    // 3: Chalk on Black Board (inverted value)
    paperCol = vec3(0.07, 0.075, 0.085);
    midCol = vec3(0.48, 0.50, 0.53);
    strokeCol = vec3(0.95, 0.94, 0.91);
  }

  // Subtle laid-paper lighting
  paperCol *= 1.0 + (laid - 0.5) * 0.04 * u_tooth + grain * 0.05 * u_tooth + (fiber - 0.5) * 0.04;

  // Map charcoal density cleanly into deep staining black/velvet charcoal
  float d = clamp(charcoal * 1.05, 0.0, 1.0);
  float toothBreakup = mix(1.0, 0.72 + 0.32 * laid + grain * 0.42, u_tooth);
  float toneT = clamp(d * toothBreakup, 0.0, 1.0);

  vec3 col = mix(paperCol, midCol, smoothstep(0.02, 0.30, toneT));
  col = mix(col, strokeCol, smoothstep(0.22, 0.70, toneT));

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
