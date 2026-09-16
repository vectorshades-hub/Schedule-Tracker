"use client";
import { useEffect, useRef, useState } from "react";

function todayMMDD() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Ported from index.html/management.html's #bdayOverlay — canvas confetti, once/day/user. */
export default function BirthdayPopup({ username, birthday }) {
  const [open, setOpen] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!username || !birthday || birthday !== todayMMDD()) return;
    const key = `bday_shown_${username}`;
    const todayStr = new Date().toISOString().slice(0, 10);
    try {
      if (localStorage.getItem(key) === todayStr) return;
      localStorage.setItem(key, todayStr);
    } catch {}
    setOpen(true);
  }, [username, birthday]);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ["#e74c3c", "#f1c40f", "#3498db", "#2ecc71", "#9b59b6", "#e67e22"];
    const particles = [];
    function burst(x, y) {
      for (let i = 0; i < 60; i++) {
        particles.push({
          x,
          y,
          vx: (Math.random() - 0.5) * 12,
          vy: Math.random() * -12 - 4,
          size: Math.random() * 6 + 3,
          color: colors[Math.floor(Math.random() * colors.length)],
          rotation: Math.random() * 360,
          rotSpeed: (Math.random() - 0.5) * 12,
          life: 1,
        });
      }
    }
    burst(60, canvas.height - 40);
    burst(canvas.width - 60, canvas.height - 40);

    let raf;
    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.vy += 0.35; // gravity
        p.vx *= 0.99; // friction
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotSpeed;
        p.life -= 0.008;
        ctx.save();
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        if (particles[i].life <= 0 || particles[i].y > canvas.height + 50) particles.splice(i, 1);
      }
      if (particles.length) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  if (!open) return null;
  return (
    <div className="st-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, pointerEvents: "none" }} />
      <div className="st-modal text-center" style={{ maxWidth: 380 }}>
        <div className="st-modal-body">
          <div style={{ fontSize: 48 }}>🎂</div>
          <h4>Happy Birthday, {username}!</h4>
          <p className="text-muted">Wishing you a great day from the whole team.</p>
          <button className="btn btn-primary" onClick={() => setOpen(false)}>
            Thanks!
          </button>
        </div>
      </div>
    </div>
  );
}
