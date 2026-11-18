/**
 * Crisp 2D Object & Simulation Layer stacked above the WebGL shader canvas.
 * - Renders 2D objects/entities at native devicePixelRatio (never blurred by shader scaling)
 * - Supports 2D Top-Down (0), Isometric 2.5D (1), and 3D Perspective Stage (2) coordinate mapping
 * - Handles pointer picking, dragging, velocity throwing, and cursor field emission
 * - Bridges active objects & pointer state directly into GLEngine each frame
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
    this.viewMode = 0; // 0: 2D Top-Down, 1: Isometric 2.5D, 2: 3D Perspective Dish

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

    this.draggedObject = null;
    this.hoveredObject = null;
    this.selectedObject = null;
    this.onSelectionChange = null;
    this.onObjectsChange = null;

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
    this.hoveredObject = null;
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
   * Project normalized dish floor UV [0..1] to screen pixel coordinates + perspective scale.
   */
  projectUVToScreen(u, v) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (this.viewMode >= 1.5) {
      // Exact inverse of Mode 2 3D Perspective Stage transform in ferrofluid.js
      const pxFloor = u - 0.5;
      const pyFloor = v - 0.5;
      const denom = Math.max(0.25, 1.0 - 0.442 * pyFloor);
      const sy = (0.68 * pyFloor - 0.06) / denom;
      const zDepth = Math.max(0.35, 1.0 + sy * 0.65);
      const sx = pxFloor * 0.85 * zDepth;
      const screenU = sx + 0.5;
      const screenV = sy + 0.5;
      return {
        px: screenU * w,
        py: (1.0 - screenV) * h,
        scaleX: 0.85 * zDepth,
        scaleY: 0.58 * zDepth,
      };
    }
    return {
      px: u * w,
      py: (1.0 - v) * h,
      scaleX: 1.0,
      scaleY: this.viewMode >= 0.5 ? 0.82 : 1.0,
    };
  }

  _clientToUV(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const screenU = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(rect.width, 1)));
    const screenV = Math.max(0, Math.min(1, 1.0 - (clientY - rect.top) / Math.max(rect.height, 1)));
    const aspect = rect.width / Math.max(rect.height, 1);

    if (this.viewMode >= 1.5) {
      const sx = screenU - 0.5;
      const sy = screenV - 0.5;
      const zDepth = Math.max(0.35, 1.0 + sy * 0.65);
      const u = Math.max(0.02, Math.min(0.98, sx / (zDepth * 0.85) + 0.5));
      const v = Math.max(0.02, Math.min(0.98, (sy + 0.06) / (zDepth * 0.68) + 0.5));
      return { x: u, y: v, aspect };
    }
    return { x: screenU, y: screenV, aspect };
  }

  _pickObject(uvX, uvY, aspect) {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const obj = this.objects[i];
      if (!obj.draggable) continue;
      const dx = (uvX - obj.x) * aspect;
      const dy = uvY - obj.y;
      const dist = Math.hypot(dx, dy);
      const hitRadius = Math.max(obj.radius * 0.9, 0.036);
      if (dist <= hitRadius) {
        return obj;
      }
    }
    return null;
  }

  _bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => {
      const { x, y, aspect } = this._clientToUV(e.clientX, e.clientY);
      this.pointer.x = x;
      this.pointer.y = y;
      this.pointer.prevX = x;
      this.pointer.prevY = y;
      this.pointer.down = true;
      this.pointer.active = true;

      const hit = this._pickObject(x, y, aspect);
      if (hit) {
        this.draggedObject = hit;
        hit.isDragged = true;
        hit.vx = 0;
        hit.vy = 0;
        this.selectObject(hit);
      }
      this.canvas.setPointerCapture?.(e.pointerId);
      this._syncToEngine();
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const { x, y, aspect } = this._clientToUV(e.clientX, e.clientY);
      this.pointer.vx = (x - this.pointer.x) * 35.0;
      this.pointer.vy = (y - this.pointer.y) * 35.0;
      this.pointer.prevX = this.pointer.x;
      this.pointer.prevY = this.pointer.y;
      this.pointer.x = x;
      this.pointer.y = y;
      this.pointer.active = true;

      if (this.draggedObject) {
        const rawVx = (x - this.draggedObject.x) * 14.0;
        const rawVy = (y - this.draggedObject.y) * 14.0;
        this.draggedObject.vx = Math.max(-1.2, Math.min(1.2, this.draggedObject.vx * 0.5 + rawVx * 0.5));
        this.draggedObject.vy = Math.max(-1.2, Math.min(1.2, this.draggedObject.vy * 0.5 + rawVy * 0.5));
        this.draggedObject.x = x;
        this.draggedObject.y = y;
      } else {
        const hit = this._pickObject(x, y, aspect);
        if (this.hoveredObject !== hit) {
          if (this.hoveredObject) this.hoveredObject.isHovered = false;
          this.hoveredObject = hit;
          if (hit) hit.isHovered = true;
          this.canvas.style.cursor = hit ? 'grab' : 'crosshair';
        }
      }
      this._syncToEngine();
    });

    const endPointer = () => {
      this.pointer.down = false;
      if (this.draggedObject) {
        this.draggedObject.isDragged = false;
        this.draggedObject = null;
      }
      this._syncToEngine();
    };

    this.canvas.addEventListener('pointerup', endPointer);
    this.canvas.addEventListener('pointercancel', endPointer);
    this.canvas.addEventListener('pointerleave', () => {
      this.pointer.active = false;
      endPointer();
    });

    // Scroll wheel over an object adjusts its field charge/radius
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        const target = this.hoveredObject || this.selectedObject;
        if (!target) return;
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        const nextCharge = Math.max(-2.5, Math.min(2.5, Number((target.charge + delta).toFixed(2))));
        if (target.setCharge) target.setCharge(nextCharge);
        else target.charge = nextCharge;
        this.onSelectionChange?.(target);
        this._syncToEngine();
      },
      { passive: false }
    );
  }

  _syncToEngine() {
    if (!this.glEngine) return;
    const ptrActive = this.pointerFieldEnabled && this.pointer.active && !this.draggedObject;
    const ptrStrength = ptrActive ? (this.pointer.down ? this.pointerCharge * 1.6 : this.pointerCharge * 0.7) : 0.0;
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

  stepAndRender(dt, elapsed) {
    this.resize();
    for (const obj of this.objects) {
      if (obj.isDragged) {
        // Decay velocity while held stationary so stationary dragged poles don't shoot fluid
        obj.vx *= 0.72;
        obj.vy *= 0.72;
      }
      obj.update(dt, elapsed, this);
    }

    // Decay pointer velocity smoothly when still
    this.pointer.vx *= 0.82;
    this.pointer.vy *= 0.82;
    this._syncToEngine();

    const ctx = this.ctx;
    const view = {
      width: this.canvas.width,
      height: this.canvas.height,
      dpr: this.dpr,
      viewMode: this.viewMode,
      project: (u, v) => this.projectUVToScreen(u, v),
    };

    ctx.clearRect(0, 0, view.width, view.height);
    if (!this.showGizmos) return;

    for (const obj of this.objects) {
      obj.render2D(ctx, view);
      if (obj === this.selectedObject && obj.visible) {
        const proj = view.project(obj.x, obj.y);
        const pr = obj.radius * view.height * proj.scaleX;
        ctx.save();
        ctx.translate(proj.px, proj.py);
        ctx.scale(1.0, proj.scaleY / Math.max(proj.scaleX, 0.01));
        ctx.beginPath();
        ctx.arc(0, 0, pr + 5 * view.dpr, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = 1.2 * view.dpr;
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}
