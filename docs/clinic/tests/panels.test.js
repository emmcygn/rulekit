// The panel layer has two contracts worth pinning.
//
// 1. `panelFadeFor` is pure arithmetic on the chapter's own progress, so the
//    text is on exactly the same clock as the camera — never a CSS timer.
// 2. `createPanelLayer` reads panels that already exist in index.html (it never
//    creates prose in JS) and it does not write to the DOM on every frame: the
//    class toggles happen on a chapter change, and the opacity write is skipped
//    when the quantised value has not moved.
//
// Node environment — a hand-rolled `document` stub covers the handful of DOM
// calls the layer makes.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { panelFadeFor, createPanelLayer } from '../src/core/panels.js';
import { CHAPTERS } from '../src/core/chapters.js';

describe('panelFadeFor', () => {
  it('fades in at the head of a chapter', () => {
    expect(panelFadeFor(0)).toBe(0);
    expect(panelFadeFor(0, true)).toBe(1); // chapter 0: no entry ramp, visible on load
    expect(panelFadeFor(0.04)).toBeGreaterThan(0);
    expect(panelFadeFor(0.04)).toBeLessThan(1);
    expect(panelFadeFor(0.08)).toBeCloseTo(1, 6);
  });
  it('holds fully opaque through the body of the chapter', () => {
    expect(panelFadeFor(0.3)).toBe(1);
    // p = 0.88 is every interior chapter's aim-hold twin (cameraKeys.js). The
    // tail starts at 0.90 so the twin sits INSIDE the opaque window, not on its
    // edge: the held shot and its card are readable at the same time.
    expect(panelFadeFor(0.88)).toBe(1);
    expect(panelFadeFor(0.90)).toBe(1);
  });
  it('fades out at the tail', () => {
    expect(panelFadeFor(0.94)).toBeLessThan(1);
    expect(panelFadeFor(1)).toBeCloseTo(0, 6);
  });
  // The two outer ends of the piece are not crossings. Chapter 00 is what a
  // cold load renders, and chapter 10's progress reaches 1 and holds there for
  // as long as the reader sits at the bottom of the page.
  it('gives the first chapter its title on the very first frame', () => {
    expect(panelFadeFor(0, true)).toBe(1);
    expect(panelFadeFor(0.02, true)).toBe(1);
    // ...and still clears out of the way of chapter 01.
    expect(panelFadeFor(1, true)).toBeCloseTo(0, 6);
  });
  it('leaves the last chapter readable where the reader parks', () => {
    expect(panelFadeFor(1, false, true)).toBe(1);
    expect(panelFadeFor(0.97, false, true)).toBe(1);
    // ...and still ramps in behind chapter 09.
    expect(panelFadeFor(0, false, true)).toBe(0);
  });
});

// --- DOM stub ------------------------------------------------------------

function fakeEl(tag = 'div') {
  const el = {
    tag,
    className: '',
    dataset: {},
    attrs: {},
    style: {},
    children: [],
    writes: 0,
    classes: new Set(),
    innerHTML: '',
    href: '',
    classList: {
      toggle(name, on) { if (on) el.classes.add(name); else el.classes.delete(name); },
      contains(name) { return el.classes.has(name); },
    },
    setAttribute(k, v) { el.attrs[k] = v; },
    getAttribute(k) { return el.attrs[k]; },
    appendChild(c) { el.children.push(c); return c; },
    replaceChildren() { el.children.length = 0; },
    addEventListener() {},
  };
  // Count opacity writes so the "no per-frame DOM writes" rule is testable.
  let opacity = '';
  Object.defineProperty(el.style, 'opacity', {
    get() { return opacity; },
    set(v) { opacity = v; el.writes++; },
    configurable: true,
  });
  return el;
}

let savedDocument;

beforeEach(() => {
  savedDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => fakeEl(tag) };
});

afterEach(() => {
  globalThis.document = savedDocument;
});

function fakeRoot() {
  const panels = new Map(CHAPTERS.map((c, i) => {
    const el = fakeEl('section');
    el.dataset.side = i % 2 === 0 ? 'left' : 'right';   // index.html alternates
    return [c.id, el];
  }));
  return {
    panels,
    root: { querySelector: (sel) => panels.get(sel.replace(/^\[data-panel="|"\]$/g, '')) || null },
  };
}

describe('createPanelLayer', () => {
  it('throws when index.html is missing a panel', () => {
    const railRoot = fakeEl('nav');
    expect(() => createPanelLayer({ root: { querySelector: () => null }, railRoot }))
      .toThrow(/missing the panel/);
  });

  it('builds one labelled rail dot per chapter', () => {
    const { root } = fakeRoot();
    const railRoot = fakeEl('nav');
    createPanelLayer({ root, railRoot });
    expect(railRoot.children).toHaveLength(CHAPTERS.length);
    expect(railRoot.children[0].getAttribute('aria-label')).toBe(`${CHAPTERS[0].num} ${CHAPTERS[0].title}`);
    expect(railRoot.children[3].href).toBe(`#panel-${CHAPTERS[3].id}`);
  });

  it('marks exactly one panel and one dot current', () => {
    const { root, panels } = fakeRoot();
    const railRoot = fakeEl('nav');
    const layer = createPanelLayer({ root, railRoot });
    layer.setActive(4, 0.5);
    const current = CHAPTERS.filter((c) => panels.get(c.id).classList.contains('is-current'));
    expect(current).toHaveLength(1);
    expect(current[0].id).toBe(CHAPTERS[4].id);
    expect(railRoot.children.filter((d) => d.classList.contains('is-current'))).toHaveLength(1);
    expect(railRoot.children[4].getAttribute('aria-current')).toBe('true');
  });

  it('never hides an inactive panel from assistive tech or find-in-page', () => {
    const { root, panels } = fakeRoot();
    const layer = createPanelLayer({ root, railRoot: fakeEl('nav') });
    layer.setActive(4, 0.5);
    const off = panels.get(CHAPTERS[0].id);
    expect(off.style.display).toBeUndefined();
    expect(off.style.visibility).toBeUndefined();
    expect(off.attrs.hidden).toBeUndefined();
    expect(off.attrs.inert).toBeUndefined();
    expect(off.attrs['aria-hidden']).toBeUndefined();
  });

  it('does not write to the DOM on every frame', () => {
    const { root, panels } = fakeRoot();
    const layer = createPanelLayer({ root, railRoot: fakeEl('nav') });
    const el = panels.get(CHAPTERS[2].id);
    layer.setActive(2, 0.5);
    const after = el.writes;
    for (let i = 0; i < 60; i++) layer.setActive(2, 0.5 + i * 1e-5);
    expect(el.writes).toBe(after);
  });

  // The card only takes the pointer once it is readable. Below that it is a
  // ghost, and a ghost that eats the wheel stalls the camera under the cursor.
  it('gates pointer-events to the readable part of the fade', () => {
    const { root, panels } = fakeRoot();
    const layer = createPanelLayer({ root, railRoot: fakeEl('nav') });
    const el = panels.get(CHAPTERS[2].id);
    layer.setActive(2, 0.02);                       // deep-link ramp
    expect(el.classList.contains('is-readable')).toBe(false);
    layer.setActive(2, 0.5);                        // body of the chapter
    expect(el.classList.contains('is-readable')).toBe(true);
    layer.setActive(2, 0.995);                      // faded back out
    expect(el.classList.contains('is-readable')).toBe(false);
  });

  // The exemptions are only worth anything if the layer actually passes them.
  it('hands the first/last exemption through to the live panels', () => {
    const { root, panels } = fakeRoot();
    const layer = createPanelLayer({ root, railRoot: fakeEl('nav') });
    layer.setActive(0, 0);                          // cold load, top of page
    expect(panels.get(CHAPTERS[0].id).style.opacity).toBe('1.000');
    layer.setActive(CHAPTERS.length - 1, 1);        // parked at the bottom
    expect(panels.get(CHAPTERS[CHAPTERS.length - 1].id).style.opacity).toBe('1.000');
    expect(panels.get(CHAPTERS[CHAPTERS.length - 1].id).classList.contains('is-readable')).toBe(true);
  });

  it('drops is-readable on the panel it leaves', () => {
    const { root, panels } = fakeRoot();
    const layer = createPanelLayer({ root, railRoot: fakeEl('nav') });
    layer.setActive(2, 0.5);
    layer.setActive(3, 0.5);
    expect(panels.get(CHAPTERS[2].id).classList.contains('is-readable')).toBe(false);
    expect(panels.get(CHAPTERS[3].id).classList.contains('is-readable')).toBe(true);
  });

  // The rail label opens leftward from its tick, which is inside a right-docked
  // card. The CSS suppresses it there, and this is the flag it reads.
  it('tells the rail which side the current card is docked on', () => {
    const { root } = fakeRoot();
    const railRoot = fakeEl('nav');
    const layer = createPanelLayer({ root, railRoot });
    layer.setActive(0, 0.5);
    expect(railRoot.dataset.currentSide).toBe('left');
    layer.setActive(3, 0.5);
    expect(railRoot.dataset.currentSide).toBe('right');
  });

  it('clears the rail and resets every panel on destroy', () => {
    const { root, panels } = fakeRoot();
    const railRoot = fakeEl('nav');
    const layer = createPanelLayer({ root, railRoot });
    layer.setActive(4, 0.5);
    layer.destroy();
    expect(railRoot.children).toHaveLength(0);
    expect(railRoot.dataset.currentSide).toBeUndefined();
    for (const c of CHAPTERS) {
      const el = panels.get(c.id);
      expect(el.classList.contains('is-current')).toBe(false);
      expect(el.classList.contains('is-readable')).toBe(false);
      expect(el.style.opacity).toBe('0');
    }
  });
});
