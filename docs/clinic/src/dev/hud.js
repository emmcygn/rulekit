// Dev-only performance HUD. This is the instrument every later task's budget
// check reads: draw calls, triangles, resident geometries/textures, tier, dpr,
// and where the scroll driver currently is.
//
// Never on the default production path — `hudEnabled()` gates it behind the
// Vite dev server or an explicit `?hud=1`.
//
// The per-frame path only writes one number into a ring buffer; the DOM write
// and the string building happen 4x/second.

export function hudEnabled() {
  return import.meta.env.DEV || new URLSearchParams(location.search).has('hud');
}

export function createHUD({
  renderer,
  driver,
  getTier = () => '?',
  getSceneStats = () => ({ built: [], calls: 0, tris: 0 }),
}) {
  const el = document.createElement('pre');
  el.id = 'hud';
  el.style.cssText = [
    'position:fixed', 'top:8px', 'right:8px', 'z-index:99', 'margin:0',
    'padding:8px 10px', 'background:rgba(255,255,255,.92)', 'border:1px solid #D8DEE4',
    'font:11px/1.45 ui-monospace,Menlo,monospace', 'color:#1A1D21', 'white-space:pre',
    'pointer-events:none', 'text-align:right',
  ].join(';');
  document.body.appendChild(el);

  // Rolling 60-frame window of frame times, in ms.
  const samples = new Array(60).fill(16.7);
  let cursor = 0;
  let acc = 0;

  function tick(dt) {
    samples[cursor] = dt * 1000;
    cursor = (cursor + 1) % samples.length;
    acc += dt;
    if (acc < 0.25) return;
    acc = 0;

    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const fps = 1000 / mean;
    const r = renderer.info.render;
    const m = renderer.info.memory;
    const scene = getSceneStats();
    const over = r.calls > 300 || r.triangles > 500000;
    el.style.color = over ? '#E2582A' : '#1A1D21';
    el.textContent = [
      `${fps.toFixed(1)} fps`,
      `${r.calls} calls / 300`,
      `${(r.triangles / 1000).toFixed(1)}k tris / 500k`,
      `geo ${m.geometries}  tex ${m.textures}`,
      `tier ${getTier()}  dpr ${renderer.getPixelRatio().toFixed(2)}`,
      `ch ${driver.state.index} ${scene.built.join(' ') || '-'}`,
      `p ${driver.state.p.toFixed(3)}  ${driver.state.atRest ? 'rest' : 'move'}`,
    ].join('\n');
  }

  return { tick, destroy() { el.remove(); } };
}
