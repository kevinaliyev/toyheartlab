import { SceneObject } from '../core/scene-object.js';

/**
 * Modular registry of Fighter Gimmicks.
 * Each gimmick hooks into lifecycle events:
 * - init(fighter)
 * - onUpdate(fighter, dt, arena)
 * - onWallBounce(fighter, arena, normal)
 * - onBodyClash(fighter, other, arena)
 * - onDealDamage(fighter, target, amount, arena)
 * - getWeaponSegments(fighter, aspect) -> Array of { x1, y1, x2, y2, radius, damage }
 * - renderAttachment(fighter, ctx, px, py, pr, dpr)
 * - getStatBadge(fighter) -> string
 */
export const GIMMICK_DEFS = {
  sawblade: {
    id: 'sawblade',
    label: 'Katana Sawblade (RPM Scaling)',
    shortLabel: 'Katana',
    description: 'Orbits a lethal razor blade. Every bounce & parry accelerates spin RPM and extends reach.',
    init(f) {
      f.bladeAngle = f.team === 0 ? 0 : Math.PI;
      f.bladeSpeed = 6.5 * (f.team === 0 ? 1 : -1); // rad/s
      f.bladeLength = f.radius * 1.45;
      f.bladeDamage = 9;
      f.parryCooldown = 0;
    },
    onUpdate(f, dt) {
      f.bladeAngle += f.bladeSpeed * dt;
      if (f.parryCooldown > 0) f.parryCooldown = Math.max(0, f.parryCooldown - dt);
    },
    onWallBounce(f) {
      const sign = Math.sign(f.bladeSpeed) || 1;
      const mag = Math.min(28.0, Math.abs(f.bladeSpeed) * 1.045 + 0.25);
      f.bladeSpeed = sign * mag;
      f.bladeLength = Math.min(f.radius * 2.35, f.bladeLength + 0.0012);
    },
    onBodyClash(f) {
      f.bladeDamage = Math.min(24, f.bladeDamage + 0.5);
    },
    getWeaponSegments(f, aspect) {
      const dirX = Math.cos(f.bladeAngle);
      const dirY = Math.sin(f.bladeAngle);
      const startR = f.radius * 0.9;
      const endR = f.radius + f.bladeLength;
      return [
        {
          x1: f.x + (dirX * startR) / aspect,
          y1: f.y + dirY * startR,
          x2: f.x + (dirX * endR) / aspect,
          y2: f.y + dirY * endR,
          radius: 0.011,
          damage: f.bladeDamage,
        },
      ];
    },
    renderAttachment(f, ctx, px, py, pr, dpr) {
      const lenPx = f.bladeLength * ctx.canvas.height;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-f.bladeAngle); // Canvas Y is inverted relative to UV Y

      // Glowing energy edge + steel core
      ctx.beginPath();
      ctx.moveTo(pr * 0.85, -3.5 * dpr);
      ctx.lineTo(pr + lenPx, 0);
      ctx.lineTo(pr * 0.85, 3.5 * dpr);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = f.hexColor;
      ctx.shadowBlur = 10 * dpr;
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = f.hexColor;
      ctx.stroke();

      // Hilt collar
      ctx.beginPath();
      ctx.arc(pr * 0.88, 0, 4.5 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = '#111111';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();
    },
    getStatBadge(f) {
      const rpm = Math.round((Math.abs(f.bladeSpeed) / (Math.PI * 2)) * 60);
      return `${rpm} RPM · ${Math.round(f.bladeDamage)} DMG`;
    },
  },

  berserker: {
    id: 'berserker',
    label: 'Berserker Juggernaut (Speed Ramp)',
    shortLabel: 'Berserker',
    description: 'Gains +7% velocity and +1.5 slam damage on every wall bounce. High-speed body checks crush enemies.',
    init(f) {
      f.stacks = 0;
      f.slamBonus = 8;
      f.charge = 1.4;
    },
    onUpdate(f) {
      f.charge = 1.2 + Math.min(1.5, f.stacks * 0.08);
    },
    onWallBounce(f, arena) {
      f.stacks += 1;
      const boost = 1.055;
      const maxSpd = 1.35;
      const curSpd = Math.hypot(f.vx, f.vy);
      if (curSpd < maxSpd) {
        f.vx *= boost;
        f.vy *= boost;
      }
      f.slamBonus = Math.min(35, f.slamBonus + 1.2);
      if (f.stacks % 4 === 0) {
        arena.spawnFloatingText(f.x, f.y + f.radius, `SPEED x${(1 + f.stacks * 0.06).toFixed(1)}!`, f.hexColor);
      }
    },
    onBodyClash(f, other, arena) {
      const relSpeed = Math.hypot(f.vx - other.vx, f.vy - other.vy);
      const dmg = Math.round(f.slamBonus + relSpeed * 11);
      other.takeDamage(dmg, f, arena, 'SLAM');
    },
    renderAttachment(f, ctx, px, py, pr, dpr) {
      // Spiked aura ring that grows more intense with stacks
      const spikes = 8;
      const spikeH = (4 + Math.min(10, f.stacks * 0.45)) * dpr;
      const rot = performance.now() * 0.004 * (1 + f.stacks * 0.05);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? pr + spikeH : pr * 0.96;
        const a = (i * Math.PI) / spikes;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = f.hexColor;
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
      ctx.restore();
    },
    getStatBadge(f) {
      return `+${f.stacks * 6}% SPD · ${Math.round(f.slamBonus)} SLAM`;
    },
  },

  'gravity-nova': {
    id: 'gravity-nova',
    label: 'Gravity Nova (Shockwave Pulse)',
    shortLabel: 'Gravity Nova',
    description: 'Pulls enemies inward and builds charge on every bounce. At 100%, detonates a massive shockwave.',
    init(f) {
      f.energy = 25;
      f.novaCount = 0;
      f.charge = 1.6;
    },
    onUpdate(f, dt, arena) {
      f.energy = Math.min(100, f.energy + dt * 18);
      // Subtle gravitational pull on enemy fighters
      for (const other of arena.fighters) {
        if (other.team === f.team || other.dead) continue;
        const dx = f.x - other.x;
        const dy = f.y - other.y;
        const d = Math.hypot(dx, dy) + 0.05;
        const pull = 0.085 / (d * d + 0.04);
        other.vx += (dx / d) * pull * dt;
        other.vy += (dy / d) * pull * dt;
      }
      if (f.energy >= 100) {
        f.energy = 0;
        f.novaCount += 1;
        const radius = 0.24 + Math.min(0.12, f.novaCount * 0.02);
        const dmg = 14 + f.novaCount * 2;
        arena.triggerShockwave(f, radius, dmg);
      }
    },
    onWallBounce(f) {
      f.energy = Math.min(100, f.energy + 16);
    },
    onBodyClash(f, other, arena) {
      other.takeDamage(6, f, arena);
      f.energy = Math.min(100, f.energy + 22);
    },
    renderAttachment(f, ctx, px, py, pr, dpr) {
      // Charging orbital ring
      const ratio = f.energy / 100;
      ctx.save();
      ctx.translate(px, py);
      ctx.beginPath();
      ctx.arc(0, 0, pr + 6 * dpr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 * dpr;
      ctx.stroke();

      // Gravity well ripples
      const pulseR = pr * (1.15 + 0.55 * (1.0 - ((performance.now() * 0.0015) % 1)));
      ctx.beginPath();
      ctx.arc(0, 0, pulseR, 0, Math.PI * 2);
      ctx.strokeStyle = `${f.hexColor}66`;
      ctx.lineWidth = 1.2 * dpr;
      ctx.stroke();
      ctx.restore();
    },
    getStatBadge(f) {
      return `NOVA ${Math.round(f.energy)}% · #${f.novaCount}`;
    },
  },

  splitter: {
    id: 'splitter',
    label: 'Swarm Splitter (Mitosis Clones)',
    shortLabel: 'Splitter',
    description: 'Every 3 wall bounces spawns an autonomous mini-drone clone that ricochets and chips enemy HP.',
    init(f) {
      f.bounceTicker = 0;
      f.clonesSpawned = 0;
    },
    onWallBounce(f, arena) {
      if (f.isMinion) return;
      f.bounceTicker += 1;
      if (f.bounceTicker >= 3) {
        f.bounceTicker = 0;
        const activeMinions = arena.fighters.filter((m) => m.team === f.team && m.isMinion && !m.dead).length;
        if (activeMinions < 5) {
          f.clonesSpawned += 1;
          arena.spawnMinion(f);
        }
      }
    },
    onBodyClash(f, other, arena) {
      const dmg = f.isMinion ? 5 : 8;
      other.takeDamage(dmg, f, arena);
      if (f.isMinion) {
        f.takeDamage(5, other, arena);
      }
    },
    renderAttachment(f, ctx, px, py, pr, dpr) {
      if (f.isMinion) return;
      // 3-pip progress indicator around ball
      ctx.save();
      ctx.translate(px, py);
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
        const x = Math.cos(a) * (pr + 5 * dpr);
        const y = Math.sin(a) * (pr + 5 * dpr);
        ctx.beginPath();
        ctx.arc(x, y, 3 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = i < f.bounceTicker ? '#ffffff' : 'rgba(255,255,255,0.25)';
        ctx.fill();
      }
      ctx.restore();
    },
    getStatBadge(f) {
      return `CLONES ${f.clonesSpawned} (${f.bounceTicker}/3)`;
    },
  },

  sniper: {
    id: 'sniper',
    label: 'Ricochet Cannon (Laser Volley)',
    shortLabel: 'Cannon',
    description: 'Locks onto the opponent and fires high-velocity ricochet plasma bolts every 1.1s (faster on bounce).',
    init(f) {
      f.fireTimer = 0.4;
      f.fireRate = 1.05;
      f.shotsFired = 0;
      f.aimAngle = 0;
    },
    onUpdate(f, dt, arena) {
      const target = arena.fighters.find((o) => o.team !== f.team && !o.dead);
      if (target) {
        const dx = (target.x - f.x) * arena.aspect;
        const dy = target.y - f.y;
        f.aimAngle = Math.atan2(dy, dx);
      }
      f.fireTimer += dt;
      if (f.fireTimer >= f.fireRate) {
        f.fireTimer = 0;
        f.shotsFired += 1;
        arena.spawnProjectile(f, f.aimAngle);
      }
    },
    onWallBounce(f) {
      f.fireTimer += 0.28;
      f.fireRate = Math.max(0.42, f.fireRate * 0.975);
    },
    onBodyClash(f, other, arena) {
      other.takeDamage(6, f, arena);
    },
    renderAttachment(f, ctx, px, py, pr, dpr) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-f.aimAngle);
      // Turret barrel
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.rect(pr * 0.55, -3.5 * dpr, pr * 0.75, 7 * dpr);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },
    getStatBadge(f) {
      return `ROF ${(1 / f.fireRate).toFixed(1)}/s · #${f.shotsFired}`;
    },
  },

  vampire: {
    id: 'vampire',
    label: 'Blood Reaper (Dual Scythes + Lifesteal)',
    shortLabel: 'Vampire',
    description: 'Spins twin crimson scythes. Heals for 60% of all damage dealt and grows larger as it feeds.',
    init(f) {
      f.bladeAngle = 0;
      f.bladeSpeed = 5.4 * (f.team === 0 ? 1 : -1);
      f.bladeLength = f.radius * 1.15;
      f.healedTotal = 0;
      f.parryCooldown = 0;
    },
    onUpdate(f, dt) {
      f.bladeAngle += f.bladeSpeed * dt;
      if (f.parryCooldown > 0) f.parryCooldown = Math.max(0, f.parryCooldown - dt);
    },
    onWallBounce(f) {
      f.bladeSpeed *= 1.02;
    },
    onBodyClash(f, other, arena) {
      other.takeDamage(6, f, arena);
    },
    onDealDamage(f, _target, amount, arena) {
      const heal = Math.max(1, Math.round(amount * 0.55));
      f.hp = Math.min(f.maxHp, f.hp + heal);
      f.healedTotal += heal;
      f.radius = Math.min(0.082, f.radius + 0.0006);
      arena.spawnFloatingText(f.x, f.y + f.radius, `+${heal} HP`, '#4ade80');
    },
    getWeaponSegments(f, aspect) {
      const segs = [];
      for (const offset of [0, Math.PI]) {
        const ang = f.bladeAngle + offset;
        const dirX = Math.cos(ang);
        const dirY = Math.sin(ang);
        const startR = f.radius * 0.9;
        const endR = f.radius + f.bladeLength;
        segs.push({
          x1: f.x + (dirX * startR) / aspect,
          y1: f.y + dirY * startR,
          x2: f.x + (dirX * endR) / aspect,
          y2: f.y + dirY * endR,
          radius: 0.01,
          damage: 7,
        });
      }
      return segs;
    },
    renderAttachment(f, ctx, px, py, pr, dpr) {
      const lenPx = f.bladeLength * ctx.canvas.height;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-f.bladeAngle);
      for (const rot of [0, Math.PI]) {
        ctx.save();
        ctx.rotate(rot);
        ctx.beginPath();
        ctx.moveTo(pr * 0.85, 0);
        ctx.quadraticCurveTo(pr + lenPx * 0.65, -9 * dpr, pr + lenPx, 4 * dpr);
        ctx.quadraticCurveTo(pr + lenPx * 0.5, -2 * dpr, pr * 0.85, 3 * dpr);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeStyle = f.hexColor;
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    },
    getStatBadge(f) {
      return `DRAIN +${f.healedTotal} HP`;
    },
  },
};

function rgbArrayToHex([r, g, b]) {
  const toHex = (n) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToRgbArray(hex) {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  ];
}

/**
 * 2D Arena Fighter Ball extending SceneObject.
 * Combines deterministic 2D physics, trails, health, and pluggable Gimmick behaviors
 * while emitting its footprint to the underlying WebGL shader.
 */
export class FighterBall extends SceneObject {
  constructor({
    name = 'Fighter',
    team = 0,
    x = 0.35,
    y = 0.5,
    vx = 0.35,
    vy = 0.25,
    radius = 0.044,
    maxHp = 100,
    color = [0.96, 0.28, 0.32],
    gimmickId = 'sawblade',
    isMinion = false,
  } = {}) {
    super({
      name,
      x,
      y,
      vx,
      vy,
      radius,
      charge: team === 0 ? 1.25 : -1.25,
      color,
      draggable: true,
    });
    this.team = team;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.hexColor = rgbArrayToHex(color);
    this.gimmickId = gimmickId;
    this.gimmick = GIMMICK_DEFS[gimmickId] || GIMMICK_DEFS.sawblade;
    this.isMinion = isMinion;
    this.dead = false;
    this.invulnTimer = 0;
    this.flashTimer = 0;
    this.trail = [];

    this.gimmick.init?.(this);
  }

  takeDamage(amount, attacker, arena, label = '') {
    if (this.dead || this.invulnTimer > 0) return false;
    const dmg = Math.max(1, Math.round(amount));
    this.hp = Math.max(0, this.hp - dmg);
    this.invulnTimer = 0.12;
    this.flashTimer = 0.11;

    arena.onFighterDamaged(this, attacker, dmg, label);
    attacker?.gimmick?.onDealDamage?.(attacker, this, dmg, arena);

    if (this.hp <= 0) {
      this.dead = true;
      arena.onFighterKO(this, attacker);
    }
    return true;
  }

  recordTrail() {
    this.trail.push({ x: this.x, y: this.y, r: this.radius });
    const maxLen = this.isMinion ? 6 : 14;
    if (this.trail.length > maxLen) {
      this.trail.shift();
    }
  }

  render2D(ctx, view) {
    if (this.dead) return;
    const px = this.x * view.width;
    const py = (1.0 - this.y) * view.height;
    const pr = this.radius * view.height;
    const dpr = view.dpr;

    // 1. Motion trail
    for (let i = 0; i < this.trail.length; i++) {
      const pt = this.trail[i];
      const alpha = ((i + 1) / (this.trail.length + 1)) * 0.28;
      ctx.beginPath();
      ctx.arc(pt.x * view.width, (1.0 - pt.y) * view.height, pt.r * view.height * ((i + 2) / (this.trail.length + 2)), 0, Math.PI * 2);
      ctx.fillStyle = `${this.hexColor}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
      ctx.fill();
    }

    // 2. Gimmick weapon / aura attachment
    this.gimmick.renderAttachment?.(this, ctx, px, py, pr, dpr);

    // 3. Crisp ball body
    ctx.save();
    ctx.translate(px, py);

    ctx.beginPath();
    ctx.arc(0, 0, pr, 0, Math.PI * 2);
    ctx.fillStyle = this.flashTimer > 0 ? '#ffffff' : this.hexColor;
    ctx.fill();

    // Inner HP arc ring
    const hpRatio = Math.max(0, this.hp / this.maxHp);
    ctx.beginPath();
    ctx.arc(0, 0, pr * 0.78, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpRatio);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.lineWidth = (this.isMinion ? 2 : 3.2) * dpr;
    ctx.stroke();

    // Crisp dark outer rim
    ctx.beginPath();
    ctx.arc(0, 0, pr, 0, Math.PI * 2);
    ctx.lineWidth = 2.2 * dpr;
    ctx.strokeStyle = '#111111';
    ctx.stroke();

    // Center HP number
    if (!this.isMinion) {
      ctx.fillStyle = this.flashTimer > 0 ? '#111111' : '#ffffff';
      ctx.font = `800 ${Math.max(11, Math.round(pr * 0.48))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
      ctx.shadowBlur = 4 * dpr;
      ctx.fillText(String(Math.ceil(this.hp)), 0, 1 * dpr);
    }

    ctx.restore();
  }
}
