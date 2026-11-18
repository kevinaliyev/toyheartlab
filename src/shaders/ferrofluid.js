import { COMMON_GLSL } from './common.glsl.js';

export const ferrofluidStudy = {
  id: 'ferrofluid',
  name: 'Magnetic Ferrofluid',
  description:
    'Finite-volume magnetic ferrofluid in a physics dish that flows, bridges across poles, splits, and erupts into 3D Rosensweig spikes, with 2D, Isometric, and 3D Perspective views.',
  mode: 'pingpong',
  usesTritone: false,
  usesGradient: true,
  supportsObjects: true,
  params: [
    {
      key: 'u_viewMode',
      label: 'Camera Perspective',
      group: 'Stage & View',
      type: 'select',
      default: 1,
      options: [
        { value: 0, label: '2D Top-Down (Empty Canvas)' },
        { value: 1, label: 'Isometric 2.5D (Extruded Spikes)' },
        { value: 2, label: '3D Perspective Dish' },
      ],
    },
    {
      key: 'u_bgStyle',
      label: 'Canvas Surface',
      group: 'Stage & View',
      type: 'select',
      default: 0,
      options: [
        { value: 0, label: 'Archival Lab Dish (Light)' },
        { value: 1, label: 'Anodized Slate Tray (Dark)' },
        { value: 2, label: 'Backlit Light-Table' },
      ],
    },
    { key: 'u_fluidVolume', label: 'Fluid Volume', group: 'Fluid Physics', min: 0.20, max: 1.0, step: 0.05, default: 0.55 },
    { key: 'u_tension', label: 'Droplet Cohesion', group: 'Fluid Physics', min: 0.10, max: 1.0, step: 0.05, default: 0.55 },
    { key: 'u_damping', label: 'Fluid Viscosity', group: 'Fluid Physics', min: 0.50, max: 0.94, step: 0.02, default: 0.78 },
    { key: 'u_spikeFreq', label: 'Spike Density', group: 'Magnetics', min: 14.0, max: 48.0, step: 1.0, default: 28.0 },
    { key: 'u_spikeSharp', label: 'Spike Height / Sharp', group: 'Magnetics', min: 0.6, max: 2.5, step: 0.05, default: 1.40 },
    { key: 'u_fieldStrength', label: 'Magnetic Pull', group: 'Magnetics', min: 0.3, max: 2.5, step: 0.05, default: 1.30 },
    { key: 'u_sheen', label: 'Specular Gloss', group: 'Surface & Light', min: 0.2, max: 1.5, step: 0.05, default: 0.95 },
    { key: 'u_iridescence', label: 'Oil-Slick Coating', group: 'Surface & Light', min: 0.0, max: 1.0, step: 0.02, default: 0.25 },
    { key: 'u_colorSeed', label: 'Coat Seed Offset', group: 'Surface & Light', min: 0.0, max: 100.0, step: 1.0, default: 0.0 },
  ],
  simShader: /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outState;

uniform sampler2D u_prevTex;
uniform float u_time;
uniform float u_frame;
uniform vec2 u_resolution;
uniform float u_seed;

uniform float u_fluidVolume;
uniform float u_tension;
uniform float u_damping;
uniform float u_spikeFreq;
uniform float u_spikeSharp;
uniform float u_fieldStrength;

uniform vec4 u_pointer;     // x, y, down, strength
uniform vec2 u_pointerVel;  // vx, vy
uniform float u_objectCount;
uniform vec4 u_objectPos0; uniform vec4 u_objectVel0;
uniform vec4 u_objectPos1; uniform vec4 u_objectVel1;
uniform vec4 u_objectPos2; uniform vec4 u_objectVel2;
uniform vec4 u_objectPos3; uniform vec4 u_objectVel3;
uniform vec4 u_objectPos4; uniform vec4 u_objectVel4;
uniform vec4 u_objectPos5; uniform vec4 u_objectVel5;
uniform vec4 u_objectPos6; uniform vec4 u_objectVel6;
uniform vec4 u_objectPos7; uniform vec4 u_objectVel7;

${COMMON_GLSL}

// Hexagonal 3-wave Rosensweig instability lattice for 3D ferrofluid cones
float rosensweigLattice(vec2 p, float phase) {
  const vec2 k1 = vec2(1.0, 0.0);
  const vec2 k2 = vec2(-0.5, 0.8660254);
  const vec2 k3 = vec2(-0.5, -0.8660254);
  float w = (
    cos(dot(p, k1) + phase) +
    cos(dot(p, k2) - phase * 0.7) +
    cos(dot(p, k3) + phase * 0.4)
  ) / 3.0;
  return smoothstep(0.05, 0.98, w * 0.5 + 0.5);
}

// Smooth, singularity-free magnetic metaball & drag evaluation across poles
void evalPolePotential(
  vec2 uv,
  vec2 aspect,
  vec4 objPos,
  vec4 objVel,
  float volScale,
  inout float attractPotential,
  inout float repelPotential,
  inout float bField,
  inout vec2 dragShift,
  inout float weightSum
) {
  float charge = clamp(objPos.w, -2.5, 2.5);
  if (abs(charge) < 0.001) return;

  float radius = max(objPos.z, 0.03) * (0.85 + 0.50 * volScale);
  vec2 d = (uv - objPos.xy) * aspect;
  float r2 = dot(d, d);
  float s2 = radius * radius * 2.2;

  // Smooth Gaussian core + soft Lorentzian tail so poles bridge like liquid metaballs without sharp creases
  float core = exp(-r2 / s2);
  float bridge = exp(-r2 / (s2 * 2.8));
  float kernel = 0.72 * core + 0.28 * bridge;

  // Clamped velocity prevents fast mouse flicks from exploding the advection lookup
  vec2 safeVel = clamp(objVel.xy, vec2(-1.0), vec2(1.0));

  if (charge > 0.0) {
    float q = min(charge, 2.0);
    // Sub-linear accumulation so overlapping poles merge smoothly instead of doubling to infinity
    attractPotential += q * kernel;
    bField += q * (0.8 * core + 0.2 * bridge);
    dragShift += safeVel * core * 0.0055;
    weightSum += core;
  } else {
    float q = min(abs(charge), 2.0);
    // Negative pole carves a smooth depression and pushes a soft collar around its perimeter
    repelPotential += q * core * 1.15;
    float collar = exp(-pow((sqrt(r2) - radius * 1.55) / (radius * 0.55), 2.0)) * q * 0.32;
    attractPotential += collar;
    bField += q * collar * 0.8;
    // Smooth non-singular outward push (vanishes at r=0 so it never overshoots the pole center)
    vec2 pushOut = (d / (radius + sqrt(r2))) * core * q * 0.0045;
    dragShift += pushOut + safeVel * core * 0.004;
  }
}

void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  vec2 centered = (v_uv - 0.5) * aspect;

  float attractPotential = 0.0;
  float repelPotential = 0.0;
  float bField = 0.0;
  vec2 dragShift = vec2(0.0);
  float weightSum = 0.0;

  int count = int(u_objectCount + 0.5);
  bool hasPositivePole = false;
  if (count > 0 && u_objectPos0.w > 0.05) hasPositivePole = true;
  if (count > 1 && u_objectPos1.w > 0.05) hasPositivePole = true;
  if (count > 2 && u_objectPos2.w > 0.05) hasPositivePole = true;
  if (count > 3 && u_objectPos3.w > 0.05) hasPositivePole = true;
  if (count > 4 && u_objectPos4.w > 0.05) hasPositivePole = true;
  if (count > 5 && u_objectPos5.w > 0.05) hasPositivePole = true;
  if (count > 6 && u_objectPos6.w > 0.05) hasPositivePole = true;
  if (count > 7 && u_objectPos7.w > 0.05) hasPositivePole = true;

  // Ambient central puddle when no positive poles are placed
  if (!hasPositivePole && count > 0) {
    float baseR = 0.19 * (0.65 + 0.65 * u_fluidVolume);
    float cCore = exp(-dot(centered, centered) / (baseR * baseR));
    attractPotential += cCore * 1.05;
    bField += cCore * 0.65;
  }

  if (count > 0) evalPolePotential(v_uv, aspect, u_objectPos0, u_objectVel0, u_fluidVolume, attractPotential, repelPotential, bField, dragShift, weightSum);
  if (count > 1) evalPolePotential(v_uv, aspect, u_objectPos1, u_objectVel1, u_fluidVolume, attractPotential, repelPotential, bField, dragShift, weightSum);
  if (count > 2) evalPolePotential(v_uv, aspect, u_objectPos2, u_objectVel2, u_fluidVolume, attractPotential, repelPotential, bField, dragShift, weightSum);
  if (count > 3) evalPolePotential(v_uv, aspect, u_objectPos3, u_objectVel3, u_fluidVolume, attractPotential, repelPotential, bField, dragShift, weightSum);
  if (count > 4) evalPolePotential(v_uv, aspect, u_objectPos4, u_objectVel4, u_fluidVolume, attractPotential, repelPotential, bField, dragShift, weightSum);
  if (count > 5) evalPolePotential(v_uv, aspect, u_objectPos5, u_objectVel5, u_fluidVolume, attractPotential, repelPotential, bField, dragShift, weightSum);
  if (count > 6) evalPolePotential(v_uv, aspect, u_objectPos6, u_objectVel6, u_fluidVolume, attractPotential, repelPotential, bField, dragShift, weightSum);
  if (count > 7) evalPolePotential(v_uv, aspect, u_objectPos7, u_objectVel7, u_fluidVolume, attractPotential, repelPotential, bField, dragShift, weightSum);

  // Standalone Shader Lab mode (no 2D objects): two orbiting poles pulling & bridging fluid
  if (count == 0) {
    vec2 p1 = vec2(0.5) + vec2(cos(u_time * 0.55), sin(u_time * 0.8)) * 0.17 / aspect;
    vec2 p2 = vec2(0.5) + vec2(cos(u_time * 0.45 + 3.14), sin(u_time * 0.65 + 1.5)) * 0.15 / aspect;
    evalPolePotential(v_uv, aspect, vec4(p1, 0.085, 1.30), vec4(0.0), u_fluidVolume, attractPotential, repelPotential, bField, dragShift, weightSum);
    evalPolePotential(v_uv, aspect, vec4(p2, 0.080, 1.15), vec4(0.0), u_fluidVolume, attractPotential, repelPotential, bField, dragShift, weightSum);
  }

  // Live cursor magnetic field (hover gently attracts, click & hold parts/repels the ferrofluid)
  if (abs(u_pointer.w) > 0.01) {
    float ptrSign = u_pointer.z > 0.5 ? -1.25 : 0.75;
    evalPolePotential(
      v_uv, aspect,
      vec4(u_pointer.xy, 0.072, min(u_pointer.w, 1.5) * ptrSign),
      vec4(u_pointerVel, 0.0, 0.0),
      u_fluidVolume, attractPotential, repelPotential, bField, dragShift, weightSum
    );
  }

  // Soft-saturate combined attraction so overlapping poles form a smooth flat-topped pool instead of exploding
  float netPotential = (1.0 - exp(-attractPotential * 1.15)) * 1.18 - repelPotential;
  float targetMass = clamp(netPotential, 0.0, 1.15);

  if (u_frame < 0.5) {
    outState = vec4(targetMass, targetMass * 0.35, 0.0, 0.0);
    return;
  }

  // Strictly bound per-frame advection offset so lookups never jump or explode
  vec2 safeShift = clamp(dragShift, vec2(-0.008), vec2(0.008));
  vec2 advUv = clamp(v_uv - safeShift / aspect, vec2(0.003), vec2(0.997));

  vec4 c = texture(u_prevTex, advUv);
  vec4 n = texture(u_prevTex, clamp(advUv + vec2(0.0, px.y * 1.6), 0.003, 0.997));
  vec4 s = texture(u_prevTex, clamp(advUv - vec2(0.0, px.y * 1.6), 0.003, 0.997));
  vec4 e = texture(u_prevTex, clamp(advUv + vec2(px.x * 1.6, 0.0), 0.003, 0.997));
  vec4 w = texture(u_prevTex, clamp(advUv - vec2(px.x * 1.6, 0.0), 0.003, 0.997));
  vec4 avg = 0.25 * (n + s + e + w);

  // Viscous relaxation + surface tension smoothing (no >1 multiplier so mass never runs away)
  float prevMass = mix(c.r, avg.r, 0.32);
  float relaxRate = 1.0 - clamp(u_damping, 0.50, 0.94);
  float rawMass = mix(prevMass, targetMass, relaxRate);
  // Subtle droplet edge cohesion without runaway amplification
  float mass = mix(rawMass, smoothstep(0.06 * u_tension, 0.92 - 0.15 * u_tension, rawMass), 0.22);
  mass = clamp(mass, 0.0, 1.15);

  // Compute 3D surface height H(x,y): 0 on dry canvas, smooth meniscus + 3D Rosensweig cones inside pool
  float poolMask = smoothstep(0.14, 0.30, mass);
  float meniscus = pow(smoothstep(0.12, 0.82, mass), 0.65);

  float absB = clamp(bField * u_fieldStrength, 0.0, 2.2);
  vec2 warp = vec2(
    vnoise(centered * 3.2 + vec2(u_time * 0.05, u_seed)),
    vnoise(centered * 3.2 - vec2(u_seed, u_time * 0.04) + 7.1)
  ) - 0.5;

  // Smoothly advect the phase of the spike lattice so spikes glide with dragged fluid
  vec2 prevPhase = mix(c.ba, avg.ba, 0.25);
  vec2 latticePhase = clamp((prevPhase + safeShift * 0.85) * 0.92, vec2(-0.12), vec2(0.12));

  vec2 spikeCoord = (centered - latticePhase + warp * 0.032) * u_spikeFreq;
  float cones = pow(rosensweigLattice(spikeCoord, u_seed * 1.7), u_spikeSharp);

  float spikeHeight = cones * smoothstep(0.12, 1.10, absB) * (0.35 + 0.65 * meniscus);
  float targetH = poolMask * (meniscus * 0.26 + spikeHeight * 0.74);
  float h = mix(mix(c.g, avg.g, 0.25), targetH, relaxRate * 0.70);

  outState = vec4(mass, clamp(h, 0.0, 1.15), latticePhase.x, latticePhase.y);
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

uniform float u_viewMode;
uniform float u_bgStyle;
uniform float u_sheen;
uniform float u_iridescence;
uniform float u_colorSeed;
uniform float u_useGradient;
uniform vec3 u_gradA;
uniform vec3 u_gradB;
uniform vec3 u_gradC;
uniform vec3 u_gradD;

${COMMON_GLSL}

vec3 sampleCoatPalette(float t, uint seed) {
  if (u_useGradient > 0.5) {
    return clamp(u_gradA + u_gradB * cos(6.2831853 * (u_gradC * t + u_gradD)), 0.0, 1.0);
  }
  return seededCosinePalette(t, seed);
}

// Render the dry laboratory dish / canvas background at floor UV
vec3 sampleCanvasBackground(vec2 floorUv, vec2 aspect) {
  vec2 p = (floorUv - 0.5) * aspect;
  float r = length(p);

  // Subtle calibration grid + concentric petri/dish rings
  vec2 gridP = p * 22.0;
  vec2 fw = max(fwidth(gridP), vec2(0.001));
  vec2 g = abs(fract(gridP - 0.5) - 0.5) / fw;
  float gridLine = 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);

  vec2 subGridP = p * 4.4;
  vec2 subG = abs(fract(subGridP - 0.5) - 0.5) / max(fwidth(subGridP), vec2(0.001));
  float majorLine = 1.0 - clamp(min(subG.x, subG.y), 0.0, 1.0);

  float dishRing = smoothstep(0.006, 0.0, abs(r - 0.42)) + smoothstep(0.004, 0.0, abs(r - 0.21)) * 0.5;
  float vignette = smoothstep(0.95, 0.15, r);

  if (u_bgStyle < 0.5) {
    // 0: Warm Archival Lab Dish (Light contrasting surface)
    vec3 paper = mix(vec3(0.84, 0.82, 0.77), vec3(0.95, 0.93, 0.89), vignette);
    paper -= vec3(0.06, 0.06, 0.055) * gridLine * 0.45;
    paper -= vec3(0.11, 0.11, 0.10) * majorLine * 0.55;
    paper -= vec3(0.14, 0.13, 0.12) * clamp(dishRing, 0.0, 1.0) * 0.65;
    return paper;
  } else if (u_bgStyle < 1.5) {
    // 1: Brushed Anodized Slate Tray (Dark technical stage)
    vec3 slate = mix(vec3(0.055, 0.062, 0.075), vec3(0.12, 0.135, 0.16), vignette);
    slate += vec3(0.04, 0.05, 0.065) * gridLine * 0.4;
    slate += vec3(0.08, 0.10, 0.13) * majorLine * 0.6;
    slate += vec3(0.12, 0.16, 0.22) * clamp(dishRing, 0.0, 1.0) * 0.7;
    return slate;
  } else {
    // 2: Backlit Cyan/Warm Frosted Light-Table
    vec3 glow = mix(vec3(0.32, 0.42, 0.52), vec3(0.82, 0.90, 0.96), vignette);
    glow -= vec3(0.10, 0.12, 0.14) * gridLine * 0.35;
    glow -= vec3(0.18, 0.20, 0.22) * majorLine * 0.5;
    return glow;
  }
}

float sampleFluidHeight(vec2 uv) {
  if (uv.x < 0.002 || uv.x > 0.998 || uv.y < 0.002 || uv.y > 0.998) return 0.0;
  return texture(u_simTex, uv).g;
}

float sampleFluidMass(vec2 uv) {
  if (uv.x < 0.002 || uv.x > 0.998 || uv.y < 0.002 || uv.y > 0.998) return 0.0;
  return texture(u_simTex, uv).r;
}

void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 px = 1.4 / max(u_resolution, vec2(1.0));

  // 1. Determine floor plane coordinates & 3D extrusion vector based on Camera Perspective (u_viewMode)
  vec2 baseUv = v_uv;
  vec2 extrudeDir = vec2(0.0);
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  float heightScale = 0.0;

  if (u_viewMode > 0.5 && u_viewMode < 1.5) {
    // Mode 1: Isometric 2.5D Relief (45-degree oblique extrusion upward on screen)
    heightScale = 0.14;
    extrudeDir = vec2(0.0, heightScale);
    viewDir = normalize(vec3(0.0, -0.58, 0.81));
  } else if (u_viewMode >= 1.5) {
    // Mode 2: 3D Perspective Stage (Tilted tabletop dish with perspective foreshortening)
    vec2 s = v_uv - 0.5;
    float zDepth = 1.0 + s.y * 0.65;
    vec2 tiltedP = vec2(s.x / (zDepth * 0.85), (s.y + 0.06) / (zDepth * 0.68));
    baseUv = tiltedP + 0.5;
    heightScale = 0.19 / max(zDepth, 0.45);
    extrudeDir = vec2(s.x * 0.06, heightScale);
    viewDir = normalize(vec3(-s.x * 0.35, -0.68, 0.72));
  }

  // Outside the 3D tilted table boundary in Mode 2
  if (baseUv.x < 0.0 || baseUv.x > 1.0 || baseUv.y < 0.0 || baseUv.y > 1.0) {
    outColor = vec4(vec3(0.03, 0.032, 0.04), 1.0);
    return;
  }

  // 2. Raymarch the 3D Ferrofluid Heightfield along the camera ray
  vec2 hitUv = baseUv;
  float hitH = 0.0;
  float hitMass = 0.0;
  bool hitFluid = false;

  if (heightScale < 0.001) {
    // Mode 0: Pure 2D Top-Down
    vec4 s = texture(u_simTex, baseUv);
    hitMass = s.r;
    hitH = s.g;
    hitFluid = hitMass > 0.14;
  } else {
    // Mode 1 & 2: 28-step front-to-back heightfield raymarch (from max spike height h=1.15 down to floor h=0.0)
    const int STEPS = 28;
    float prevRayH = 1.15;
    vec2 prevSampleUv = baseUv - extrudeDir * prevRayH;

    for (int i = 1; i <= STEPS; i++) {
      float t = float(i) / float(STEPS);
      float rayH = 1.15 * (1.0 - t);
      vec2 sampleUv = baseUv - extrudeDir * rayH;
      float surfH = sampleFluidHeight(sampleUv);
      float surfM = sampleFluidMass(sampleUv);

      if (surfM > 0.14 && surfH >= rayH) {
        float prevSurfH = sampleFluidHeight(prevSampleUv);
        float denom = (surfH - rayH) - (prevSurfH - prevRayH);
        float frac = clamp((-(prevSurfH - prevRayH)) / max(abs(denom), 1e-4), 0.0, 1.0);
        hitUv = mix(prevSampleUv, sampleUv, frac);
        hitH = mix(prevRayH, rayH, frac);
        hitMass = sampleFluidMass(hitUv);
        hitFluid = true;
        break;
      }
      prevRayH = rayH;
      prevSampleUv = sampleUv;
    }
  }

  // 3. Render Empty Canvas Background + Cast Shadows when ray hits the dry dish floor
  vec3 bgCol = sampleCanvasBackground(baseUv, aspect);

  if (!hitFluid) {
    vec2 lightOffset = vec2(-0.028, 0.042) / aspect;
    float sh1 = sampleFluidHeight(baseUv + lightOffset * 0.45);
    float sh2 = sampleFluidHeight(baseUv + lightOffset * 0.95);
    float sh3 = sampleFluidHeight(baseUv + lightOffset * 1.55);
    float shadow = clamp((sh1 * 1.4 + sh2 * 1.1 + sh3 * 0.8) * 1.35, 0.0, 0.62);

    float edgeHalo = smoothstep(0.02, 0.14, sampleFluidMass(baseUv)) * 0.25;
    vec3 floorCol = bgCol * (1.0 - max(shadow, edgeHalo));
    outColor = vec4(clamp(floorCol, 0.0, 1.0), 1.0);
    return;
  }

  // 4. Shade the 3D Ferrofluid Volume & Spikes
  float hL = sampleFluidHeight(hitUv - vec2(px.x, 0.0));
  float hR = sampleFluidHeight(hitUv + vec2(px.x, 0.0));
  float hD = sampleFluidHeight(hitUv - vec2(0.0, px.y));
  float hU = sampleFluidHeight(hitUv + vec2(0.0, px.y));

  float mL = sampleFluidMass(hitUv - vec2(px.x * 1.5, 0.0));
  float mR = sampleFluidMass(hitUv + vec2(px.x * 1.5, 0.0));
  float mD = sampleFluidMass(hitUv - vec2(0.0, px.y * 1.5));
  float mU = sampleFluidMass(hitUv + vec2(0.0, px.y * 1.5));

  vec2 grad = vec2((hL - hR) * 3.8 + (mL - mR) * 0.9, (hD - hU) * 3.8 + (mD - mU) * 0.9);
  vec3 normal = normalize(vec3(grad.x, grad.y, 1.0));

  float NdotV = clamp(dot(normal, viewDir), 0.0, 1.0);
  float slope = length(normal.xy);
  float fresnel = pow(1.0 - NdotV, 2.8);

  vec3 lightKey = normalize(vec3(-0.38, 0.52, 0.76));
  vec3 lightFill = normalize(vec3(0.48, -0.32, 0.81));
  vec3 halfKey = normalize(lightKey + viewDir);
  vec3 halfFill = normalize(lightFill + viewDir);

  float diffKey = max(dot(normal, lightKey), 0.0);
  float specBroad = pow(max(dot(normal, halfKey), 0.0), 16.0);
  float specPin = pow(max(dot(normal, halfKey), 0.0), 72.0);
  float specFill = pow(max(dot(normal, halfFill), 0.0), 24.0) * 0.45;

  vec3 bodyCol = vec3(0.016, 0.018, 0.024);
  vec3 metalSheen = vec3(0.15, 0.18, 0.23) * (0.22 + 0.78 * diffKey)
                  + vec3(0.90, 0.94, 1.0) * (specBroad * 0.58 + specFill) * u_sheen;

  uint baseSeed = uint(max(u_seed, 0.0) * 1000.0) + 1u;
  uint coatSeed = baseSeed + uint(max(u_colorSeed, 0.0)) * 97u;
  float filmPhase = slope * 1.4 + hitH * 0.55;
  vec3 iridCol = sampleCoatPalette(filmPhase, coatSeed);

  vec3 coated = mix(metalSheen, metalSheen * (0.45 + 0.90 * iridCol), u_iridescence * smoothstep(0.05, 0.55, slope));
  vec3 fluidCol = mix(bodyCol, coated, clamp(0.24 + 0.76 * smoothstep(0.0, 0.65, hitH) + fresnel * 0.42, 0.0, 1.0));
  fluidCol += vec3(0.98, 0.99, 1.0) * specPin * u_sheen * 0.90;

  float ao = smoothstep(0.02, 0.28, hitH);
  fluidCol *= mix(0.58, 1.0, ao);

  float wetAlpha = smoothstep(0.14, 0.22, hitMass);
  vec3 finalCol = mix(bgCol * 0.75, fluidCol, wetAlpha);

  outColor = vec4(clamp(finalCol, 0.0, 1.0), 1.0);
}
`,
};
