(function () {
  'use strict';

  const RAD = Math.PI / 180;
  const MAX_LAT = 1.4;
  const ARC = '#ffd24a';
  const G = { lon: 0, lat: 0.35, zoom: 1, sig: null };
  let run = 0, cleanup = null;

  // plain land outline as [lon, sin(lat), cos(lat)]; only used if WebGL is unavailable
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

  // ---------- Earth texture (NASA Blue Marble, equirectangular) ----------
  const earth = new Image();
  let earthState = 'idle'; // idle | loading | ready | failed
  const waiting = [];
  function whenEarth(fn) {
    if (earthState === 'ready' || earthState === 'failed') return fn();
    waiting.push(fn);
    if (earthState === 'idle') {
      earthState = 'loading';
      earth.onload = () => { earthState = 'ready'; waiting.splice(0).forEach(f => f()); };
      earth.onerror = () => { earthState = 'failed'; waiting.splice(0).forEach(f => f()); };
      earth.src = 'data/earth.jpg';
    }
  }

  const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

  // Orthographic sphere: for every pixel inside the disc, work out its longitude/latitude and look up the texture.
  // The mip level is chosen by hand because the longitude wrap-around breaks automatic derivatives.
  const FRAG = `#version 300 es
precision highp float;
uniform sampler2D tex;
uniform float c, R, lon0, sinL, cosL, texW;
out vec4 o;
void main() {
  float x = (gl_FragCoord.x - c) / R;
  float y = (gl_FragCoord.y - c) / R;
  float r2 = x * x + y * y;
  if (r2 >= 1.0) { o = vec4(0.0); return; }
  float z = sqrt(1.0 - r2);
  float sinp = clamp(y * cosL + z * sinL, -1.0, 1.0);
  float lon = lon0 + atan(x, z * cosL - y * sinL);
  vec2 uv = vec2(lon / 6.2831853 + 0.5, asin(sinp) / 3.1415927 + 0.5);
  float cosp = sqrt(1.0 - sinp * sinp);
  float lod = log2(max(1.0, (texW / 6.2831853) / (R * max(z, 0.1) * max(cosp, 0.1)))) - 0.3;
  vec3 col = textureLod(tex, uv, max(lod, 0.0)).rgb;
  float d = dot(vec3(x, y, z), normalize(vec3(-0.4, 0.5, 0.75)));
  float light = (0.8 + 0.3 * d) * (0.86 + 0.14 * z);
  col = pow(col, vec3(0.92)) * light * 1.1;
  o = vec4(min(col, 1.0), 1.0);
}`;

  function initGL(glCanvas) {
    const gl = glCanvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: true });
    if (!gl) return null;
    try {
      const shader = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const pr = gl.createProgram();
      gl.attachShader(pr, shader(gl.VERTEX_SHADER, VERT));
      gl.attachShader(pr, shader(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      gl.useProgram(pr);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle
      const loc = gl.getAttribLocation(pr, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const u = {};
      for (const n of ['c', 'R', 'lon0', 'sinL', 'cosL', 'texW']) u[n] = gl.getUniformLocation(pr, n);
      return { gl, u, tex: null };
    } catch (e) {
      console.warn('Globe: WebGL setup failed, using the plain outline.', e);
      return null;
    }
  }

  function uploadTexture(g) {
    const gl = g.gl;
    g.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, g.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, earth);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  window.startGlobe = function (canvas, routes, ports) {
    if (!canvas) return;
    const myRun = ++run;
    if (cleanup) cleanup();
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.height = Math.round(canvas.clientWidth * dpr);

    // the globe surface is drawn by WebGL on a canvas underneath; this 2D canvas on top draws the glow, routes and labels
    const glCanvas = document.createElement('canvas');
    glCanvas.width = glCanvas.height = canvas.width;
    canvas.parentNode.insertBefore(glCanvas, canvas);
    const g = initGL(glCanvas);
    cleanup = () => {
      const ext = g && g.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      glCanvas.remove();
    };

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

    const arcs = routes.map(([a, b]) => arcPoints(a, b));
    const dots = ports.map(p => ({ code: p.iata, lam: p.lon * RAD, sp: Math.sin(p.lat * RAD), cp: Math.cos(p.lat * RAD) }));
    const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    let auto = !reduced, dirty = true, vx = 0, vy = 0;

    whenEarth(() => {
      if (myRun !== run) return;
      if (g && earthState === 'ready') uploadTexture(g);
      dirty = true;
    });

    function draw() {
      const W = canvas.width, c = W / 2, R = W * 0.46 * G.zoom;
      const sinL = Math.sin(G.lat), cosL = Math.cos(G.lat);
      const proj = (lam, sp, cp, r) => {
        const cl = Math.cos(lam - G.lon), sl = Math.sin(lam - G.lon);
        return [r * cp * sl, r * (cosL * sp - sinL * cp * cl), r * (sinL * sp + cosL * cp * cl)];
      };
      ctx.clearRect(0, 0, W, W);

      // atmosphere glow
      const halo = ctx.createRadialGradient(c, c, R * 0.995, c, c, R * 1.12);
      halo.addColorStop(0, 'rgba(110,170,255,0.4)'); halo.addColorStop(1, 'rgba(110,170,255,0)');
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(c, c, R * 1.13, 0, 2 * Math.PI); ctx.fill();

      if (g) {
        const gl = g.gl;
        gl.viewport(0, 0, W, W);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        if (g.tex) {
          gl.uniform1f(g.u.c, c); gl.uniform1f(g.u.R, R);
          gl.uniform1f(g.u.lon0, G.lon); gl.uniform1f(g.u.sinL, sinL); gl.uniform1f(g.u.cosL, cosL);
          gl.uniform1f(g.u.texW, earth.naturalWidth);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        } else {
          ctx.beginPath(); ctx.arc(c, c, R, 0, 2 * Math.PI); ctx.fillStyle = '#0a2146'; ctx.fill();
        }
      } else {
        // no WebGL: flat ocean with a plain land outline
        ctx.save();
        ctx.beginPath(); ctx.arc(c, c, R, 0, 2 * Math.PI); ctx.fillStyle = '#123d78'; ctx.fill(); ctx.clip();
        ctx.fillStyle = '#4f7f45';
        for (const poly of land) {
          const ps = poly.map(([lam, sp, cp]) => proj(lam, sp, cp, 1));
          if (!ps.some(p => p[2] > 0)) continue;
          ctx.beginPath();
          ps.forEach(([x, y, z], i) => {
            if (z < 0) { const m = Math.hypot(x, y) || 1; x /= m; y /= m; }
            i ? ctx.lineTo(c + R * x, c - R * y) : ctx.moveTo(c + R * x, c - R * y);
          });
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }

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
        const gp = gap();
        G.zoom = Math.max(0.7, Math.min(3, G.zoom * gp / pinch)); pinch = gp;
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
