(function () {
  'use strict';

  const RAD = Math.PI / 180;
  const MAX_LAT = 1.4;
  const G = { lon: 0, lat: 0.35, zoom: 1, sig: null };
  let run = 0;

  // land outline as [lon, sin(lat), cos(lat)] so each frame only needs a few multiplications
  const land = window.LAND.map(poly => poly.map(([lon, lat]) => [lon * RAD, Math.sin(lat * RAD), Math.cos(lat * RAD)]));

  const unit = p => [Math.cos(p.lat * RAD) * Math.cos(p.lon * RAD), Math.cos(p.lat * RAD) * Math.sin(p.lon * RAD), Math.sin(p.lat * RAD)];

  // great-circle points lifted above the surface so routes read as arcs
  function arcPoints(a, b) {
    const A = unit(a), B = unit(b);
    const w = Math.acos(Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
    const n = Math.max(8, Math.ceil(w * 40));
    const lift = 0.04 + 0.2 * w / Math.PI;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const s1 = w < 1e-6 ? 1 - t : Math.sin((1 - t) * w) / Math.sin(w);
      const s2 = w < 1e-6 ? t : Math.sin(t * w) / Math.sin(w);
      const x = s1 * A[0] + s2 * B[0], y = s1 * A[1] + s2 * B[1], z = s1 * A[2] + s2 * B[2];
      const m = Math.hypot(x, y, z), h = Math.hypot(x, y);
      pts.push([Math.atan2(y, x), z / m, h / m, 1 + lift * Math.sin(Math.PI * t)]);
    }
    return pts;
  }

  window.startGlobe = function (canvas, routes, ports) {
    if (!canvas) return;
    const myRun = ++run;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.height = Math.round(canvas.clientWidth * dpr);

    const sig = ports.map(p => p.iata).sort().join();
    if (G.sig !== sig) {
      G.sig = sig; G.zoom = 1;
      let sx = 0, sy = 0, sz = 0;
      for (const p of ports) { const u = unit(p); sx += u[0]; sy += u[1]; sz += u[2]; }
      if (Math.hypot(sx, sy, sz) > 1e-6) {
        G.lon = Math.atan2(sy, sx);
        G.lat = Math.max(-1, Math.min(1, Math.atan2(sz, Math.hypot(sx, sy))));
      }
    }

    const css = getComputedStyle(document.documentElement);
    const col = n => css.getPropertyValue(n).trim();
    const arcs = routes.map(([a, b]) => arcPoints(a, b));
    const dots = ports.map(p => ({ code: p.iata, lam: p.lon * RAD, sp: Math.sin(p.lat * RAD), cp: Math.cos(p.lat * RAD) }));
    const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    let auto = !reduced, dirty = true, vx = 0, vy = 0;

    function draw() {
      const W = canvas.width, c = W / 2, R = W * 0.46 * G.zoom;
      const sinL = Math.sin(G.lat), cosL = Math.cos(G.lat);
      const proj = (lam, sp, cp, r) => {
        const cl = Math.cos(lam - G.lon), sl = Math.sin(lam - G.lon);
        return [r * cp * sl, r * (cosL * sp - sinL * cp * cl), r * (sinL * sp + cosL * cp * cl)];
      };
      ctx.clearRect(0, 0, W, W);

      // ocean
      ctx.beginPath(); ctx.arc(c, c, R, 0, 2 * Math.PI);
      ctx.fillStyle = col('--water'); ctx.fill();
      ctx.lineWidth = dpr; ctx.strokeStyle = col('--line'); ctx.stroke();

      // land, clipped to the globe; points behind the horizon are pushed onto the rim
      ctx.save();
      ctx.beginPath(); ctx.arc(c, c, R, 0, 2 * Math.PI); ctx.clip();
      ctx.fillStyle = col('--land'); ctx.strokeStyle = col('--line'); ctx.lineWidth = 0.5 * dpr;
      for (const poly of land) {
        const ps = poly.map(([lam, sp, cp]) => proj(lam, sp, cp, 1));
        if (!ps.some(p => p[2] > 0)) continue;
        ctx.beginPath();
        ps.forEach(([x, y, z], i) => {
          if (z < 0) { const m = Math.hypot(x, y) || 1; x /= m; y /= m; }
          const px = c + R * x, py = c - R * y;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        });
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();

      // routes
      ctx.strokeStyle = col('--accent'); ctx.lineWidth = 1.6 * dpr; ctx.lineCap = 'round';
      for (const pts of arcs) {
        ctx.beginPath();
        let pen = false;
        for (const [lam, sp, cp, r] of pts) {
          const [x, y, z] = proj(lam, sp, cp, r);
          if (z > 0 || x * x + y * y > 1) {
            const px = c + R * x, py = c - R * y;
            pen ? ctx.lineTo(px, py) : ctx.moveTo(px, py); pen = true;
          } else pen = false;
        }
        ctx.stroke();
      }

      // airports
      const labels = dots.length <= 24 || G.zoom > 1.4;
      ctx.font = `600 ${11 * dpr}px sans-serif`;
      for (const d of dots) {
        const [x, y, z] = proj(d.lam, d.sp, d.cp, 1);
        if (z < 0.05) continue;
        const px = c + R * x, py = c - R * y;
        ctx.beginPath(); ctx.arc(px, py, 3.2 * dpr, 0, 2 * Math.PI);
        ctx.fillStyle = col('--accent'); ctx.fill();
        ctx.strokeStyle = col('--card'); ctx.lineWidth = dpr; ctx.stroke();
        if (labels) {
          ctx.lineWidth = 3 * dpr; ctx.strokeStyle = col('--water'); ctx.strokeText(d.code, px + 6 * dpr, py - 5 * dpr);
          ctx.fillStyle = col('--text'); ctx.fillText(d.code, px + 6 * dpr, py - 5 * dpr);
        }
      }
    }

    function frame() {
      if (myRun !== run || !canvas.isConnected) return;
      if (auto) { G.lon += 0.0025; dirty = true; }
      if (Math.abs(vx) > 1e-5 || Math.abs(vy) > 1e-5) {
        G.lon += vx; G.lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, G.lat + vy));
        vx *= 0.94; vy *= 0.94; dirty = true;
      }
      if (dirty) { draw(); dirty = false; }
      requestAnimationFrame(frame);
    }

    // drag to spin, pinch or scroll to zoom
    const ptrs = new Map();
    let pinch = 0;
    const gap = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    const radiusCss = () => canvas.clientWidth * 0.46 * G.zoom;
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      auto = false; vx = vy = 0;
      if (ptrs.size === 2) pinch = gap();
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 1) {
        vx = -dx / radiusCss(); vy = dy / radiusCss();
        G.lon += vx; G.lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, G.lat + vy));
      } else if (ptrs.size === 2) {
        const g = gap();
        G.zoom = Math.max(0.7, Math.min(3, G.zoom * g / pinch)); pinch = g;
      }
      dirty = true;
    });
    const end = e => { ptrs.delete(e.pointerId); canvas.style.cursor = 'grab'; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      G.zoom = Math.max(0.7, Math.min(3, G.zoom * Math.exp(-e.deltaY * 0.0015)));
      dirty = true;
    }, { passive: false });

    frame();
  };
})();
