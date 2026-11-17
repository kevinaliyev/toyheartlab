/**
 * Shared GLSL 300 es procedural primitives:
 * hashes, 2D value/simplex noise, fBm, directional brush noise, paper grain, and tritone mapping.
 */
export const COMMON_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Smooth 2D value noise in [0, 1]
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);

  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 4-octave Fractal Brownian Motion in [0, 1]
float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    value += amp * vnoise(p);
    p = rot * p * 2.03 + vec2(17.1, 31.7);
    amp *= 0.5;
  }
  return value;
}

// Directional (anisotropic) noise stretched along a given angle for brush-bristle streaks
float brushNoise(vec2 p, float angle, float stretch) {
  float c = cos(angle);
  float s = sin(angle);
  mat2 r = mat2(c, -s, s, c);
  vec2 q = r * p;
  q.x /= stretch;
  q.y *= stretch;
  return fbm(q);
}

// Subtle procedural paper/canvas fiber texture centered around 0.0
float paperGrain(vec2 fragCoord) {
  float fine = hash12(fragCoord * 0.85) - 0.5;
  float fiber = vnoise(fragCoord * vec2(0.18, 0.04)) - 0.5;
  return fine * 0.6 + fiber * 0.4;
}

// Maps scalar t in [0, 1] across dark -> mid -> light with controllable edge crispness
vec3 tritoneMap(float t, vec3 dark, vec3 mid, vec3 light, float contrast) {
  float edge = mix(0.28, 0.025, clamp(contrast, 0.0, 1.0));
  float lowBand = smoothstep(0.33 - edge, 0.33 + edge, t);
  float highBand = smoothstep(0.67 - edge, 0.67 + edge, t);
  vec3 col = mix(dark, mid, lowBand);
  col = mix(col, light, highBand);
  return col;
}

// 32-bit PCG integer hash for deterministic PRNG
uint pcgHash(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

float prng1f(uint seed) {
  return float(pcgHash(seed)) * (1.0 / 4294967296.0);
}

vec3 prng3f(uint seed) {
  uint h1 = pcgHash(seed);
  uint h2 = pcgHash(h1);
  uint h3 = pcgHash(h2);
  return vec3(h1, h2, h3) * (1.0 / 4294967296.0);
}

float prng2d(ivec2 p, uint seed) {
  uint x = uint(p.x) * 374761393u;
  uint y = uint(p.y) * 668265263u;
  return prng1f(x ^ y ^ pcgHash(seed));
}

// Smooth quintic-interpolated 2D PRNG value noise in [0, 1]
float prngNoise(vec2 p, uint seed) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 ip = ivec2(i);

  float a = prng2d(ip, seed);
  float b = prng2d(ip + ivec2(1, 0), seed);
  float c = prng2d(ip + ivec2(0, 1), seed);
  float d = prng2d(ip + ivec2(1, 1), seed);

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 5-octave rotated PRNG fBm in [0, 1]
float prngFbm(vec2 p, uint seed) {
  float value = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 5; i++) {
    value += amp * prngNoise(p, seed + uint(i) * 1013u);
    norm += amp;
    p = rot * p * 2.02 + vec2(13.7, 29.3);
    amp *= 0.5;
  }
  return value / norm;
}

// Seeded cosine gradient palette
vec3 seededCosinePalette(float t, uint seed) {
  vec3 r0 = prng3f(seed + 17u);
  vec3 r1 = prng3f(seed + 53u);
  vec3 r2 = prng3f(seed + 97u);
  vec3 a = mix(vec3(0.35), vec3(0.62), r0);
  vec3 b = mix(vec3(0.28), vec3(0.48), r1);
  vec3 c = mix(vec3(0.75), vec3(1.55), r2);
  vec3 d = prng3f(seed + 151u);
  return clamp(a + b * cos(6.2831853 * (c * t + d)), 0.0, 1.0);
}
`;
