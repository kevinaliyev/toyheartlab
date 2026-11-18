const ISO_SCALE = 0.92;
const ISO_OFFSET_Y = -0.04;
const DEFAULT_YAW = Math.PI * 0.25;
const DEFAULT_PITCH = 0.6154797; // atan(1 / sqrt(2)) exact isometric tilt

function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 < 1e-6) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

/**
 * Crisp 2D/Isometric Object & Simulation Layer stacked above the WebGL shader canvas.
 * - Renders 3D-projected magnets and a sleek, minimalist XYZ arrow gizmo at native devicePixelRatio
 * - Supports 2D Top-Down (0) and 3D Orbitable Isometric Dish (1) coordinate mapping
 * - Handles right-click orbital camera rotation around the dish focus point
 * - Handles axis-constrained (X, Y, Z) dragging, XY-plane dragging, and pointer field emission
 */
export class Stage2D {
  constructor(canvas, glEngine = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.glEngine = glEngine;

    this.objects = [];
    this.showGizmos = true;
    this.pointerFieldEnabled = true;
    this.pointerCharge = 1.15;
    this.viewMode = 1; // 0: 2D Top-Down, 1: Orbitable Isometric 3D Dish

    this.camYaw = DEFAULT_YAW;
    this.camPitch = DEFAULT_PITCH;

    this.pointer = {
      x: 0.5,
      y: 0.5,
      prevX: 0.5,
      prevY: 0.5,
      vx: 0.0,
      vy: 0.0,
      down: false,
      active: false,
    };

    this.isOrbiting = false;
    this.orbitLastClient = { x: 0, y: 0 };

    this.draggedObject = null;
    this.dragAxis = null; // null | 'xy' | 'x' | 'y' | 'z'
    this.dragStartScreen = { sx: 0, sy: 0 };
    this.dragStartObj = { x: 0.5, y: 0.5, z: 0.06 };
    this.hoveredObject = null;
    this.hoveredAxis = null; // null | 'x' | 'y' | 'z'
    this.selectedObject = null;
    this.onSelectionChange = null;
    this.onObjectsChange = null;
    this.onObjectTransform = null;

    this.dpr = 1;
    this._bindEvents();
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  resetCamera() {
    this.camYaw = DEFAULT_YAW;
    this.camPitch = DEFAULT_PITCH;
    this._syncToEngine();
  }

  _getCameraBasis() {
    const cy = Math.cos(this.camYaw);
    const sy = Math.sin(this.camYaw);
    const cp = Math.cos(this.camPitch);
    const sp = Math.sin(this.camPitch);
    return {
      right: [sy, -cy, 0],
      up: [cy * sp, sy * sp, cp],
      forward: [cy * cp, sy * cp, -sp],
    };
  }

  addObject(obj) {
    if (this.objects.length >= 8) {
      this.objects.shift();
    }
    this.objects.push(obj);
    this.selectObject(obj);
    this._syncToEngine();
    this.onObjectsChange?.(this.objects);
    return obj;
  }

  removeObject(objOrId) {
    const idx = this.objects.findIndex((o) => o === objOrId || o.id === objOrId);
    if (idx >= 0) {
      const removed = this.objects[idx];
      this.objects.splice(idx, 1);
      if (this.selectedObject === removed) {
        this.selectObject(this.objects[this.objects.length - 1] || null);
      }
      this._syncToEngine();
      this.onObjectsChange?.(this.objects);
    }
  }

  clearObjects() {
    this.objects = [];
    this.draggedObject = null;
    this.dragAxis = null;
    this.hoveredObject = null;
    this.hoveredAxis = null;
    this.selectObject(null);
    this._syncToEngine();
    this.onObjectsChange?.(this.objects);
  }

  selectObject(obj) {
    if (this.selectedObject === obj) return;
    this.selectedObject = obj;
    this.onSelectionChange?.(obj);
  }

  /**
   * Project 3D dish coordinates (u, v in [0,1], z >= 0) to canvas pixel coordinates.
   */
  project3D(u, v, z = 0) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const aspect = w / Math.max(h, 1);

    if (this.viewMode < 0.5) {
      return {
        px: u * w,
        py: (1.0 - v) * h,
        scale: 1.0,
      };
    }

    const x = u - 0.5;
    const y = v - 0.5;
    const { right, up } = this._getCameraBasis();

    const sx = (x * right[0] + y * right[1] + z * right[2]) * ISO_SCALE;
    const sy = (x * up[0] + y * up[1] + z * up[2]) * ISO_SCALE + ISO_OFFSET_Y;

    return {
      px: (0.5 + sx / aspect) * w,
      py: (0.5 - sy) * h,
      scale: ISO_SCALE,
    };
  }

  /**
   * Unproject screen normalized coords (sx, sy relative to center, y-up) onto horizontal plane at height z.
   */
  _screenToIsoPlane(sx, sy, zPlane = 0) {
    const { right, up, forward } = this._getCameraBasis();
    const u = sx / ISO_SCALE;
    const v = (sy - ISO_OFFSET_Y) / ISO_SCALE;

    const roX = right[0] * u + up[0] * v - forward[0] * 0.85;
    const roY = right[1] * u + up[1] * v - forward[1] * 0.85;
    const roZ = right[2] * u + up[2] * v - forward[2] * 0.85;

    const t = (zPlane - roZ) / (forward[2] || -1e-4);
    return {
      u: roX + forward[0] * t + 0.5,
      v: roY + forward[1] * t + 0.5,
    };
  }

  _clientToScreenNorm(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const aspect = rect.width / Math.max(rect.height, 1);
    const screenU = (clientX - rect.left) / Math.max(rect.width, 1);
    const screenV = 1.0 - (clientY - rect.top) / Math.max(rect.height, 1);
    return {
      sx: (screenU - 0.5) * aspect,
      sy: screenV - 0.5,
      px: screenU * this.canvas.width,
      py: (1.0 - screenV) * this.canvas.height,
      screenU,
      screenV,
      aspect,
    };
  }

  _getGizmoAxesPixels(obj) {
    const origin = this.project3D(obj.x, obj.y, obj.z);
    const axisWorldLen = 0.085;
    const tipX = this.project3D(obj.x + axisWorldLen, obj.y, obj.z);
    const tipY = this.project3D(obj.x, obj.y + axisWorldLen, obj.z);
    const tipZ = this.project3D(obj.x, obj.y, obj.z + axisWorldLen);

    const targetLen = 44 * this.dpr;
    const normTip = (tip) => {
      const dx = tip.px - origin.px;
      const dy = tip.py - origin.py;
      const len = Math.hypot(dx, dy) || 1;
      return { px: origin.px + (dx / len) * targetLen, py: origin.py + (dy / len) * targetLen };
    };

    return {
      origin,
      x: normTip(tipX),
      y: normTip(tipY),
      z: normTip(tipZ),
    };
  }

  _pickAxisHandle(px, py) {
    if (this.viewMode < 0.5 || !this.selectedObject || !this.showGizmos) return null;
    const obj = this.selectedObject;
    const axes = this._getGizmoAxesPixels(obj);
    const threshold = 9 * this.dpr;

    let bestAxis = null;
    let bestDist = threshold;
    for (const key of ['z', 'x', 'y']) {
      const distFromOrigin = Math.hypot(px - axes.origin.px, py - axes.origin.py);
      if (distFromOrigin < 11 * this.dpr) continue;
      const d = distToSegment(px, py, axes.origin.px, axes.origin.py, axes[key].px, axes[key].py);
      if (d < bestDist) {
        bestDist = d;
        bestAxis = key;
      }
    }
    return bestAxis;
  }

  _pickObjectScreen(px, py) {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const obj = this.objects[i];
      if (!obj.draggable) continue;
      const pos = this.project3D(obj.x, obj.y, obj.z);
      const hitR = Math.max(16 * this.dpr, obj.radius * 0.45 * this.canvas.height);
      if (Math.hypot(px - pos.px, py - pos.py) <= hitR) {
        return obj;
      }
    }
    return null;
  }

  _clampToDish(u, v) {
    const dx = u - 0.5;
    const dy = v - 0.5;
    const d = Math.hypot(dx, dy);
    const maxR = 0.37;
    if (d > maxR) {
      return { u: 0.5 + (dx / d) * maxR, v: 0.5 + (dy / d) * maxR };
    }
    return { u, v };
  }

  _bindEvents() {
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('pointerdown', (e) => {
      // Right-click (button 2) orbits the camera around the dish focus point
      if (e.button === 2 && this.viewMode >= 0.5) {
        this.isOrbiting = true;
        this.orbitLastClient = { x: e.clientX, y: e.clientY };
        this.canvas.style.cursor = 'grabbing';
        this.canvas.setPointerCapture?.(e.pointerId);
        return;
      }

      const ptr = this._clientToScreenNorm(e.clientX, e.clientY);
      const floorUV =
        this.viewMode >= 0.5
          ? this._screenToIsoPlane(ptr.sx, ptr.sy, 0)
          : { u: ptr.screenU, v: ptr.screenV };

      this.pointer.x = floorUV.u;
      this.pointer.y = floorUV.v;
      this.pointer.prevX = floorUV.u;
      this.pointer.prevY = floorUV.v;
      this.pointer.down = true;
      this.pointer.active = true;

      const axisHit = this._pickAxisHandle(ptr.px, ptr.py);
      if (axisHit && this.selectedObject) {
        this.draggedObject = this.selectedObject;
        this.dragAxis = axisHit;
        this.draggedObject.isDragged = true;
        this.draggedObject.vx = 0;
        this.draggedObject.vy = 0;
        this.dragStartScreen = { sx: ptr.sx, sy: ptr.sy };
        this.dragStartObj = {
          x: this.draggedObject.x,
          y: this.draggedObject.y,
          z: this.draggedObject.z,
        };
        this.canvas.setPointerCapture?.(e.pointerId);
        this._syncToEngine();
        return;
      }

      const hit = this._pickObjectScreen(ptr.px, ptr.py);
      if (hit) {
        this.draggedObject = hit;
        this.dragAxis = 'xy';
        hit.isDragged = true;
        hit.vx = 0;
        hit.vy = 0;
        this.dragStartScreen = { sx: ptr.sx, sy: ptr.sy };
        this.dragStartObj = { x: hit.x, y: hit.y, z: hit.z };
        this.selectObject(hit);
      }
      this.canvas.setPointerCapture?.(e.pointerId);
      this._syncToEngine();
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (this.isOrbiting) {
        const dx = e.clientX - this.orbitLastClient.x;
        const dy = e.clientY - this.orbitLastClient.y;
        this.orbitLastClient = { x: e.clientX, y: e.clientY };

        this.camYaw -= dx * 0.0075;
        this.camPitch = Math.max(0.16, Math.min(1.48, this.camPitch + dy * 0.0075));
        this._syncToEngine();
        return;
      }

      const ptr = this._clientToScreenNorm(e.clientX, e.clientY);
      const floorUV =
        this.viewMode >= 0.5
          ? this._screenToIsoPlane(ptr.sx, ptr.sy, 0)
          : { u: ptr.screenU, v: ptr.screenV };

      this.pointer.vx = (floorUV.u - this.pointer.x) * 30.0;
      this.pointer.vy = (floorUV.v - this.pointer.y) * 30.0;
      this.pointer.prevX = this.pointer.x;
      this.pointer.prevY = this.pointer.y;
      this.pointer.x = floorUV.u;
      this.pointer.y = floorUV.v;
      this.pointer.active = true;

      if (this.draggedObject) {
        const obj = this.draggedObject;
        const dsx = ptr.sx - this.dragStartScreen.sx;
        const dsy = ptr.sy - this.dragStartScreen.sy;
        const { right, up } = this._getCameraBasis();

        if (this.viewMode < 0.5 || this.dragAxis === 'xy') {
          const target =
            this.viewMode >= 0.5
              ? this._screenToIsoPlane(ptr.sx, ptr.sy, obj.z)
              : { u: ptr.screenU, v: ptr.screenV };
          const clamped = this.viewMode >= 0.5 ? this._clampToDish(target.u, target.v) : target;
          const rawVx = (clamped.u - obj.x) * 14.0;
          const rawVy = (clamped.v - obj.y) * 14.0;
          obj.vx = Math.max(-1.0, Math.min(1.0, obj.vx * 0.5 + rawVx * 0.5));
          obj.vy = Math.max(-1.0, Math.min(1.0, obj.vy * 0.5 + rawVy * 0.5));
          obj.x = clamped.u;
          obj.y = clamped.v;
        } else if (this.dragAxis === 'x') {
          const ax = right[0] * ISO_SCALE;
          const ay = up[0] * ISO_SCALE;
          const deltaX = (dsx * ax + dsy * ay) / Math.max(ax * ax + ay * ay, 1e-4);
          const clamped = this._clampToDish(this.dragStartObj.x + deltaX, this.dragStartObj.y);
          obj.vx = Math.max(-1.0, Math.min(1.0, (clamped.u - obj.x) * 14.0));
          obj.vy = 0;
          obj.x = clamped.u;
          obj.y = clamped.v;
        } else if (this.dragAxis === 'y') {
          const ax = right[1] * ISO_SCALE;
          const ay = up[1] * ISO_SCALE;
          const deltaY = (dsx * ax + dsy * ay) / Math.max(ax * ax + ay * ay, 1e-4);
          const clamped = this._clampToDish(this.dragStartObj.x, this.dragStartObj.y + deltaY);
          obj.vx = 0;
          obj.vy = Math.max(-1.0, Math.min(1.0, (clamped.v - obj.y) * 14.0));
          obj.x = clamped.u;
          obj.y = clamped.v;
        } else if (this.dragAxis === 'z') {
          const az = up[2] * ISO_SCALE;
          const deltaZ = dsy / Math.max(az, 0.08);
          obj.z = Math.max(0.01, Math.min(0.32, this.dragStartObj.z + deltaZ));
          this.onObjectTransform?.(obj);
        }
      } else {
        const axisHover = this._pickAxisHandle(ptr.px, ptr.py);
        this.hoveredAxis = axisHover;
        const hit = axisHover ? null : this._pickObjectScreen(ptr.px, ptr.py);
        if (this.hoveredObject !== hit) {
          if (this.hoveredObject) this.hoveredObject.isHovered = false;
          this.hoveredObject = hit;
          if (hit) hit.isHovered = true;
        }
        this.canvas.style.cursor = axisHover ? 'pointer' : hit ? 'grab' : 'crosshair';
      }
      this._syncToEngine();
    });

    const endPointer = () => {
      this.pointer.down = false;
      if (this.isOrbiting) {
        this.isOrbiting = false;
        this.canvas.style.cursor = 'crosshair';
      }
      if (this.draggedObject) {
        this.draggedObject.isDragged = false;
        this.draggedObject = null;
        this.dragAxis = null;
      }
      this._syncToEngine();
    };

    this.canvas.addEventListener('pointerup', endPointer);
    this.canvas.addEventListener('pointercancel', endPointer);
    this.canvas.addEventListener('pointerleave', () => {
      this.pointer.active = false;
      this.hoveredAxis = null;
      endPointer();
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        const target = this.hoveredObject || this.selectedObject;
        if (!target) return;
        e.preventDefault();
        if (e.shiftKey && this.viewMode >= 0.5) {
          const dz = e.deltaY < 0 ? 0.015 : -0.015;
          target.z = Math.max(0.01, Math.min(0.32, Number((target.z + dz).toFixed(3))));
          this.onObjectTransform?.(target);
        } else {
          const delta = e.deltaY < 0 ? 0.15 : -0.15;
          const nextCharge = Math.max(-2.5, Math.min(2.5, Number((target.charge + delta).toFixed(2))));
          if (target.setCharge) target.setCharge(nextCharge);
          else target.charge = nextCharge;
          this.onSelectionChange?.(target);
        }
        this._syncToEngine();
      },
      { passive: false }
    );
  }

  _syncToEngine() {
    if (!this.glEngine) return;
    const ptrActive = this.pointerFieldEnabled && this.pointer.active && !this.draggedObject && !this.isOrbiting;
    const ptrStrength = ptrActive ? (this.pointer.down ? this.pointerCharge * 1.5 : this.pointerCharge * 0.65) : 0.0;
    this.glEngine.setCamera(this.camYaw, this.camPitch);
    this.glEngine.setPointer(
      this.pointer.x,
      this.pointer.y,
      this.pointer.down ? 1.0 : 0.0,
      ptrStrength,
      this.pointer.vx,
      this.pointer.vy
    );
    this.glEngine.setObjects(this.objects.map((o) => o.toShaderUniform()));
  }

  _renderXYZGizmo(ctx, obj) {
    if (this.viewMode < 0.5) return;
    const axes = this._getGizmoAxesPixels(obj);
    const dpr = this.dpr;
    const activeAxis = this.dragAxis && this.dragAxis !== 'xy' ? this.dragAxis : this.hoveredAxis;

    const specs = [
      { key: 'x', label: 'X', color: '#e05a47', tip: axes.x },
      { key: 'y', label: 'Y', color: '#2ea893', tip: axes.y },
      { key: 'z', label: 'Z', color: '#4a85e8', tip: axes.z },
    ];

    ctx.save();
    for (const s of specs) {
      const isFocused = activeAxis === s.key;
      const isDimmed = activeAxis && !isFocused;
      const alpha = isFocused ? 1.0 : isDimmed ? 0.25 : 0.68;

      const dx = s.tip.px - axes.origin.px;
      const dy = s.tip.py - axes.origin.py;
      const ang = Math.atan2(dy, dx);

      const startOffset = 11 * dpr;
      const len = Math.hypot(dx, dy) || 1;
      const sx = axes.origin.px + (dx / len) * startOffset;
      const sy = axes.origin.py + (dy / len) * startOffset;

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = (isFocused ? 2.2 : 1.35) * dpr;
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(s.tip.px, s.tip.py);
      ctx.stroke();

      const headLen = (isFocused ? 7.5 : 6.0) * dpr;
      const headHalf = 0.44;
      ctx.beginPath();
      ctx.moveTo(s.tip.px, s.tip.py);
      ctx.lineTo(
        s.tip.px - headLen * Math.cos(ang - headHalf),
        s.tip.py - headLen * Math.sin(ang - headHalf)
      );
      ctx.lineTo(
        s.tip.px - headLen * 0.65 * Math.cos(ang),
        s.tip.py - headLen * 0.65 * Math.sin(ang)
      );
      ctx.lineTo(
        s.tip.px - headLen * Math.cos(ang + headHalf),
        s.tip.py - headLen * Math.sin(ang + headHalf)
      );
      ctx.closePath();
      ctx.fill();

      if (isFocused) {
        const lx = s.tip.px + Math.cos(ang) * 11 * dpr;
        const ly = s.tip.py + Math.sin(ang) * 11 * dpr;
        ctx.font = `700 ${Math.round(9.5 * dpr)}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const txt = s.key === 'z' && this.dragAxis === 'z' ? `Z ${obj.z.toFixed(2)}` : s.label;
        ctx.fillText(txt, lx, ly);
      }
    }
    ctx.restore();
  }

  stepAndRender(dt, elapsed) {
    this.resize();
    for (const obj of this.objects) {
      if (obj.isDragged) {
        obj.vx *= 0.72;
        obj.vy *= 0.72;
      }
      obj.update(dt, elapsed, this);
    }

    this.pointer.vx *= 0.82;
    this.pointer.vy *= 0.82;
    this._syncToEngine();

    const ctx = this.ctx;
    const view = {
      width: this.canvas.width,
      height: this.canvas.height,
      dpr: this.dpr,
      viewMode: this.viewMode,
      project3D: (u, v, z) => this.project3D(u, v, z),
    };

    ctx.clearRect(0, 0, view.width, view.height);
    if (!this.showGizmos) return;

    // Depth-sort objects back-to-front along camForward for accurate 3D overlap
    const { forward } = this._getCameraBasis();
    const ordered = [...this.objects].sort((a, b) => {
      const da = (a.x - 0.5) * forward[0] + (a.y - 0.5) * forward[1] + a.z * forward[2];
      const db = (b.x - 0.5) * forward[0] + (b.y - 0.5) * forward[1] + b.z * forward[2];
      return db - da;
    });

    for (const obj of ordered) {
      obj.render2D(ctx, view);
    }

    if (this.selectedObject && this.selectedObject.visible) {
      this._renderXYZGizmo(ctx, this.selectedObject);
    }
  }
}
