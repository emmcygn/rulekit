// Station manifest for the 3D clinic.
//
// Dual numbering: the array index is the station index (0-10); `num` is
// plain.html's own reader-facing chapter number (01-06), so the rail and the
// panel eyebrows stay continuous with the 2D page.
//
// `vh` values are plain.html's dwell ratios (its data-steps counts and section
// heights) normalised down to a 1100svh total. The 2D page's literal heights
// sum to ~2530vh, which is far too long once the camera moves continuously.

export const CHAPTERS = [
  { id: '00-hero',     num: '00', title: 'Start',                 plain: ['hero'],                                vh:  70 },
  { id: '01-clinical', num: '01', title: 'The clinical side',     plain: ['clinical'],                            vh: 100 },
  { id: '02-engine',   num: '02', title: 'The engine',            plain: ['sw-engine', 'engine', 'engine-notes'], vh:  75 },
  { id: '03-compile',  num: '02', title: 'The sentence compiles', plain: ['p-compile'],                           vh: 135 },
  { id: '04-three',    num: '02', title: 'Three answers',         plain: ['p-three'],                             vh: 120 },
  { id: '05-clash',    num: '02', title: 'The contradiction',     plain: ['clash-intro', 'p-clash'],              vh: 120 },
  { id: '06-chasm',    num: '02', title: 'One calculation',       plain: ['chasm', 'onecalc'],                    vh:  90 },
  { id: '07-ai',       num: '03', title: 'The AI part',           plain: ['sw-ai', 'ai-intro', 'p-ai'],           vh: 145 },
  { id: '08-intake',   num: '04', title: 'Ten charts',            plain: ['intake'],                              vh:  70 },
  { id: '09-build',    num: '05', title: 'What exists, and the build', plain: ['exists', 'build'],                vh: 100 },
  { id: '10-close',    num: '06', title: 'Close',                 plain: ['assembly', 'close'],                   vh:  75 },
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
