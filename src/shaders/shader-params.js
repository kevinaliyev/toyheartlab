/**
 * Shared shader parameter descriptors and GLSL color/gradient helpers.
 * Designed to be imported by shaders and reused across Lab, Sandbox, and standalone Toybox apps.
 */

export function populateStudySelect(selectEl, studies) {
  if (!selectEl) return;
  selectEl.innerHTML = '';

  const group2d = document.createElement('optgroup');
  group2d.label = '2D Shaders (Fullscreen Quad)';

  const group25d = document.createElement('optgroup');
  group25d.label = '2.5D / Raymarched SDF (Z-Axis Quad)';

  const group3d = document.createElement('optgroup');
  group3d.label = '3D Shaders (True 3D)';

  for (const study of studies) {
    const opt = document.createElement('option');
    opt.value = study.id;
    opt.textContent = study.name;
    if (study.dimension === '3d') {
      group3d.appendChild(opt);
    } else if (study.dimension === '2.5d') {
      group25d.appendChild(opt);
    } else {
      group2d.appendChild(opt);
    }
  }

  if (group2d.children.length > 0) {
    selectEl.appendChild(group2d);
  }

  if (group25d.children.length > 0) {
    selectEl.appendChild(group25d);
  }

  if (group3d.children.length === 0) {
    const emptyOpt = document.createElement('option');
    emptyOpt.disabled = true;
    emptyOpt.textContent = 'Coming soon — True 3D pipeline';
    group3d.appendChild(emptyOpt);
  }
  selectEl.appendChild(group3d);
}

export function colorSeedParam({
  label = 'Colour Seed Offset',
  group = 'Surface & Light',
  defaultValue = 0.0,
} = {}) {
  return {
    key: 'u_colorSeed',
    label,
    group,
    min: 0.0,
    max: 100.0,
    step: 1.0,
    default: defaultValue,
  };
}

export const GRADIENT_UNIFORMS_GLSL = /* glsl */ `
uniform float u_colorSeed;
uniform float u_useGradient;
uniform vec3 u_gradA;
uniform vec3 u_gradB;
uniform vec3 u_gradC;
uniform vec3 u_gradD;
`;

export const GRADIENT_SAMPLER_GLSL = /* glsl */ `
float colorSeedPhase() {
  return clamp(u_colorSeed, 0.0, 100.0) * 0.01;
}

uint computeColorSeed(uint baseSeed) {
  return baseSeed + uint(max(u_colorSeed, 0.0)) * 97u;
}

vec3 evalCosineGradient(float t) {
  return clamp(u_gradA + u_gradB * cos(6.2831853 * (u_gradC * t + u_gradD)), 0.0, 1.0);
}

vec3 sampleShaderPalette(float t, uint colorSeed) {
  if (u_useGradient > 0.5) {
    return evalCosineGradient(t + colorSeedPhase());
  }
  return seededCosinePalette(t + colorSeedPhase() * 0.5, colorSeed);
}
`;
