// Chapter 00 — "Start". The document you cannot run, and the rules you can.
//
// This room is the whole piece in one picture, the way plain.html's hero figure
// is: a page of law on the left, an arrow, the same rules runnable on the right,
// three answers underneath. It cannot be laid out side by side here — a portrait
// frustum is 31° wide and would show one box or the other — so it is told in
// TIME instead of in space, as three beats along one continuous approach.
//
//   BEAT 1  p 0.00-0.35   THE LAW. A single huge page hangs in the white and the
//                         camera drifts out of the haze toward it. Its caption,
//                         "the entry rules, as law", hangs under it. From a
//                         fifth of the way in the page's own words let go of the
//                         face and spread. Nothing here is a metaphor for a PDF
//                         — it IS a printed page, at the scale of a wall.
//
//   BEAT 2  p 0.34-0.70   PROSE BECOMES CODE. The loose words do not drift off:
//                         they CONVERGE, into three ranks in front of the page,
//                         and a small bordered plate resolves under them —
//                         "SAME RULES, RUNNABLE" and the trial's three checks,
//                         set in type instead of prose. The swarm fades out as
//                         the printed lines fade in, so the last thing a word
//                         does is turn into the line it became.
//
//   BEAT 3  p 0.62-1.00   THREE ANSWERS. A verdict mark materialises at the end
//                         of each check — ■ pass, □ fail, ▨ don't know — and
//                         "three answers, on purpose" prints beneath them. The
//                         machine is allowed to say I-don't-know in the first
//                         thirty seconds of the story, not in chapter four. The
//                         marks are up and readable from p ≈ 0.70; then, from
//                         0.78, the plate LIFTS AWAY toward station 1 and the
//                         camera flies on through the emptied page.
//
// ── The mark language starts here, and it starts complete ─────────────────
// The three marks are built exactly the way 04-three and 10-close build them —
// one geometry for all three so "identical but for the mark" is true in the
// data, a body each, and a drawn ink border on the two that need one:
//
//   ■ pass       solid ink, no border — the ink IS the mark.
//   □ fail       PAPER body plus an ink border. Not a bare wireframe: a
//                LineSegments alone is one device pixel wide, with white showing
//                through, and reads lighter and emptier than its two siblings.
//   ▨ don't know hatch body plus the same border, so the diagonal stripes are
//                CUT by a square edge instead of fraying off it.
//
// All three arrive on ONE scalar. There is no per-mark offset here and there
// must never be, for the same reason 04-three's three monoliths rise together:
// a "don't know" that arrives late is a "don't know" that has been demoted.
//
// NO ACCENT IN THIS ROOM. #E2582A is one focal element per frame, and it is
// spent in 05 and 07. Putting it on the plate here would place a fourth colour
// beside three marks whose entire job is to be the only status language on the
// page — the reader would have to work out whether orange meant something. Ink,
// paper and hatch carry it, and they carry it in greyscale too.
//
// ── Where the props sit, and why ──────────────────────────────────────────
// Station 0 is the world origin and `cameraT` PARKS the camera on it for the
// whole first half of this chapter (cameraT(0, p) clamps to 0 until p = 0.5),
// then runs it out to roughly (2.3, 0.6, -8.8) by p = 1. So the forward drift of
// the first half has to come from `off` in cameraKeys — which is why 00's
// opening key pulls the camera back to z = +4.6.
//
// The page sits ON the path — (0.9, 0.2, -8.2), which is where the camera ends
// up, not where it starts. It is ~13u out at p = 0 (a third of the way into the
// fog, so it reads as a shape in haze) and the camera goes straight through it
// in the last few percent: you do not stop at the document, you pass through it.
// The x of 0.9 is what makes that pass clean — the flight path drifts to x ≈ 2.3
// by then, and a page centred on x = 0 would show its right EDGE across the
// middle of the frame instead of covering it. Portrait's frustum is half as
// wide, so update() slides the page to z = -7.0 and scales it to 0.72 there.
//
// ── Why the plate has to travel, and to the right ─────────────────────────
// The plate is the thing the reader is meant to READ, and the camera closes 13
// units over this chapter, so a plate parked anywhere fixed is either a postage
// stamp at p = 0.5 or wider than the frame at p = 0.8. It therefore LEADS: it
// forms in front of the page's face and drifts forward and to the right while
// the camera closes and turns. Right, because the aim turns that way — the look
// target runs out to station 1 at x = +3.5 — and because chapter 00's card
// docks on the LEFT at 1280x800, out to NDC x = -0.12. A plate that only drifted
// forward would put its three marks straight behind that card at the exact beat
// they arrive. Measured, landscape 1280x800 (NDC, so 2.0 is the whole frame):
//
//   p     dist   card width   left edge of the top mark   (card's edge: -0.12)
//   0.60  6.44u  0.59         -0.05
//   0.66  5.78u  0.67         +0.09
//   0.70  5.28u  0.73         +0.06
//   0.74  4.70u  0.81         +0.01
//   0.78  4.00u  0.94         -0.07
//
// Then it releases: up and forward along the bearing of station 1. Its bottom
// edge clears the top of the frame by p ≈ 0.90, two frames after the camera
// hand-off starts (HANDOFF_START = 0.88), and update() stops drawing it there.
// Closest approach of camera to plate over the whole chapter is 3.6u, so
// nothing here is flown through — the only thing the camera passes through is
// the page it has finished with.
//
// Portrait is a 62°/0.46 frame: 0.555u of width per unit of depth against
// landscape's 1.492. The same plate would fill it twice over, so the portrait
// layout draws one 1.66u wide against landscape's 3.2, and carries it HIGH: the
// card docks across the bottom 46svh, whose top edge is NDC y = -0.081, and
// everything on this plate has to sit above that line. Measured, 390x844:
//
//   p     dist   card width   card bottom edge   foot caption baseline
//   0.50  8.09u  0.24         +0.28              +0.19
//   0.60  6.54u  0.84         +0.26              +0.23
//   0.70  5.02u  1.13         +0.28              +0.24
//   0.78  3.63u  1.61         +0.33              +0.29
//
// The foot caption is the lowest ink in the room and it never comes within 0.27
// of NDC of the card. Measured, not eyeballed — that is the T22 lesson.
//
// ── One draw call for every word ──────────────────────────────────────────
// The words are one InstancedMesh sharing one glyph atlas, so which cell of the
// atlas an instance shows has to be a per-instance attribute: `aUvRect` holds
// that word's (x, y, w, h) rect and a two-line patch on the stock MeshBasic
// vertex shader rewrites vMapUv from it. Without that patch every quad would
// show the whole atlas at once.

import * as THREE from 'three';
import { createSwarm } from '../lib/instancedSwarm.js';
import { makePageTexture, makeGlyphAtlas, makeTextTexture } from '../lib/textures.js';
import { makeContactShadow } from '../lib/contactShadow.js';
import { cloneOwned } from '../lib/materials.js';
import { sub, smoothstep, lerp } from '../lib/easing.js';

const WORDS = ['participants', 'are', 'required', 'to', 'have', 'an', 'eGFR', 'of', 'at', 'least', '30', 'at', 'screening'];

// Fixed label strings, every one of them lifted from plain.html's hero figure
// word for word. Fixed is the contract (see _stub.js rule 4): makeTextTexture
// memoises by string with no eviction, so a label that varied with p would mint
// a canvas per frame.
const LAW_CAPTION = 'the entry rules, as law';
const PLATE_HEAD = 'SAME RULES, RUNNABLE';
const CHECKS = ['age 18 or older', 'kidney score 30 or more', 'no clashing medicine'];
const PLATE_FOOT = 'three answers, on purpose';

// The document assembly's home, in station-local space. `z` is the landscape
// value; portrait uses PORTRAIT_Z (see update).
const DOC = { x: 0.9, y: 0.2, z: -8.2 };
const PORTRAIT_Z = -7.0;
const PORTRAIT_DOC_SCALE = 0.72;
const SLAB_W = 4.8, SLAB_H = 6.2, SLAB_D = 0.06;

// The printed grid on the page face. Quad aspect matches the atlas cell aspect
// (6px wide by 1.4px tall in makeGlyphAtlas's units) so nothing is stretched.
const COLS = 6;
const QUAD_W = 0.74, QUAD_H = 0.1727;
const COL_GAP = 0.76, ROW_GAP = 0.38;
const TOP_Y = 2.3;
const GLYPH_Z = SLAB_D / 2 + 0.02;
// The printed face sits just proud of the slab's +z plane — far enough not to
// z-fight at this depth range, far enough behind GLYPH_Z that the words still
// float clear of it.
const PAGE_Z = SLAB_D / 2 + 0.004;

// ── the plate ─────────────────────────────────────────────────────────────
// Authored at unit scale, in its own local space, centred on the card. The
// per-orientation layout below only ever moves and scales the whole group, so
// the plate's internal proportions — and therefore how the three checks read
// against their three marks — are identical in both orientations.
const CARD_W = 3.2, CARD_H = 1.9;
const ROW_Y = [0.22, -0.10, -0.42];   // the three check rows
const MARK_X = -1.26;                  // the mark's column, left inset
const TEXT_X = -1.03;                  // where each check line starts
const MARK = 0.20;                     // ■ □ ▨ are this square
const HEAD_Y = 0.70, HEAD_H = 0.115;
const LINE_H = 0.19;
const FOOT_Y = -1.16, FOOT_H = 0.125;
const CARD_Z = 0.02;                   // text and marks stand proud of the card

// Where the plate lives, in the page's own (sheet-local) frame, and what it
// does there. `home` is the forming pose, `drift` the lead it takes while the
// camera closes, `release` the lift-away toward station 1.
//
// `scale` multiplies the doc's own scale, so portrait's 0.72 on a doc already at
// 0.72 is a plate 1.66u wide against landscape's 3.2u — which is what a 31°-wide
// frustum holds with all three checks and all three marks inside it.
//
// The x/y/z are sheet-local because the plate is a child of `sheet`: it rides
// the page's own slight turn rather than hanging square to a page that is not,
// and the words converging on it can therefore address it in the frame they are
// already in, with no matrix work on the frame path. At the plate's standoff
// that inherited turn costs it ~10° of obliquity to the camera — a lean, not a
// skew.
const LAYOUT = {
  L: {
    home: [0.20, 0.55, 1.72],
    drift: [2.05, 0, -1.10],         // leads the camera, and follows its aim
    release: [0.95, 5.60, -4.20],    // up and away, on station 1's bearing
    scale: 1,
    // The law caption goes UNDER the page, where plain.html prints it.
    law: [0, -(SLAB_H / 2 + 0.42), 1],
  },
  P: {
    home: [-0.05, 2.45, 1.30],
    drift: [1.20, 0, -0.90],
    release: [1.10, 5.0, -3.20],
    scale: 0.72,
    // ...and OVER it in portrait, at 1.6 the size. Not a preference: the card
    // docks across the bottom 46svh, and at the portrait page's own framing the
    // space under it is NDC y -0.38 — behind the card, in the clip, where a
    // caption is not a caption. The page's other edge is at +0.28, which a
    // reader can actually read. Same words, same object, the side of it that is
    // on screen.
    law: [0, SLAB_H / 2 + 0.42, 1.6],
  },
};

// Beat boundaries, in chapter progress. Two of these are load bearing and the
// rest are dressing: MARKS_IN has to FINISH where RELEASE begins, or the plate
// starts leaving before the third mark is on it; and RELEASE has to begin by
// 0.78, because that is where the closing camera would otherwise get inside
// 2.5u of a 3.2u plate and wear it as a hat.
const PEEL = [0.20, 0.45];
const CONVERGE = [0.34, 0.62];
const CARD_IN = [0.42, 0.62];
const LINES_IN = [0.52, 0.70];
const MARKS_IN = [0.62, 0.78];
const FOOT_IN = [0.68, 0.84];
const DRIFT = [0.42, 0.78];
const RELEASE = [0.78, 1.00];
const LAW_OUT = [0.38, 0.54];

// makeGlyphAtlas left-aligns each word 0.15/6 of a cell in from its left edge,
// at a mono advance of ~0.6em on a 6em cell. So a short word sits far left of
// its quad unless we shift the instance back by the difference — this is that
// correction, in quad widths.
function inkOffset(word) {
  const f = Math.min(0.95, word.length * 0.1);
  return QUAD_W * (0.025 + f / 2 - 0.5);
}

const _v = new THREE.Vector3();

// One owned text plane. `h` is its height in plate-local units; the width comes
// from the texture's own aspect so nothing is ever stretched.
function label(text, h, color, px) {
  const tex = makeTextTexture(text, { px, color });
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(h * (tex.userData.aspect || 4), h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }),
  );
  return mesh;
}

export default {
  id: '00-hero',
  // 17 in fact: the document (box, printed face, contact shadow, glyph swarm,
  // law caption = 5), the plate (card, ink border, head, three check lines,
  // foot = 7) and the three marks (three bodies plus the two borders = 5). One
  // spare, and the triangle count is the honest ~200 rather than the 6000 this
  // room used to reserve for a set piece it never built.
  budget: { calls: 18, tris: 1200 },

  build(ctx) {
    const g = new THREE.Group();
    const M = ctx.materials;

    // `doc` carries the assembly's placement and the two portrait tweaks update
    // applies. `sheet` is the page's own frame: the slab, the glyphs AND the
    // plate live in it, so a word that has not let go yet swings with the page
    // rather than hanging beside it, and the plate the words become inherits
    // the same turn instead of floating square to a page that is not.
    const doc = new THREE.Group();
    doc.position.set(DOC.x, DOC.y, DOC.z);
    const sheet = new THREE.Group();
    doc.add(sheet);

    // The slab is one bone box and ONE printed plane laid on its +z face — not a
    // six-material box. A material array makes three.js emit one render item per
    // BoxGeometry group, so the six-entry version cost six draw calls to show
    // five identical bone faces. Same silhouette, same face, two calls.
    const slab = new THREE.Mesh(new THREE.BoxGeometry(SLAB_W, SLAB_H, SLAB_D), M.bone);
    sheet.add(slab);

    const pageTex = makePageTexture({ w: 512, h: 660, lines: 22, seed: 7 });
    const page = new THREE.Mesh(
      new THREE.PlaneGeometry(SLAB_W, SLAB_H),
      new THREE.MeshLambertMaterial({ map: pageTex, color: 0xFFFFFF }),
    );
    page.position.z = PAGE_Z;
    sheet.add(page);

    // plain.html prints "the entry rules, as law" under the left-hand box. So
    // does this: the page is not a mystery object, it is named, and the name is
    // what the plate is about to answer.
    const lawCap = label(LAW_CAPTION, 0.34, '#5A6169', 64);
    lawCap.position.z = GLYPH_Z;      // y and scale are per-orientation; see update
    sheet.add(lawCap);

    const shadow = makeContactShadow(M, { radius: 3.2, opacity: 0.16 });
    shadow.position.set(0, -3.2, 0);
    doc.add(shadow);
    g.add(doc);

    // The words peeling off the page — one InstancedMesh, one draw call.
    const n = ctx.quality.count(WORDS.length * 6);
    const atlas = makeGlyphAtlas(WORDS, { px: 72 });
    const glyphGeo = new THREE.PlaneGeometry(QUAD_W, QUAD_H);

    const rects = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const r = atlas.uv.get(WORDS[i % WORDS.length]);
      rects[i * 4 + 0] = r.x;
      rects[i * 4 + 1] = r.y;
      rects[i * 4 + 2] = r.w;
      rects[i * 4 + 3] = r.h;
    }
    glyphGeo.setAttribute('aUvRect', new THREE.InstancedBufferAttribute(rects, 4));

    const glyphMat = new THREE.MeshBasicMaterial({ map: atlas.texture, transparent: true, depthWrite: false });
    glyphMat.onBeforeCompile = (shader) => {
      shader.vertexShader = `attribute vec4 aUvRect;\n${shader.vertexShader}`.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n\t#ifdef USE_MAP\n\tvMapUv = aUvRect.xy + uv * aUvRect.zw;\n\t#endif',
      );
    };
    // Without this the patched program would collide with any other MeshBasic
    // material in the cache that happens to share its feature set.
    glyphMat.customProgramCacheKey = () => 'hero-glyph-uv-rect';

    const glyphs = createSwarm({ geometry: glyphGeo, material: glyphMat, count: n });
    sheet.add(glyphs.mesh);

    // Fixed per-instance seeds, generated once so update() allocates nothing:
    // [start x, start y, release order, drift direction].
    const seeds = new Float32Array(n * 4);
    // ...and where each word ENDS UP: a slot on one of the plate's three rows,
    // in plate-local units. Interleaved (i % 3) rather than blocked, so all
    // three rows fill at the same rate and no line is written last.
    const dest = new Float32Array(n * 2);
    const perRow = Math.max(1, Math.ceil(n / 3));
    for (let i = 0; i < n; i++) {
      const col = i % COLS, row = Math.floor(i / COLS);
      seeds[i * 4 + 0] = (col - (COLS - 1) / 2) * COL_GAP - inkOffset(WORDS[i % WORDS.length]);
      seeds[i * 4 + 1] = TOP_Y - row * ROW_GAP;
      seeds[i * 4 + 2] = ((i * 37) % 100) / 100;
      seeds[i * 4 + 3] = (((i * 61) % 100) / 100 - 0.5) * 2;

      const line = i % 3;
      const slot = Math.floor(i / 3) / Math.max(1, perRow - 1);
      dest[i * 2 + 0] = TEXT_X + 0.06 + slot * 1.86;
      dest[i * 2 + 1] = ROW_Y[line] + (seeds[i * 4 + 3]) * 0.03;
    }

    // ── the plate: the same rules, runnable ───────────────────────────────
    const plate = new THREE.Group();
    plate.visible = false;
    sheet.add(plate);

    // The card group scales in on its own so the marks can arrive later
    // without the whole plate popping a second time.
    const card = new THREE.Group();
    plate.add(card);

    // Brighter than the slab's paper, because the plate stands one and a half
    // units in FRONT of a white page in a white room and the silhouette has to
    // survive that. The ink border is what actually separates them; the whiter
    // body is what stops it looking like a hole cut in the page.
    const cardM = cloneOwned(M.bone);
    cardM.color.setHex(0xFFFFFF);
    const cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    const cardMesh = new THREE.Mesh(cardGeo, cardM);
    card.add(cardMesh);

    // One owned line material for every drawn edge on this plate — the card's
    // own border and the two marks that need one. cloneOwned, never .clone():
    // a plain clone comes back still flagged shared and the manager never frees
    // it. plain.html draws this box at full ink weight while the law page next
    // to it is drawn in grey; so does this.
    const lineM = cloneOwned(M.line);
    lineM.color.setHex(0x1A1D21);
    const cardEdge = new THREE.LineSegments(new THREE.EdgesGeometry(cardGeo), lineM);
    cardEdge.position.z = 0.004;   // off the plane, so the border cannot z-fight it
    cardMesh.add(cardEdge);

    // The head sits over the MARK column, not the text column, so the card has
    // one left margin and not two.
    const head = label(PLATE_HEAD, HEAD_H, '#5A6169', 64);
    head.position.set(MARK_X - MARK / 2 + head.geometry.parameters.width / 2, HEAD_Y, CARD_Z);
    card.add(head);

    const lines = CHECKS.map((text, i) => {
      const m = label(text, LINE_H, '#1A1D21', 64);
      m.position.set(TEXT_X + m.geometry.parameters.width / 2, ROW_Y[i], CARD_Z);
      card.add(m);
      return m;
    });

    // ── the three marks ───────────────────────────────────────────────────
    // ONE geometry for all three, and the border geometry made once from it, so
    // "identical but for the mark" is true in the data and not just in the eye.
    const marks = new THREE.Group();
    marks.visible = false;
    plate.add(marks);

    const markGeo = new THREE.PlaneGeometry(MARK, MARK);
    const markEdge = new THREE.EdgesGeometry(markGeo);
    const bodies = [
      new THREE.Mesh(markGeo, M.ink),     // ■ pass    — the ink IS the mark
      new THREE.Mesh(markGeo, M.bone),    // □ fail    — paper body, ink border
      new THREE.Mesh(markGeo, M.hatch),   // ▨ unknown — hatch body, ink border
    ];
    for (let i = 0; i < 3; i++) {
      const body = bodies[i];
      body.position.set(MARK_X, ROW_Y[i], CARD_Z);
      if (i > 0) {
        const border = new THREE.LineSegments(markEdge, lineM);
        border.position.z = 0.004;
        body.add(border);          // a child, so it scales with the mark exactly
      }
      marks.add(body);
    }

    const foot = label(PLATE_FOOT, FOOT_H, '#5A6169', 64);
    foot.position.set(0, FOOT_Y, CARD_Z);
    plate.add(foot);

    g.userData = { doc, sheet, glyphs, seeds, dest, n, lawCap, plate, card, cardMesh, lines, head, marks, bodies, foot };
    return g;
  },

  update(g, p, ctx) {
    const u = g.userData;
    const { doc, sheet, glyphs, seeds, dest, n } = u;
    const portrait = !!(ctx && ctx.portrait);
    const A = portrait ? LAYOUT.P : LAYOUT.L;

    // Portrait's camera never runs as far down the corridor, so the page comes
    // to meet it. Read here rather than in build(), because the phone can turn
    // long after this room exists.
    doc.position.z = portrait ? PORTRAIT_Z : DOC.z;
    // ...and shrinks, because pulling the portrait camera far enough back to
    // fit a 4.8u page in a 31°-wide frustum would cost more per-frame camera
    // travel over the back half of the chapter than the rig's jump budget
    // allows (tests/cameraRig.test.js, MAX_FRAME_UNITS).
    doc.scale.setScalar(portrait ? PORTRAIT_DOC_SCALE : 1);

    // 0.00-0.45: the page turns very slightly toward the reader as they close.
    sheet.rotation.y = lerp(0.06, 0.26, smoothstep(sub(p, 0, 0.45)));

    // ── the plate's track ─────────────────────────────────────────────────
    const driftT = smoothstep(sub(p, DRIFT[0], DRIFT[1]));
    const relT = smoothstep(sub(p, RELEASE[0], RELEASE[1]));
    const cardIn = smoothstep(sub(p, CARD_IN[0], CARD_IN[1]));
    const marksIn = smoothstep(sub(p, MARKS_IN[0], MARKS_IN[1]));

    const plate = u.plate;
    // Always posed, because the words converging on it read its position even
    // on the frame the manager builds this room at p = 1 and nothing has been
    // walked through in order.
    plate.position.set(
      A.home[0] + A.drift[0] * driftT + A.release[0] * relT,
      A.home[1] + A.drift[1] * driftT + A.release[1] * relT,
      A.home[2] + A.drift[2] * driftT + A.release[2] * relT,
    );
    plate.scale.setScalar(A.scale);
    // Past the top of the frame and still climbing: stop drawing it rather than
    // pay twelve draw calls for something nobody can see. 0.62 of the release is
    // p ≈ 0.905, where the card's BOTTOM edge is already at NDC y 1.16
    // (landscape) / 1.58 (portrait) — measured, so the cut is not a pop.
    plate.visible = cardIn > 0.001 && relT < 0.62;
    if (plate.visible) {
      // The card resolves under the arriving words; the marks come later and on
      // their own scalar, so the plate does not pop twice.
      u.card.scale.setScalar(Math.max(0.0001, cardIn));

      const lineIn = smoothstep(sub(p, LINES_IN[0], LINES_IN[1]));
      u.head.material.opacity = smoothstep(sub(p, CARD_IN[0] + 0.04, CARD_IN[1]));
      for (let i = 0; i < u.lines.length; i++) u.lines[i].material.opacity = lineIn;
      u.foot.material.opacity = smoothstep(sub(p, FOOT_IN[0], FOOT_IN[1]));

      // ALL THREE MARKS ON ONE SCALAR. No per-mark offset, ever: a "don't know"
      // that arrives after its two siblings is a "don't know" that has been
      // quietly demoted, which is the exact failure 04-three exists to refuse.
      u.marks.visible = marksIn > 0.004;
      if (u.marks.visible) {
        for (let i = 0; i < u.bodies.length; i++) u.bodies[i].scale.setScalar(marksIn);
      }
    }

    // The law caption hands over to the plate rather than sitting under it.
    u.lawCap.position.y = A.law[1];
    u.lawCap.scale.setScalar(A.law[2]);
    u.lawCap.material.opacity = 1 - smoothstep(sub(p, LAW_OUT[0], LAW_OUT[1]));

    // ── the words: off the page, then into the lines they became ──────────
    // Two blends per axis, no allocation: the page slot eases out to a free
    // flight pose over PEEL, and that pose eases into the word's slot on the
    // plate over CONVERGE. The lateral spread narrows in portrait so nothing
    // leaves the frame on the way.
    const spread = portrait ? 1.0 : 1.6;
    const px = plate.position.x, py = plate.position.y, pz = plate.position.z;
    const ps = A.scale;
    for (let i = 0; i < n; i++) {
      const rel = seeds[i * 4 + 2];
      const dir = seeds[i * 4 + 3];
      const sx = seeds[i * 4 + 0];
      const sy = seeds[i * 4 + 1];

      const peel = smoothstep(sub(p, PEEL[0] + rel * 0.14, PEEL[1] + rel * 0.14));
      const conv = smoothstep(sub(p, CONVERGE[0] + rel * 0.10, CONVERGE[1] + rel * 0.10));

      const fx = sx + dir * spread;
      const fy = sy + (0.25 + rel * 0.9);
      const fz = GLYPH_Z + (0.9 + rel * 1.9);

      _v.set(
        lerp(lerp(sx, fx, peel), px + dest[i * 2 + 0] * ps, conv),
        lerp(lerp(sy, fy, peel), py + dest[i * 2 + 1] * ps, conv),
        lerp(lerp(GLYPH_Z, fz, peel), pz + (CARD_Z + 0.05) * ps, conv),
      );
      // A word shrinks to the size of the line it is turning into and then
      // closes to nothing under it: the last thing a word does is become type.
      //
      // The vanish is SCALE and not instance colour. setColorAt multiplies the
      // material colour, and this atlas is drawn in #1A1D21 ink, so fading a
      // glyph by colour would drive it toward BLACK on a white page instead of
      // away — the same trap 04-three's cube stream documents.
      const shrink = lerp(1, 0.62 * ps, conv) * (1 - smoothstep(sub(conv, 0.68, 1)));
      glyphs.setAt(i, _v, shrink, dir * 0.18 * peel * (1 - conv), 1);
    }
    glyphs.commit();
  },
};
