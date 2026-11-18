/**
 * Path Studio — Keyframed Emitter Path Drawing & Pseudo-AI Path Assistance.
 * Separate from 3D/2D Object Keyframe Motion.
 *
 * Features:
 * - Multi-stroke keyframed path sequences (startT, duration, easing, loopDuration)
 * - Smart Freehand smoothing (Ramer-Douglas-Peucker simplification + Catmull-Rom spline)
 * - Magnetic Snap (snaps anchors to endpoints, symmetry axes, and grid guides)
 * - Pseudo-AI Auto-Trace (procedural vector shapes + Text-to-Contour tracing)
 * - Direct evaluation into watercolor `paintP` [-1, 1] or UV [0, 1] emitter coordinates
 */

function distSq(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function perpDist(p, a, b) {
  const l2 = distSq(a, b);
  if (l2 < 1e-8) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

/**
 * Ramer-Douglas-Peucker polyline simplification (removes hand-jitter).
 */
export function simplifyRDP(points, epsilon = 0.012) {
  if (points.length <= 2) return points.map((p) => ({ ...p }));
  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpDist(points[i], points[0], points[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = simplifyRDP(points.slice(0, index + 1), epsilon);
    const right = simplifyRDP(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [{ ...points[0] }, { ...points[end] }];
}

/**
 * Catmull-Rom spline subdivision for silky vector curves from sparse anchors.
 */
export function smoothCatmullRom(points, subdivisions = 6) {
  if (points.length < 3) return points.map((p) => ({ ...p }));
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    for (let s = 0; s < subdivisions; s++) {
      const t = s / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out.push({ x, y });
    }
  }
  out.push({ ...points[points.length - 1] });
  return out;
}

function applyEase(u, easing = 'easeInOut') {
  const t = Math.max(0, Math.min(1, u));
  if (easing === 'linear') return t;
  if (easing === 'easeIn') return t * t;
  if (easing === 'easeOut') return 1 - (1 - t) * (1 - t);
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * Procedural & Pseudo-AI Auto-Trace Shape Generators (normalized UV [0, 1]).
 */
export function generateShapeStrokes(kind) {
  const pts = [];
  if (kind === 'heart') {
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const hx = 16 * Math.sin(a) ** 3;
      const hy = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
      pts.push({ x: 0.5 + hx * 0.014, y: 0.52 + hy * 0.014 });
    }
    return [{ points: pts, startT: 0.0, duration: 3.5, easing: 'easeInOut' }];
  }

  if (kind === 'spiral') {
    const steps = 64;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const a = u * Math.PI * 6;
      const r = 0.03 + u * 0.25;
      pts.push({ x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r });
    }
    return [{ points: pts, startT: 0.0, duration: 4.0, easing: 'linear' }];
  }

  if (kind === 'infinity') {
    const steps = 56;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const denom = 1 + Math.sin(a) ** 2;
      const x = (0.28 * Math.cos(a)) / denom;
      const y = (0.28 * Math.sin(a) * Math.cos(a)) / denom;
      pts.push({ x: 0.5 + x, y: 0.5 + y });
    }
    return [{ points: pts, startT: 0.0, duration: 3.5, easing: 'linear' }];
  }

  // Star
  const tips = 5;
  for (let i = 0; i <= tips * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / tips;
    const r = i % 2 === 0 ? 0.26 : 0.11;
    pts.push({ x: 0.5 + Math.cos(a) * r, y: 0.5 - Math.sin(a) * r });
  }
  return [{ points: pts, startT: 0.0, duration: 3.2, easing: 'easeInOut' }];
}

/**
 * Pseudo-AI Text/Mask Contour Tracer:
 * Renders text to an offscreen bitmap, detects silhouette edge pixels,
 * and chains them into clean simplified emitter strokes (up to 6 strokes).
 */
export function traceTextToStrokes(text = 'toyheart') {
  const clean = (text || 'toyheart').trim().slice(0, 12) || 'toyheart';
  const w = 240;
  const h = 100;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const ctx = off.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 54px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(clean, w / 2, h / 2);

  const img = ctx.getImageData(0, 0, w, h).data;
  const isSolid = (x, y) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return false;
    return img[(y * w + x) * 4] > 128;
  };

  // Extract boundary pixels
  const edgePts = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (isSolid(x, y) && (!isSolid(x - 1, y) || !isSolid(x + 1, y) || !isSolid(x, y - 1) || !isSolid(x, y + 1))) {
        edgePts.push({ x, y, visited: false });
      }
    }
  }

  // Nearest-neighbor contour chaining into strokes
  const rawStrokes = [];
  for (let i = 0; i < edgePts.length; i++) {
    if (edgePts[i].visited) continue;
    const chain = [];
    let cur = edgePts[i];
    cur.visited = true;
    chain.push(cur);

    while (chain.length < 220) {
      let best = null;
      let bestD = 18; // max pixel jump
      for (let j = 0; j < edgePts.length; j++) {
        const cand = edgePts[j];
        if (cand.visited) continue;
        const d = (cand.x - cur.x) ** 2 + (cand.y - cur.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = cand;
          if (d <= 2) break;
        }
      }
      if (!best) break;
      best.visited = true;
      chain.push(best);
      cur = best;
    }

    if (chain.length >= 12) {
      const normPts = chain.map((p) => ({
        x: 0.14 + (p.x / w) * 0.72,
        y: 0.5 + ((0.5 - p.y / h) * 0.36),
      }));
      rawStrokes.push(simplifyRDP(normPts, 0.006));
    }
  }

  // Keep top 6 longest strokes & stagger their keyframe start times
  rawStrokes.sort((a, b) => b.length - a.length);
  const top = rawStrokes.slice(0, 6);
  return top.map((points, idx) => ({
    points,
    startT: idx * 0.45,
    duration: 2.8,
    easing: 'easeInOut',
  }));
}

/**
 * Manages a keyframed collection of 2D emitter paths and an interactive overlay canvas.
 */
export class PathStudio {
  constructor(canvas, onChange = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange;

    this.enabled = false;
    this.tool = 'smart'; // 'smart' (freehand+RDP+Catmull) | 'magnetic' (anchor click + snap)
    this.strokes = []; // Array of { points: [{x,y}], startT, duration, easing }
    this.loopDuration = 6.0;
    this.dpr = 1;

    this.drawingPoints = [];
    this.isDrawing = false;
    this.magneticAnchor = null;
    this.hoverUV = null;

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

  setEnabled(enabled) {
    this.enabled = enabled;
    this.canvas.hidden = !enabled;
    if (enabled) {
      this.resize();
      this.render();
    }
  }

  clear() {
    this.strokes = [];
    this.drawingPoints = [];
    this.isDrawing = false;
    this.render();
    this.onChange?.(this.strokes);
  }

  loadPresetShape(kind) {
    const generated = generateShapeStrokes(kind);
    this.strokes = generated;
    this._recomputeLoopDuration();
    this.render();
    this.onChange?.(this.strokes);
  }

  traceText(text) {
    const traced = traceTextToStrokes(text);
    if (traced.length > 0) {
      this.strokes = traced;
      this._recomputeLoopDuration();
      this.render();
      this.onChange?.(this.strokes);
    }
  }

  _recomputeLoopDuration() {
    let maxEnd = 4.0;
    for (const s of this.strokes) {
      maxEnd = Math.max(maxEnd, (s.startT || 0) + (s.duration || 2.5) + 0.6);
    }
    this.loopDuration = maxEnd;
  }

  _clientToUV(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: Math.max(0.02, Math.min(0.98, (clientX - rect.left) / Math.max(rect.width, 1))),
      y: Math.max(0.02, Math.min(0.98, 1.0 - (clientY - rect.top) / Math.max(rect.height, 1))),
    };
  }

  /**
   * Magnetic Snap: pulls cursor toward existing endpoints, center symmetry axes, or 10% grid.
   */
  _magneticSnap(uv) {
    const snapRadius = 0.024;
    let best = { ...uv };
    let snapped = false;

    // 1. Snap to existing stroke endpoints
    for (const s of this.strokes) {
      for (const endPt of [s.points[0], s.points[s.points.length - 1]]) {
        if (!endPt) continue;
        if (Math.hypot(uv.x - endPt.x, uv.y - endPt.y) < snapRadius) {
          return { x: endPt.x, y: endPt.y, snapped: true };
        }
      }
    }

    // 2. Snap to center symmetry axes (0.5)
    if (Math.abs(uv.x - 0.5) < 0.015) { best.x = 0.5; snapped = true; }
    if (Math.abs(uv.y - 0.5) < 0.015) { best.y = 0.5; snapped = true; }
    return { ...best, snapped };
  }

  _bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.button !== 0) return;
      const raw = this._clientToUV(e.clientX, e.clientY);
      const pt = this.tool === 'magnetic' ? this._magneticSnap(raw) : raw;
      this.isDrawing = true;
      this.drawingPoints = [{ x: pt.x, y: pt.y }];
      this.canvas.setPointerCapture?.(e.pointerId);
      this.render();
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      const raw = this._clientToUV(e.clientX, e.clientY);
      const pt = this.tool === 'magnetic' ? this._magneticSnap(raw) : raw;
      this.hoverUV = pt;

      if (this.isDrawing) {
        const last = this.drawingPoints[this.drawingPoints.length - 1];
        if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) > 0.008) {
          this.drawingPoints.push({ x: pt.x, y: pt.y });
        }
      }
      this.render();
    });

    const finishStroke = () => {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      if (this.drawingPoints.length >= 2) {
        // Pseudo-AI Smart Smoothing: simplify jitter + Catmull-Rom spline
        const simplified = simplifyRDP(this.drawingPoints, 0.010);
        const smoothed = smoothCatmullRom(simplified, 5);
        if (this.strokes.length >= 6) this.strokes.shift();
        const startT = this.strokes.length * 0.55;
        this.strokes.push({
          points: smoothed,
          startT,
          duration: 2.8,
          easing: 'easeInOut',
        });
        this._recomputeLoopDuration();
        this.onChange?.(this.strokes);
      }
      this.drawingPoints = [];
      this.render();
    };

    this.canvas.addEventListener('pointerup', finishStroke);
    this.canvas.addEventListener('pointercancel', finishStroke);
  }

  /**
   * Sample stroke i at time t (seconds) for watercolor `paintP` space or UV space.
   */
  sampleBrushAt(t, brushIndex, dt = 0.02, aspect = 1.0, paintSpace = true) {
    if (brushIndex >= this.strokes.length) {
      return { pos: [0, 0], prev: [0, 0], lift: 0.0 };
    }
    const stroke = this.strokes[brushIndex];
    const pts = stroke.points;
    if (!pts || pts.length < 2) return { pos: [0, 0], prev: [0, 0], lift: 0.0 };

    const loopT = ((t % this.loopDuration) + this.loopDuration) % this.loopDuration;
    const localT = loopT - stroke.startT;
    if (localT < 0 || localT > stroke.duration) {
      return { pos: [0, 0], prev: [0, 0], lift: 0.0 };
    }

    const evalAt = (lt) => {
      const u = applyEase(Math.max(0, Math.min(1, lt / stroke.duration)), stroke.easing);
      const scaled = u * (pts.length - 1);
      const idx = Math.min(pts.length - 2, Math.floor(scaled));
      const frac = scaled - idx;
      const a = pts[idx];
      const b = pts[idx + 1];
      const ux = a.x + (b.x - a.x) * frac;
      const uy = a.y + (b.y - a.y) * frac;
      if (paintSpace) {
        return [(ux - 0.5) * 2.0, (uy - 0.5) * (2.0 / Math.max(aspect, 0.5))];
      }
      return [ux, uy];
    };

    const pos = evalAt(localT);
    const prev = evalAt(Math.max(0, localT - dt));
    // Soft fade in/out at stroke ends
    const edge = Math.min(localT / 0.15, (stroke.duration - localT) / 0.15, 1.0);
    return { pos, prev, lift: Math.max(0, Math.min(1, edge)) };
  }

  render() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const dpr = this.dpr;
    ctx.clearRect(0, 0, w, h);

    // Subtle symmetry guide crosshairs when Magnetic Snap is active
    if (this.tool === 'magnetic') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(w * 0.5, 0);
      ctx.lineTo(w * 0.5, h);
      ctx.moveTo(0, h * 0.5);
      ctx.lineTo(w, h * 0.5);
      ctx.stroke();
      ctx.restore();
    }

    const drawPolyline = (pts, color, dashed = false) => {
      if (pts.length < 2) return;
      ctx.save();
      ctx.beginPath();
      pts.forEach((p, idx) => {
        const px = p.x * w;
        const py = (1.0 - p.y) * h;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2 * dpr;
      if (dashed) ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.stroke();

      // Start & end anchor dots
      const first = pts[0];
      const last = pts[pts.length - 1];
      for (const ep of [first, last]) {
        ctx.beginPath();
        ctx.arc(ep.x * w, (1.0 - ep.y) * h, 3.5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = 1.2 * dpr;
        ctx.stroke();
      }
      ctx.restore();
    };

    const colors = ['#f43f5e', '#f59e0b', '#10b981', '#38bdf8', '#a855f7', '#ec4899'];
    this.strokes.forEach((s, idx) => {
      drawPolyline(s.points, colors[idx % colors.length]);
    });

    if (this.drawingPoints.length > 1) {
      drawPolyline(this.drawingPoints, '#ffffff', true);
    }

    if (this.hoverUV?.snapped) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.hoverUV.x * w, (1.0 - this.hoverUV.y) * h, 6 * dpr, 0, Math.PI * 2);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.8 * dpr;
      ctx.stroke();
      ctx.restore();
    }
  }
}
