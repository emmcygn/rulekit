// Runtime smoke test: does the built page actually run in a real browser?
//
// The whole point of this file is that `npm run build` and `vitest` both passed
// on a bundle that threw on the first ScrollTrigger in a real browser. Neither
// of those two ever executes a frame, so neither can see it. Static reasoning is
// not evidence; this is. It drives the page from the top of the document to the
// bottom and asserts the four things that break when a bundle is runtime-broken:
//
//   1. window.__clinic exists (the app booted at all)
//   2. driver.state.global climbs monotonically and finishes at ~1
//   3. the last chapter (index 10) is reached
//   4. no more than three rooms are ever resident, and zero page errors
//
// Then a second pass at 380x780 — the narrowest phone the copy is cut for —
// visits all eleven chapters and asserts every card FITS. The panel is
// `overflow:hidden` by design (a scrollable card swallows the wheel), so copy
// that does not fit is not clipped-with-a-scrollbar, it is gone. Only a real
// layout can answer this: the type scale is clamp()-driven and the .ext/.ext-tall
// gating is media-query-driven, so no test that does not lay out CSS at 380px
// can see a card overrun. That is what the last three commits kept fixing by
// hand; this is the regression test for all of them.
//
// Usage:
//   npm run smoke                              # serves dist/ itself on 4173
//   node scripts/smoke.mjs http://host:port/   # or point it at a running server
//
// With no URL argument it starts `serve dist` on PORT (default 4173) and stops
// it on the way out, so `npm run verify` is one command rather than "remember
// to start a server first".
//
// Needs puppeteer-core and a local Chrome. Neither is a dependency of this
// package — the browser is a machine you already have, not a 300MB download in
// every install — so both are looked up, not required:
//   PUPPETEER_EXECUTABLE_PATH  path to Chrome (default: macOS Google Chrome)
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.error('smoke: puppeteer-core is not installed.\n  npm i -D puppeteer-core   (or run this from a directory that has it)');
  process.exit(2);
}

// Not named URL: that would shadow the global URL constructor the response
// handler below uses to read a pathname.
const TARGET = process.argv[2] || `http://localhost:${process.env.PORT || 4173}/`;
const errors = [];

// Spawn `serve dist` unless we were handed a URL to point at. The binary is
// spawned directly rather than through npx so that killing it kills the server
// and not a wrapper that leaves the port held.
let server = null;
if (!process.argv[2]) {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath: toPath } = await import('node:url');
  const root = toPath(new URL('..', import.meta.url));
  const port = String(process.env.PORT || 4173);
  server = spawn(toPath(new URL('../node_modules/.bin/serve', import.meta.url)),
    ['dist', '-l', port, '--no-clipboard'],
    { cwd: root, stdio: 'ignore' });
  // Without unref() the live child handle keeps this process's event loop alive
  // after the last assertion, and the run hangs on a green result forever.
  server.unref();
  const stop = () => { if (server && !server.killed) server.kill('SIGTERM'); };
  process.on('exit', stop);
  process.on('SIGINT', () => { stop(); process.exit(130); });
  // Poll rather than sleep a fixed amount: a cold `serve` is up in ~200ms and a
  // busy CI box is not, and neither should decide how long this waits.
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try {
      const r = await fetch(TARGET, { method: 'HEAD' });
      up = r.ok;
    } catch { /* not listening yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) {
    console.error(`smoke: could not reach ${TARGET} after 15s. Is dist/ built? (npm run build)`);
    stop();
    process.exit(2);
  }
  console.log(`smoke: serving dist/ at ${TARGET}`);
}

const b = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  // SwiftShader, so this runs the same on a headless box with no GPU. It is a
  // "does it run" test, not a "how fast" test.
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
});
const p = await b.newPage();
p.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); });
p.on('console', (m) => {
  if (m.type() !== 'error') return;
  // The URL-less mirror of a 404 the response handler already reports properly.
  if (/Failed to load resource/.test(m.text())) return;
  errors.push('console.error: ' + m.text());
});
p.on('requestfailed', (r) => { errors.push('reqfail: ' + r.url() + ' ' + (r.failure()?.errorText || '')); });
// A bare "404 (Not Found)" console line names no URL, which is useless. Track
// responses so a 404 says WHICH file.
p.on('response', (r) => {
  if (r.status() < 400) return;
  const u = r.url();
  // Exact pathname, not a substring: this swallows the browser's own automatic
  // /favicon.ico probe and nothing else, so a 404 on any file the app actually
  // asks for — including one with "favicon" in its name — still fails the run.
  if (new URL(u).pathname === '/favicon.ico') return;
  errors.push(`http ${r.status()}: ${u}`);
});

await p.goto(TARGET, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 2500));

const boot = await p.evaluate(() => ({
  clinic: typeof window.__clinic,
  driver: window.__clinic ? typeof window.__clinic.driver : 'n/a',
  state: window.__clinic && window.__clinic.driver ? JSON.parse(JSON.stringify(window.__clinic.driver.state)) : null,
  webgl2: !!document.createElement('canvas').getContext('webgl2'),
}));
console.log('boot:', JSON.stringify(boot));

// Scroll 0 -> 1 in steps. `global` is the damped value the camera follows, so
// it must climb monotonically and finish near 1.
const STEPS = 12;
const samples = [];
for (let i = 0; i <= STEPS; i++) {
  const frac = i / STEPS;
  await p.evaluate((f) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.round(f * max));
  }, frac);
  await new Promise((r) => setTimeout(r, 450));
  const s = await p.evaluate(() => {
    const d = window.__clinic && window.__clinic.driver;
    if (!d || !d.state) return null;
    const { global, targetGlobal, index, p } = d.state;
    return { global, targetGlobal, index, p, rooms: window.__clinic.sceneManager.stats().built.length };
  });
  samples.push({ frac: +frac.toFixed(3), s });
  console.log(`scroll ${frac.toFixed(3)} ->`, JSON.stringify(s));
}

// ── portrait fit pass: 380x780, every chapter ─────────────────────────────
const NARROW = { width: 380, height: 780 };
const fits = [];
const phone = await b.newPage();
phone.on('pageerror', (e) => { errors.push('portrait pageerror: ' + e.message); });
await phone.setViewport({ ...NARROW, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await phone.goto(TARGET, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 2500));

const cardIds = await phone.evaluate(
  () => [...document.querySelectorAll('#panels .panel')].map((el) => el.id),
);
if (cardIds.length !== 11) errors.push(`portrait: found ${cardIds.length} panels, expected 11`);

for (let i = 0; i < cardIds.length; i++) {
  await phone.evaluate((n) => {
    window.__clinic.driver.scrollToChapter(n);
  }, i);
  // WAIT for the card, do not sleep at it. The scroll position jumps but the
  // damped value the panel layer reads glides in over ~2s, so a fixed 500ms
  // sleep measured the PREVIOUS chapter's card for 3 of the 11 — three panels
  // silently never checked, which is the exact failure this pass exists to stop.
  let arrived = true;
  try {
    await phone.waitForFunction(
      (id) => {
        const el = document.querySelector('#panels .panel.is-current');
        return !!el && el.id === id;
      },
      { timeout: 10000, polling: 100 },
      cardIds[i],
    );
  } catch {
    arrived = false;
  }
  if (!arrived) errors.push(`portrait: chapter ${i} never became current (${cardIds[i]})`);
  const m = await phone.evaluate(() => {
    const el = document.querySelector('#panels .panel.is-current');
    const doc = document.documentElement;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      id: el.id,
      // The card is overflow:hidden, so anything past clientHeight is cut away
      // with no scrollbar and no way for a reader to reach it.
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      padBottom: parseFloat(cs.paddingBottom) || 0,
      docOverflow: doc.scrollWidth - doc.clientWidth,
      // Chrome leaves bottom padding out of scrollHeight when content
      // overflows, so measure the last line's own baseline box too: its bottom
      // must clear the card's padding, not merely the card's border.
      lastChildOverrun: (() => {
        const kids = [...el.children].filter((k) => getComputedStyle(k).display !== 'none');
        const last = kids[kids.length - 1];
        if (!last) return 0;
        return Math.round(last.getBoundingClientRect().bottom - (el.getBoundingClientRect().bottom - (parseFloat(cs.paddingBottom) || 0)));
      })(),
    };
  });
  fits.push({ chapter: i, expected: cardIds[i], m });
  console.log(`fit@380 ch${String(i).padStart(2, '0')} ->`, JSON.stringify(m));
}

// ── URL-bar pass: does the camera hold still when only the chrome moves? ──
//
// A phone's browser UI shows and hides as you scroll. That changes
// window.innerHeight and NOTHING else: #spacer is sized in svh, which is the
// viewport with the UI SHOWN and does not move. Chapter bounds are measured in
// pixels against the scrollable distance, so if that distance is taken as
// scrollHeight - innerHeight, the SAME scroll position maps to a different
// chapter progress every time the bar toggles — and because the bar toggles
// both ways during an ordinary scroll, the camera walks forward through beats
// and then back through them again. That is a scene repeating.
//
// Headless Chrome has no browser UI, so svh == lvh == innerHeight here and the
// condition cannot arise on its own. A phone supplies two constants that
// headless cannot: svh (the viewport with the bar SHOWN) and lvh (with it
// hidden). Neither moves when the bar does; only innerHeight moves. So this
// pass pins both — #spacer to 1100 * svh, and the driver's own lvh probe to
// lvh — and then moves the viewport height alone, which is exactly what the
// device does.
//
// Pinning the probe does NOT pre-answer the question. If the driver measures
// chapter bounds against innerHeight, pinning it changes nothing and the camera
// still walks; the pass only goes green if the driver actually uses the stable
// height. Confirmed by running it against the code before the fix.
const BAR = 82;                       // iOS Safari's bottom bar, near enough
const PHONE = { width: 390, height: 844 };
const barMoves = [];
{
  const bar = await b.newPage();
  bar.on('pageerror', (e) => { errors.push('url-bar pageerror: ' + e.message); });
  await bar.setViewport({ ...PHONE, isMobile: true, hasTouch: true });
  await bar.goto(TARGET, { waitUntil: 'load' });
  await bar.waitForFunction('window.__clinic && window.__clinic.driver', { timeout: 20000 });
  await bar.evaluate((svhPx, lvhPx) => {
    const el = document.createElement('style');
    el.textContent = `#spacer{height:${svhPx}px !important}`
      + `[data-viewport-probe]{height:${lvhPx}px !important}`;
    document.head.appendChild(el);
  }, 1100 * PHONE.height / 100, PHONE.height + BAR);
  await bar.evaluate(() => window.__clinic.driver.refresh());
  const frames = (n) => bar.evaluate((k) => new Promise((r) => {
    let i = 0; const t = () => (++i >= k ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
  }), n);
  const pose = () => bar.evaluate(() => {
    const c = window.__clinic, cam = c.stage.camera, s = c.driver.state;
    return { x: cam.position.x, y: cam.position.y, z: cam.position.z, ch: s.index, p: s.p };
  });
  for (const y of [1266, 3798, 5064, 6330, 7596]) {
    await bar.setViewport({ ...PHONE, isMobile: true, hasTouch: true });
    await bar.evaluate((yy) => window.scrollTo(0, yy), y);
    await frames(70);
    const before = await pose();
    await bar.setViewport({ ...PHONE, height: PHONE.height + BAR, isMobile: true, hasTouch: true });
    await frames(70);
    const after = await pose();
    const move = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
    barMoves.push({ y, before, after, move });
    console.log(`urlbar y=${String(y).padStart(4)} -> ` + JSON.stringify({
      ch: `${before.ch}:${before.p.toFixed(3)} -> ${after.ch}:${after.p.toFixed(3)}`,
      move: +move.toFixed(3),
    }));
  }
  await bar.close();
}

await b.close();

// ── assertions ────────────────────────────────────────────────────────────
const fail = [];
// The camera is allowed to move a little when the frustum changes shape — a
// taller viewport is a different aspect and the portrait keys re-frame for it.
// It is NOT allowed to travel down the flight path, which is what a re-mapped
// scroll position does. 0.5u is well under a station gap (18u) and well over
// the re-framing.
const BAR_TOL = 0.5;
for (const m of barMoves) {
  if (m.move > BAR_TOL) {
    fail.push(`urlbar y=${m.y}: the camera moved ${m.move.toFixed(2)}u (limit ${BAR_TOL}) when only the browser UI height changed - `
      + `chapter progress went ${m.before.ch}:${m.before.p.toFixed(3)} -> ${m.after.ch}:${m.after.p.toFixed(3)}, so the reader is replayed beats they have already seen`);
  }
}
if (barMoves.length !== 5) fail.push(`urlbar pass measured ${barMoves.length} positions, expected 5`);

// The fit pass. 1px of tolerance for sub-pixel line boxes, nothing more.
const TOL = 1;
for (const { chapter, expected, m } of fits) {
  if (!m) { fail.push(`fit@380 ch${chapter}: no .panel.is-current card was showing`); continue; }
  if (m.id !== expected) { fail.push(`fit@380 ch${chapter}: measured ${m.id}, expected ${expected} - the card never arrived, so this chapter went unchecked`); continue; }
  const over = m.scrollHeight - m.clientHeight;
  if (over > TOL) fail.push(`fit@380 ch${chapter} (${m.id}): card content overruns its box by ${over}px (${m.scrollHeight} in ${m.clientHeight}) - copy is being clipped away`);
  if (m.lastChildOverrun > TOL) fail.push(`fit@380 ch${chapter} (${m.id}): last block runs ${m.lastChildOverrun}px past the card's ${m.padBottom}px bottom padding`);
  if (m.docOverflow > TOL) fail.push(`fit@380 ch${chapter} (${m.id}): the document scrolls sideways by ${m.docOverflow}px at 380px wide`);
}
if (fits.length !== 11) fail.push(`fit@380 measured ${fits.length} chapters, expected 11`);
if (boot.clinic !== 'object') fail.push('window.__clinic never appeared');
if (boot.state === null) fail.push('driver.state was null at boot');

const states = samples.map((x) => x.s);
if (states.some((s) => s === null)) fail.push(`driver.state was null at ${states.filter((s) => s === null).length}/${states.length} scroll positions`);
else {
  const g = states.map((s) => s.global);
  for (let i = 1; i < g.length; i++) {
    if (g[i] < g[i - 1] - 1e-6) fail.push(`global went backwards at step ${i}: ${g[i - 1]} -> ${g[i]}`);
  }
  if (g[g.length - 1] <= g[0] + 0.5) fail.push(`global did not advance: ${g[0]} -> ${g[g.length - 1]}`);
  if (g[g.length - 1] < 0.95) fail.push(`global finished at ${g[g.length - 1]}, expected ~1`);
  const idx = states.map((s) => s.index);
  if (Math.max(...idx) < 10) fail.push(`never reached the last chapter, max index ${Math.max(...idx)}`);
  if (states.some((s) => s.rooms > 3)) fail.push(`residency exceeded 3 rooms: max ${Math.max(...states.map((s) => s.rooms))}`);
}
if (errors.length) fail.push(`${errors.length} page error(s):\n    ` + errors.slice(0, 10).join('\n    '));

if (fail.length) {
  console.log('\nSMOKE FAIL');
  fail.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
const g = states.map((s) => s.global);
const worst = Math.max(...fits.map(({ m }) => m.scrollHeight - m.clientHeight));
console.log(`\nSMOKE PASS: global ${g[0].toFixed(4)} -> ${g[g.length - 1].toFixed(4)} monotonic over ${STEPS + 1} samples, index 0 -> ${Math.max(...states.map((s) => s.index))}, max residency ${Math.max(...states.map((s) => s.rooms))} rooms, 0 page errors`);
console.log(`FIT PASS: all ${fits.length} cards fit at ${NARROW.width}x${NARROW.height}, worst card is ${worst}px inside its box, no sideways scroll`);
console.log(`URLBAR PASS: worst camera move on a ${BAR}px browser-UI change is ${Math.max(...barMoves.map((m) => m.move)).toFixed(3)}u (limit ${BAR_TOL}), across ${barMoves.length} scroll depths`);
// Explicit: the spawned server is unref'd, but say so rather than rely on an
// empty event loop to end a script that has already printed its verdict.
process.exit(0);
