import { useEffect, useRef } from 'react';

interface Blip { x: number; y: number; a: number; }

interface RadarProps {
  victim: { x: number; z: number } | null;
}

/**
 * Sweeping sector radar. Victim position is plotted in real time;
 * random ambient blips fade out after the sweep passes them.
 */
export function Radar({ victim }: RadarProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const angleRef = useRef(0);
  const blipsRef = useRef<Blip[]>([]);
  const victimRef = useRef(victim);
  victimRef.current = victim;

  useEffect(() => {
    const cvs = ref.current!;
    const ctx = cvs.getContext('2d')!;
    const W = cvs.width, H = cvs.height, cx = W / 2, cy = H / 2, R = W / 2 - 4;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const angle = angleRef.current;

      ctx.fillStyle = '#020d14';
      ctx.fillRect(0, 0, W, H);

      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (R * i) / 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,229,255,.15)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(0,229,255,.1)';
      ctx.beginPath(); ctx.moveTo(cx, 4); ctx.lineTo(cx, H - 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(4, cy); ctx.lineTo(W - 4, cy); ctx.stroke();

      // sweep trail
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R, 0);
      ctx.strokeStyle = 'rgba(0,229,255,.9)'; ctx.lineWidth = 2; ctx.stroke();
      for (let a = 0; a < Math.PI * 0.6; a += 0.04) {
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.lineTo(R * Math.cos(-a), R * Math.sin(-a));
        ctx.strokeStyle = `rgba(0,229,255,${0.07 * (1 - a / (Math.PI * 0.6))})`;
        ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.restore();

      blipsRef.current = blipsRef.current.filter((b) => b.a > 0);
      blipsRef.current.forEach((b) => {
        b.a -= 0.005;
        ctx.beginPath(); ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,229,255,${b.a})`; ctx.fill();
      });

      const v = victimRef.current;
      if (v) {
        const vx = cx + (v.x / 60) * (R - 6);
        const vy = cy - (v.z / 60) * (R - 6);
        ctx.beginPath(); ctx.arc(vx, vy, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,45,85,.9)'; ctx.fill();
        ctx.beginPath(); ctx.arc(vx, vy, 8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,45,85,.4)'; ctx.lineWidth = 1; ctx.stroke();
      }

      if (Math.random() < 0.022) {
        const a = Math.random() * Math.PI * 2;
        const d = 20 + Math.random() * (R - 20);
        blipsRef.current.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, a: 0.6 });
      }
      angleRef.current = (angle + 0.03) % (Math.PI * 2);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      width={180}
      height={180}
      className="rounded-full border border-cyan-400/20 shadow-[inset_0_0_20px_rgba(0,229,255,.1)]"
    />
  );
}
