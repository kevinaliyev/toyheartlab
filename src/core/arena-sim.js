import { FighterBall, hexToRgbArray } from '../objects/arena-fighter.js';
import { SoundFX } from './sfx.js';

function distToSegmentSq(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 < 1e-9) return (px - x1) ** 2 + (py - y1) ** 2;
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * (x2 - x1);
  const projY = y1 + t * (y2 - y1);
  return (px - projX) ** 2 + (py - projY) ** 2;
}

/**
 * 2D Arena Simulation Engine.
 * Runs deterministic sub-stepped collisions, weapon parries, projectiles, shockwaves,
 * particles, hit-stop, and scoreboard overlays while feeding impulses to GLEngine.
 */
export class ArenaSim {
  constructor(canvas, glEngine = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.glEngine = glEngine;
    this.sfx = new SoundFX();

    this.dpr = 1;
    this.aspect = 1;

    // Arena settings
    this.arenaShape = 'circle'; // 'circle' | 'box' | 'shrinking'
    this.baseArenaRadius = 0.39;
    this.arenaRadius = 0.39;
    this.gravity = 0.38;
    this.restitution = 1.015; // Slightly >1 keeps fights energetic
    this.simSpeed = 1.0;
    this.shaderReact = true;
    this.showHudOverlay = true;

    // Entities & VFX
    this.fighters = [];
    this.projectiles = [];
    this.shockwaves = [];
    this.particles = [];
    this.floatingTexts = [];

    this.hitStopTimer = 0;
    this.shakeAmount = 0;
    this.shaderImpulse = { x: 0.5, y: 0.5, strength: 0, vx: 0, vy: 0 };
    this.winner = null;
    this.matchElapsed = 0;
    this.onMatchEvent = null;

    this.fighterConfigs = [
      {
        name: 'Crimson',
        gimmickId: 'sawblade',
        hex: '#f43f5e',
        maxHp: 120,
        speed: 0.52,
        radius: 0.044,
      },
      {
        name: 'Cobalt',
        gimmickId: 'berserker',
        hex: '#38bdf8',
        maxHp: 120,
        speed: 0.52,
        radius: 0.044,
      },
    ];

    this.draggedFighter = null;
    this._bindPointer();
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
    this.aspect = w / Math.max(h, 1);
  }

  startMatch() {
    this.resize();
    this.fighters = [];
    this.projectiles = [];
    this.shockwaves = [];
    this.particles = [];
    this.floatingTexts = [];
    this.winner = null;
    this.matchElapsed = 0;
    this.arenaRadius = this.baseArenaRadius;
    this.hitStopTimer = 0;
    this.shakeAmount = 0;
    this.sfx.bounceCount = 0;

    const span = 0.16 / Math.max(this.aspect, 0.8);
    this.fighterConfigs.forEach((cfg, idx) => {
      const sign = idx === 0 ? -1 : 1;
      const angle = idx === 0 ? 0.45 : Math.PI - 0.45;
      const fighter = new FighterBall({
        name: cfg.name,
        team: idx,
        x: 0.5 + sign * span,
        y: 0.52 + (idx === 0 ? 0.03 : -0.03),
        vx: Math.cos(angle) * (cfg.speed / this.aspect),
        vy: Math.sin(angle) * cfg.speed,
        radius: cfg.radius,
        maxHp: cfg.maxHp,
        color: hexToRgbArray(cfg.hex),
        gimmickId: cfg.gimmickId,
      });
      this.fighters.push(fighter);
    });

    this._syncToShader();
    this.onMatchEvent?.({ type: 'start', fighters: this.fighters });
  }

  spawnMinion(parent) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 0.58;
    const minion = new FighterBall({
      name: `${parent.name} Jr`,
      team: parent.team,
      x: parent.x + (Math.cos(ang) * parent.radius * 1.4) / this.aspect,
      y: parent.y + Math.sin(ang) * parent.radius * 1.4,
      vx: (Math.cos(ang) * spd) / this.aspect,
      vy: Math.sin(ang) * spd,
      radius: parent.radius * 0.52,
      maxHp: 15,
      color: parent.color,
      gimmickId: 'splitter',
      isMinion: true,
    });
    this.fighters.push(minion);
    this.spawnSparks(minion.x, minion.y, parent.hexColor, 8);
    this.spawnFloatingText(parent.x, parent.y + parent.radius, 'CLONE!', parent.hexColor);
    this.sfx.playBounce(1.5);
  }

  spawnProjectile(owner, angle) {
    const speed = 0.92;
    const startDist = owner.radius * 1.35;
    this.projectiles.push({
      team: owner.team,
      owner,
      x: owner.x + (Math.cos(angle) * startDist) / this.aspect,
      y: owner.y + Math.sin(angle) * startDist,
      vx: (Math.cos(angle) * speed) / this.aspect,
      vy: Math.sin(angle) * speed,
      radius: 0.011,
      damage: 9,
      bouncesLeft: 1,
      color: owner.hexColor,
    });
    this.sfx.playBounce(1.8);
  }

  triggerShockwave(owner, maxRadius, damage) {
    this.shockwaves.push({
      x: owner.x,
      y: owner.y,
      radius: owner.radius,
      maxRadius,
      color: owner.hexColor,
      alpha: 1.0,
    });
    this.sfx.playNova();
    this.shakeAmount = Math.max(this.shakeAmount, 9);
    this.emitShaderImpulse(owner.x, owner.y, 2.4 * (owner.team === 0 ? 1 : -1), 0, 0);
    this.spawnFloatingText(owner.x, owner.y + owner.radius, 'GRAVITY NOVA!', owner.hexColor);

    for (const other of this.fighters) {
      if (other.team === owner.team || other.dead) continue;
      const dx = (other.x - owner.x) * this.aspect;
      const dy = other.y - owner.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= maxRadius + other.radius) {
        other.takeDamage(damage, owner, this, 'NOVA');
        const nx = dx / Math.max(dist, 1e-4);
        const ny = dy / Math.max(dist, 1e-4);
        other.vx += (nx * 0.55) / this.aspect;
        other.vy += ny * 0.55;
      }
    }
  }

  emitShaderImpulse(x, y, strength, vx = 0, vy = 0) {
    this.shaderImpulse = { x, y, strength, vx, vy };
  }

  spawnSparks(x, y, color, count = 12, speedScale = 1.0) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.12 + Math.random() * 0.38) * speedScale;
      this.particles.push({
        x,
        y,
        vx: (Math.cos(a) * s) / this.aspect,
        vy: Math.sin(a) * s,
        life: 0.25 + Math.random() * 0.22,
        maxLife: 0.45,
        size: 2.2 + Math.random() * 2.5,
        color,
      });
    }
  }

  spawnFloatingText(x, y, text, color = '#ffffff') {
    this.floatingTexts.push({
      x,
      y,
      vy: 0.14,
      text,
      color,
      life: 0.65,
      maxLife: 0.65,
    });
  }

  onFighterDamaged(victim, attacker, dmg, label) {
    const mx = (victim.x + (attacker ? attacker.x : victim.x)) * 0.5;
    const my = (victim.y + (attacker ? attacker.y : victim.y)) * 0.5;
    this.spawnSparks(victim.x, victim.y, victim.hexColor, dmg >= 12 ? 18 : 10, 1.2);
    const txt = label ? `${label} -${dmg}` : `-${dmg}`;
    this.spawnFloatingText(victim.x, victim.y + victim.radius * 0.8, txt, '#ffffff');
    this.sfx.playHit(dmg >= 12);
    this.hitStopTimer = dmg >= 14 ? 0.055 : 0.028;
    this.shakeAmount = Math.max(this.shakeAmount, dmg >= 14 ? 10 : 5);
    this.emitShaderImpulse(mx, my, -2.0, victim.vx * 2, victim.vy * 2);
  }

  onFighterKO(victim, attacker) {
    this.spawnSparks(victim.x, victim.y, victim.hexColor, 36, 1.8);
    this.spawnFloatingText(victim.x, victim.y, victim.isMinion ? 'POP!' : 'K.O.!', '#facc15');
    this.shakeAmount = 14;
    this.hitStopTimer = 0.09;

    // Check if a main team has won
    const aliveTeams = new Set(this.fighters.filter((f) => !f.dead && !f.isMinion).map((f) => f.team));
    if (aliveTeams.size === 1 && !this.winner) {
      const winTeam = [...aliveTeams][0];
      this.winner = this.fighters.find((f) => f.team === winTeam && !f.isMinion) || attacker;
      this.sfx.playWin();
      this.onMatchEvent?.({ type: 'win', winner: this.winner });
    }
  }

  _bindPointer() {
    const toUV = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(rect.width, 1))),
        y: Math.max(0, Math.min(1, 1.0 - (e.clientY - rect.top) / Math.max(rect.height, 1))),
      };
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      const { x, y } = toUV(e);
      for (const f of this.fighters) {
        if (f.dead) continue;
        const d = Math.hypot((x - f.x) * this.aspect, y - f.y);
        if (d <= f.radius * 1.3) {
          this.draggedFighter = f;
          f.isDragged = true;
          this.canvas.setPointerCapture?.(e.pointerId);
          return;
        }
      }
      // Clicking empty space creates a ripple impulse in the arena floor
      this.emitShaderImpulse(x, y, 1.8, 0, 0);
      this.spawnSparks(x, y, '#ffffff', 6, 0.6);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.draggedFighter) return;
      const { x, y } = toUV(e);
      this.draggedFighter.vx = (x - this.draggedFighter.x) * 24;
      this.draggedFighter.vy = (y - this.draggedFighter.y) * 24;
      this.draggedFighter.x = x;
      this.draggedFighter.y = y;
    });

    const release = () => {
      if (this.draggedFighter) {
        this.draggedFighter.isDragged = false;
        this.draggedFighter = null;
      }
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
  }

  _constrainToArena(f) {
    if (this.arenaShape === 'box') {
      const halfW = (this.arenaRadius * 1.15) / this.aspect;
      const halfH = this.arenaRadius * 0.92;
      const rx = f.radius / this.aspect;
      const ry = f.radius;
      let bounced = false;
      let nx = 0;
      let ny = 0;

      if (f.x - rx < 0.5 - halfW) {
        f.x = 0.5 - halfW + rx;
        f.vx = Math.abs(f.vx) * this.restitution;
        bounced = true;
        nx = 1;
      } else if (f.x + rx > 0.5 + halfW) {
        f.x = 0.5 + halfW - rx;
        f.vx = -Math.abs(f.vx) * this.restitution;
        bounced = true;
        nx = -1;
      }

      if (f.y - ry < 0.5 - halfH) {
        f.y = 0.5 - halfH + ry;
        f.vy = Math.abs(f.vy) * this.restitution;
        bounced = true;
        ny = 1;
      } else if (f.y + ry > 0.5 + halfH) {
        f.y = 0.5 + halfH - ry;
        f.vy = -Math.abs(f.vy) * this.restitution;
        bounced = true;
        ny = -1;
      }

      if (bounced) this._handleWallBounce(f, nx, ny);
      return;
    }

    // Circle or Shrinking Circle Arena (aspect-corrected around center 0.5, 0.5)
    const dx = (f.x - 0.5) * this.aspect;
    const dy = f.y - 0.5;
    const dist = Math.hypot(dx, dy);
    const maxDist = Math.max(0.12, this.arenaRadius - f.radius);

    if (dist > maxDist) {
      const nx = dx / Math.max(dist, 1e-6);
      const ny = dy / Math.max(dist, 1e-6);
      f.x = 0.5 + (nx * maxDist) / this.aspect;
      f.y = 0.5 + ny * maxDist;

      // Velocity in isotropic space
      const vxIso = f.vx * this.aspect;
      const vyIso = f.vy;
      const dot = vxIso * nx + vyIso * ny;
      if (dot > 0) {
        const rvx = (vxIso - (1 + this.restitution) * dot * nx) / this.aspect;
        const rvy = vyIso - (1 + this.restitution) * dot * ny;
        f.vx = rvx;
        f.vy = rvy;
        this._handleWallBounce(f, -nx, -ny);
      }
    }
  }

  _handleWallBounce(f, nx, ny) {
    const spd = Math.hypot(f.vx * this.aspect, f.vy);
    // Keep minimum lively bounce speed
    if (spd < 0.28) {
      f.vx += (nx * 0.14) / this.aspect;
      f.vy += ny * 0.14;
    }
    this.sfx.playBounce(spd);
    this.spawnSparks(f.x - (nx * f.radius) / this.aspect, f.y - ny * f.radius, f.hexColor, 5, 0.65);
    this.emitShaderImpulse(f.x, f.y, f.team === 0 ? 1.3 : -1.3, f.vx, f.vy);
    f.gimmick.onWallBounce?.(f, this, { nx, ny });
  }

  _stepPhysics(dt) {
    if (this.arenaShape === 'shrinking' && !this.winner) {
      this.arenaRadius = Math.max(0.17, this.baseArenaRadius - this.matchElapsed * 0.0065);
    } else {
      this.arenaRadius = this.baseArenaRadius;
    }

    const subSteps = 6;
    const subDt = dt / subSteps;

    for (let s = 0; s < subSteps; s++) {
      // 1. Advance fighters & arena constraints
      for (const f of this.fighters) {
        if (f.dead) continue;
        if (f.invulnTimer > 0) f.invulnTimer = Math.max(0, f.invulnTimer - subDt);
        if (f.flashTimer > 0) f.flashTimer = Math.max(0, f.flashTimer - subDt);

        if (!f.isDragged) {
          f.vy -= this.gravity * subDt;
          f.x += f.vx * subDt;
          f.y += f.vy * subDt;
        }
        f.gimmick.onUpdate?.(f, subDt, this);
        this._constrainToArena(f);
      }

      // 2. Fighter vs Fighter body collisions
      for (let i = 0; i < this.fighters.length; i++) {
        const a = this.fighters[i];
        if (a.dead) continue;
        for (let j = i + 1; j < this.fighters.length; j++) {
          const b = this.fighters[j];
          if (b.dead) continue;

          const dx = (b.x - a.x) * this.aspect;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          const minDist = a.radius + b.radius;

          if (dist < minDist && dist > 1e-6) {
            const nx = dx / dist;
            const ny = dy / dist;
            const overlap = minDist - dist;

            a.x -= (nx * overlap * 0.5) / this.aspect;
            a.y -= ny * overlap * 0.5;
            b.x += (nx * overlap * 0.5) / this.aspect;
            b.y += ny * overlap * 0.5;

            const rvx = (b.vx - a.vx) * this.aspect;
            const rvy = b.vy - a.vy;
            const velAlongNormal = rvx * nx + rvy * ny;

            if (velAlongNormal < 0) {
              const impulse = -(1 + this.restitution) * velAlongNormal * 0.5;
              const boost = Math.max(impulse, 0.22);
              a.vx -= (boost * nx) / this.aspect;
              a.vy -= boost * ny;
              b.vx += (boost * nx) / this.aspect;
              b.vy += boost * ny;

              if (a.team !== b.team) {
                a.gimmick.onBodyClash?.(a, b, this);
                b.gimmick.onBodyClash?.(b, a, this);
              }
            }
          }
        }
      }

      // 3. Weapon Segments: Parry (Weapon vs Weapon) & Slash (Weapon vs Body)
      for (let i = 0; i < this.fighters.length; i++) {
        const a = this.fighters[i];
        if (a.dead || !a.gimmick.getWeaponSegments) continue;
        const segsA = a.gimmick.getWeaponSegments(a, this.aspect);

        for (let j = 0; j < this.fighters.length; j++) {
          const b = this.fighters[j];
          if (b.dead || a.team === b.team) continue;

          // Check Weapon A vs Weapon B Parry first
          let parried = false;
          if (b.gimmick.getWeaponSegments && a.parryCooldown <= 0 && b.parryCooldown <= 0) {
            const segsB = b.gimmick.getWeaponSegments(b, this.aspect);
            for (const sa of segsA) {
              for (const sb of segsB) {
                const midBX = (sb.x1 + sb.x2) * 0.5;
                const midBY = (sb.y1 + sb.y2) * 0.5;
                const dSq = distToSegmentSq(
                  midBX * this.aspect,
                  midBY,
                  sa.x1 * this.aspect,
                  sa.y1,
                  sa.x2 * this.aspect,
                  sa.y2
                );
                const tipDSq = distToSegmentSq(
                  sb.x2 * this.aspect,
                  sb.y2,
                  sa.x1 * this.aspect,
                  sa.y1,
                  sa.x2 * this.aspect,
                  sa.y2
                );
                if (Math.min(dSq, tipDSq) < (sa.radius + sb.radius + 0.018) ** 2) {
                  parried = true;
                  a.parryCooldown = 0.16;
                  b.parryCooldown = 0.16;
                  a.bladeSpeed = -a.bladeSpeed * 1.04;
                  b.bladeSpeed = -b.bladeSpeed * 1.04;

                  // Knock both fighters back on parry
                  const dx = (b.x - a.x) * this.aspect;
                  const dy = b.y - a.y;
                  const d = Math.hypot(dx, dy) || 1;
                  a.vx -= ((dx / d) * 0.32) / this.aspect;
                  a.vy -= (dy / d) * 0.32;
                  b.vx += ((dx / d) * 0.32) / this.aspect;
                  b.vy += (dy / d) * 0.32;

                  const px = (sa.x2 + sb.x2) * 0.5;
                  const py = (sa.y2 + sb.y2) * 0.5;
                  this.sfx.playParry();
                  this.spawnSparks(px, py, '#facc15', 16, 1.35);
                  this.spawnFloatingText(px, py, 'PARRY!', '#facc15');
                  this.hitStopTimer = 0.04;
                  this.shakeAmount = Math.max(this.shakeAmount, 6);
                  this.emitShaderImpulse(px, py, 2.2, 0, 0);
                  break;
                }
              }
              if (parried) break;
            }
          }

          if (parried) continue;

          // Check Weapon A vs Body B Slash
          for (const sa of segsA) {
            const dSq = distToSegmentSq(
              b.x * this.aspect,
              b.y,
              sa.x1 * this.aspect,
              sa.y1,
              sa.x2 * this.aspect,
              sa.y2
            );
            if (dSq <= (b.radius + sa.radius) ** 2) {
              if (b.takeDamage(sa.damage, a, this, 'SLASH')) {
                const dx = (b.x - a.x) * this.aspect;
                const dy = b.y - a.y;
                const d = Math.hypot(dx, dy) || 1;
                b.vx += ((dx / d) * 0.25) / this.aspect;
                b.vy += (dy / d) * 0.25;
              }
            }
          }
        }
      }
    }

    // 4. Advance Projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Hit enemy fighters
      let hit = false;
      for (const f of this.fighters) {
        if (f.dead || f.team === p.team) continue;
        const d = Math.hypot((f.x - p.x) * this.aspect, f.y - p.y);
        if (d <= f.radius + p.radius) {
          f.takeDamage(p.damage, p.owner, this, 'SNIPE');
          hit = true;
          break;
        }
      }
      if (hit) {
        this.projectiles.splice(i, 1);
        continue;
      }

      // Arena wall ricochet
      const dx = (p.x - 0.5) * this.aspect;
      const dy = p.y - 0.5;
      const dist = Math.hypot(dx, dy);
      if (dist > this.arenaRadius - p.radius) {
        if (p.bouncesLeft > 0) {
          p.bouncesLeft -= 1;
          const nx = dx / Math.max(dist, 1e-5);
          const ny = dy / Math.max(dist, 1e-5);
          const vxIso = p.vx * this.aspect;
          const dot = vxIso * nx + p.vy * ny;
          p.vx = (vxIso - 2 * dot * nx) / this.aspect;
          p.vy = p.vy - 2 * dot * ny;
          this.spawnSparks(p.x, p.y, p.color, 4, 0.5);
        } else {
          this.projectiles.splice(i, 1);
        }
      }
    }

    // Record motion trails once per frame
    for (const f of this.fighters) {
      if (!f.dead) f.recordTrail();
    }
  }

  _syncToShader() {
    if (!this.glEngine) return;
    if (!this.shaderReact) {
      this.glEngine.setObjects([]);
      this.glEngine.setPointer(0.5, 0.5, 0, 0, 0, 0);
      return;
    }

    const active = this.fighters
      .filter((f) => !f.dead)
      .map((f) => f.toShaderUniform());
    this.glEngine.setObjects(active);

    if (Math.abs(this.shaderImpulse.strength) > 0.02) {
      this.glEngine.setPointer(
        this.shaderImpulse.x,
        this.shaderImpulse.y,
        this.shaderImpulse.strength < 0 ? 1.0 : 0.0,
        Math.abs(this.shaderImpulse.strength),
        this.shaderImpulse.vx,
        this.shaderImpulse.vy
      );
      this.shaderImpulse.strength *= 0.84;
    } else {
      this.glEngine.setPointer(0.5, 0.5, 0, 0, 0, 0);
    }
  }

  stepAndRender(rawDt) {
    this.resize();
    const dt = Math.min(rawDt, 0.05) * this.simSpeed;

    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - rawDt);
    } else {
      this.matchElapsed += dt;
      this._stepPhysics(dt);
    }

    // Update VFX (always animate smoothly even during brief hit-stop)
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += (sw.maxRadius - sw.radius) * 0.22 + 0.01;
      sw.alpha -= rawDt * 2.4;
      if (sw.alpha <= 0) this.shockwaves.splice(i, 1);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.x += pt.vx * rawDt;
      pt.y += pt.vy * rawDt;
      pt.life -= rawDt;
      if (pt.life <= 0) this.particles.splice(i, 1);
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy * rawDt;
      ft.life -= rawDt;
      if (ft.life <= 0) this.floatingTexts.splice(i, 1);
    }

    this.shakeAmount *= 0.82;
    this._syncToShader();
    this._render( { width: this.canvas.width, height: this.canvas.height, dpr: this.dpr });
  }

  _render(view) {
    const ctx = this.ctx;
    const { width, height, dpr } = view;
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    if (this.shakeAmount > 0.4) {
      const sx = (Math.random() - 0.5) * this.shakeAmount * dpr;
      const sy = (Math.random() - 0.5) * this.shakeAmount * dpr;
      ctx.translate(sx, sy);
    }

    // 1. Arena Cage Boundary
    const cx = width * 0.5;
    const cy = height * 0.5;
    ctx.save();
    if (this.arenaShape === 'box') {
      const rw = this.arenaRadius * 1.15 * height * 2;
      const rh = this.arenaRadius * 0.92 * height * 2;
      ctx.beginPath();
      ctx.roundRect(cx - rw * 0.5, cy - rh * 0.5, rw, rh, 14 * dpr);
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, this.arenaRadius * height, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgba(10, 12, 16, 0.34)';
    ctx.fill();
    ctx.lineWidth = 4 * dpr;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.stroke();

    // Subtle outer danger ring when shrinking
    if (this.arenaShape === 'shrinking') {
      ctx.beginPath();
      ctx.arc(cx, cy, this.baseArenaRadius * height, 0, Math.PI * 2);
      ctx.setLineDash([6 * dpr, 6 * dpr]);
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.45)';
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // 2. Shockwaves
    for (const sw of this.shockwaves) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(sw.x * width, (1.0 - sw.y) * height, sw.radius * height, 0, Math.PI * 2);
      ctx.strokeStyle = sw.color;
      ctx.globalAlpha = Math.max(0, sw.alpha);
      ctx.lineWidth = 4 * dpr;
      ctx.stroke();
      ctx.restore();
    }

    // 3. Projectiles
    for (const p of this.projectiles) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x * width, (1.0 - p.y) * height, p.radius * height, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8 * dpr;
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = p.color;
      ctx.stroke();
      ctx.restore();
    }

    // 4. Fighters
    for (const f of this.fighters) {
      f.render2D(ctx, view);
    }

    // 5. Sparks / Particles
    for (const pt of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x * width, (1.0 - pt.y) * height, pt.size * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 6. Floating Combat Text
    for (const ft of this.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
      ctx.font = `800 ${Math.round(13 * dpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.fillStyle = ft.color;
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 3 * dpr;
      ctx.textAlign = 'center';
      const tx = ft.x * width;
      const ty = (1.0 - ft.y) * height;
      ctx.strokeText(ft.text, tx, ty);
      ctx.fillText(ft.text, tx, ty);
      ctx.restore();
    }

    ctx.restore();

    // 7. Crisp Top Versus Scoreboard & Stat Badges
    if (this.showHudOverlay) {
      this._renderScoreboard(ctx, view);
    }
  }

  _renderScoreboard(ctx, { width, height, dpr }) {
    const f0 = this.fighters.find((f) => f.team === 0 && !f.isMinion);
    const f1 = this.fighters.find((f) => f.team === 1 && !f.isMinion);
    if (!f0 || !f1) return;

    const barW = Math.min(200 * dpr, width * 0.28);
    const barH = 14 * dpr;
    const topY = 22 * dpr;
    const centerX = width * 0.5;
    const gap = 24 * dpr;

    ctx.save();
    ctx.font = `800 ${Math.round(12 * dpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;

    // VS badge
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText('VS', centerX, topY + barH * 0.8);

    // Fighter A (Left)
    const leftX = centerX - gap - barW;
    ctx.fillStyle = 'rgba(17, 17, 17, 0.78)';
    ctx.fillRect(leftX, topY, barW, barH);
    const r0 = Math.max(0, f0.hp / f0.maxHp);
    ctx.fillStyle = f0.hexColor;
    ctx.fillRect(leftX + barW * (1 - r0), topY, barW * r0, barH);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeRect(leftX, topY, barW, barH);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(`${f0.name} (${f0.gimmick.shortLabel})`, leftX, topY - 5 * dpr);
    ctx.font = `700 ${Math.round(10 * dpr)}px ui-monospace, monospace`;
    ctx.fillStyle = '#e5e7eb';
    ctx.fillText(f0.gimmick.getStatBadge?.(f0) || '', leftX, topY + barH + 13 * dpr);

    // Fighter B (Right)
    const rightX = centerX + gap;
    ctx.fillStyle = 'rgba(17, 17, 17, 0.78)';
    ctx.fillRect(rightX, topY, barW, barH);
    const r1 = Math.max(0, f1.hp / f1.maxHp);
    ctx.fillStyle = f1.hexColor;
    ctx.fillRect(rightX, topY, barW * r1, barH);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(rightX, topY, barW, barH);

    ctx.font = `800 ${Math.round(12 * dpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(`${f1.name} (${f1.gimmick.shortLabel})`, rightX + barW, topY - 5 * dpr);
    ctx.font = `700 ${Math.round(10 * dpr)}px ui-monospace, monospace`;
    ctx.fillStyle = '#e5e7eb';
    ctx.fillText(f1.gimmick.getStatBadge?.(f1) || '', rightX + barW, topY + barH + 13 * dpr);

    // Winner Banner
    if (this.winner) {
      const bannerY = height * 0.16;
      ctx.font = `900 ${Math.round(20 * dpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = this.winner.hexColor;
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 4 * dpr;
      const winText = `★ ${this.winner.name.toUpperCase()} WINS! ★`;
      ctx.strokeText(winText, centerX, bannerY);
      ctx.fillText(winText, centerX, bannerY);
    }

    ctx.restore();
  }
}
