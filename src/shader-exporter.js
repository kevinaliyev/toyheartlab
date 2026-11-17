function formatFloat(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0.0';
  const s = Number(num.toFixed(6)).toString();
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
}

function formatGlslLiteral(type, val) {
  if (type === 'float') return formatFloat(val);
  if (Array.isArray(val)) {
    const parts = val.map(formatFloat).join(',');
    return `${type}(${parts})`;
  }
  return null;
}

/**
 * Bake static uniforms into GLSL `const` declarations so the driver compiler
 * can constant-fold and dead-code-eliminate unused branches.
 */
function bakeStaticUniforms(source, staticUniforms) {
  return source.replace(
    /uniform\s+(float|vec2|vec3|vec4)\s+([A-Za-z_]\w*)\s*;/g,
    (full, type, name) => {
      if (!(name in staticUniforms)) return full;
      const literal = formatGlslLiteral(type, staticUniforms[name]);
      if (!literal) return full;
      return `const ${type} ${name}=${literal};`;
    }
  );
}

/**
 * Minify GLSL ES 3.00 source while keeping preprocessor directives intact.
 */
export function minifyGLSL(source) {
  const noBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = noBlockComments.split(/\r?\n/);
  const out = [];

  for (const rawLine of lines) {
    const noLineComment = rawLine.replace(/\/\/.*$/, '').trim();
    if (!noLineComment) continue;

    if (noLineComment.startsWith('#')) {
      out.push(`\n${noLineComment}\n`);
    } else {
      const compact = noLineComment
        .replace(/\s*([{}();,=+\-*/<>!&|?:])\s*/g, '$1')
        .replace(/\s+/g, ' ');
      out.push(compact);
    }
  }

  return out
    .join(' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\s+\n/g, '\n')
    .replace(/\n+/g, '\n')
    .trim();
}

/**
 * Build a hyper-optimized, self-contained Shader Object from the current lab state.
 */
export function buildShaderObject({
  name,
  study,
  params,
  palette,
  gradient,
  seed,
  perf,
  pigmentUniforms = {},
}) {
  const staticUniforms = {
    u_seed: seed,
    u_colorDark: palette.dark,
    u_colorMid: palette.mid,
    u_colorLight: palette.light,
    u_useGradient: gradient.useSeed ? 0.0 : 1.0,
    u_gradA: gradient.a,
    u_gradB: gradient.b,
    u_gradC: gradient.c,
    u_gradD: gradient.d,
    ...params,
    ...pigmentUniforms,
  };

  const base = {
    id: `${study.id}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom'}`,
    name,
    studyId: study.id,
    mode: study.mode === 'pingpong' ? 'pingpong' : 'single',
    perf,
  };

  if (base.mode === 'pingpong') {
    return {
      ...base,
      simShader: minifyGLSL(bakeStaticUniforms(study.simShader, staticUniforms)),
      displayShader: minifyGLSL(bakeStaticUniforms(study.displayShader, staticUniforms)),
    };
  }

  return {
    ...base,
    fragmentShader: minifyGLSL(bakeStaticUniforms(study.fragmentShader, staticUniforms)),
  };
}

/**
 * Serialize a Shader Object as a zero-dependency ES module for blog/portfolio use.
 */
export function serializeShaderModule(shaderObject) {
  return `// Exported by Toyheart Lab — load with createShaderPlayer(canvas, shader)\nexport default ${JSON.stringify(shaderObject, null, 2)};\n`;
}
