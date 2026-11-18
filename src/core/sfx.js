/**
 * Lightweight zero-dependency Web Audio procedural sound effects for 2D simulations.
 * Generates crisp pitched wall bounces, metallic blade parries, slash impacts,
 * laser pews, shockwave drops, and victory chords.
 */
export class SoundFX {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.bounceCount = 0;
  }

  _ensureContext() {
    if (!this.enabled) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playBounce(speed = 1.0) {
    const ctx = this._ensureContext();
    if (!ctx) return;

    // Pentatonic scale climb for satisfying TikTok/Shorts bounce progression
    const scale = [220, 246.94, 277.18, 329.63, 369.99, 440, 493.88, 554.37, 659.25];
    const freq = scale[this.bounceCount % scale.length] * (0.95 + Math.min(speed, 2.0) * 0.08);
    this.bounceCount += 1;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.65, now + 0.065);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  playParry() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    for (const ratio of [1.0, 1.48, 2.11]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(880 * ratio, now);
      osc.frequency.exponentialRampToValueAtTime(1320 * ratio, now + 0.11);

      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.13);
    }
  }

  playHit(heavy = false) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(heavy ? 140 : 210, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + (heavy ? 0.18 : 0.11));

    gain.gain.setValueAtTime(heavy ? 0.16 : 0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.19 : 0.12));

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + (heavy ? 0.2 : 0.13));
  }

  playNova() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.28);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.29);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  playWin() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t0 = now + idx * 0.07;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.09, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.34);
    });
  }
}
