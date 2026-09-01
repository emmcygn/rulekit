// The HUD is the instrument every later budget check reads, so its two
// contracts are worth pinning: it writes to the DOM 4x/second (not per frame),
// and it turns red exactly at the draw-call / triangle budgets.
//
// Node environment — a hand-rolled `document` stub is enough for the handful of
// DOM calls the HUD makes.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHUD } from '../src/dev/hud.js';

let el;

function fakeDocument() {
  const appended = [];
  return {
    appended,
    createElement() {
      return {
        id: '',
        textContent: null,
        style: { cssText: '', color: '' },
        removed: false,
        remove() { this.removed = true; },
      };
    },
    body: { appendChild(node) { appended.push(node); } },
  };
}

function fakeRenderer({ calls = 12, triangles = 4000, geometries = 3, textures = 2 } = {}) {
  return {
    info: { render: { calls, triangles }, memory: { geometries, textures } },
    getPixelRatio: () => 2,
  };
}

const fakeDriver = { state: { index: 6, p: 0.25, atRest: true } };

let doc;
beforeEach(() => {
  doc = fakeDocument();
  globalThis.document = doc;
});
afterEach(() => {
  delete globalThis.document;
});

function drive(hud, frames, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) hud.tick(dt);
}

describe('createHUD', () => {
  it('writes to the DOM 4x/second, not every frame', () => {
    const hud = createHUD({ renderer: fakeRenderer(), driver: fakeDriver });
    el = doc.appended[0];

    // 15 frames at 60fps = 0.2499...s, still under the 0.25s gate.
    drive(hud, 15);
    expect(el.textContent).toBe(null);

    drive(hud, 1);
    expect(el.textContent).not.toBe(null);

    // The accumulator resets, so the next write is another 0.25s away.
    const first = el.textContent;
    el.textContent = null;
    drive(hud, 15);
    expect(el.textContent).toBe(null);
    drive(hud, 1);
    expect(el.textContent).not.toBe(null);
    expect(el.textContent).toBe(first);
  });

  it('reports fps, budgets, memory, tier, dpr and driver position', () => {
    const hud = createHUD({
      renderer: fakeRenderer({ calls: 13, triangles: 4200, geometries: 3, textures: 2 }),
      driver: fakeDriver,
      getTier: () => 'high',
      getSceneStats: () => ({ built: ['06-chasm', '07-bridge'], calls: 0, tris: 0 }),
    });
    el = doc.appended[0];
    // 64 frames: past the gate and long enough for the 60-sample ring to hold
    // nothing but 1/60s frames, so the fps line is exactly 60.0.
    drive(hud, 64);

    const lines = el.textContent.split('\n');
    expect(lines[0]).toBe('60.0 fps');
    expect(lines[1]).toBe('13 calls / 300');
    expect(lines[2]).toBe('4.2k tris / 500k');
    expect(lines[3]).toBe('geo 3  tex 2');
    expect(lines[4]).toBe('tier high  dpr 2.00');
    expect(lines[5]).toBe('ch 6 06-chasm 07-bridge');
    expect(lines[6]).toBe('p 0.250  rest');
  });

  it('falls back to "-" when no rooms are resident', () => {
    const hud = createHUD({ renderer: fakeRenderer(), driver: fakeDriver });
    el = doc.appended[0];
    drive(hud, 16);
    expect(el.textContent.split('\n')[5]).toBe('ch 6 -');
  });

  it('stays black inside budget and turns red past it', () => {
    const cases = [
      [{ calls: 300, triangles: 500000 }, '#1A1D21'],
      [{ calls: 301, triangles: 500000 }, '#E2582A'],
      [{ calls: 300, triangles: 500001 }, '#E2582A'],
    ];
    for (const [info, color] of cases) {
      doc = fakeDocument();
      globalThis.document = doc;
      const hud = createHUD({ renderer: fakeRenderer(info), driver: fakeDriver });
      drive(hud, 16);
      expect(doc.appended[0].style.color).toBe(color);
    }
  });

  it('tracks a moving driver', () => {
    const driver = { state: { index: 2, p: 0.5, atRest: false } };
    const hud = createHUD({ renderer: fakeRenderer(), driver });
    el = doc.appended[0];
    drive(hud, 16);
    expect(el.textContent).toContain('p 0.500  move');
  });

  it('destroy() removes the element', () => {
    const hud = createHUD({ renderer: fakeRenderer(), driver: fakeDriver });
    el = doc.appended[0];
    hud.destroy();
    expect(el.removed).toBe(true);
  });
});
