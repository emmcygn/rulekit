import { createStage, hasWebGL2, prefersReducedMotion, isPortrait } from './core/renderer.js';
import { createScrollDriver, syncToTarget } from './core/scrollDriver.js';
import { createCameraRig } from './core/cameraRig.js';
import { createQuality, detectTier, resolveTier, IDLE_FPS } from './core/quality.js';
import { createSceneManager } from './core/sceneManager.js';
import { createPanelLayer } from './core/panels.js';
import { createMaterials } from './lib/materials.js';
import MODULES from './scenes/index.js';
import { createHUD, hudEnabled } from './dev/hud.js';
import { fallbackDecision, shouldOfferFallback, installBanner } from './core/fallback.js';

// The scroll driver's own `atRest` needs the damped gap under ~2e-5 before it
// flips, which is ~2.2s of exponential tail after a full-page jump. Gate the
// idle drop on the raw gap instead: 1e-4 of the whole document is well under a
// pixel of scroll, so by the time we go idle nothing is visibly still moving.
const REST_GAP = 1e-4;

// Boot gate, spec section 9. The decision itself lives in fallback.js so it can
// be tested without a browser; this is only the two lines that act on it.
const decision = fallbackDecision({ webgl2: hasWebGL2(), reducedMotion: prefersReducedMotion() });
if (decision.redirect) location.replace('/plain');
else boot();

function boot() {
  const canvas = document.getElementById('stage');

  // Render-on-dirty: the rAF loop always runs, but it only draws when something
  // changed. Declared first because half the setup below needs to force a draw.
  let dirty = true;
  const markDirty = () => { dirty = true; };

  // Read once, up here: the tier flag has to be in hand before the first
  // quality decision, and ?ch= / ?debug= read the same object further down.
  const params = new URLSearchParams(location.search);

  const quality = createQuality(resolveTier(params.get('tier'), detectTier({
    dpr: window.devicePixelRatio || 1,
    cores: navigator.hardwareConcurrency || 4,
    mobile: matchMedia('(pointer: coarse)').matches,
  })));
  const stage = createStage({
    canvas,
    antialias: quality.settings.antialias,
    dprCap: quality.settings.dprCap,
  });
  quality.onChange(() => {
    stage.setDpr(quality.settings.dprCap);
    document.body.dataset.tier = quality.tier;
    markDirty();
  });
  // Published for the CSS hooks that read the tier: the frosted panel backdrop
  // and the #vignette grain overlay, both high-tier only.
  document.body.dataset.tier = quality.tier;

  const driver = createScrollDriver({ spacer: document.getElementById('spacer') });

  // The eleven panels already exist in index.html; this only wires them to the
  // same scroll state the camera reads, and builds the rail from CHAPTERS.
  const panelLayer = createPanelLayer({
    root: document.getElementById('panels'),
    railRoot: document.getElementById('rail'),
    onJump: (i) => {
      driver.scrollToChapter(i);
      syncToTarget(driver.state);
      markDirty();
    },
  });

  const rig = createCameraRig({ camera: stage.camera });
  if (params.has('debug')) stage.scene.add(rig.debugGroup());
  let portrait = isPortrait();

  // The nine shared materials are made once and live for the page; rooms borrow
  // them and never dispose them. The manager keeps at most three rooms built —
  // the one you are in and its two neighbours — so memory is flat no matter how
  // far you scroll.
  const materials = createMaterials();
  const sceneManager = createSceneManager({
    scene: stage.scene, modules: MODULES, materials, quality, portrait,
  });

  // Deep-link: ?ch=6 opens at chapter 6 instead of the top. One rAF late so the
  // browser has finished restoring its own scroll position first. syncToTarget
  // lands the damped value on the jump instead of gliding there over ~2s.
  const ch = params.get('ch');
  if (ch !== null && Number.isFinite(Number(ch))) {
    requestAnimationFrame(() => {
      driver.scrollToChapter(Number(ch));
      syncToTarget(driver.state);
      // syncToTarget lands at rest, so the gap is already zero and the loop
      // would not otherwise notice the camera teleported.
      markDirty();
    });
  }

  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // Chapter bounds are measured in pixels, so re-measure alongside the size.
      stage.resize();
      driver.refresh();
      // Same tick as stage.resize(), so the portrait keyframes and the portrait
      // fov switch land on one frame instead of 120ms apart.
      portrait = isPortrait();
      sceneManager.setPortrait(portrait);
      // NON-NEGOTIABLE: setSize reallocates the drawing buffer, which comes back
      // empty. If the page is idle when the resize settles, nothing is dirty and
      // the canvas stays blank until the next 1/12s ambient tick — or forever,
      // if a later change makes idle ticks conditional. Force the draw here, in
      // the same tick as the resize, not on the raw resize event 120ms earlier.
      markDirty();
    }, 120);
    // The debounce means the raw event is 120ms early for the reallocation, but
    // it still keeps the loop awake while the user is dragging the window edge.
    markDirty();
  };
  window.addEventListener('resize', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  window.addEventListener('scroll', markDirty, { passive: true });
  // Coming back to a backgrounded tab: the compositor may have dropped what it
  // had, and `last` is stale, so redraw once on the way in.
  document.addEventListener('visibilitychange', markDirty);

  const hud = hudEnabled()
    ? createHUD({
        renderer: stage.renderer,
        driver,
        getTier: () => quality.tier,
        getSceneStats: () => sceneManager.stats(),
      })
    : null;

  // The last rung of the fallback ladder: the machine is already on the cheapest
  // tier and still cannot hold 24fps, so we offer the flat version. `probeDone`
  // makes it a one-shot — the offer is made once per session or not at all.
  const banner = installBanner({ root: document.getElementById('perfbanner') });
  let probeDone = false;
  const probeStart = performance.now();

  let last = performance.now();
  let lastDraw = last;
  let idleAcc = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    // A hidden tab still gets the odd rAF in some browsers; skipping the whole
    // body (and resetting the clocks) means no catch-up burst on return.
    if (document.hidden) { last = now; lastDraw = now; return; }

    // Two deltas, deliberately. `rafDt` is raw, because the FPS monitor has to
    // see a 200ms frame as 5fps; clamping it would floor the observable rate at
    // 20fps and hide the frames worth reacting to. `dt` is clamped, because
    // animation must not teleport across a stall.
    const rafDt = (now - last) / 1000;
    const dt = Math.min(rafDt, 0.05);
    last = now;

    driver.tick(dt);
    const moving = Math.abs(driver.state.targetGlobal - driver.state.global) > REST_GAP;
    if (moving) { dirty = true; idleAcc = 0; }
    else {
      idleAcc += dt;
      // Ambient idle-float ticks: the room keeps breathing at IDLE_FPS.
      if (idleAcc >= 1 / IDLE_FPS) { idleAcc = 0; dirty = true; }
    }
    if (!dirty) return;
    dirty = false;

    // Build/drop rooms first, then pose the camera: whatever gets built this
    // frame is already in the scene by the time we draw it.
    sceneManager.update(driver.state);
    panelLayer.setActive(driver.state.index, driver.state.p);
    rig.update(driver.state, dt, now / 1000, portrait);
    const t0 = performance.now();
    stage.render();
    const workMs = performance.now() - t0;
    // The monitor needs both numbers: how far apart the frames were, and how
    // much of that gap was our own draw. A 30Hz display or an occluded tab
    // gives us slow frames we did nothing to cause, and must not cost a tier.
    quality.sample(rafDt, workMs);
    // The HUD gets the real gap between draws, so its fps readout shows the
    // ~12fps idle rate instead of the 60fps the rAF loop is still running at.
    const drawDt = Math.min((now - lastDraw) / 1000, 0.5);
    lastDraw = now;
    // After render, so renderer.info reports the frame the HUD is labelling.
    if (hud) hud.tick(drawDt);

    // The fallback probe opens at 1s, but it does not close there: quality.js
    // answers `pending` until its 90-frame window is full, which on the machines
    // this question is actually about takes longer than a second. Asking once at
    // 1s would therefore always read `pending` and never offer anything. So poll
    // from 1s on, and settle the moment there is a real verdict to settle on.
    if (!probeDone && now - probeStart > 1000) {
      const verdict = quality.probeVerdict();
      if (verdict !== 'pending') {
        probeDone = true;
        if (shouldOfferFallback({ tier: quality.tier, verdict })) banner.show();
      }
    }
  }
  requestAnimationFrame(frame);

  window.__clinic = { stage, driver, rig, hud, quality, sceneManager, materials, panelLayer, markDirty, banner };
}
