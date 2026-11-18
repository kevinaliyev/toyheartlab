import { COMMON_GLSL } from './common.glsl.js';

export const noiseSignalStudy = {
  id: 'noise-signal',
  name: 'Signal & Noise Lab',
  description:
    'Procedural analog & digital signal generator featuring TV snow static, curved CRT phosphor scanlines, VHS tracking glitch, 1-bit Bayer dither, and Ryoji Ikeda data matrices.',
  mode: 'single',
  usesTritone: true,
  usesGradient: false,
  params: [
    {
      key: 'u_signalPreset',
      label: 'Signal Preset',
      group: 'Signal & Mode',
      type: 'select',
      default: 0,
      options: [
        { value: 0, label: 'TV Static (RF Snow)' },
        { value: 1, label: 'CRT Scanlines & Phosphor' },
        { value: 2, label: 'VHS Tracking Glitch' },
        { value: 3, label: '1-Bit Bayer Dither' },
        { value: 4, label: 'Digital Data Matrix' },
        { value: 5, label: 'Moiré Interference' },
      ],
    },
    { key: 'u_speed', label: 'Signal Speed', group: 'Signal & Mode', min: 0.1, max: 3.0, step: 0.05, default: 1.0 },
    { key: 'u_pixelScale', label: 'Pixel / Grain Size', group: 'Signal & Mode', min: 1.0, max: 8.0, step: 0.25, default: 2.0 },
    { key: 'u_staticAmt', label: 'Static / Noise', group: 'Artifacts', min: 0.0, max: 1.0, step: 0.02, default: 0.72 },
    { key: 'u_scanlines', label: 'Scanlines / Grille', group: 'Artifacts', min: 0.0, max: 1.0, step: 0.02, default: 0.55 },
    { key: 'u_glitch', label: 'Sync Tear / Glitch', group: 'Artifacts', min: 0.0, max: 1.0, step: 0.02, default: 0.38 },
    { key: 'u_chroma', label: 'Chroma Shift', group: 'Artifacts', min: 0.0, max: 1.0, step: 0.02, default: 0.35 },
    { key: 'u_curvature', label: 'CRT Curvature', group: 'Artifacts', min: 0.0, max: 1.0, step: 0.02, default: 0.30 },
  ],
  fragmentShader: /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_seed;

uniform vec3 u_colorDark;
uniform vec3 u_colorMid;
uniform vec3 u_colorLight;

uniform float u_signalPreset;
uniform float u_speed;
uniform float u_pixelScale;
uniform float u_staticAmt;
uniform float u_scanlines;
uniform float u_glitch;
uniform float u_chroma;
uniform float u_curvature;

${COMMON_GLSL}

// Classic CRT barrel distortion
vec2 applyCurvature(vec2 uv, float amt) {
  if (amt <= 0.001) return uv;
  vec2 c = uv * 2.0 - 1.0;
  vec2 offset = abs(c.yx) / mix(8.0, 2.8, amt);
  c = c + c * offset * offset;
  return c * 0.5 + 0.5;
}

// 4x4 ordered Bayer matrix threshold in [0, 1]
float bayer4x4(ivec2 p) {
  int x = p.x & 3;
  int y = p.y & 3;
  int idx = y * 4 + x;
  if (idx == 0) return 0.0 / 16.0;
  if (idx == 1) return 8.0 / 16.0;
  if (idx == 2) return 2.0 / 16.0;
  if (idx == 3) return 10.0 / 16.0;
  if (idx == 4) return 12.0 / 16.0;
  if (idx == 5) return 4.0 / 16.0;
  if (idx == 6) return 14.0 / 16.0;
  if (idx == 7) return 6.0 / 16.0;
  if (idx == 8) return 3.0 / 16.0;
  if (idx == 9) return 11.0 / 16.0;
  if (idx == 10) return 1.0 / 16.0;
  if (idx == 11) return 9.0 / 16.0;
  if (idx == 12) return 15.0 / 16.0;
  if (idx == 13) return 7.0 / 16.0;
  if (idx == 14) return 13.0 / 16.0;
  return 5.0 / 16.0;
}

float evalSignalLuma(vec2 uv, vec2 pxCoord, float t, uint baseSeed) {
  ivec2 cell = ivec2(floor(pxCoord / max(u_pixelScale, 1.0)));
  uint frameTick = uint(floor(t * 28.0));

  // Rolling horizontal sync tear & burst interference
  float rowNoise = prng1f(uint(cell.y) * 193u + frameTick * 37u + baseSeed);
  float tearBand = smoothstep(0.06, 0.0, abs(fract(uv.y - t * 0.14) - 0.5));
  float tearShift = (rowNoise - 0.5) * u_glitch * (0.04 + 0.12 * tearBand);

  vec2 sUv = vec2(fract(uv.x + tearShift), uv.y);
  ivec2 sCell = ivec2(floor((sUv * u_resolution) / max(u_pixelScale, 1.0)));

  if (u_signalPreset < 0.5) {
    // 0: TV Static (RF Snow)
    float snow = prng2d(sCell, baseSeed + frameTick * 97u);
    float burst = smoothstep(0.85, 1.0, prng1f(uint(sCell.y / 3) + frameTick * 13u + baseSeed));
    float humBar = 0.5 + 0.5 * sin(sUv.y * 6.28318 - t * 2.2);
    float val = mix(0.22 + 0.25 * humBar, snow, u_staticAmt);
    val = mix(val, step(0.45, snow), burst * u_glitch * 0.8);
    return clamp(val, 0.0, 1.0);
  }

  if (u_signalPreset < 1.5) {
    // 1: CRT Scanlines & Phosphor Carrier
    float wave = 0.5 + 0.5 * sin(sUv.y * 14.0 - t * 3.0 + fbm(sUv * 4.0 + t * 0.3) * 3.5);
    float refreshBar = exp(-pow(fract(sUv.y + t * 0.22) - 0.5, 2.0) * 90.0) * 0.35;
    float grain = (prng2d(sCell, baseSeed + frameTick * 53u) - 0.5) * u_staticAmt * 0.55;
    return clamp(0.18 + wave * 0.55 + refreshBar + grain, 0.0, 1.0);
  }

  if (u_signalPreset < 2.5) {
    // 2: VHS Tracking Glitch
    float headSwitch = smoothstep(0.08, 0.0, sUv.y);
    float jitter = (prng1f(uint(sCell.y / 2) + frameTick * 41u) - 0.5) * (0.08 + 0.28 * headSwitch) * u_glitch;
    vec2 vUv = vec2(fract(sUv.x + jitter), sUv.y);
    float tapeBands = fbm(vec2(vUv.x * 2.5, vUv.y * 18.0 + t * 1.6) + u_seed);
    float dropout = step(0.94 - 0.14 * u_glitch, prng2d(ivec2(vUv.x * 40.0, vUv.y * 180.0), frameTick + baseSeed));
    float grain = (prng2d(sCell, baseSeed + frameTick * 71u) - 0.5) * u_staticAmt * 0.45;
    return clamp(tapeBands * 0.72 + dropout * 0.65 + grain, 0.0, 1.0);
  }

  if (u_signalPreset < 3.5) {
    // 3: 1-Bit Bayer Dither
    float field = fbm(sUv * 3.8 + vec2(t * 0.18, -t * 0.12) + u_seed * 2.1);
    float wave = 0.5 + 0.5 * sin(length(sUv - 0.5) * 14.0 - t * 2.4 + field * 4.0);
    float luma = mix(field, wave, 0.55) + (prng2d(sCell, frameTick + baseSeed) - 0.5) * u_staticAmt * 0.25;
    float thresh = bayer4x4(sCell);
    return step(thresh, clamp(luma, 0.0, 1.0));
  }

  if (u_signalPreset < 4.5) {
    // 4: Ryoji Ikeda Digital Data Matrix
    ivec2 barCell = ivec2(int(sUv.x * 96.0), int(sUv.y * 18.0));
    uint clk = uint(floor(t * 14.0));
    float colGate = step(0.35, prng1f(uint(barCell.y) * 311u + clk * 19u + baseSeed));
    float bits = step(0.52 - 0.2 * u_staticAmt, prng2d(barCell, clk * 73u + baseSeed));
    float microLine = step(0.88, fract(sUv.y * 18.0));
    float pulse = prng1f(uint(barCell.x) * 17u + clk * 59u) * u_glitch;
    return clamp(bits * colGate + microLine * 0.15 + pulse * 0.35, 0.0, 1.0);
  }

  // 5: Moiré Interference
  vec2 c1 = sUv - vec2(0.5 + 0.18 * cos(t * 0.7), 0.5 + 0.18 * sin(t * 0.5));
  vec2 c2 = sUv - vec2(0.5 - 0.18 * cos(t * 0.6), 0.5 - 0.18 * sin(t * 0.8));
  float m1 = sin(length(c1) * 95.0 - t * 4.0);
  float m2 = sin(length(c2) * 95.0 + t * 3.2);
  float moire = 0.5 + 0.25 * (m1 + m2);
  float grain = (prng2d(sCell, frameTick * 61u + baseSeed) - 0.5) * u_staticAmt * 0.45;
  return clamp(moire + grain, 0.0, 1.0);
}

void main() {
  uint baseSeed = uint(max(u_seed, 0.0) * 1000.0) + 1u;
  float t = u_time * u_speed;

  vec2 uv = applyCurvature(v_uv, u_curvature);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    outColor = vec4(0.02, 0.02, 0.025, 1.0);
    return;
  }

  // Chromatic aberration offset
  float shift = u_chroma * 0.012 * (1.0 + 0.8 * u_glitch * sin(t * 9.0));
  float lumaR = evalSignalLuma(uv + vec2(shift, 0.0), uv * u_resolution, t, baseSeed);
  float lumaG = evalSignalLuma(uv, uv * u_resolution, t, baseSeed);
  float lumaB = evalSignalLuma(uv - vec2(shift, 0.0), uv * u_resolution, t, baseSeed);

  vec3 colR = tritoneMap(lumaR, u_colorDark, u_colorMid, u_colorLight, 0.55);
  vec3 colG = tritoneMap(lumaG, u_colorDark, u_colorMid, u_colorLight, 0.55);
  vec3 colB = tritoneMap(lumaB, u_colorDark, u_colorMid, u_colorLight, 0.55);
  vec3 col = vec3(colR.r, colG.g, colB.b);

  // CRT scanline & RGB phosphor grille mask
  if (u_scanlines > 0.01) {
    float scan = 0.5 + 0.5 * sin(uv.y * u_resolution.y * 1.45);
    float grille = 0.5 + 0.5 * sin(uv.x * u_resolution.x * 1.8);
    float mask = mix(1.0, 0.55 + 0.45 * scan, u_scanlines) * mix(1.0, 0.80 + 0.20 * grille, u_scanlines * 0.7);
    col *= mask;
  }

  // Subtle CRT glass vignette when curvature is active
  if (u_curvature > 0.01) {
    vec2 vig = uv * (1.0 - uv.yx);
    float v = clamp(pow(vig.x * vig.y * 16.0, 0.22), 0.0, 1.0);
    col *= mix(1.0, v, u_curvature * 0.75);
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
