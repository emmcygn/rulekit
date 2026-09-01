// Chapter 07 makes two claims in prose, at the top of src/scenes/07-ai.js:
//
//   A. THE DOOR NEVER OPENS.
//   B. A QUOTE IS NEVER UNTETHERED.
//
// A comment is not a guarantee. These tests are, and they are written to fail
// if either claim stops being true — the door test trips on a leaf rotated by
// as little as a milliradian, and the tether test trips if either end of a
// tether stops tracking the thing it is supposed to be joined to.
//
// Everything here is read back off the built scene graph. No constant is
// copied out of 07-ai.js: the leaves are found by "the meshes in the door
// group wearing the shared accent material", the source line each tether has
// to land on is recovered from the highlighter swarm's own instance matrix,
// and the tether's endpoints are recovered from its own transform. Retuning
// the room's numbers cannot make these tests pass by accident.

import { describe, it, expect, vi } from 'vitest';

// ── the allocation counter, declared before anything imports 'three' ──────
// Counting is the only honest way to prove "allocates nothing" in Node: a heap
// reading cannot tell "allocated nothing" from "allocated and was collected".
// So 'three' is replaced, for this file only, by a namespace whose vector and
// matrix types count their own construction. It sees every `new THREE.x` on
// the frame path, which is the whole way this room could allocate; it cannot
// see a bare {} or [], so it is a floor on the claim, not a ceiling.
//
// Only OUR modules go through this: three's own files import each other by
// relative path, so its internals are untouched and still behave normally.
const allocations = vi.hoisted(() => ({ on: false, n: 0 }));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal();
  const counted = (Base) => class extends Base {
    constructor(...args) { super(...args); if (allocations.on) allocations.n++; }
  };
  return {
    ...actual,
    Vector2: counted(actual.Vector2),
    Vector3: counted(actual.Vector3),
    Vector4: counted(actual.Vector4),
    Quaternion: counted(actual.Quaternion),
    Matrix4: counted(actual.Matrix4),
    Euler: counted(actual.Euler),
    Color: counted(actual.Color),
  };
});

import * as THREE from 'three';
import { createMaterials } from '../src/lib/materials.js';
import { createQuality } from '../src/core/quality.js';
import { CHAPTERS } from '../src/core/chapters.js';
import MOD from '../src/scenes/07-ai.js';

const CHAPTER = CHAPTERS.find((c) => c.id === '07-ai');

// A real sweep, not three spot checks: 0 -> 1 -> 0 at a step of 0.005, so both
// travel directions are covered and every beat boundary is crossed twice. The
// manager can pose a room at any p in any order, so the invariants have to hold
// off a cold p as well as along a scrub.
const STEP = 0.005;
function sweep() {
  const ps = [];
  for (let p = 0; p <= 1 + 1e-9; p += STEP) ps.push(Math.min(p, 1));
  for (let p = 1 - STEP; p >= -1e-9; p -= STEP) ps.push(Math.max(p, 0));
  return ps;
}
const PS = sweep();

function room(portrait, tier = 'high') {
  const materials = createMaterials();
  const ctx = {
    THREE,
    quality: createQuality(tier),
    materials,
    portrait,
    station: new THREE.Vector3(),
    chapter: CHAPTER,
  };
  const g = MOD.build(ctx);
  // The manager parks a room at its station after build(); do the same, so
  // world-space readings are the ones the camera actually sees.
  g.position.set(-2.5, 0.5, -125);
  return { g, ctx, materials };
}

const pose = (g, p, ctx) => { MOD.update(g, p, ctx); g.updateMatrixWorld(true); };

// ── A. the door never opens ───────────────────────────────────────────────
describe('the approval door never opens', () => {
  for (const portrait of [false, true]) {
    for (const tier of ['high', 'low']) {
      const label = `${portrait ? 'portrait' : 'landscape'}/${tier}`;

      it(`holds both leaves at one world pose across p 0 -> 1 -> 0 (${label})`, () => {
        const { g, ctx, materials } = room(portrait, tier);
        const door = g.userData.door;
        // Found by material identity, not by index: the leaves are the only
        // things in this room wearing the shared accent.
        const leaves = door.children.filter((o) => o.isMesh && o.material === materials.accent);
        expect(leaves, 'the door should be two accent leaves').toHaveLength(2);

        const q = leaves.map(() => new THREE.Quaternion());
        const w = leaves.map(() => new THREE.Vector3());
        let ref = null;
        let maxQ = 0;
        let maxP = 0;
        let maxGap = 0;
        let minGap = Infinity;

        for (const p of PS) {
          pose(g, p, ctx);
          for (let i = 0; i < 2; i++) {
            leaves[i].getWorldQuaternion(q[i]);
            leaves[i].getWorldPosition(w[i]);
          }
          const gap = w[0].distanceTo(w[1]);
          if (!ref) {
            ref = {
              q: q.map((x) => x.clone()),
              w: w.map((x) => x.clone()),
            };
          }
          for (let i = 0; i < 2; i++) {
            maxQ = Math.max(maxQ, ref.q[i].angleTo(q[i]));
            maxP = Math.max(maxP, ref.w[i].distanceTo(w[i]));
          }
          maxGap = Math.max(maxGap, gap);
          minGap = Math.min(minGap, gap);
        }

        // A door that opens is a leaf that turns. One milliradian of swing over
        // the whole sweep fails this.
        expect(maxQ, `worst leaf rotation over the sweep (${label})`).toBeLessThan(1e-9);
        expect(maxP, `worst leaf translation over the sweep (${label})`).toBeLessThan(1e-9);
        // ...and a door that slides open is a seam that widens.
        expect(maxGap - minGap, `leaf seam width varied (${label})`).toBeLessThan(1e-9);
      });

      it(`keeps the reviewer's mark on the near side of the leaves, always (${label})`, () => {
        const { g, ctx, materials } = room(portrait, tier);
        const door = g.userData.door;
        const mark = g.userData.mark;
        const leaf = door.children.find((o) => o.isMesh && o.material === materials.accent);

        // The near face of the door, in the door's own frame — read off the
        // leaf's geometry rather than assumed.
        leaf.geometry.computeBoundingBox();
        const face = leaf.position.z + leaf.geometry.boundingBox.max.z;

        let worst = Infinity;
        for (const p of PS) {
          pose(g, p, ctx);
          worst = Math.min(worst, mark.position.z - face);
        }
        // Strictly in front of the door, on every p, in both directions.
        expect(worst, `mark clearance in front of the leaves (${label})`).toBeGreaterThan(0);
      });
    }
  }

  it('never writes the door group itself', () => {
    const { g, ctx } = room(false);
    const door = g.userData.door;
    pose(g, 0, ctx);
    const y = door.rotation.y;
    const pos = door.position.clone();
    const s = door.scale.clone();
    for (const p of PS) {
      pose(g, p, ctx);
      expect(door.rotation.y).toBe(y);
      expect(door.position.equals(pos)).toBe(true);
      expect(door.scale.equals(s)).toBe(true);
    }
  });
});

// ── B. a quote is never untethered ────────────────────────────────────────
// Tolerances, stated up front. The two geometric ones are in TABLE-LOCAL
// units, which is the frame the room is authored in — the table carries a
// per-orientation scale, so a world-space bound would be a different bound in
// portrait than in landscape and would quietly loosen or tighten with a
// staging tweak.
//   CARD_TOL  the card end of a tether must sit within 0.10 of the card's
//             origin — the room hangs it 0.09 below, so this is that plus room
//             for float error and nothing else.
//   LINE_TOL  the note end must sit within 0.02 of the highlighted line's own
//             drawn segment. The room lifts the tether 0.008 off the page face
//             so it does not z-fight the paper; 0.02 covers that and no more.
//   TRACK_TOL both ends must move exactly as much as the things they join.
//             World units, because this one is about motion, not offset.
const CARD_TOL = 0.10;
const LINE_TOL = 0.02;
const TRACK_TOL = 1e-9;

// Distance from a point to a finite segment.
function distToSegment(p, a, b) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const len2 = ab.lengthSq();
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / len2));
  return p.distanceTo(new THREE.Vector3().copy(a).addScaledVector(ab, t));
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

// The highlighted line, recovered from the highlighter swarm rather than from
// any constant: instance i's geometry has its origin on the LEFT edge and runs
// one unit right before scaling, so the drawn stroke is [pos, pos + scale.x].
function barSegment(bars, i, out) {
  bars.mesh.getMatrixAt(i, _m);
  _m.decompose(out.a, _q, _s);
  out.b.copy(out.a).add(new THREE.Vector3(_s.x, 0, 0));
  out.a.applyMatrix4(bars.mesh.matrixWorld);
  out.b.applyMatrix4(bars.mesh.matrixWorld);
  return _s.x;
}

describe('a suggestion is never drawn without its receipt', () => {
  for (const portrait of [false, true]) {
    const label = portrait ? 'portrait' : 'landscape';

    it(`every visible card has a visible tether landing on its own source line (${label})`, () => {
      const { g, ctx } = room(portrait);
      const d = g.userData;
      const n = d.cards.length;
      expect(n).toBe(3);

      // Pass 1: the full extent each highlighter stroke ever reaches. That is
      // the source LINE — a card born mid-highlight is still tethered to a
      // point on the line it is being read from, not to the moving stroke tip.
      const full = new Array(n).fill(0);
      const seg = { a: new THREE.Vector3(), b: new THREE.Vector3() };
      for (const p of PS) {
        pose(g, p, ctx);
        for (let i = 0; i < n; i++) full[i] = Math.max(full[i], barSegment(d.bars, i, seg));
      }
      for (const f of full) expect(f).toBeGreaterThan(0.5);

      let framesAllOut = 0;
      let framesAnyOut = 0;
      let worstCard = 0;
      let worstLine = 0;
      let worstTrack = 0;
      const prev = new Array(n).fill(null);
      const cardEnd = new THREE.Vector3();
      const noteEnd = new THREE.Vector3();
      const cardPos = new THREE.Vector3();
      const notePos = new THREE.Vector3();
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const dir = new THREE.Vector3();
      const cardEndL = new THREE.Vector3();
      const noteEndL = new THREE.Vector3();
      const aL = new THREE.Vector3();
      const bL = new THREE.Vector3();
      const toTable = (src, dst) => d.table.worldToLocal(dst.copy(src));

      for (const p of PS) {
        pose(g, p, ctx);
        d.note.getWorldPosition(notePos);
        let out = 0;
        for (let i = 0; i < n; i++) {
          const card = d.cards[i].group;
          const tether = d.tethers[i];

          // The claim, in its bluntest form.
          expect(tether.visible, `card ${i} visible without its tether at p=${p.toFixed(3)} (${label})`)
            .toBe(card.visible);
          if (!card.visible) { prev[i] = null; continue; }
          out++;

          // The cylinder is 1 unit tall about its own origin and scaled to the
          // tether's length, so its ends are its own local (0, ±0.5, 0). +y is
          // the direction it was built pointing: the card end.
          tether.localToWorld(cardEnd.set(0, 0.5, 0));
          tether.localToWorld(noteEnd.set(0, -0.5, 0));
          card.getWorldPosition(cardPos);

          // ...and the offsets are judged in the table's own frame, where the
          // room's numbers live. `card.position` is already table-local: the
          // card group is a direct child of the table.
          const dCard = toTable(cardEnd, cardEndL).distanceTo(card.position);
          worstCard = Math.max(worstCard, dCard);
          expect(dCard, `tether ${i} lost its card at p=${p.toFixed(3)} (${label})`)
            .toBeLessThanOrEqual(CARD_TOL);

          barSegment(d.bars, i, { a, b });
          toTable(a, aL); toTable(b, bL);
          // Extend the drawn stroke out to the full line: the receipt points at
          // the line, not at however much of it has been swept so far. full[i]
          // is an instance scale, so it is already in this frame.
          dir.subVectors(bL, aL).normalize();
          bL.copy(aL).addScaledVector(dir, full[i]);
          const dLine = distToSegment(toTable(noteEnd, noteEndL), aL, bL);
          worstLine = Math.max(worstLine, dLine);
          expect(dLine, `tether ${i} left its source line at p=${p.toFixed(3)} (${label})`)
            .toBeLessThanOrEqual(LINE_TOL);

          // ...and both ends TRACK. Between two neighbouring frames the note
          // end must move exactly as far as the note did, and the card end
          // exactly as far as the card did. A tether that is animated on its
          // own rather than derived from its two ends fails here even when it
          // happens to look right in a still frame.
          if (prev[i]) {
            const moveNote = noteEnd.distanceTo(prev[i].noteEnd) - notePos.distanceTo(prev[i].notePos);
            const moveCard = cardEnd.distanceTo(prev[i].cardEnd) - cardPos.distanceTo(prev[i].cardPos);
            worstTrack = Math.max(worstTrack, Math.abs(moveNote), Math.abs(moveCard));
            expect(Math.abs(moveNote), `tether ${i} note end drifted off the note at p=${p.toFixed(3)} (${label})`)
              .toBeLessThan(TRACK_TOL);
            expect(Math.abs(moveCard), `tether ${i} card end drifted off the card at p=${p.toFixed(3)} (${label})`)
              .toBeLessThan(TRACK_TOL);
          }
          prev[i] = {
            noteEnd: noteEnd.clone(), cardEnd: cardEnd.clone(),
            notePos: notePos.clone(), cardPos: cardPos.clone(),
          };
        }
        if (out === n) framesAllOut++;
        if (out > 0) framesAnyOut++;
      }

      // Not vacuous: the sweep really did put cards on screen, and really did
      // have all three out at once.
      expect(framesAnyOut).toBeGreaterThan(PS.length * 0.4);
      expect(framesAllOut).toBeGreaterThan(PS.length * 0.3);
      expect(worstCard).toBeLessThanOrEqual(CARD_TOL);
      expect(worstLine).toBeLessThanOrEqual(LINE_TOL);
      expect(worstTrack).toBeLessThan(TRACK_TOL);
    });

    it(`opens with no card and no tether, and closes with all three (${label})`, () => {
      const { g, ctx } = room(portrait);
      const d = g.userData;
      pose(g, 0, ctx);
      for (let i = 0; i < d.cards.length; i++) {
        expect(d.cards[i].group.visible).toBe(false);
        expect(d.tethers[i].visible).toBe(false);
      }
      pose(g, 1, ctx);
      for (let i = 0; i < d.cards.length; i++) {
        expect(d.cards[i].group.visible).toBe(true);
        expect(d.tethers[i].visible).toBe(true);
      }
    });
  }
});

// ── C. update() allocates nothing ─────────────────────────────────────────
describe('update() allocates nothing on the frame path', () => {
  for (const portrait of [false, true]) {
    it(`constructs no vector, matrix or colour across a full sweep (${portrait ? 'portrait' : 'landscape'})`, () => {
      const { g, ctx } = room(portrait);
      MOD.update(g, 0.5, ctx);       // warm any first-call path
      allocations.on = true;
      allocations.n = 0;
      try {
        for (const p of PS) MOD.update(g, p, ctx);
      } finally {
        allocations.on = false;
      }
      expect(allocations.n, `${allocations.n} allocations over ${PS.length} frames`).toBe(0);
    });
  }
});
