// Station manifest for the 3D clinic.
//
// Dual numbering: the array index is the station index (0-10); `num` is
// plain.html's own reader-facing chapter number (01-06), so the rail and the
// panel eyebrows stay continuous with the 2D page.
//
// `vh` values started as plain.html's dwell ratios (its data-steps counts and
// section heights) normalised down to a 1100svh total — the 2D page's literal
// heights sum to ~2530vh, which is far too long once the camera moves
// continuously. Those step counts turned out to be a poor proxy for how much
// there is to READ here: at the old allocation 08-intake spent 219vh per 100
// words of card and 10-close spent 32, a 6.9x spread on the same prose.
//
// So the length is now allocated by reading load, with the two ends of that
// spread pulled in toward the mean. 08-intake's 62 is the FLOOR and not a
// preference: camera travel per frame scales as 1/vh, the widest station gap is
// ~19.4u, and the 2400-frame journey sweep in tests/cameraRig.test.js caps a
// frame at 0.15u — which puts the minimum at 19.4 / 0.15 / 2400 * 1100 ~= 60vh.
// At 55vh that sweep measures 0.1618 and fails. TOTAL_VH stays 1100; anything
// added here has to be taken from somewhere else.
//
// 00-hero IS THE ONE OUTLIER LEFT, and deliberately so. The intro rework took
// its card from 112 words to 246, which is 28.5vh per 100 words — the tightest
// in the piece, tighter than 02-engine ever was. But length is not what ails
// this chapter: its beat map is. MARKS_IN ends at 0.80 and RELEASE starts at
// 0.80, so the three verdict marks reach full size on the exact frame the plate
// begins leaving, and FOOT_IN does not finish until 0.84, by which point the
// marks are running off the top-left corner in portrait (measured off the real
// rig at 390x844). More vh scales that window; it does not open it. Fixing 00
// means retuning 00-hero.js's own beats against a settle key it does not yet
// have, which is a separate piece of work from this one — so it keeps its 70
// and the spread stays honest about where the remaining problem is.

export const CHAPTERS = [
  { id: '00-hero',     num: '00', title: 'Start',                 plain: ['hero'],                                vh:  70 },
  { id: '01-clinical', num: '01', title: 'The clinical side',     plain: ['clinical'],                            vh: 118 },
  { id: '02-engine',   num: '02', title: 'The engine',            plain: ['sw-engine', 'engine', 'engine-notes'], vh:  90 },
  { id: '03-compile',  num: '02', title: 'The sentence compiles', plain: ['p-compile'],                           vh: 100 },
  { id: '04-three',    num: '02', title: 'Three answers',         plain: ['p-three'],                             vh: 108 },
  { id: '05-clash',    num: '02', title: 'The contradiction',     plain: ['clash-intro', 'p-clash'],              vh: 108 },
  { id: '06-chasm',    num: '02', title: 'One calculation',       plain: ['chasm', 'onecalc'],                    vh:  80 },
  { id: '07-ai',       num: '03', title: 'The AI part',           plain: ['sw-ai', 'ai-intro', 'p-ai'],           vh: 128 },
  { id: '08-intake',   num: '04', title: 'Ten charts',            plain: ['intake'],                              vh:  62 },
  { id: '09-build',    num: '05', title: 'What exists, and the build', plain: ['exists', 'build'],                vh: 108 },
  { id: '10-close',    num: '06', title: 'Close',                 plain: ['assembly', 'close'],                   vh: 128 },
];

export const TOTAL_VH = CHAPTERS.reduce((s, c) => s + c.vh, 0);

export function chapterRanges() {
  const out = [];
  let acc = 0;
  for (const c of CHAPTERS) {
    const start = acc / TOTAL_VH;
    acc += c.vh;
    out.push({ id: c.id, start, end: acc / TOTAL_VH });
  }
  return out;
}

const RANGES = chapterRanges();

// Pass `out` (any {index, p} object you own) on per-frame paths so the lookup
// allocates nothing. Called with one argument it allocates a fresh result, so
// one-off callers and tests read the same as before.
export function globalToChapter(g, out) {
  const r0 = out || { index: 0, p: 0 };
  if (g <= 0) {
    r0.index = 0;
    r0.p = 0;
    return r0;
  }
  if (g >= 1) {
    r0.index = CHAPTERS.length - 1;
    r0.p = 1;
    return r0;
  }
  for (let i = 0; i < RANGES.length; i++) {
    const r = RANGES[i];
    if (g < r.end || i === RANGES.length - 1) {
      r0.index = i;
      r0.p = (g - r.start) / (r.end - r.start);
      return r0;
    }
  }
  r0.index = 0;
  r0.p = 0;
  return r0;
}

export function chapterToGlobal(i, p) {
  const r = RANGES[i];
  return r.start + p * (r.end - r.start);
}
