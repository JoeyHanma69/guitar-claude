// ---------------------------------------------------------------------------
// Fixed-size particle pool. Particles are recycled in a ring, so gameplay
// never allocates during the frame loop and the GC stays quiet.
// ---------------------------------------------------------------------------

/** Burst presets: 'flame' on hits, 'shatter' on misses, 'star' for star power. */
export type BurstKind = 'flame' | 'shatter' | 'star';

type ParticleKind = 'spark' | 'ring' | 'shard' | 'flash';

interface Particle {
  active: boolean;
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  rot: number;
  vrot: number;
  gravity: number;
}

const POOL_SIZE = 600;

function blank(): Particle {
  return {
    active: false,
    kind: 'spark',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 1,
    size: 2,
    color: '#ffffff',
    rot: 0,
    vrot: 0,
    gravity: 0,
  };
}

export class ParticleSystem {
  private pool: Particle[];

  private cursor = 0;

  constructor() {
    this.pool = Array.from({ length: POOL_SIZE }, blank);
  }

  private next(): Particle {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % POOL_SIZE;
    return p;
  }

  private emit(
    kind: ParticleKind,
    x: number,
    y: number,
    opts: Partial<Omit<Particle, 'active' | 'kind' | 'x' | 'y'>>,
  ): void {
    const p = this.next();
    p.active = true;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = opts.vx ?? 0;
    p.vy = opts.vy ?? 0;
    p.maxLife = opts.maxLife ?? 500;
    p.life = p.maxLife;
    p.size = opts.size ?? 3;
    p.color = opts.color ?? '#ffffff';
    p.rot = opts.rot ?? 0;
    p.vrot = opts.vrot ?? 0;
    p.gravity = opts.gravity ?? 0;
  }

  burst(x: number, y: number, kind: BurstKind): void {
    if (kind === 'flame') {
      // GH2 flame: a licking orange/yellow burst rising off the fret button.
      this.emit('flash', x, y, { color: '#ffb027', size: 34, maxLife: 200 });
      for (let i = 0; i < 16; i += 1) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
        const speed = 90 + Math.random() * 260;
        this.emit('spark', x, y, {
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: Math.random() < 0.4 ? '#ffe27a' : '#ff8a1e',
          size: 2 + Math.random() * 3.5,
          maxLife: 260 + Math.random() * 260,
          gravity: 140,
        });
      }
    } else if (kind === 'star') {
      // Star power: white-silver sparkle.
      this.emit('flash', x, y, { color: '#dfeaff', size: 50, maxLife: 300 });
      this.emit('ring', x, y, { color: '#9fd0ff', size: 12, maxLife: 450 });
      for (let i = 0; i < 20; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 100 + Math.random() * 300;
        this.emit('spark', x, y, {
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 50,
          color: Math.random() < 0.5 ? '#ffffff' : '#9fd0ff',
          size: 1.5 + Math.random() * 3,
          maxLife: 350 + Math.random() * 300,
          gravity: 120,
        });
      }
    } else {
      // Miss: red shatter.
      for (let i = 0; i < 12; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 100 + Math.random() * 260;
        this.emit('shard', x, y, {
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: '#ff2a4d',
          size: 3 + Math.random() * 5,
          maxLife: 420 + Math.random() * 260,
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 14,
          gravity: 420,
        });
      }
    }
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dtMs;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.pool) {
      if (!p.active) continue;
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      if (p.kind === 'spark') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * alpha), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'ring') {
        const radius = p.size + (1 - alpha) * p.size * 6;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2 + 2 * alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'shard') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.7, p.size);
        ctx.lineTo(-p.size * 0.7, p.size * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        // flash
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        gradient.addColorStop(0, p.color);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
