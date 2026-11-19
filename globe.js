(function () {
  'use strict';

  const RAD = Math.PI / 180;
  const MAX_LAT = 1.4;
  const ARC = '#ffd24a';
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

  // sub-solar point (where the sun is overhead) for a moment in time, in radians; accurate to about 1 degree
  function sunPoint(ms) {
    const n = ms / 86400000 - 10957.5; // days since J2000
    const L = (280.46 + 0.9856474 * n) % 360;
    const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
    const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
    const eps = (23.439 - 4e-7 * n) * RAD;
    const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
    const gmst = ((280.46061837 + 360.98564736629 * n) % 360) * RAD;
    return { lon: ra - gmst, lat: dec };
  }

  // ---------- land colouring ----------
  // No land-cover data is bundled, so colour comes from latitude bands plus a handful of hand-placed regions
  const COLORS = {
    desert: [206, 178, 122], steppe: [170, 160, 100], rain: [22, 84, 40],
    mount: [128, 112, 92], ice: [242, 246, 250],
  };
  const STRENGTH = { desert: 1, steppe: 0.5, rain: 1, mount: 0.55, ice: 1 };
  // [centre lon, centre lat, half-width lon, half-height lat, kind]
  const REGIONS = [
    [10, 24, 28, 9, 'desert'], [47, 24, 12, 8, 'desert'], [103, 43, 14, 6, 'desert'], [134, -25, 14, 9, 'desert'],
    [-111, 33, 9, 6, 'desert'], [20, -24, 9, 7, 'desert'], [62, 40, 10, 6, 'desert'], [71, 27, 5, 4, 'desert'],
    [58, 31, 8, 5, 'desert'], [-68, -45, 5, 9, 'steppe'], [-100, 42, 12, 6, 'steppe'], [60, 52, 25, 5, 'steppe'],
    [-62, -4, 14, 9, 'rain'], [22, 0, 10, 7, 'rain'], [108, -1, 14, 7, 'rain'], [102, 17, 7, 8, 'rain'],
    [88, 32, 14, 5, 'mount'], [-70, -20, 4, 20, 'mount'], [-110, 45, 6, 12, 'mount'],
    [-40, 73, 22, 12, 'ice'],
  ];
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), u = smooth(0, 1, x - xi), v = smooth(0, 1, y - yi);
    return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
  }
  // base colour by latitude (degrees, signed)
  const BANDS = [
    [0, [40, 110, 52]], [12, [84, 126, 60]], [30, [92, 126, 68]], [45, [66, 100, 58]],
    [58, [58, 84, 66]], [68, [132, 142, 124]], [76, [240, 244, 248]],
  ];
  function bandColor(alat) {
    for (let i = 1; i < BANDS.length; i++) {
      if (alat <= BANDS[i][0]) {
        const t = (alat - BANDS[i - 1][0]) / (BANDS[i][0] - BANDS[i - 1][0]);
        const a = BANDS[i - 1][1], b = BANDS[i][1];
        return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
      }
    }
    return BANDS[BANDS.length - 1][1];
  }
  const landRGB = [0, 0, 0];
  function landColor(lonD, latD) {
    let c = latD < -64 ? COLORS.ice : bandColor(Math.abs(latD));
    let r = c[0], g = c[1], b = c[2];
    for (const [lc, la, rx, ry, kind] of REGIONS) {
      const dl = ((lonD - lc + 540) % 360) - 180, dy = latD - la;
      // wobble the edge with noise so regions look like patches of terrain rather than ovals
      const d2 = (dl / rx) * (dl / rx) + (dy / ry) * (dy / ry) + (noise(lonD / 4 + lc, latD / 4 + la) - 0.5) * 0.9;
      if (d2 >= 1) continue;
      const w = smooth(0, 0.7, 1 - d2) * STRENGTH[kind], k = COLORS[kind];
      r = lerp(r, k[0], w); g = lerp(g, k[1], w); b = lerp(b, k[2], w);
    }
    const n = 0.86 + 0.28 * (0.65 * noise(lonD / 7, latD / 7) + 0.35 * noise(lonD / 2.5, latD / 2.5));
    landRGB[0] = r * n; landRGB[1] = g * n; landRGB[2] = b * n;
    return landRGB;
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

    let auto = !reduced, dirty = true, vx = 0, vy = 0, sunAt = 0;

    // The coloured surface (ocean, land, sun lighting, night side) is computed on a small grid and scaled up,
    // which keeps it smooth and fast; land edges stay crisp because the land is drawn as a vector clip.
    const N = 220;
    const mk = () => { const cv = document.createElement('canvas'); cv.width = cv.height = N; return cv; };
    const oceanCv = mk(), landCv = mk();
    const oceanCtx = oceanCv.getContext('2d'), landCtx = landCv.getContext('2d');
    const oceanImg = oceanCtx.createImageData(N, N), landImg = landCtx.createImageData(N, N);

    function paintSurface(c, R, proj) {
      const sun = sunPoint(Date.now());
      const [sx, sy, sz] = proj(sun.lon, Math.sin(sun.lat), Math.cos(sun.lat), 1);
      const hm = Math.hypot(sx, sy, sz + 1), hx = sx / hm, hy = sy / hm, hz = (sz + 1) / hm; // half-vector for the sun glint
      const sinL = Math.sin(G.lat), cosL = Math.cos(G.lat);
      const W = canvas.width, od = oceanImg.data, ld = landImg.data;
      for (let j = 0; j < N; j++) {
        const y = (c - (j + 0.5) / N * W) / R;
        for (let i = 0; i < N; i++) {
          const x = ((i + 0.5) / N * W - c) / R, r2 = x * x + y * y, o = (j * N + i) * 4;
          if (r2 >= 1) { od[o + 3] = 0; ld[o + 3] = 0; continue; }
          const z = Math.sqrt(1 - r2);
          const latD = Math.asin(Math.max(-1, Math.min(1, y * cosL + z * sinL))) / RAD;
          const lonD = (G.lon + Math.atan2(x, z * cosL - y * sinL)) / RAD;

          const d = x * sx + y * sy + z * sz;                           // cosine of the sun's angle from overhead
          const day = smooth(-0.1, 0.25, d);
          const lit = (0.24 + 0.76 * day * (0.6 + 0.4 * Math.max(d, 0))) * (0.7 + 0.3 * z);
          const tw = Math.exp(-(((d - 0.03) / 0.08) ** 2)) * 0.5;         // warm glow along the terminator
          const spec = day > 0 ? Math.pow(Math.max(0, x * hx + y * hy + z * hz), 160) * 0.35 * day : 0;

          const cl = Math.cos(latD * RAD), t = cl * cl;
          const L = landColor(lonD, latD);
          ld[o] = L[0] * lit + tw * 70; ld[o + 1] = L[1] * lit + tw * 30; ld[o + 2] = L[2] * lit; ld[o + 3] = 255;
          od[o] = lerp(10, 18, t) * lit + tw * 50 + spec * 255;
          od[o + 1] = lerp(38, 72, t) * lit + tw * 22 + spec * 255;
          od[o + 2] = lerp(86, 132, t) * lit + spec * 255;
          od[o + 3] = 255;
        }
      }
      oceanCtx.putImageData(oceanImg, 0, 0);
      landCtx.putImageData(landImg, 0, 0);
      sunAt = Date.now();
    }

    function draw() {
      const W = canvas.width, c = W / 2, R = W * 0.46 * G.zoom;
      const sinL = Math.sin(G.lat), cosL = Math.cos(G.lat);
      const proj = (lam, sp, cp, r) => {
        const cl = Math.cos(lam - G.lon), sl = Math.sin(lam - G.lon);
        return [r * cp * sl, r * (cosL * sp - sinL * cp * cl), r * (sinL * sp + cosL * cp * cl)];
      };
      ctx.clearRect(0, 0, W, W);

      // atmosphere glow
      const halo = ctx.createRadialGradient(c, c, R * 0.97, c, c, R * 1.13);
      halo.addColorStop(0, 'rgba(110,170,255,0.5)'); halo.addColorStop(1, 'rgba(110,170,255,0)');
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(c, c, R * 1.13, 0, 2 * Math.PI); ctx.fill();

      paintSurface(c, R, proj);
      ctx.save();
      ctx.beginPath(); ctx.arc(c, c, R, 0, 2 * Math.PI); ctx.clip();
      ctx.fillStyle = '#0a2146'; ctx.fillRect(0, 0, W, W); // solid base so the low-res edge pixels never show through
      ctx.drawImage(oceanCv, 0, 0, W, W);

      // land: one path of every visible polygon (points behind the horizon are pushed onto the rim),
      // filled with the coloured land layer
      const path = new Path2D();
      for (const poly of land) {
        const ps = poly.map(([lam, sp, cp]) => proj(lam, sp, cp, 1));
        if (!ps.some(p => p[2] > 0)) continue;
        ps.forEach(([x, y, z], i) => {
          if (z < 0) { const m = Math.hypot(x, y) || 1; x /= m; y /= m; }
          const px = c + R * x, py = c - R * y;
          i ? path.lineTo(px, py) : path.moveTo(px, py);
        });
        path.closePath();
      }
      ctx.save();
      ctx.clip(path);
      ctx.drawImage(landCv, 0, 0, W, W);
      ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 0.7 * dpr; ctx.stroke(path);
      ctx.restore();

      // routes
      ctx.lineCap = 'round';
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass ? ARC : 'rgba(4,12,30,0.55)';
        ctx.lineWidth = (pass ? 1.8 : 3.6) * dpr;
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
      }

      // airports
      const labels = dots.length <= 24 || G.zoom > 1.4;
      ctx.font = `700 ${11 * dpr}px sans-serif`;
      for (const d of dots) {
        const [x, y, z] = proj(d.lam, d.sp, d.cp, 1);
        if (z < 0.05) continue;
        const px = c + R * x, py = c - R * y;
        ctx.beginPath(); ctx.arc(px, py, 3.4 * dpr, 0, 2 * Math.PI);
        ctx.fillStyle = ARC; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
        if (labels) {
          ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(4,12,30,0.85)'; ctx.strokeText(d.code, px + 6 * dpr, py - 5 * dpr);
          ctx.fillStyle = '#fff'; ctx.fillText(d.code, px + 6 * dpr, py - 5 * dpr);
        }
      }
    }

    function frame() {
      if (myRun !== run || !canvas.isConnected) return;
      if (auto) { G.lon += 0.0025; dirty = true; }
      if (Date.now() - sunAt > 30000) dirty = true; // keep day/night live while idle
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
      auto = false;
      G.zoom = Math.max(0.7, Math.min(3, G.zoom * Math.exp(-e.deltaY * 0.0015)));
      dirty = true;
    }, { passive: false });

    frame();
  };
})();
