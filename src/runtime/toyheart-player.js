const VS_SRC = `#version 300 es
in vec2 a_position;out vec2 v_uv;void main(){v_uv=a_position*0.5+0.5;gl_Position=vec4(a_position,0.0,1.0);}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader compile error:\n${log}`);
  }
  return s;
}

function link(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link error:\n${log}`);
  }
  return prog;
}

/**
 * Inspect browser/device context for dynamic shader selection.
 */
export function getDeviceContext() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const saveData = typeof navigator !== 'undefined' ? Boolean(navigator.connection?.saveData) : false;
  return {
    userAgent: ua,
    isMobile,
    reducedMotion: Boolean(reducedMotion),
    lowPower: isMobile || cores <= 4 || saveData,
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
  };
}

/**
 * Pick a Shader Object (or null to disable) from a list of conditional rules.
 * @param {Array<{ match?: (ctx: ReturnType<typeof getDeviceContext>) => boolean, shader: object | null }>} rules
 * @param {object} [ctx]
 */
export function pickShaderForContext(rules, ctx = getDeviceContext()) {
  for (const rule of rules) {
    if (!rule.match || rule.match(ctx)) return rule.shader ?? null;
  }
  return null;
}

/**
 * Lightweight standalone WebGL2 player for exported Toyheart Shader Objects.
 * Supports dynamic load/unload, user-agent adaptive scaling, and clean GPU teardown.
 */
export function createShaderPlayer(canvas, initialShader = null, options = {}) {
  const {
    respectReducedMotion = true,
    autoDowngrade = true,
    renderScale: optScale,
    maxFps: optFps,
  } = options;

  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: 'low-power',
  });
  if (!gl) throw new Error('WebGL2 not supported.');

  const ctxInfo = getDeviceContext();
  let renderScale = optScale ?? (autoDowngrade && ctxInfo.lowPower ? 0.5 : 0.75);
  let maxFps = optFps ?? (autoDowngrade && ctxInfo.lowPower ? 24 : 30);

  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  let program = null;
  let paused = respectReducedMotion && ctxInfo.reducedMotion;
  let needsRedraw = true;
  let elapsed = 0;
  let frameCount = 0;
  let lastTime = null;
  let lastRender = 0;
  let rafId = null;

  function unload() {
    if (program) {
      gl.deleteProgram(program);
      program = null;
    }
  }

  function load(shaderObj) {
    unload();
    if (!shaderObj) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const fs = shaderObj.fragmentShader || shaderObj.displayShader;
    if (!fs) throw new Error('Shader Object missing fragmentShader.');
    program = link(gl, VS_SRC, fs);
    const loc = gl.getAttribLocation(program, 'a_position');
    if (loc >= 0) {
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
    if (shaderObj.perf?.scale && optScale === undefined) renderScale = shaderObj.perf.scale;
    if (shaderObj.perf?.fps && optFps === undefined) maxFps = shaderObj.perf.fps;
    elapsed = 0;
    frameCount = 0;
    needsRedraw = true;
  }

  function resize() {
    const w = Math.max(1, Math.floor(canvas.clientWidth * renderScale));
    const h = Math.max(1, Math.floor(canvas.clientHeight * renderScale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      needsRedraw = true;
    }
  }

  function draw() {
    if (!program) return;
    resize();
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    const uTime = gl.getUniformLocation(program, 'u_time');
    const uRes = gl.getUniformLocation(program, 'u_resolution');
    const uFrame = gl.getUniformLocation(program, 'u_frame');
    if (uTime) gl.uniform1f(uTime, elapsed);
    if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
    if (uFrame) gl.uniform1f(uFrame, frameCount);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    frameCount += 1;
  }

  function tick(now) {
    rafId = requestAnimationFrame(tick);
    if (document.hidden || !program) {
      lastTime = now;
      return;
    }
    if (paused && !needsRedraw) {
      lastTime = now;
      return;
    }
    if (!paused && maxFps > 0 && now - lastRender < 1000 / maxFps) return;
    if (lastTime === null) lastTime = now;
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    lastRender = now;
    if (!paused) elapsed += dt;
    needsRedraw = false;
    draw();
  }

  const onResize = () => resize();
  window.addEventListener('resize', onResize);

  if (initialShader) load(initialShader);
  rafId = requestAnimationFrame(tick);

  return {
    load,
    unload,
    pause: () => { paused = true; },
    resume: () => { paused = false; lastTime = null; needsRedraw = true; },
    setRenderScale: (s) => { renderScale = Math.max(0.25, Math.min(2, s)); resize(); },
    setMaxFps: (f) => { maxFps = f; },
    destroy: () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      unload();
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
    },
  };
}
