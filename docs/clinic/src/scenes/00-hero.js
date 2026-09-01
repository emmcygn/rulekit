// Chapter 00 — "Start". The document you cannot run, and the rules you can.
//
// This room is the whole piece in one picture, the way plain.html's hero figure
// is: a page of law on the left, an arrow, the same rules runnable on the right,
// three answers underneath. It cannot be laid out side by side here — a portrait
// frustum is 31° wide and would show one box or the other — so it is told in
// TIME instead of in space, as three beats along one continuous approach.
//
//   BEAT 0  p 0.00-0.42   THE BURN. The piece opens on the PROBLEM, not on the
//                         document. Out of the white void a cluster of blocks
//                         stacks up, quarter after quarter, each column taller
//                         than the last, and one hatched band settles across
//                         the climb at the share that did not have to be spent.
//                         Two fixed captions stand on the crown of it — "Eroom's
//                         law" over "the cost of one new medicine" — so the
//                         shape is NAMED rather than left as an abstract
//                         skyline. It peaks under the card's own sentence — "the
//                         mistakes turn up after the money is spent" — and then
//                         recedes, captions and all.
//                         NO NUMERALS, NO CURRENCY, NO SOURCE LINE anywhere in
//                         it. The figures and their Tufts label live in chapter
//                         01's panel, where they can be cited; this is the
//                         feeling of the bill, and a figure a room cannot cite
//                         is decoration. The two captions are the exception that
//                         proves it: they are POINTERS, four and three words of
//                         plain.html's own hero paragraph, carrying no number
//                         and no source of their own. The claim they point at
//                         ("new medicines per research dollar have halved
//                         roughly every nine years") and its Scannell et al.
//                         source line are on the card, at every width. The band
//                         is hatched and not coloured for the same reason
//                         01-clinical's is: the avoidable share is a judgement,
//                         and status in this piece is solid, outline or hatch —
//                         never a colour.
//
//   BEAT 1  p 0.18-0.60   THE LAW. The PROTOCOL page RISES out of the bottom of
//                         the frame, through and behind the burn, and takes the
//                         shot off it: the document arrives as the answer to a
//                         cost that is already on screen. It turns 0.06 → 0.26
//                         rad toward the reader and its caption, "the entry
//                         rules, as law", hangs off it. From p ≈ 0.32 the page's
//                         own words let go of the face and spread. Nothing here
//                         is a metaphor for a PDF — it IS a printed page, at the
//                         scale of a wall.
//
//   BEAT 2  p 0.42-0.74   PROSE BECOMES CODE. The loose words do not drift off:
//                         they CONVERGE, into three ranks in front of the page,
//                         and a small bordered plate resolves under them —
//                         "SAME RULES, RUNNABLE" and the trial's three checks,
//                         set in type instead of prose. The swarm fades out as
//                         the printed lines fade in, so the last thing a word
//                         does is turn into the line it became.
//
//   BEAT 3  p 0.68-1.00   THREE ANSWERS. A verdict mark materialises at the end
//                         of each check — ■ pass, □ fail, ▨ don't know — and
//                         "three answers, on purpose" prints beneath them. The
//                         machine is allowed to say I-don't-know in the first
//                         thirty seconds of the story, not in chapter four. The
//                         marks are up and readable from p ≈ 0.74; then the
//                         plate LIFTS AWAY toward station 1 and the camera flies
//                         on through the emptied page.
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
// ── Where the burn sits, and why the page has to arrive from below ────────
// The burn stands at z = -3.5, roughly HALF WAY between the camera's opening
// perch (z = +4.6) and the page (z = -8.2), and off to the +x side the shot is
// already turning toward. Two things fall out of that:
//
//   * it is 8.1u from the camera at p = 0, which is one tenth of a unit past
//     the fog's near plane — so it resolves out of the white rather than being
//     cut into it, and it is fully crisp by the time it peaks.
//   * the page rises BEHIND it, not beside it. 4.7u of separation at a 50°
//     frustum is enough parallax to read as depth on a white ground where
//     there is nothing else to read depth against.
//
// The page cannot simply fade up, because a page that fades up in the same
// place the burn is standing reads as the burn TURNING INTO the page. It
// travels: doc.y starts at DOC.y - PAGE_RISE and climbs over p 0.18-0.32.
// PAGE_RISE is 12.4 because the page has to be entirely OUTSIDE the opening
// frame, in both orientations, and portrait is the binding one: measured on the
// real rig at p = 0, 11.0 still leaves the page's top edge at NDC y -0.91 —
// under the docked card, but the card is frosted, not opaque, and a shape
// behind frosted glass is a shape. 12.4 puts it at -1.06 (portrait) and -1.26
// (landscape), which is off the bottom of the frame and not merely hidden.
//
// The camera does not have to move for any of this. The burn is framed by
// PLACEMENT, per orientation, and cameraKeys is UNTOUCHED — measured against
// the real rig with a projection harness, not eyeballed. NDC, so 2.0 is the
// whole frame; the landscape card docks LEFT out to NDC x -0.12 and the
// portrait card docks across the bottom 46svh, top edge NDC y -0.08:
//
//         landscape 1280x800              portrait 390x844
//   p     burn x span      burn y span    burn x span      burn y span
//   0.00  -0.01 .. +0.58   -0.65 .. +0.32  -0.46 .. +0.59   +0.02 .. +0.51
//   0.05  -0.05 .. +0.61   -0.68 .. +0.33  -0.54 .. +0.61   +0.02 .. +0.53
//   0.12  -0.06 .. +0.63   -0.72 .. +0.35  -0.58 .. +0.63   +0.02 .. +0.56
//   0.20  -0.08 .. +0.73   -0.75 .. +0.53  -0.65 .. +0.76   +0.05 .. +0.69
//   0.25  -0.11 .. +0.77   -0.79 .. +0.54  -0.73 .. +0.82   +0.05 .. +0.72
//
// Those are whole-cluster bounds, and they include the crouch of every block
// that has not landed yet, so they over-state what is actually on screen.
// Three things they have to hold, and do:
//
//   * landscape — the burn's left edge never crosses the card's -0.12 while
//     the burn is at full strength. It comes within 0.01 at p = 0.25, by which
//     point the fade has started and the recede is pulling it back.
//   * landscape — the base never falls out of the bottom of the frame. It sits
//     at -0.79 at its lowest; BURN.L.y is -2.0 and not the -2.4 it was first
//     drawn at, because at -2.4 the front row was cut off by p = 0.25.
//   * portrait — the burn's BOTTOM never drops below +0.02, which is a tenth
//     of NDC clear of the docked card's top edge, at every p in the beat. That
//     is what BURN.P's high base is for; there is no room under a 46svh dock.
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
//   p     dist   plate's left edge   (the card's edge: -0.12)
//   0.60  5.51u  -0.03
//   0.66  4.77u  -0.03
//   0.70  4.23u  -0.01
//   0.74  3.67u  +0.01
//   0.78  3.03u  -0.00
//   0.80  2.67u  -0.02
//
// Then it releases: up and forward along the bearing of station 1. Its bottom
// edge clears the top of the frame by p = 0.90 — at 0.90 the whole plate is at
// NDC y +1.01 and up, two frames after the camera hand-off starts
// (HANDOFF_START = 0.88) — and update() stops drawing it there, which is a
// measured cut and not a pop.
//
// The cost open pushed everything after it back by roughly a twelfth, so the
// release now starts at 0.80 rather than 0.78 and the plate is 2.67u from the
// camera when it does. That is still outside the 2.5u where a 3.2u plate stops
// being a thing you read and starts being a thing you are wearing — but it is
// the LAST beat with room to give, which is why `drift.z` came back from -1.10
// to -0.80 in the same pass, and why the release vectors were scaled by 1.24 so
// the plate still clears the frame in the 0.10 of chapter it has left.
//
// Portrait is a 62°/0.46 frame: 0.555u of width per unit of depth against
// landscape's 1.492. The same plate would fill it twice over, so the portrait
// layout draws one 1.66u wide against landscape's 3.2, and carries it HIGH: the
// card docks across the bottom 46svh, whose top edge is NDC y = -0.081, and
// everything on this plate has to sit above that line. Measured, 390x844:
//
//   p     dist   plate's bottom edge   (the card's edge: -0.081)
//   0.50  7.65u  +0.19
//   0.60  6.02u  +0.23
//   0.70  4.53u  +0.24
//   0.78  3.23u  +0.26
//   0.80  2.87u  +0.28
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

// The burn's own two captions, both lifted from the framing paragraph plain.html
// opens with, word for word: "The climb has a name: Eroom's law... so the cost of
// one new medicine has climbed for sixty years without pause." The name goes on
// top and the thing it names underneath, so the pair reads as a chart's title
// and subtitle rather than as two unrelated labels.
const EROOM_CAP = "Eroom's law";
const CLIMB_CAP = 'the cost of one new medicine';

// The document assembly's home, in station-local space. `z` is the landscape
// value; portrait uses PORTRAIT_Z (see update).
const DOC = { x: 0.9, y: 0.2, z: -8.2 };
const PORTRAIT_Z = -7.0;
const PORTRAIT_DOC_SCALE = 0.72;
const SLAB_W = 4.8, SLAB_H = 6.2, SLAB_D = 0.06;
// How far below its home the page starts. See the header: it is set by the
// bottom of the opening frame at the page's own depth, in both orientations.
const PAGE_RISE = 12.4;

// ── the cost open ─────────────────────────────────────────────────────────
// A cluster of blocks that climbs, quarter after quarter. Authored around its
// own BASE — the group's origin is the floor of the stack — so the per-
// orientation layout can hang it off the bottom of the frame and the recede at
// the end can collapse it toward that same floor with one scale.
//
// One InstancedMesh for every block, because the blocks are plural and the
// budget test refuses a room that loops meshes for a plural thing. The tier
// scales BURN_ROWS, not the column count and not the width: fewer, chunkier
// blocks on a weak machine, with the same silhouette at the same size. A tier
// that shortened the climb would be a tier that told a different story.
const BURN_COLS = 7;                                        // the quarters
const BURN_ROWS = 12;                                       // blocks in the tallest column, at `high`
const BURN_PROFILE = [0.16, 0.26, 0.38, 0.52, 0.68, 0.84, 1.00];
const BURN_W = 4.2;                                         // full width of the cluster
const BURN_H = 4.0;                                         // height of the tallest column
const BURN_BAND_AT = 0.45;                                  // where the hatched share crosses it
const BURN_BAND_H = 0.17;
const BURN_RECEDE_Z = 3.2;                                  // how far it backs off while it goes

const BURN = {
  // x/y are the base of the stack in station-local space; z is shared.
  L: { x: 2.0, y: -2.0, z: -3.5, scale: 1 },
  // Portrait's card docks across the bottom 46svh (NDC y -0.081 at 390x844),
  // so the whole burn has to live ABOVE that line — hence a base high in the
  // world rather than low, and 0.78 scale to keep 4.2u of cluster inside a
  // 31°-wide frustum.
  P: { x: 0.5, y: 0.75, z: -3.5, scale: 0.78 },
};

// The caption pair rides a group parked on the CROWN of the cluster (local y =
// BURN_H), so one scale per orientation moves both of them together and grows
// them upward, away from the blocks, instead of into them. Portrait multiplies
// by 1.45 because the whole burn is already at 0.78 there: 0.30 x 1.45 x 0.78 is
// 0.34 world units of cap height at ~8u of standoff, which is the same share of
// a 62-degree frame as the law caption takes of the page's, and measures 27px on
// a 390x844 phone. Landscape needs no boost — a 50-degree frame at the same
// standoff already prints the name at 32px.
const CAP_SCALE_P = 1.45;
const CAP_NAME_Y = 0.62;     // "Eroom's law", crown-local
const CAP_NAME_H = 0.30;
const CAP_SUB_Y = 0.22;      // "the cost of one new medicine", crown-local
const CAP_SUB_H = 0.22;

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
    drift: [2.05, 0, -0.80],         // leads the camera, and follows its aim
    release: [1.18, 6.95, -5.20],    // up and away, on station 1's bearing
    scale: 1,
    // The law caption goes UNDER the page, where plain.html prints it.
    law: [0, -(SLAB_H / 2 + 0.42), 1],
  },
  P: {
    home: [-0.05, 2.45, 1.30],
    drift: [1.20, 0, -0.90],
    release: [1.36, 6.20, -3.97],
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

// Beat boundaries, in chapter progress. Four of these are load bearing and the
// rest are dressing:
//
//   * BURN_IN has to FINISH before PAGE_IN starts, or the page rises through a
//     cluster that is still assembling and the reader watches two things build
//     at once instead of one thing answering another.
//   * BURN_OUT has to FINISH long before MARKS_IN, which the owner asked for
//     in as many words: by the marks beat the burn is gone. It is, by 0.40.
//   * MARKS_IN has to FINISH where RELEASE begins, or the plate starts leaving
//     before the third mark is on it.
//   * RELEASE cannot begin much past 0.80 — that is 2.67u of standoff, and
//     inside 2.5u the closing camera wears a 3.2u plate as a hat. The open cost
//     the back half a twelfth of the chapter and this is where it came from.
//
// The band lands on the peak, not after it.
// Starts NEGATIVE on purpose: the p=0 landing frame must already show a
// standing partial skyline (a natural page load sits at exactly p=0, and an
// empty white void reads as a broken page). Blocks whose slot offset falls
// before 0 are pre-landed on arrival; the rest climb as the reader scrolls.
const BURN_IN = [-0.12, 0.185];   // per-block; each block gets a slice of this
const BURN_BLOCK = 0.025;         // how long one block takes to land
const BURN_BAND_IN = [0.125, 0.215];
const BURN_OUT = [0.22, 0.40];
const PAGE_IN = [0.18, 0.32];

const PEEL = [0.32, 0.54];
const CONVERGE = [0.42, 0.68];
const CARD_IN = [0.48, 0.68];
const LINES_IN = [0.56, 0.74];
const MARKS_IN = [0.68, 0.80];
const FOOT_IN = [0.72, 0.84];
const DRIFT = [0.48, 0.80];
const RELEASE = [0.80, 1.00];
const LAW_OUT = [0.46, 0.60];

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
  // 21 in fact: the burn (one InstancedMesh for every block, the hatched band,
  // and its two captions = 4), the document (box, printed face, contact shadow,
  // glyph swarm, law caption = 5), the plate (card, ink border, head, three
  // check lines, foot = 7) and the three marks (three bodies plus the two
  // borders = 5). One spare.
  //
  // The triangles are 760 at `high` and the ceiling moves with them: the burn
  // is 46 boxes at 12 triangles each, which is 552 of it, and a declaration
  // that did not move when the room grew a set piece would be a wish. 900 is
  // the honest number with headroom; it was 1200 against a measured 192, and
  // reserving four times what a room spends is its own kind of dishonesty.
  budget: { calls: 22, tris: 900 },

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

    // ── the cost open: a burn that climbs, then goes ──────────────────────
    // The tier buys vertical RESOLUTION, not size: `rows` is how many blocks
    // the tallest column is cut into, and the block geometry is sized from it,
    // so `low` shows the same 4.2 x 4.0 climb in 16 chunky blocks where `high`
    // shows it in 46 fine ones.
    const rows = ctx.quality.count(BURN_ROWS);
    const unit = BURN_H / rows;
    const pitch = BURN_W / BURN_COLS;

    let blockCount = 0;
    for (let c = 0; c < BURN_COLS; c++) blockCount += Math.max(1, Math.round(BURN_PROFILE[c] * rows));

    const burn = new THREE.Group();
    g.add(burn);

    // Owned, because the burn FADES and a shared material cannot. The fade is
    // material opacity and not instance colour for the reason the glyph swarm
    // documents below, only worse: setColorAt multiplies, so fading a bone
    // block toward zero drives it to BLACK, and black on a white void is the
    // most visible this thing has ever been.
    const burnM = cloneOwned(M.bone);
    burnM.transparent = true;
    const blockGeo = new THREE.BoxGeometry(pitch * 0.78, unit * 0.84, pitch * 0.78);
    const blocks = createSwarm({ geometry: blockGeo, material: burnM, count: blockCount });
    burn.add(blocks.mesh);

    // Per-block: [x, slot y, order]. Order is the block's own index over the
    // whole cluster — column-major, bottom-up — so blocks land at a CONSTANT
    // RATE and the fill reads as one thing accruing rather than as seven bars
    // growing at once. Normalising per column instead would give a two-block
    // quarter and a twelve-block quarter the same slice of the timeline, and
    // the tall ones would arrive as a shower.
    const bslot = new Float32Array(blockCount * 3);
    let bi = 0;
    for (let c = 0; c < BURN_COLS; c++) {
      const h = Math.max(1, Math.round(BURN_PROFILE[c] * rows));
      for (let r = 0; r < h; r++) {
        bslot[bi * 3 + 0] = (c - (BURN_COLS - 1) / 2) * pitch;
        bslot[bi * 3 + 1] = (r + 0.5) * unit;
        bslot[bi * 3 + 2] = blockCount > 1 ? bi / (blockCount - 1) : 0;
        bi++;
      }
    }

    // The one hatched band: the share that did not have to be spent. Hatch and
    // not colour, exactly as 01-clinical's is — and with no number on it,
    // because the number belongs in 01's panel with its source line.
    const bandM = cloneOwned(M.hatch);
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(BURN_W + 0.10, BURN_BAND_H, pitch * 0.78 + 0.10),
      bandM,
    );
    band.position.y = BURN_H * BURN_BAND_AT;
    burn.add(band);

    // The captions. Children of `burn`, so they take its placement, its recede
    // and its collapse for free and can never drift off the thing they name;
    // their opacity is driven off the same burnOut the blocks fade on. Both
    // strings are module constants, so makeTextTexture mints exactly two
    // canvases for the life of the page (rule 4 in _stub.js).
    const caps = new THREE.Group();
    caps.position.y = BURN_H;
    burn.add(caps);

    const eroomCap = label(EROOM_CAP, CAP_NAME_H, '#1A1D21', 64);
    eroomCap.position.y = CAP_NAME_Y;
    caps.add(eroomCap);

    const climbCap = label(CLIMB_CAP, CAP_SUB_H, '#5A6169', 64);
    climbCap.position.y = CAP_SUB_Y;
    caps.add(climbCap);

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

    g.userData = {
      doc, sheet, glyphs, seeds, dest, n, lawCap, plate, card, cardMesh, lines, head, marks, bodies, foot,
      burn, blocks, bslot, blockCount, burnM, band, bandM, caps, eroomCap, climbCap,
    };
    return g;
  },

  update(g, p, ctx) {
    const u = g.userData;
    const { doc, sheet, glyphs, seeds, dest, n } = u;
    const portrait = !!(ctx && ctx.portrait);
    const A = portrait ? LAYOUT.P : LAYOUT.L;

    // ── beat 0: the burn ──────────────────────────────────────────────────
    // Placed, not re-keyed. The camera does the same thing it did before this
    // beat existed; the burn is put where the opening frame already looks.
    const B = portrait ? BURN.P : BURN.L;
    const burnOut = smoothstep(sub(p, BURN_OUT[0], BURN_OUT[1]));
    const burn = u.burn;
    // One frame past gone, stop paying two draw calls for it.
    burn.visible = burnOut < 0.999;
    if (burn.visible) {
      // It recedes as it fades — backs off on z and collapses toward its own
      // base — so the closing camera cannot make it LARGER on the way out.
      burn.position.set(B.x, B.y, B.z - BURN_RECEDE_Z * burnOut);
      burn.scale.setScalar(B.scale * (1 - 0.16 * burnOut));
      const alpha = 1 - burnOut;
      u.burnM.opacity = alpha;
      u.bandM.opacity = alpha;

      // The captions live and die with the climb: full strength on the landing
      // frame (a caption that faded IN would leave p = 0 showing an unnamed
      // skyline, which is the exact thing this pass exists to fix), then out on
      // the same scalar as the blocks. `caps` is scaled per orientation here
      // rather than at build time, because the phone can turn at any moment.
      u.caps.scale.setScalar(portrait ? CAP_SCALE_P : 1);
      // Squared, and that is not a second timing. The blocks are bone on white
      // and half of bone is already nearly nothing; the captions are #1A1D21 ink
      // and half of ink is still black. On the same scalar the labels outlive
      // the thing they label and hang over the arriving page. alpha^2 is the
      // same curve, weighted for how much darker the ink starts.
      const capAlpha = alpha * alpha;
      u.eroomCap.material.opacity = capAlpha;
      u.climbCap.material.opacity = capAlpha;

      // Each block gets its own slice of BURN_IN, ordered left to right and
      // bottom-up, and lands from just below its slot.
      const span = (BURN_IN[1] - BURN_IN[0]) - BURN_BLOCK;
      const bslot = u.bslot;
      for (let i = 0; i < u.blockCount; i++) {
        const o = bslot[i * 3 + 2];
        const t = smoothstep(sub(p, BURN_IN[0] + o * span, BURN_IN[0] + o * span + BURN_BLOCK));
        const sy = bslot[i * 3 + 1];
        _v.set(bslot[i * 3 + 0], lerp(sy - 0.30, sy, t), 0);
        u.blocks.setAt(i, _v, Math.max(0.0001, t), 0, 1);
      }
      u.blocks.commit();

      // The band opens out from the middle of the climb and settles across it,
      // the same gesture 01-clinical's avoidable band makes on its own chart.
      const bandT = smoothstep(sub(p, BURN_BAND_IN[0], BURN_BAND_IN[1]));
      u.band.scale.x = Math.max(0.0001, bandT);
      u.band.visible = bandT > 0.004;
    }

    // Portrait's camera never runs as far down the corridor, so the page comes
    // to meet it. Read here rather than in build(), because the phone can turn
    // long after this room exists.
    doc.position.z = portrait ? PORTRAIT_Z : DOC.z;
    // ── beat 1: the page arrives from under the frame ─────────────────────
    // It rises THROUGH the burn rather than fading up in the same place, so the
    // two beats read as a hand-off and not as a transformation.
    doc.position.y = DOC.y - PAGE_RISE * (1 - smoothstep(sub(p, PAGE_IN[0], PAGE_IN[1])));
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
    // pay twelve draw calls for something nobody can see. Half of the release
    // is p = 0.90 exactly, where the plate's BOTTOM edge is already at NDC y
    // 1.09 (landscape) / 1.46 (portrait) — measured, so the cut is not a pop.
    // The threshold moved from 0.62 to 0.50 with the beat map: the release now
    // has 0.10 of chapter rather than 0.12, and A.release was scaled to match,
    // so half of it does what 0.62 of the old one did.
    plate.visible = cardIn > 0.001 && relT < 0.50;
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
