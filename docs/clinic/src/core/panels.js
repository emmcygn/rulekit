// The panel layer: eleven fixed cards of real DOM text, one per chapter, plus
// the progress rail down the right edge.
//
// Two rules run through everything here.
//
// 1. The panels are on the camera's clock, not their own. Their opacity is a
//    pure function of the chapter progress the scroll driver already computed,
//    so a paused scroll pauses the text mid-fade exactly like it pauses the
//    room. There is no CSS transition on .panel opacity for the same reason.
//
// 2. No prose is created here. The eleven <section>s live in index.html, in
//    document order, inside <main> — so the page is selectable, findable with
//    ctrl-F, and readable top-to-bottom by a screen reader whatever the camera
//    is doing. This module only looks them up and toggles classes. Inactive
//    panels get `opacity:0; pointer-events:none` and NOTHING else: display,
//    visibility, hidden, inert and aria-hidden would each take the text away
//    from assistive tech and from in-page find.

import { CHAPTERS } from './chapters.js';
import { smoothstep, sub } from '../lib/easing.js';

// Fades in over the first 8% of a chapter, holds through 88%, fades out over
// the last 12% — so the outgoing card is gone before the incoming one starts.
export function panelFadeFor(p, first = false) {
  // The entry ramp exists so cards arrive with their chapters mid-journey.
  // The FIRST chapter has no arrival: a natural page load lands at exactly
  // p = 0, and ramping from zero there greets every visitor with a blank
  // void. Chapter 0's card is simply on from the start.
  const enter = first ? 1 : smoothstep(sub(p, 0, 0.08));
  return enter * (1 - smoothstep(sub(p, 0.88, 1)));
}

export function createPanelLayer({ root, railRoot, onJump = null }) {
  const panels = new Map();
  for (const c of CHAPTERS) {
    const el = root.querySelector(`[data-panel="${c.id}"]`);
    if (!el) throw new Error(`index.html is missing the panel for ${c.id}`);
    panels.set(c.id, el);
  }
  const order = CHAPTERS.map((c) => panels.get(c.id));

  // Progress rail, built from the chapter list — one tick per chapter, each one
  // a real link to its panel so keyboard and screen-reader users get the same
  // table of contents the sighted reader sees.
  const dots = CHAPTERS.map((c, i) => {
    const a = document.createElement('a');
    a.className = 'rail-dot';
    a.href = `#panel-${c.id}`;
    a.dataset.num = c.num;
    a.setAttribute('aria-label', `${c.num} ${c.title}`);
    a.innerHTML = `<span class="rail-tick"></span><span class="rail-label">${c.title}</span>`;
    // The panels are position:fixed, so the browser's own anchor jump would
    // scroll nowhere. When main.js hands us a jump we drive the scroll instead;
    // without one the href stays as the honest fallback.
    if (onJump) {
      a.addEventListener('click', (e) => { e.preventDefault(); onJump(i); });
    }
    railRoot.appendChild(a);
    return a;
  });

  let activeIndex = -1;
  let lastOpacity = '';
  let lastReadable = false;

  // A card only takes the pointer once it is actually readable. Below half
  // opacity it is a ghost, and a ghost that eats the wheel would stall the
  // camera under the reader's cursor.
  const READABLE = 0.5;

  // Called every frame, so it writes nothing unless something actually moved:
  // the class toggles only run on a chapter change or a threshold crossing, and
  // the opacity string is quantised to 1/1000 and compared before it goes to
  // the DOM. Holding at 1.0 through the body of a chapter costs zero writes.
  function setActive(index, p) {
    const i = index < 0 ? 0 : index > CHAPTERS.length - 1 ? CHAPTERS.length - 1 : index;
    if (i !== activeIndex) {
      for (let k = 0; k < order.length; k++) {
        order[k].classList.toggle('is-current', k === i);
        dots[k].classList.toggle('is-current', k === i);
        dots[k].setAttribute('aria-current', k === i ? 'true' : 'false');
      }
      // The panel we just left keeps whatever opacity it faded out to; zero it
      // once here rather than tracking two panels every frame.
      if (activeIndex >= 0) {
        order[activeIndex].style.opacity = '0';
        order[activeIndex].classList.toggle('is-readable', false);
      }
      // The rail label sits to the LEFT of its tick, which is inside a
      // right-docked card. Tell the CSS which side the current card is on so
      // the label can stand down rather than print over the prose.
      railRoot.dataset.currentSide = order[i].dataset.side === 'right' ? 'right' : 'left';
      activeIndex = i;
      lastOpacity = '';
      lastReadable = false;
    }
    const fade = panelFadeFor(p, i === 0);
    const next = fade.toFixed(3);
    if (next !== lastOpacity) {
      order[i].style.opacity = next;
      lastOpacity = next;
    }
    const readable = fade >= READABLE;
    if (readable !== lastReadable) {
      order[i].classList.toggle('is-readable', readable);
      lastReadable = readable;
    }
  }

  return {
    setActive,
    destroy() {
      railRoot.replaceChildren();
      delete railRoot.dataset.currentSide;
      for (const el of order) {
        el.classList.toggle('is-current', false);
        el.classList.toggle('is-readable', false);
        el.style.opacity = '0';
      }
      activeIndex = -1;
      lastOpacity = '';
      lastReadable = false;
    },
  };
}
