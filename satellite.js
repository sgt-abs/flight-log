(function () {
  'use strict';

  const VERSION = '5.6.0';
  const BASE = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/' + VERSION + '/maplibre-gl';
  const TILES = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
  const RAD = Math.PI / 180;
  const PX_PER_ZOOM0 = 512 / (2 * Math.PI); // globe radius in px at map zoom 0

  let libPromise = null, map = null, host = null, box = null, markers = [];

  // MapLibre is only fetched when someone actually zooms in, so the app itself stays small and offline-friendly
  function loadLib() {
    if (window.maplibregl) return Promise.resolve();
    if (!libPromise) {
      libPromise = new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = BASE + '.css';
        document.head.appendChild(link);
        const s = document.createElement('script');
        s.src = BASE + '.js'; s.onload = resolve;
        s.onerror = () => { libPromise = null; link.remove(); s.remove(); reject(new Error('load failed')); };
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }

  const unit = p => [Math.cos(p.lat * RAD) * Math.cos(p.lon * RAD), Math.cos(p.lat * RAD) * Math.sin(p.lon * RAD), Math.sin(p.lat * RAD)];

  function greatCircle(a, b) {
    const A = unit(a), B = unit(b);
    const w = Math.acos(Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
    const n = Math.max(8, Math.ceil(w * 60));
    const out = [];
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const s1 = w < 1e-6 ? 1 - t : Math.sin((1 - t) * w) / Math.sin(w);
      const s2 = w < 1e-6 ? t : Math.sin(t * w) / Math.sin(w);
      const x = s1 * A[0] + s2 * B[0], y = s1 * A[1] + s2 * B[1], z = s1 * A[2] + s2 * B[2];
      let lon = Math.atan2(y, x) / RAD;
      if (prev !== null) lon += 360 * Math.round((prev - lon) / 360); // keep the line continuous across the date line
      prev = lon;
      out.push([lon, Math.atan2(z, Math.hypot(x, y)) / RAD]);
    }
    return out;
  }

  function center(ports) {
    let sx = 0, sy = 0, sz = 0;
    for (const p of ports) { const u = unit(p); sx += u[0]; sy += u[1]; sz += u[2]; }
    if (Math.hypot(sx, sy, sz) < 1e-6) return { lon: 0, lat: 20 };
    return { lon: Math.atan2(sy, sx) / RAD, lat: Math.atan2(sz, Math.hypot(sx, sy)) / RAD };
  }

  function notice(wrap, text) {
    const n = document.createElement('div');
    n.className = 'satmsg'; n.textContent = text;
    wrap.appendChild(n);
    setTimeout(() => n.remove(), 3500);
  }

  function close() {
    if (map) { map.remove(); map = null; }
    markers = [];
    if (box) { box.remove(); box = null; }
    host = null;
  }

  // opts: { lon, lat, radius (px of the globe being handed over), routes, ports, lock, onExit }
  // resolves true once the map is showing, false if it could not be loaded
  async function open(wrap, opts) {
    close();
    try { await loadLib(); } catch (e) {
      notice(wrap, 'Satellite view needs an internet connection.');
      return false;
    }
    if (!wrap.isConnected) return false;
    host = wrap;
    box = document.createElement('div');
    box.id = 'satMap';
    wrap.appendChild(box);

    const c = opts.lon === undefined ? center(opts.ports) : opts;
    const zoom = opts.radius ? Math.log2(opts.radius / PX_PER_ZOOM0) : 1.4;
    const enterZoom = zoom;

    map = new maplibregl.Map({
      container: box,
      center: [c.lon, c.lat],
      zoom,
      minZoom: opts.lock ? 0.5 : 1.2,
      maxZoom: 9,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true, customAttribution: 'Imagery: NASA GIBS (Blue Marble)' },
      style: {
        version: 8,
        projection: { type: 'globe' },
        sources: { sat: { type: 'raster', tiles: [TILES], tileSize: 256, maxzoom: 8 } },
        layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
      },
    });
    map.touchZoomRotate.disableRotation();

    map.on('load', () => {
      const seen = new Set(), features = [];
      for (const [a, b] of opts.routes) { // routes are already de-duplicated by the caller
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: greatCircle(a, b) }, properties: {} });
      }
      map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({ id: 'routes-casing', type: 'line', source: 'routes', paint: { 'line-color': '#04122a', 'line-width': 5, 'line-opacity': 0.5 }, layout: { 'line-cap': 'round' } });
      map.addLayer({ id: 'routes', type: 'line', source: 'routes', paint: { 'line-color': '#4c9aff', 'line-width': 2.5 }, layout: { 'line-cap': 'round' } });
      for (const p of opts.ports) {
        if (seen.has(p.iata)) continue;
        seen.add(p.iata);
        const el = document.createElement('div');
        el.className = 'satdot';
        const label = document.createElement('span');
        label.textContent = p.iata;
        el.appendChild(label);
        markers.push(new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map));
      }
    });

    if (!opts.lock && opts.onExit) {
      map.on('zoom', () => {
        if (map && map.getZoom() < enterZoom - 0.3) {
          const ctr = map.getCenter();
          const exit = { lon: ctr.lng, lat: ctr.lat };
          close();
          opts.onExit(exit);
        }
      });
    }
    return true;
  }

  window.Satellite = { open, close };
})();
