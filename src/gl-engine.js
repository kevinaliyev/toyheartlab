const VERTEX_SHADER_SRC = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error:\n${info}`);
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error:\n${info}`);
  }
  return program;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function createProgramAsync(gl, vsSource, fsSource, parallelExt, onTick) {
  // Yield a frame before starting so UI loading bars paint smoothly
  await nextFrame();

  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, vsSource);
  gl.compileShader(vs);

  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, fsSource);
  gl.compileShader(fs);

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  // If KHR_parallel_shader_compile is available, poll completion asynchronously without blocking the main thread
  if (parallelExt) {
    let ticks = 0;
    while (
      !gl.isContextLost() &&
      ticks < 180 &&
      !gl.getProgramParameter(program, parallelExt.COMPLETION_STATUS_KHR)
    ) {
      ticks += 1;
      onTick?.(ticks);
      await nextFrame();
    }
  }

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error:\n${info}`);
  }
  return program;
}

/**
 * Minimal WebGL2 fullscreen-quad shader engine.
 * Supports both single-pass fragment shaders and two-pass ping-pong FBO simulations.
 */
export class GLEngine {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    if (!gl) {
      throw new Error('WebGL2 is not supported in this browser.');
    }
    this.gl = gl;
    this.hasFloatFBO = Boolean(
      gl.getExtension('EXT_color_buffer_float') ||
      gl.getExtension('EXT_color_buffer_half_float')
    );
    this.parallelCompileExt = gl.getExtension('KHR_parallel_shader_compile');
    this._loadToken = 0;

    this.mode = 'single'; // 'single' | 'pingpong'
    this.program = null;
    this.simProgram = null;
    this.displayProgram = null;
    this.uniformLocations = new Map();
    this.uniformValues = {};
    this.pointerState = [0.5, 0.5, 0.0, 0.0]; // x, y (UV), down, wheel/pulse
    this.pointerVel = [0.0, 0.0];
    this.camYaw = Math.PI * 0.25;
    this.camPitch = 0.6154797; // atan(1 / sqrt(2)) exact isometric tilt
    this.maxObjects = 8;
    this.objectUniforms = []; // Array of { pos: [x,y,radius,charge], vel: [vx,vy,r,g], extra: [b,mode,0,0] }

    this.fbos = [null, null];
    this.fboIndex = 0;
    this.fboWidth = 0;
    this.fboHeight = 0;

    this.paused = false;
    this.needsRedraw = true;
    this.renderScale = 1.0;
    this.maxFps = 60;
    this.elapsed = 0;
    this.frameCount = 0;
    this.lastFrameTime = null;
    this.lastRenderTime = 0;
    this.rafId = null;
    this.onBeforeFrame = null;

    this._initQuad();
    this.resize();
  }

  _initQuad() {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    this.vao = vao;
    this.vbo = buffer;
  }

  _bindQuadAttrib(program) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const posLoc = gl.getAttribLocation(program, 'a_position');
    if (posLoc >= 0) {
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }
  }

  _clearPrograms() {
    const gl = this.gl;
    if (this.program) gl.deleteProgram(this.program);
    if (this.simProgram) gl.deleteProgram(this.simProgram);
    if (this.displayProgram) gl.deleteProgram(this.displayProgram);
    this.program = null;
    this.simProgram = null;
    this.displayProgram = null;
    this.uniformLocations.clear();
  }

  _destroyFBOs() {
    const gl = this.gl;
    for (let i = 0; i < 2; i++) {
      if (this.fbos[i]) {
        gl.deleteFramebuffer(this.fbos[i].fbo);
        gl.deleteTexture(this.fbos[i].tex);
        this.fbos[i] = null;
      }
    }
    this.fboWidth = 0;
    this.fboHeight = 0;
  }

  _createFBO(width, height) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);

    if (this.hasFloatFBO) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return { fbo, tex };
  }

  _ensureFBOs() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (this.fbos[0] && this.fboWidth === w && this.fboHeight === h) {
      return;
    }
    this._destroyFBOs();
    this.fbos[0] = this._createFBO(w, h);
    this.fbos[1] = this._createFBO(w, h);
    this.fboWidth = w;
    this.fboHeight = h;
    this.fboIndex = 0;
    this.frameCount = 0;
  }

  loadFragmentShader(fsSource) {
    this._loadToken += 1;
    this._clearPrograms();
    this._destroyFBOs();
    this.mode = 'single';
    this.program = createProgram(this.gl, VERTEX_SHADER_SRC, fsSource);
    this._bindQuadAttrib(this.program);
    this.needsRedraw = true;
  }

  async loadFragmentShaderAsync(fsSource, onProgress = null) {
    const token = ++this._loadToken;
    onProgress?.(22, 'Compiling shader...');
    const program = await createProgramAsync(
      this.gl,
      VERTEX_SHADER_SRC,
      fsSource,
      this.parallelCompileExt,
      (tick) => onProgress?.(Math.min(86, 25 + tick * 6), 'Compiling GPU pipeline...')
    );
    if (token !== this._loadToken) {
      this.gl.deleteProgram(program);
      return false;
    }
    this._clearPrograms();
    this._destroyFBOs();
    this.mode = 'single';
    this.program = program;
    this._bindQuadAttrib(this.program);
    onProgress?.(94, 'Warming frame...');
    await nextFrame();
    this.needsRedraw = true;
    onProgress?.(100, 'Ready');
    return true;
  }

  loadPingPongShaders(simSource, displaySource) {
    this._loadToken += 1;
    this._clearPrograms();
    this.mode = 'pingpong';
    this.simProgram = createProgram(this.gl, VERTEX_SHADER_SRC, simSource);
    this.displayProgram = createProgram(this.gl, VERTEX_SHADER_SRC, displaySource);
    this._bindQuadAttrib(this.simProgram);
    this._bindQuadAttrib(this.displayProgram);
    this._ensureFBOs();
    this.needsRedraw = true;
  }

  async loadPingPongShadersAsync(simSource, displaySource, onProgress = null) {
    const token = ++this._loadToken;
    onProgress?.(18, 'Compiling simulation pass...');
    const simProgram = await createProgramAsync(
      this.gl,
      VERTEX_SHADER_SRC,
      simSource,
      this.parallelCompileExt,
      (tick) => onProgress?.(Math.min(54, 22 + tick * 5), 'Compiling simulation pass...')
    );
    if (token !== this._loadToken) {
      this.gl.deleteProgram(simProgram);
      return false;
    }

    onProgress?.(58, 'Compiling display pass...');
    const displayProgram = await createProgramAsync(
      this.gl,
      VERTEX_SHADER_SRC,
      displaySource,
      this.parallelCompileExt,
      (tick) => onProgress?.(Math.min(88, 60 + tick * 5), 'Compiling display pass...')
    );
    if (token !== this._loadToken) {
      this.gl.deleteProgram(simProgram);
      this.gl.deleteProgram(displayProgram);
      return false;
    }

    this._clearPrograms();
    this.mode = 'pingpong';
    this.simProgram = simProgram;
    this.displayProgram = displayProgram;
    this._bindQuadAttrib(this.simProgram);
    this._bindQuadAttrib(this.displayProgram);
    this._ensureFBOs();
    onProgress?.(94, 'Warming buffers...');
    await nextFrame();
    this.needsRedraw = true;
    onProgress?.(100, 'Ready');
    return true;
  }

  resetSimulation() {
    this.frameCount = 0;
    this.elapsed = 0;
    this.needsRedraw = true;
    if (this.mode !== 'pingpong') return;
    const gl = this.gl;
    for (const target of this.fbos) {
      if (!target) continue;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  setUniform(name, value) {
    this.uniformValues[name] = value;
    this.needsRedraw = true;
  }

  /**
   * Update normalized pointer state in UV coordinates [0..1] (y=0 bottom, y=1 top).
   */
  setPointer(x, y, pressed = 0.0, strength = 1.0, vx = 0.0, vy = 0.0) {
    this.pointerState = [x, y, pressed, strength];
    this.pointerVel = [vx, vy];
    this.needsRedraw = true;
  }

  /**
   * Sync 2D scene objects into standard shader uniforms (u_objectCount, u_objectPos0..7, u_objectVel0..7).
   * Each entry in `objects`: { x, y, vx, vy, radius, charge, color: [r,g,b] } in UV space.
   */
  setObjects(objects = []) {
    this.objectUniforms = objects.slice(0, this.maxObjects);
    this.needsRedraw = true;
  }

  setCamera(yaw, pitch) {
    this.camYaw = yaw;
    this.camPitch = pitch;
    this.needsRedraw = true;
  }

  setRenderScale(scale) {
    this.renderScale = Math.max(0.25, Math.min(2.0, scale));
    this.resize();
    this.needsRedraw = true;
  }

  setMaxFps(fps) {
    this.maxFps = fps;
  }

  resize() {
    const baseDpr = Math.min(window.devicePixelRatio || 1, 1.0);
    const scale = baseDpr * this.renderScale;
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * scale));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
      this.needsRedraw = true;
    }
  }

  _bindUniform(program, name, value) {
    const gl = this.gl;
    const cacheKey = `${program === this.simProgram ? 'sim' : program === this.displayProgram ? 'disp' : 'main'}:${name}`;
    let loc = this.uniformLocations.get(cacheKey);
    if (loc === undefined) {
      loc = gl.getUniformLocation(program, name);
      this.uniformLocations.set(cacheKey, loc);
    }
    if (loc === null) return;

    if (typeof value === 'number') {
      gl.uniform1f(loc, value);
    } else if (Array.isArray(value)) {
      if (value.length === 2) gl.uniform2f(loc, value[0], value[1]);
      else if (value.length === 3) gl.uniform3f(loc, value[0], value[1], value[2]);
      else if (value.length === 4) gl.uniform4f(loc, value[0], value[1], value[2], value[3]);
    }
  }

  _bindAllUniforms(program) {
    this._bindUniform(program, 'u_time', this.elapsed);
    this._bindUniform(program, 'u_frame', this.frameCount);
    this._bindUniform(program, 'u_resolution', [this.canvas.width, this.canvas.height]);
    this._bindUniform(program, 'u_pointer', this.pointerState);
    this._bindUniform(program, 'u_pointerVel', this.pointerVel);
    this._bindUniform(program, 'u_camYaw', this.camYaw);
    this._bindUniform(program, 'u_camPitch', this.camPitch);
    this._bindUniform(program, 'u_objectCount', this.objectUniforms.length);

    // Bind packed vec4[8] uniform arrays (fast single-call upload & loopable in GLSL)
    const gl = this.gl;
    const posArr = new Float32Array(32);
    const velArr = new Float32Array(32);
    const extArr = new Float32Array(32);
    for (let i = 0; i < this.maxObjects; i++) {
      const obj = this.objectUniforms[i];
      if (obj) {
        const off = i * 4;
        posArr[off] = obj.x ?? 0.5;
        posArr[off + 1] = obj.y ?? 0.5;
        posArr[off + 2] = obj.radius ?? 0.06;
        posArr[off + 3] = obj.charge ?? 1.0;

        velArr[off] = obj.vx ?? 0.0;
        velArr[off + 1] = obj.vy ?? 0.0;
        velArr[off + 2] = obj.color?.[0] ?? 1.0;
        velArr[off + 3] = obj.color?.[1] ?? 1.0;

        extArr[off] = obj.z ?? 0.0;
        extArr[off + 1] = obj.vz ?? 0.0;
        extArr[off + 2] = obj.color?.[2] ?? 1.0;
        extArr[off + 3] = 0.0;
      }
    }
    const pKey = `${program === this.simProgram ? 'sim' : program === this.displayProgram ? 'disp' : 'main'}:`;
    for (const [uName, data] of [['u_objectPos', posArr], ['u_objectVel', velArr], ['u_objectExtra', extArr]]) {
      let loc = this.uniformLocations.get(pKey + uName);
      if (loc === undefined) {
        loc = gl.getUniformLocation(program, uName);
        this.uniformLocations.set(pKey + uName, loc);
      }
      if (loc !== null) gl.uniform4fv(loc, data);
    }

    for (let i = 0; i < this.maxObjects; i++) {
      const obj = this.objectUniforms[i];
      if (obj) {
        this._bindUniform(program, `u_objectPos${i}`, [
          obj.x ?? 0.5,
          obj.y ?? 0.5,
          obj.radius ?? 0.06,
          obj.charge ?? 1.0,
        ]);
        this._bindUniform(program, `u_objectVel${i}`, [
          obj.vx ?? 0.0,
          obj.vy ?? 0.0,
          obj.color?.[0] ?? 1.0,
          obj.color?.[1] ?? 1.0,
        ]);
        this._bindUniform(program, `u_objectExtra${i}`, [
          obj.z ?? 0.0,
          obj.vz ?? 0.0,
          obj.color?.[2] ?? 1.0,
          0.0,
        ]);
      } else {
        this._bindUniform(program, `u_objectPos${i}`, [0.0, 0.0, 0.0, 0.0]);
        this._bindUniform(program, `u_objectVel${i}`, [0.0, 0.0, 0.0, 0.0]);
        this._bindUniform(program, `u_objectExtra${i}`, [0.0, 0.0, 0.0, 0.0]);
      }
    }

    for (const [name, value] of Object.entries(this.uniformValues)) {
      this._bindUniform(program, name, value);
    }
  }

  renderFrame() {
    const gl = this.gl;
    this.resize();

    if (this.mode === 'single') {
      if (!this.program) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      this._bindAllUniforms(this.program);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }

    if (!this.simProgram || !this.displayProgram) return;
    this._ensureFBOs();

    const readTarget = this.fbos[this.fboIndex];
    const writeTarget = this.fbos[1 - this.fboIndex];

    // 1. Simulation pass (only advance if not paused, or on frame 0)
    if (!this.paused || this.frameCount === 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, writeTarget.fbo);
      gl.viewport(0, 0, this.fboWidth, this.fboHeight);
      gl.useProgram(this.simProgram);
      gl.bindVertexArray(this.vao);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTarget.tex);
      const prevLoc = gl.getUniformLocation(this.simProgram, 'u_prevTex');
      if (prevLoc !== null) gl.uniform1i(prevLoc, 0);

      this._bindAllUniforms(this.simProgram);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      this.fboIndex = 1 - this.fboIndex;
      this.frameCount += 1;
    }

    // 2. Display pass (renders latest FBO to screen)
    const latestTarget = this.fbos[this.fboIndex];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.displayProgram);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, latestTarget.tex);
    const simLoc = gl.getUniformLocation(this.displayProgram, 'u_simTex');
    if (simLoc !== null) gl.uniform1i(simLoc, 0);

    this._bindAllUniforms(this.displayProgram);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  setFrameHook(fn) {
    this.onBeforeFrame = fn;
  }

  start() {
    if (this.rafId !== null) return;
    const tick = (now) => {
      this.rafId = requestAnimationFrame(tick);

      if (document.hidden) {
        this.lastFrameTime = now;
        return;
      }

      if (this.paused && !this.needsRedraw) {
        this.lastFrameTime = now;
        return;
      }

      if (!this.paused && this.maxFps > 0) {
        const minInterval = (1000 / this.maxFps) - 1.0;
        if (now - this.lastRenderTime < minInterval) {
          return;
        }
      }

      if (this.lastFrameTime === null) {
        this.lastFrameTime = now;
      }
      const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1);
      this.lastFrameTime = now;
      this.lastRenderTime = now;

      if (!this.paused) {
        this.elapsed += dt;
        if (this.onBeforeFrame) {
          this.onBeforeFrame(this.elapsed, dt);
        }
      }
      this.needsRedraw = false;
      this.renderFrame();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  setPaused(paused) {
    this.paused = paused;
    if (!paused) {
      this.lastFrameTime = null;
      this.needsRedraw = true;
    }
  }

  resetTime() {
    this.elapsed = 0;
  }

  captureThumbnail(maxWidth = 360) {
    try {
      this.renderFrame();
      const w = this.canvas.width;
      const h = this.canvas.height;
      if (!w || !h) return null;
      const scale = Math.min(1, maxWidth / w);
      const tw = Math.max(1, Math.round(w * scale));
      const th = Math.max(1, Math.round(h * scale));
      const tmp = document.createElement('canvas');
      tmp.width = tw;
      tmp.height = th;
      const ctx = tmp.getContext('2d');
      ctx.drawImage(this.canvas, 0, 0, tw, th);
      return tmp.toDataURL('image/jpeg', 0.72);
    } catch {
      return null;
    }
  }

  destroy() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this._clearPrograms();
    this._destroyFBOs();
  }
}
