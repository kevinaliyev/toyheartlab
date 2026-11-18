function easeValue(u, mode = 'easeInOut') {
  const t = Math.max(0, Math.min(1, u));
  if (mode === 'linear') return t;
  if (mode === 'easeIn') return t * t * t;
  if (mode === 'easeOut') return 1 - (1 - t) ** 3;
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Separate Keyframe Animation System for 2D/3D SceneObjects (Sandbox Magnets).
 * Stores per-object keyframe tracks ({ t, x, y, z, charge, easing }) and drives
 * smooth interpolated motion + velocity when playing or scrubbing.
 */
export class KeyframeAnimator {
  constructor() {
    this.tracks = new Map(); // objId -> sorted Array of keyframes
    this.duration = 6.0;
    this.playhead = 0.0;
    this.playing = false;
    this.loop = true;
    this.onTimeUpdate = null;
    this.onTracksChange = null;
  }

  getTrack(objOrId) {
    const id = typeof objOrId === 'string' ? objOrId : objOrId?.id;
    return id ? this.tracks.get(id) || [] : [];
  }

  /**
   * Capture the object's current (x, y, z, charge) as a keyframe at `t` (defaults to playhead).
   */
  addKeyframe(obj, t = this.playhead, easing = 'easeInOut') {
    if (!obj) return null;
    const time = Math.max(0, Math.min(this.duration, Number(t.toFixed(2))));
    const track = [...this.getTrack(obj)];
    const existingIdx = track.findIndex((kf) => Math.abs(kf.t - time) < 0.06);

    const kf = {
      t: time,
      x: obj.x,
      y: obj.y,
      z: obj.z ?? 0.06,
      charge: obj.charge,
      easing,
    };

    if (existingIdx >= 0) {
      track[existingIdx] = kf;
    } else {
      track.push(kf);
      track.sort((a, b) => a.t - b.t);
    }

    this.tracks.set(obj.id, track);
    this.onTracksChange?.(obj.id, track);
    return kf;
  }

  removeKeyframeAt(obj, t = this.playhead) {
    if (!obj) return;
    const track = this.getTrack(obj).filter((kf) => Math.abs(kf.t - t) >= 0.08);
    if (track.length === 0) {
      this.tracks.delete(obj.id);
    } else {
      this.tracks.set(obj.id, track);
    }
    this.onTracksChange?.(obj.id, track);
  }

  clearTrack(obj) {
    if (!obj) return;
    this.tracks.delete(obj.id);
    this.onTracksChange?.(obj.id, []);
  }

  setPlayhead(t, objects = []) {
    this.playhead = Math.max(0, Math.min(this.duration, t));
    this.applyAtTime(this.playhead, objects, 0.016);
    this.onTimeUpdate?.(this.playhead);
  }

  step(dt, objects = []) {
    if (!this.playing) return;
    this.playhead += dt;
    if (this.playhead > this.duration) {
      if (this.loop) {
        this.playhead = this.playhead % this.duration;
      } else {
        this.playhead = this.duration;
        this.playing = false;
      }
    }
    this.applyAtTime(this.playhead, objects, dt);
    this.onTimeUpdate?.(this.playhead);
  }

  applyAtTime(t, objects = [], dt = 0.016) {
    for (const obj of objects) {
      if (obj.isDragged) continue;
      const track = this.tracks.get(obj.id);
      if (!track || track.length === 0) continue;

      const sample = this._evaluateTrack(track, t);
      const safeDt = Math.max(dt, 0.004);
      obj.vx = Math.max(-1.0, Math.min(1.0, (sample.x - obj.x) / safeDt));
      obj.vy = Math.max(-1.0, Math.min(1.0, (sample.y - obj.y) / safeDt));
      obj.x = sample.x;
      obj.y = sample.y;
      if (obj.z !== undefined) obj.z = sample.z;
      if (obj.setCharge) obj.setCharge(sample.charge);
      else obj.charge = sample.charge;
    }
  }

  _evaluateTrack(track, t) {
    if (track.length === 1 || t <= track[0].t) {
      return { ...track[0] };
    }
    const last = track[track.length - 1];
    if (t >= last.t) {
      return { ...last };
    }

    for (let i = 0; i < track.length - 1; i++) {
      const a = track[i];
      const b = track[i + 1];
      if (t >= a.t && t <= b.t) {
        const span = Math.max(b.t - a.t, 1e-4);
        const u = easeValue((t - a.t) / span, b.easing || 'easeInOut');
        return {
          x: a.x + (b.x - a.x) * u,
          y: a.y + (b.y - a.y) * u,
          z: (a.z ?? 0.06) + ((b.z ?? 0.06) - (a.z ?? 0.06)) * u,
          charge: a.charge + (b.charge - a.charge) * u,
        };
      }
    }
    return { ...last };
  }
}
