import { COMMON_GLSL } from './common.glsl.js';
import { colorSeedParam, GRADIENT_UNIFORMS_GLSL, GRADIENT_SAMPLER_GLSL } from './shader-params.js';

export const ferrofluidStudy = {
  id: 'ferrofluid',
  name: 'Magnetic Ferrofluid',
  description:
    'True 3D SDF raymarched ferrofluid in an isometric lab dish. Lowering magnets pulls 3D liquid bridges upward via smooth-minimum until the fluid clings to the magnet and erupts into sharp Rosensweig spikes.',
  mode: 'single',
  usesTritone: false,
  usesGradient: true,
  supportsObjects: true,
  params: [
    {
      key: 'u_viewMode',
      label: 'Camera View',
      group: 'Stage & View',
      type: 'select',
      default: 1,
      options: [
        { value: 1, label: 'Isometric Dish (3D)' },
        { value: 0, label: '2D Top-Down' },
      ],
    },
    {
      key: 'u_bgStyle',
      label: 'Lab Surface',
      group: 'Stage & View',
      type: 'select',
      default: 0,
      options: [
        { value: 0, label: 'Archival Lab Bench (Light)' },
        { value: 1, label: 'Anodized Slate Tray (Dark)' },
        { value: 2, label: 'Backlit Light-Table' },
      ],
    },
    { key: 'u_fluidVolume', label: 'Fluid Volume', group: 'Fluid Material', min: 0.25, max: 1.0, step: 0.05, default: 0.60 },
    { key: 'u_tension', label: 'Surface Tension (Bridge)', group: 'Fluid Material', min: 0.15, max: 1.0, step: 0.05, default: 0.65 },
    { key: 'u_sheen', label: 'Studio Reflection', group: 'Surface & Light', min: 0.4, max: 1.8, step: 0.05, default: 1.15 },
    { key: 'u_iridescence', label: 'Oil-Slick Coating', group: 'Surface & Light', min: 0.0, max: 1.0, step: 0.02, default: 0.15 },
    colorSeedParam({ label: 'Coat / Chrome Offset', group: 'Surface & Light' }),
  ],
  fragmentShader: /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_seed;

uniform float u_viewMode;
uniform float u_bgStyle;
uniform float u_camYaw;
uniform float u_camPitch;
uniform float u_fluidVolume;
uniform float u_tension;
uniform float u_sheen;
uniform float u_iridescence;
${GRADIENT_UNIFORMS_GLSL}

uniform vec4 u_pointer;     // x, y, down, strength
uniform vec2 u_pointerVel;  // vx, vy
uniform float u_sandboxMode;
uniform float u_objectCount;
uniform vec4 u_objectPos[8];
uniform vec4 u_objectExtra[8];

${COMMON_GLSL}
${GRADIENT_SAMPLER_GLSL}

const float DISH_R = 0.395;
const float DISH_OUTER_R = 0.422;
const float DISH_RIM_H = 0.036;

const float ISO_SCALE = 0.92;
const float ISO_OFFSET_Y = -0.04;

// Polynomial smooth-minimum for organic liquid bridging
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / max(k, 1e-4), 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Polynomial smooth-maximum for smooth repulsion carving & dish wall containment
float smax(float a, float b, float k) {
  return -smin(-a, -b, k);
}

float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-5);
}

// High-frequency 3D Rosensweig spike lattice oriented in 3D space
float spike3D(vec3 p) {
  const vec3 k1 = vec3( 0.8165,  0.0000,  0.5774);
  const vec3 k2 = vec3(-0.4082,  0.7071,  0.5774);
  const vec3 k3 = vec3(-0.4082, -0.7071,  0.5774);
  const vec3 k4 = vec3( 0.0000,  0.0000,  1.0000);
  float s = (
    cos(dot(p, k1)) +
    cos(dot(p, k2)) +
    cos(dot(p, k3)) +
    cos(dot(p, k4))
  ) * 0.25;
  float ridge = clamp(s * 0.5 + 0.5, 0.0, 1.0);
  return pow(ridge, 3.0);
}

// Apply a single 3D magnet to the ferrofluid SDF and accumulate inverse-square magnetic field
void evalMagnetSDF(
  vec3 p,
  vec4 objPos,
  vec4 objExtra,
  float bridgeK,
  inout float dFluid,
  inout float totalB,
  inout vec3 fieldDir
) {
  float charge = clamp(objPos.w, -2.5, 2.5);
  if (abs(charge) < 0.001) return;

  float objR = clamp(objPos.z, 0.025, 0.20);
  vec3 mPos = vec3(objPos.xy - 0.5, max(0.01, objExtra.x));
  vec3 dVec = p - mPos;
  float distSq = dot(dVec, dVec);

  // Inverse-square magnetic field strength from 3D magnet position
  float B = (charge * objR * objR * 12.0) / (distSq + 0.0018);
  totalB += B;
  fieldDir += (dVec / (sqrt(distSq) + 1e-4)) * B;

  if (charge > 0.0) {
    // Grounded magnetic pull with gravity:
    // Fluid is always anchored to the dish floor (z = 0) and stretches upward toward the magnet
    // as it approaches, snapping back down under gravity when lifted too high.
    float maxBridgeZ = 0.075 + objR * 0.9 + min(charge, 2.0) * 0.025;
    float bridgeFactor = smoothstep(maxBridgeZ + 0.06, 0.015, mPos.z);

    // Height the fluid column can climb against gravity
    float liftZ = min(mPos.z, maxBridgeZ) * bridgeFactor;
    // Contact cling: when magnet touches/dips into the pool, fluid wraps the magnet sphere
    float touchCling = smoothstep(0.055, 0.015, mPos.z);

    if (bridgeFactor > 0.001) {
      // Grounded vertical teardrop/pillar anchored at dish floor (z=0) reaching up to liftZ
      vec3 baseCenter = vec3(mPos.xy, liftZ * 0.45);
      float colR = objR * (0.65 - 0.20 * bridgeFactor) + 0.015;
      float colH = max(0.018, liftZ * 0.65 + 0.015);
      float dColumn = sdEllipsoid(p - baseCenter, vec3(colR, colR, colH));

      // Blend grounded column into the resting pool (never detached in mid-air!)
      dFluid = smin(dFluid, dColumn, bridgeK * (0.45 + 0.55 * bridgeFactor));

      // Cling collar around the magnet only when touching the dish pool
      if (touchCling > 0.001) {
        float dMagnet = length(dVec) - (objR * 0.36 + 0.010) * touchCling;
        dFluid = smin(dFluid, dMagnet, bridgeK * 0.5 * touchCling);
      }
    }
  } else {
    // Repulsor: carves a smooth depression in the ferrofluid when lowered near the pool
    float repelR = (objR * 0.85 + 0.02) * min(abs(charge), 2.0) * smoothstep(0.24, 0.02, mPos.z);
    if (repelR > 0.001) {
      float dRepel = length(dVec) - repelR;
      dFluid = smax(dFluid, -dRepel, bridgeK * 0.75);
    }
  }
}

// Macro SDF (no high-frequency spike displacement) for fast AO, shadows, and base liquid bridging
float mapFluidMacro(vec3 p, out float totalB, out vec3 fieldDir) {
  float poolR = 0.13 + 0.13 * u_fluidVolume;
  float poolH = 0.024 + 0.022 * u_fluidVolume;

  float dFluid = sdEllipsoid(p, vec3(poolR, poolR, poolH));
  float dDishWall = length(p.xy) - (DISH_R - 0.004);
  dFluid = smax(dFluid, dDishWall, 0.015);
  dFluid = smax(dFluid, -p.z, 0.004);

  float bridgeK = 0.035 + 0.065 * u_tension;
  totalB = 0.0;
  fieldDir = vec3(0.0);

  int count = int(u_objectCount + 0.5);
  for (int i = 0; i < 8; i++) {
    if (i >= count) break;
    evalMagnetSDF(p, u_objectPos[i], u_objectExtra[i], bridgeK, dFluid, totalB, fieldDir);
  }

  if (count == 0 && u_sandboxMode < 0.5) {
    vec2 p1 = vec2(0.5) + vec2(cos(u_time * 0.55), sin(u_time * 0.8)) * 0.13;
    vec2 p2 = vec2(0.5) + vec2(cos(u_time * 0.45 + 3.14), sin(u_time * 0.65 + 1.5)) * 0.12;
    evalMagnetSDF(p, vec4(p1, 0.072, 1.35), vec4(0.045, 0.0, 0.0, 0.0), bridgeK, dFluid, totalB, fieldDir);
    evalMagnetSDF(p, vec4(p2, 0.068, 1.20), vec4(0.075, 0.0, 0.0, 0.0), bridgeK, dFluid, totalB, fieldDir);
  }

  if (abs(u_pointer.w) > 0.01 && length(u_pointer.xy - 0.5) < DISH_R) {
    float ptrSign = u_pointer.z > 0.5 ? -1.15 : 0.70;
    evalMagnetSDF(
      p,
      vec4(u_pointer.xy, 0.065, min(u_pointer.w, 1.3) * ptrSign),
      vec4(0.065, 0.0, 0.0, 0.0),
      bridgeK, dFluid, totalB, fieldDir
    );
  }

  return dFluid;
}

// Full 3D Ferrofluid SDF with Rosensweig spikes
float mapFerrofluid(vec3 p, out float outB) {
  float totalB;
  vec3 fieldDir;
  float dFluid = mapFluidMacro(p, totalB, fieldDir);

  float absB = abs(totalB);
  outB = absB;
  float spikeMask = smoothstep(0.32, 1.35, absB);
  if (spikeMask > 0.001 && dFluid < 0.045) {
    vec3 fDir = length(fieldDir) > 1e-4 ? normalize(fieldDir) : vec3(0.0, 0.0, 1.0);
    float spikes = spike3D(p * 115.0 + fDir * 1.4 + u_seed * 2.1);
    float spikeAmp = 0.022 * spikeMask * (0.75 + 0.25 * clamp(absB * 0.35, 0.0, 1.0));
    dFluid -= spikes * spikeAmp;
  }

  return dFluid;
}

float mapSDF(vec3 p) {
  float b;
  return mapFerrofluid(p, b);
}

float mapMacro(vec3 p) {
  float b;
  vec3 fd;
  return mapFluidMacro(p, b, fd);
}

// Tetrahedral central-difference 3D SDF normal
vec3 calcNormal(vec3 p) {
  const float h = 0.0012;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * mapSDF(p + k.xyy * h) +
    k.yyx * mapSDF(p + k.yyx * h) +
    k.yxy * mapSDF(p + k.yxy * h) +
    k.xxx * mapSDF(p + k.xxx * h)
  );
}

// Macro SDF ambient occlusion (fast compile & runtime)
float calcAO(vec3 pos, vec3 nor) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 3; i++) {
    float h = 0.006 + 0.015 * float(i);
    float d = mapMacro(pos + h * nor);
    occ += (h - d) * sca;
    sca *= 0.65;
  }
  return clamp(1.0 - 8.5 * occ, 0.18, 1.0);
}

// Soft shadow from ferrofluid onto dish floor
float calcSoftShadow(vec3 ro, vec3 rd) {
  float res = 1.0;
  float t = 0.008;
  for (int i = 0; i < 8; i++) {
    float h = mapMacro(ro + rd * t);
    res = min(res, 9.0 * h / t);
    t += clamp(h * 0.75, 0.008, 0.036);
    if (res < 0.02 || t > 0.32) break;
  }
  return clamp(res, 0.0, 1.0);
}

// High-contrast procedural studio light rig (bright softbox strips on a dark dome)
vec3 sampleStudioRig(vec3 R) {
  float dome = smoothstep(-0.35, 0.85, R.z);
  vec3 env = mix(vec3(0.01, 0.012, 0.018), vec3(0.11, 0.13, 0.17), dome);

  // Crisp overhead softbox strips
  float strip1 = smoothstep(0.84, 0.96, dot(R, normalize(vec3(-0.38, 0.55, 0.74))));
  float strip2 = smoothstep(0.88, 0.98, dot(R, normalize(vec3(0.55, -0.25, 0.79))));
  float horizonRing = smoothstep(0.18, 0.0, abs(R.z - 0.12)) * 0.24;

  return env
       + vec3(1.0, 0.99, 0.97) * strip1 * 1.45
       + vec3(0.88, 0.94, 1.0) * strip2 * 1.10
       + vec3(0.42, 0.48, 0.58) * horizonRing;
}

vec2 screenToPlaneXY(float sx, float sy, float zPlane, vec3 camRight, vec3 camUp, vec3 camForward) {
  if (u_viewMode < 0.5) {
    return vec2(sx, sy);
  }
  float u = sx / ISO_SCALE;
  float v = (sy - ISO_OFFSET_Y) / ISO_SCALE;
  vec3 ro = camRight * u + camUp * v - camForward * 0.85;
  float t = (zPlane - ro.z) / min(camForward.z, -1e-4);
  return ro.xy + camForward.xy * t;
}

vec3 sampleBenchBackground(float sx, float sy, float dishShadow) {
  float radial = length(vec2(sx * 0.75, sy + 0.05));
  float vignette = smoothstep(1.1, 0.1, radial);

  vec3 bench;
  if (u_bgStyle < 0.5) {
    bench = mix(vec3(0.84, 0.82, 0.77), vec3(0.94, 0.92, 0.88), vignette);
  } else if (u_bgStyle < 1.5) {
    bench = mix(vec3(0.05, 0.055, 0.068), vec3(0.11, 0.125, 0.15), vignette);
  } else {
    bench = mix(vec3(0.30, 0.40, 0.50), vec3(0.78, 0.88, 0.95), vignette);
  }
  return bench * (1.0 - dishShadow * 0.42);
}

vec3 sampleDishFloor(vec2 p) {
  float r = length(p);
  vec2 gridP = p * 24.0;
  vec2 fw = max(fwidth(gridP), vec2(0.002));
  vec2 g = abs(fract(gridP - 0.5) - 0.5) / fw;
  float gridLine = 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
  float ring = smoothstep(0.004, 0.0, abs(r - 0.20)) * 0.6;
  float innerShade = smoothstep(DISH_R, DISH_R - 0.04, r);

  if (u_bgStyle < 0.5) {
    vec3 base = vec3(0.96, 0.95, 0.92);
    base -= vec3(0.06, 0.06, 0.055) * gridLine * 0.45;
    base -= vec3(0.08, 0.08, 0.075) * ring;
    return base * mix(0.84, 1.0, innerShade);
  } else if (u_bgStyle < 1.5) {
    vec3 base = vec3(0.13, 0.145, 0.175);
    base += vec3(0.04, 0.05, 0.065) * gridLine * 0.40;
    base += vec3(0.06, 0.08, 0.11) * ring;
    return base * mix(0.75, 1.0, innerShade);
  } else {
    vec3 base = vec3(0.86, 0.93, 0.98);
    base -= vec3(0.10, 0.12, 0.14) * gridLine * 0.35;
    return base * mix(0.86, 1.0, innerShade);
  }
}

void main() {
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  float sx = (v_uv.x - 0.5) * aspect;
  float sy = v_uv.y - 0.5;
  bool isIso = u_viewMode >= 0.5;

  // Orthonormal orbital camera basis around dish focus point (0, 0, 0)
  float cy = cos(u_camYaw);
  float syaw = sin(u_camYaw);
  float cp = cos(u_camPitch);
  float sp = sin(u_camPitch);
  vec3 camRight = vec3(syaw, -cy, 0.0);
  vec3 camUp = vec3(cy * sp, syaw * sp, cp);
  vec3 camForward = vec3(cy * cp, syaw * cp, -sp);

  vec3 rd = isIso ? camForward : vec3(0.0, 0.0, -1.0);
  vec3 ro = isIso
    ? (camRight * (sx / ISO_SCALE) + camUp * ((sy - ISO_OFFSET_Y) / ISO_SCALE) - camForward * 0.85)
    : vec3(sx, sy, 0.85);

  // Analytic distance to z = 0 ground plane
  float tFloor = -ro.z / rd.z;
  vec2 floorXY = ro.xy + rd.xy * tFloor;

  // Raymarch 3D Ferrofluid SDF inside bounding sphere centered at (0, 0, 0.12)
  // so low-angle camera views never clip tall liquid bridges or spikes
  bool hitFluid = false;
  float hitB = 0.0;
  int hitSteps = 0;

  vec2 topRimXY = screenToPlaneXY(sx, sy, isIso ? DISH_RIM_H : 0.0, camRight, camUp, camForward);
  float rTop = length(topRimXY);
  float rFloor = length(floorXY);

  vec3 oc = ro - vec3(0.0, 0.0, 0.12);
  float bSph = dot(oc, rd);
  float cSph = dot(oc, oc) - 0.48 * 0.48;
  float disc = bSph * bSph - cSph;

  float t = 0.0;
  if (disc > 0.0) {
    float sq = sqrt(disc);
    float tStart = max(0.0, -bSph - sq);
    float tEnd = min(tFloor, -bSph + sq);
    t = tStart;

    if (tStart < tEnd) {
      for (int i = 0; i < 56; i++) {
        if (t >= tEnd) break;
        vec3 p = ro + rd * t;
        float bVal;
        float d = mapFerrofluid(p, bVal);
        if (d < 0.0009) {
          hitFluid = true;
          hitB = bVal;
          hitSteps = i;
          break;
        }
        t += max(d * 0.45, 0.0014);
      }
    }
  }

  if (hitFluid) {
    vec3 hitPos = ro + rd * t;
    vec3 normal = calcNormal(hitPos);
    vec3 viewDir = -rd;
    vec3 refl = reflect(-viewDir, normal);

    float NdotV = clamp(dot(normal, viewDir), 0.0, 1.0);
    float chromeMix = colorSeedPhase();
    // Strong Schlick Fresnel: sweeps from obsidian (F0=0.10) to full liquid chrome (F0=0.72)
    float F0 = mix(0.10, 0.72, chromeMix);
    float fresnel = F0 + (1.0 - F0) * pow(1.0 - NdotV, mix(4.2, 2.2, chromeMix));

    float ao = calcAO(hitPos, normal) * mix(1.0, 0.65, float(hitSteps) / 64.0);
    vec3 studioRefl = sampleStudioRig(refl) * u_sheen;

    // Optional thin-film iridescence on curved flanks (gradient-aware & phase-shifted)
    if (u_iridescence > 0.005) {
      uint baseSeed = uint(max(u_seed, 0.0) * 1000.0) + 1u;
      uint coatSeed = computeColorSeed(baseSeed);
      vec3 iridCol = sampleShaderPalette((1.0 - NdotV) * 1.4 + hitPos.z * 2.2, coatSeed);
      studioRefl = mix(studioRefl, studioRefl * (0.45 + 0.95 * iridCol), u_iridescence);
    }

    // Jet-black obsidian base (0) -> bright liquid mercury base (100)
    vec3 baseAlbedo = mix(vec3(0.012, 0.012, 0.020), vec3(0.16, 0.18, 0.22), chromeMix);
    vec3 col = mix(baseAlbedo, studioRefl, fresnel) * ao;

    outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    return;
  }

  // Render Dish Rim, Inner Wall, Bench, or Dish Floor with SDF Soft Shadows
  if (rTop >= DISH_R && rTop <= DISH_OUTER_R) {
    vec2 rimDir = normalize(topRimXY);
    float rimBevel = smoothstep(DISH_R, DISH_R + 0.007, rTop) * (1.0 - smoothstep(DISH_OUTER_R - 0.007, DISH_OUTER_R, rTop));
    float lightDot = dot(rimDir, normalize(vec2(-0.6, 0.6)));
    vec3 rimCol = mix(vec3(0.42, 0.45, 0.49), vec3(0.86, 0.89, 0.92), 0.5 + 0.5 * lightDot);
    rimCol *= mix(0.76, 1.05, rimBevel);
    outColor = vec4(rimCol, 1.0);
    return;
  }

  if (isIso && rFloor > DISH_R && rTop < DISH_OUTER_R) {
    vec2 wallXY = screenToPlaneXY(sx, sy, DISH_RIM_H * 0.5, camRight, camUp, camForward);
    vec2 wallDir = normalize(wallXY);
    float wallLight = 0.5 + 0.5 * dot(wallDir, normalize(vec2(-0.65, 0.55)));
    vec3 wallCol = mix(vec3(0.18, 0.20, 0.24), vec3(0.55, 0.58, 0.63), wallLight);
    outColor = vec4(wallCol, 1.0);
    return;
  }

  if (isIso && rFloor < DISH_R && rTop > DISH_R) {
    vec3 innerWall = mix(vec3(0.22, 0.24, 0.28), vec3(0.42, 0.45, 0.50), 0.5);
    outColor = vec4(innerWall, 1.0);
    return;
  }

  if (rFloor > DISH_R) {
    vec2 shadowXY = screenToPlaneXY(sx + 0.015, sy + 0.018, 0.0, camRight, camUp, camForward);
    float dShad = length(shadowXY);
    float dishShadow = smoothstep(DISH_OUTER_R + 0.05, DISH_OUTER_R - 0.01, dShad);
    outColor = vec4(sampleBenchBackground(sx, sy, dishShadow), 1.0);
    return;
  }

  // Dry dish floor at z = 0 with true 3D SDF cast shadow from ferrofluid & bridges
  vec3 floorPos = vec3(floorXY, 0.001);
  vec3 lightDir = normalize(vec3(-0.35, 0.52, 0.78));
  float shadow = calcSoftShadow(floorPos, lightDir);
  vec3 floorCol = sampleDishFloor(floorXY) * mix(0.42, 1.0, shadow);

  outColor = vec4(clamp(floorCol, 0.0, 1.0), 1.0);
}
`,
};
