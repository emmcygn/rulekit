// Chapter 08 — "Ten charts". Ten synthetic charts fly out of the fog, form a
// ring the camera flies through, get read one by one, and leave.
//
// THE COUNT IS THE CLAIM, SO THE COUNT IS NEVER SCALED.
//
// #intake says: "ten synthetic charts arriving. seven fail a rule, three need a
// human, none get in." Every number in that sentence is a thing you can count
// on screen, so none of them go through ctx.quality.count(). Ten cards is ten
// cards on a phone at `low` too; thinning them would make the picture lie about
// the one scene whose whole content is an arithmetic claim. Tier scaling here
// only ever touches how finely the cards are DECORATED, never how many exist —
// and in this room it touches nothing at all, because ten planes are free.
//
// THE MARKS ARE 04-three's MARKS, AND THERE IS NO SOLID ONE.
//
//   fail    □  outline  — a drawn ink box, nothing inside        ×7
//   unknown ▨  hatched  — the same box, hatched inside           ×3
//   pass    ■  solid                                             ×0
//
// One box, drawn on all ten; what differs is what is inside it, exactly as the
// glyphs themselves differ. A hatched patch with no border reads as a smudge at
// the twenty screen pixels this mark gets at the counting beat.
//
// The absence is the point: "none get in" is rendered as ten cards where the
// solid mark never once appears. No colour carries any of it — no red, no
// green, no accent. Greyscale the frame and the tally is still 7 / 3 / 0,
// because outline / hatch / solid is a difference in ink, not in hue. (The
// accent belongs to chapters 05 and 07; this room does not spend it.)
//
// EVERY CARD SAYS `synthetic` IN THE GL SCENE, not only in the HTML panel.
// This is the one room where a viewer could mistake the objects for patient
// records, so the disclosure is on the object, in ink, at full contrast, on all
// ten — sized to stay legible in a 31°-wide portrait frustum at the wide beat
// and much larger than that as the camera closes.
//
// TWO BEATS:
//   p 0.04-0.42  the ten arrive out of the fog and close into the ring
//   p 0.24-0.55  each card is stamped with the mark it earned, in ring order
//   p 0.72-1.00  the ring opens and every card leaves. The middle stays empty,
//                and the camera flies through the hole none of them got through.
//
// Contract notes (see ./_stub.js):
//   • the only cloned shared material is one cloneOwned(materials.line);
//   • four InstancedMeshes and one merged LineSegments — five draw calls for
//     ten independently animated cards;
//   • one fixed label string, so the memoised text cache stays bounded;
//   • ctx.portrait is read in update() only — it tightens the ring and the card
//     size to fit the narrow frustum, equally for all ten;
//   • update() allocates nothing: module scratch plus typed arrays made once.

import * as THREE from 'three';
import { createSwarm } from '../lib/instancedSwarm.js';
import { makeTextTexture } from '../lib/textures.js';
import { cloneOwned } from '../lib/materials.js';
import { sub, smoothstep, lerp } from '../lib/easing.js';

const CHARTS = 10;                 // never scaled by tier: the count IS the claim
// Which card carries which mark. Seven zeros, three ones, nothing else — the
// tally is a literal here so it cannot drift away from the copy. The three
// "needs a human" cards are spread around the ring rather than blocked at the
// end: a human review is not a leftover bucket, and clumping them would read as
// one.
const KIND = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0];   // 0 = fail □, 1 = unknown ▨

// The ring: a wheel standing across the flight path, ~11u ahead of the station,
// so the camera meets it face on and every card is exactly the same distance
// away. No card is nearer, larger, earlier or better lit than another.
const RING_Y = 0.45;
const RING_Z = -11.0;
// Ten cards on a circle sit 36° apart, so the gap between neighbours is the
// chord 2·R·sin(π/10) = 0.618·R, and at three and nine o'clock that gap is
// vertical — it is the card's HEIGHT, not its width, that decides whether the
// wheel packs without corners overlapping. 0.618·R must clear 1.50·scale:
// landscape 1.885 against 1.50, portrait 1.434 against 1.29.
const R_HOLD = 3.05;       // landscape radius once assembled
const R_HOLD_P = 2.32;     // portrait: the same wheel inside a 31°-wide frustum
const R_FAR = 9.0;         // where they come from
const R_OUT = 7.9;         // where they go
const Z_FAR = -17.0;       // 26u from the opening camera — the fog's far edge
const SPIN = 0.7;          // radians of orbit over the whole chapter

const CARD_W = 1.30, CARD_H = 1.50;
const HW = CARD_W / 2, HH = CARD_H / 2;
const CARD_SCALE_P = 0.86;         // portrait cards, so ten still fit side by side

// The mark sits top-left; the disclosure runs along the bottom edge.
const MX = -0.42, MY = 0.52, MH = 0.13;
const TAG_H = 0.20, TAG_Y = -0.55;
const LINE_DZ = 0.012, TICK_DZ = 0.008, TAG_DZ = 0.010, HATCH_DZ = 0.010;

// The record itself: four rows of fields, some fuller than others. Abstract on
// purpose — a chart that looked like a real chart would be exactly the thing
// this room is labelled against.
const TICK_ROWS = 4, TICK_COLS = 5;
const TICKS_PER_CARD = TICK_ROWS * TICK_COLS;
const TICK_X0 = -0.31, TICK_DX = 0.155;
const TICK_Y = [0.20, 0.04, -0.12, -0.28];
const FILL = [
  [5, 3, 4, 2], [4, 5, 2, 3], [3, 4, 5, 4], [5, 2, 3, 5], [2, 5, 4, 3],
  [4, 3, 5, 2], [5, 4, 2, 4], [3, 5, 3, 5], [4, 2, 5, 3], [5, 3, 4, 4],
];

// Stamping: one card at a time, in ring order, so the tally can be counted as
// it is made rather than appearing all at once as a fait accompli.
const STAMP_FROM = 0.24, STAMP_STEP = 0.025, STAMP_DUR = 0.085;

// Two endpoints per segment: the card's own rectangle, then the outline mark.
// Written once here, rewritten into world positions every frame.
const SEGS = 8;
const VERTS = SEGS * 2;
const BASE = new Float32Array([
  -HW, -HH, HW, -HH,
  HW, -HH, HW, HH,
  HW, HH, -HW, HH,
  -HW, HH, -HW, -HH,
  MX - MH, MY - MH, MX + MH, MY - MH,
  MX + MH, MY - MH, MX + MH, MY + MH,
  MX + MH, MY + MH, MX - MH, MY + MH,
  MX - MH, MY + MH, MX - MH, MY - MH,
]);
const MARK_FROM = 8;               // vertex index where the mark square starts

const TAU = Math.PI * 2;
const _v = new THREE.Vector3();

export default {
  id: '08-intake',
  budget: { calls: 8, tris: 2000 },

  build(ctx) {
    const g = new THREE.Group();
    const M = ctx.materials;

    // One owned line material for every drawn edge in the room: the ten card
    // rectangles and the ten mark boxes. cloneOwned, never .clone() — a
    // plain clone comes back still flagged shared and is never freed.
    const lineMat = cloneOwned(M.line);
    lineMat.color.setHex(0x1A1D21);

    // ── the ten cards ─────────────────────────────────────────────────────
    // Paper faces, one draw call. Bone rather than glass: 16% white on a white
    // room is nothing, and a chart that does not occlude does not read as an
    // object at all.
    const faces = createSwarm({
      geometry: new THREE.PlaneGeometry(CARD_W, CARD_H),
      material: M.bone,
      count: CHARTS,
    });
    g.add(faces.mesh);

    // The fields on those faces: 200 small data-blue ticks, one draw call.
    const ticks = createSwarm({
      geometry: new THREE.PlaneGeometry(0.10, 0.075),
      material: M.data,
      count: CHARTS * TICKS_PER_CARD,
    });
    g.add(ticks.mesh);

    // The fill inside three of the ten mark boxes, one draw call. Every card
    // gets the same drawn square (below); on these three it is hatched inside
    // and on the other seven it is left empty. That is the difference between
    // the glyphs themselves — □ and ▨ are the same box, one filled — and it
    // survives at 20 screen pixels far better than a hatched patch with no
    // border, which just reads as a smudge. Sized inside the box so the ink
    // border stays crisp on top of it.
    const hatch = createSwarm({
      geometry: new THREE.PlaneGeometry(MH * 1.8, MH * 1.8),
      material: M.hatch,
      count: 3,
    });
    g.add(hatch.mesh);

    // `synthetic`, ten times, one draw call. One string, so one cached texture;
    // the material is this room's own (new, not a clone) and the texture behind
    // it belongs to the module cache and outlives the room.
    const tagTex = makeTextTexture('synthetic', { px: 64, color: '#1A1D21' });
    const tagMat = new THREE.MeshBasicMaterial({ map: tagTex, transparent: true, depthWrite: false });
    const tags = createSwarm({
      geometry: new THREE.PlaneGeometry(TAG_H * (tagTex.userData.aspect || 4.2), TAG_H),
      material: tagMat,
      count: CHARTS,
    });
    g.add(tags.mesh);

    // ── every drawn edge, in one buffer ───────────────────────────────────
    // Ten cards move independently, so ten LineSegments objects is the obvious
    // build — and ten draw calls, plus seven more for the marks. Instead one
    // buffer holds all 160 endpoints and update() rewrites them from the same
    // card positions everything else is placed from: 17 draw calls become 1,
    // and the cards still move, scale and stamp one at a time.
    const lineGeo = new THREE.BufferGeometry();
    const pos = new THREE.Float32BufferAttribute(new Float32Array(CHARTS * VERTS * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    lineGeo.setAttribute('position', pos);
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    lines.frustumCulled = false;    // the buffer's bounds change every frame
    g.add(lines);

    // Which hatch instance belongs to which card, and the tick fill pattern,
    // both resolved once so update() only reads.
    const hatchSlot = new Int8Array(CHARTS).fill(-1);
    let slot = 0;
    for (let i = 0; i < CHARTS; i++) if (KIND[i] === 1) hatchSlot[i] = slot++;
    const fill = new Uint8Array(CHARTS * TICK_ROWS);
    for (let i = 0; i < CHARTS; i++) {
      for (let r = 0; r < TICK_ROWS; r++) fill[i * TICK_ROWS + r] = FILL[i][r];
    }

    g.userData = { faces, ticks, hatch, tags, lines, pos, hatchSlot, fill };
    return g;
  },

  update(g, p, ctx) {
    const u = g.userData;
    const portrait = !!(ctx && ctx.portrait);
    const rHold = portrait ? R_HOLD_P : R_HOLD;
    const cardScale = portrait ? CARD_SCALE_P : 1;
    const arr = u.pos.array;

    // Arrive, then leave. Both are one scalar for all ten: no card is admitted
    // early, held back, or let through the middle.
    const arrive = smoothstep(sub(p, 0.04, 0.42));
    const leave = smoothstep(sub(p, 0.72, 1));
    const r = lerp(lerp(R_FAR, rHold, arrive), R_OUT, leave);
    const cz = lerp(Z_FAR, RING_Z, arrive);
    const s = lerp(0.30, cardScale, arrive) * (1 - leave);
    const spin = p * SPIN;

    for (let i = 0; i < CHARTS; i++) {
      // Clockwise from twelve o'clock, so the stamping order is the order you
      // would count them in. The cards revolve; they never roll — a card upside
      // down at the bottom of the wheel is a card whose label cannot be read.
      const ang = Math.PI / 2 - (i / CHARTS) * TAU + spin;
      const cx = Math.cos(ang) * r;
      const cy = RING_Y + Math.sin(ang) * r;

      const stamp = smoothstep(sub(p, STAMP_FROM + i * STAMP_STEP, STAMP_FROM + i * STAMP_STEP + STAMP_DUR));

      _v.set(cx, cy, cz);
      u.faces.setAt(i, _v, s, 0, 1);

      _v.set(cx, cy + TAG_Y * s, cz + TAG_DZ);
      u.tags.setAt(i, _v, s, 0, 1);

      // ▨ for the three. The hatch fill rides the same stamp scalar the drawn
      // box does, so both marks are made the same way, at the same moment, out
      // of the same box.
      const hs = u.hatchSlot[i];
      if (hs >= 0) {
        _v.set(cx + MX * s, cy + MY * s, cz + HATCH_DZ);
        u.hatch.setAt(hs, _v, s * stamp, 0, 1);
      }

      // The record's fields.
      for (let row = 0; row < TICK_ROWS; row++) {
        const on = u.fill[i * TICK_ROWS + row];
        for (let col = 0; col < TICK_COLS; col++) {
          const t = i * TICKS_PER_CARD + row * TICK_COLS + col;
          if (col >= on) { _v.set(cx, cy, cz); u.ticks.setAt(t, _v, 0, 0, 1); continue; }
          _v.set(cx + (TICK_X0 + col * TICK_DX) * s, cy + TICK_Y[row] * s, cz + TICK_DZ);
          u.ticks.setAt(t, _v, s, 0, 1);
        }
      }

      // The card's rectangle, then its mark box. The box's four segments grow
      // out of the box's own centre on `stamp`, on all ten cards — what the
      // three hatched ones get is the fill inside it, not a different mark.
      const mark = stamp;
      const base = i * VERTS * 3;
      for (let v = 0; v < VERTS; v++) {
        let bx = BASE[v * 2];
        let by = BASE[v * 2 + 1];
        if (v >= MARK_FROM) {
          bx = MX + mark * (bx - MX);
          by = MY + mark * (by - MY);
        }
        const o = base + v * 3;
        arr[o] = cx + bx * s;
        arr[o + 1] = cy + by * s;
        arr[o + 2] = cz + LINE_DZ;
      }
    }

    u.faces.commit();
    u.ticks.commit();
    u.hatch.commit();
    u.tags.commit();
    u.pos.needsUpdate = true;
  },
};
