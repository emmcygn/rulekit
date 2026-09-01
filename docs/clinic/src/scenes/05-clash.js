// Chapter 05 — "The contradiction".
//
// Two clauses written pages apart, by different authors, drawn as two large
// translucent walls standing on one kidney-score number line. Rule 1 covers
// everything from 30 upward; rule 2 covers everything below 45. They slide
// together, cross, and where they cross there is a slab of scores that one
// clause admits and the other bars: [30, 45). No legal value exists in it.
//
// THE SEAM IS THE ONE ACCENTED OBJECT IN THIS ROOM, AND IN THIS STRETCH OF THE
// PIECE. #E2582A appears exactly twice here — on the slab standing in the
// overlap, and on the interval that names it — and those two are the same
// focal element said twice. Everything else is paper, ink, rule grey and the
// one data blue of the candidate values. No status colour: nothing in this room
// is red for bad or green for good, because the point is not that a patient
// failed, it is that the statute cannot answer.
//
// GEOMETRY IS PLACED WHERE THE CAMERA CAN SEE IT, WHICH IS NOT WHERE THE
// STATION IS. cameraKeys '05-clash' flies the camera from 9u BEHIND this
// station to 9u PAST it, and at p = 0.56 it passes within 1.21u of the station
// origin (0.97u at p = 0.59 in portrait — measured off the real rig, handoff
// blend included). Nothing solid may live near the origin. The whole
// composition therefore hangs at z ≈ -11.6, which is 20u out through the fog at
// p = 0, ~12u and readable at p = 0.5, and still 2.59u AHEAD of the camera when
// the chapter hands off (4.39u in portrait, which hangs further back). The glass
// fades over the last tenth so the walls never smear across the near plane on
// the way past.
//
// THE WORDING LEAVES BEFORE THE FRAME EDGE REACHES IT. The camera swings +1.35
// on x over the back of the chapter and then whips toward station 6, which drags
// the left of the composition off frame: rule 2's caption crosses the left edge
// at p = 0.85 landscape and p = 0.81 portrait, and the interval label drops
// through the bottom edge at p ≈ 0.86. A caption cut mid-word is a broken exit,
// so all four clause captions are fully faded by p = 0.80 and the label by
// p = 0.855 — before the edge gets to any of them, in either orientation.
//
// Contract notes (see ./_stub.js): authored in station-local space, nothing
// offset by ctx.station; build() never branches on ctx.portrait — both
// orientations are laid out here and update() picks one; every string handed to
// makeTextTexture is fixed for the life of the page; the only cloned shared
// materials are one glass (both walls share it) and one accent (the seam), both
// through cloneOwned; update() allocates nothing.

import * as THREE from 'three';
import { createSwarm } from '../lib/instancedSwarm.js';
import { makeTextTexture } from '../lib/textures.js';
import { cloneOwned } from '../lib/materials.js';
import { sub, smoothstep, lerp, clamp01 } from '../lib/easing.js';

// ── the number line ───────────────────────────────────────────────────────
// One kidney-score point is UNIT world units wide, and the score parked at
// x = 0 is the middle of the contested interval, so the band the two clauses
// disagree about is centred in frame and the seam grows out of the origin of
// the composition rather than off to one side.
const UNIT = 0.10;
const V_MID = 37.5;
const V_LO = 30, V_HI = 45;
const ROD_Y = -1.48, ROD_R = 0.028;
const NUM_Y = -1.80;
const BAND_Y = -2.10;

// ── the two walls ─────────────────────────────────────────────────────────
// Each is one PlaneGeometry(1,1) scaled to width, so both share a geometry.
// They start OPEN units out and TH_OPEN radians splayed, and close to a
// TH_SHUT dihedral — shallow enough that the crossing reads as an intersection
// rather than as an X seen edge-on.
const WALL_W = 5.6, WALL_H = 2.9, WALL_Y = 0.32;
const OPEN = 4.6;
const TH_OPEN = 0.44, TH_SHUT = 0.13;
const GLASS_OP = 0.22;
const SEAM_D = 0.20;

// Candidate kidney scores, walked along the line. plain.html's own claim is
// that the checker proves the clash "for every possible patient", so the room
// shows a spread of values rather than one patient: the ones that land inside
// [30, 45) lift off the line and stall inside the seam with no answer to go to.
const CAND = 28;
const CAND_LO = 3, CAND_HI = 77;

const T_RULE_1 = 'eGFR at least 30';
const S_RULE_1 = 'rule 1 · lets in';
const T_RULE_2 = 'eGFR below 45 at screening';
const S_RULE_2 = 'rule 2 · turns away';
const BAND_LABEL = '[30, 45)';

// Both orientations, laid out at build time and chosen in update(). Portrait is
// ~31° wide against landscape's ~73°, so it narrows the SCORE AXIS (sx) rather
// than shrinking the walls' height or pulling the camera back — the interval
// stays exactly [30, 45) of a narrower line, and the two rule captions stack
// above the composition instead of sitting over their own walls, where a
// 26-character clause would run straight off a 390px frame.
const L = {
  sx: 1.00, z: -11.60,
  t1: [2.05, 2.30], s1: [2.05, 2.04],
  t2: [-2.05, 2.30], s2: [-2.05, 2.04],
};
const P = {
  sx: 0.62, z: -12.20,
  t1: [0, 2.92], s1: [0, 2.68],
  t2: [0, 2.36], s2: [0, 2.12],
};

const _v = new THREE.Vector3();

function textMesh(text, height, color) {
  const tex = makeTextTexture(text, { px: 72, color });
  const w = height * (tex.userData.aspect || 4);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, height),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.userData.w = w;
  return m;
}

export default {
  id: '05-clash',
  budget: { calls: 18, tris: 1200 },

  build(ctx) {
    const g = new THREE.Group();
    const M = ctx.materials;

    // ── the two clauses ───────────────────────────────────────────────────
    // One owned glass material for both walls: they are the same kind of thing
    // and they dim together at the hand-off, so one colour/opacity write per
    // frame covers both. cloneOwned, never .clone() — a plain clone comes back
    // still flagged shared and the manager would never free it.
    const glass = cloneOwned(M.glass);
    glass.opacity = GLASS_OP;
    const wallGeo = new THREE.PlaneGeometry(1, 1);
    const wallA = new THREE.Mesh(wallGeo, glass);
    const wallB = new THREE.Mesh(wallGeo, glass);
    g.add(wallA, wallB);

    // Each wall carries its own drawn border, and it is not decoration: 22%
    // white glass against a white room and white fog is very nearly nothing,
    // so without an edge the two clauses are invisible until they overlap and
    // the whole first half of the chapter plays out on an empty screen. The
    // border is a CHILD of the wall, so it inherits the slide, the turn and
    // the non-uniform scale exactly — there is no second set of numbers to
    // keep in step.
    const edgeMat = cloneOwned(M.line);
    edgeMat.color.setHex(0x8E979F);
    edgeMat.transparent = true;
    const edgeGeo = new THREE.EdgesGeometry(wallGeo);
    wallA.add(new THREE.LineSegments(edgeGeo, edgeMat));
    wallB.add(new THREE.LineSegments(edgeGeo, edgeMat));

    // ── the seam ──────────────────────────────────────────────────────────
    // The single accented object. Its width is exactly V_HI - V_LO score
    // points, so it is not a highlight drawn over the collision — it IS the
    // interval, measured on the same line as everything else.
    const seamMat = cloneOwned(M.accent);
    seamMat.transparent = true;
    seamMat.opacity = 0;
    seamMat.depthWrite = false;
    const seam = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), seamMat);
    seam.renderOrder = 1;
    g.add(seam);

    // ── the line the two clauses are drawn on ─────────────────────────────
    const barGeo = new THREE.BoxGeometry(1, 1, 1);
    const rod = new THREE.Mesh(barGeo, M.ink);
    const tickLo = new THREE.Mesh(barGeo, M.ink);
    const tickHi = new THREE.Mesh(barGeo, M.ink);
    g.add(rod, tickLo, tickHi);

    const numLo = textMesh('30', 0.16, '#1A1D21');
    const numHi = textMesh('45', 0.16, '#1A1D21');
    g.add(numLo, numHi);

    // ── the wording, verbatim from the protocol ───────────────────────────
    const t1 = textMesh(T_RULE_1, 0.24, '#1A1D21');
    const s1 = textMesh(S_RULE_1, 0.135, '#858D95');
    const t2 = textMesh(T_RULE_2, 0.24, '#1A1D21');
    const s2 = textMesh(S_RULE_2, 0.135, '#858D95');
    const band = textMesh(BAND_LABEL, 0.30, '#E2582A');
    band.material.opacity = 0;
    g.add(t1, s1, t2, s2, band);

    // ── every possible patient ────────────────────────────────────────────
    const n = ctx.quality.count(CAND);
    const cand = createSwarm({
      geometry: new THREE.BoxGeometry(0.09, 0.09, 0.09),
      material: M.data,
      count: n,
    });
    g.add(cand.mesh);

    const score = new Float32Array(n);
    const stuck = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = lerp(CAND_LO, CAND_HI, n === 1 ? 0.5 : i / (n - 1));
      score[i] = v;
      stuck[i] = v >= V_LO && v < V_HI ? 1 : 0;
    }

    Object.assign(g.userData, {
      L, P, glass, edgeMat, seam, seamMat, wallA, wallB,
      rod, tickLo, tickHi, numLo, numHi,
      t1, s1, t2, s2, band, cand, score, stuck, n,
    });
    return g;
  },

  update(g, p, ctx) {
    const d = g.userData;
    const A = (ctx && ctx.portrait) ? d.P : d.L;
    const sx = A.sx;
    const z0 = A.z;

    // 0.06-0.40  the two clauses, pages apart, slide together
    // 0.42-0.64  the overlap lights up
    // 0.46-0.60  the interval is named
    // 0.60-0.68  the wording hands over to the interval it made
    // 0.74-0.80  the label goes before the bottom edge reaches it
    // 0.90-1.00  the glass steps back before the camera passes it
    //
    // THE LABEL OUTLIVES THE GLOW ON PURPOSE. It used to start leaving at 0.78,
    // two hundredths after the glow finished at 0.76 — fully-lit-and-named was
    // 20px of scroll, and the interval is the thing this chapter is about. It
    // now stands at full opacity from 0.60 to 0.74, which is 2.3x as long and
    // reaches into the camera's hold (settle 0.70 -> twin 0.88) rather than
    // ending before the shot that frames it arrives.
    //
    // IT CANNOT SURVIVE THE WHOLE HOLD, and 0.80 is where the frame stops it.
    // Across the hold `off` unwinds to the seam value, which drops the eye 0.4u
    // while the aim stays frozen — so the composition rides UP the frame and the
    // label, which hangs below the rod, sinks out of the bottom. Measured on the
    // real rig at fov 50 / aspect 1.6: the label's underside crosses ndc.y = -1
    // at p = 0.843 (screen y 0.994 at 0.84, 1.004 at 0.845) and is a third of
    // its own height below the edge by p = 0.88. Fading to 0.80 puts it at 0.007
    // opacity by p = 0.797, clear of the edge by 0.046 of p — where the old
    // 0.855 fade ran 0.012 PAST it, at opacity, off the bottom of the frame.
    const close = smoothstep(sub(p, 0.06, 0.40));
    const glow = smoothstep(sub(p, 0.42, 0.64));
    const named = smoothstep(sub(p, 0.46, 0.60)) * (1 - smoothstep(sub(p, 0.74, 0.80)));
    const said = 1 - smoothstep(sub(p, 0.60, 0.68));
    const leave = smoothstep(sub(p, 0.90, 1.00));

    const th = lerp(TH_OPEN, TH_SHUT, close);
    const half = (WALL_W / 2) * sx * Math.cos(th);
    const xLo = (V_LO - V_MID) * UNIT * sx;      // where "at least 30" starts
    const xHi = (V_HI - V_MID) * UNIT * sx;      // where "below 45" stops
    // Closed, rule 1's left edge sits exactly on 30 and rule 2's right edge
    // exactly on 45, so the walls are the clauses and not an illustration of
    // them. Their surfaces then cross at x = 0 by construction.
    const shutA = xLo + half;
    const shutB = xHi - half;
    const cxA = lerp(shutA + OPEN, shutA, close);
    const cxB = lerp(shutB - OPEN, shutB, close);
    const seamZ = z0 + shutA * Math.tan(th);

    d.wallA.position.set(cxA, WALL_Y, z0);
    d.wallA.rotation.y = th;
    d.wallA.scale.set(WALL_W * sx, WALL_H, 1);
    d.wallB.position.set(cxB, WALL_Y, z0);
    d.wallB.rotation.y = -th;
    d.wallB.scale.set(WALL_W * sx, WALL_H, 1);
    d.glass.opacity = GLASS_OP * (1 - 0.78 * leave);
    d.edgeMat.opacity = 1 - 0.85 * leave;

    // The seam grows out of the line rather than fading in on the spot: it is
    // a thing the two clauses made, so it has to arrive from between them.
    const h = Math.max(0.001, glow);
    d.seam.position.set(0, WALL_Y - (WALL_H / 2) * (1 - h), seamZ);
    d.seam.scale.set((V_HI - V_LO) * UNIT * sx, WALL_H * h, SEAM_D);
    d.seamMat.opacity = 0.56 * glow;
    d.seam.visible = glow > 0.004;

    // ── the line ──────────────────────────────────────────────────────────
    const rodZ = z0 + 0.32;
    d.rod.position.set(0.25 * sx, ROD_Y, rodZ);
    d.rod.scale.set(8 * sx, ROD_R, ROD_R);
    d.tickLo.position.set(xLo, ROD_Y - 0.09, rodZ);
    d.tickLo.scale.set(ROD_R, 0.24, ROD_R);
    d.tickHi.position.set(xHi, ROD_Y - 0.09, rodZ);
    d.tickHi.scale.set(ROD_R, 0.24, ROD_R);
    d.numLo.position.set(xLo, NUM_Y, rodZ);
    d.numHi.position.set(xHi, NUM_Y, rodZ);

    // ── the wording ───────────────────────────────────────────────────────
    // `said` is the exit. Both clauses have been legible since p = 0 and their
    // work is done once the seam is lit, so they step back over 0.70-0.80 rather
    // than riding the camera swing into the left edge and being sliced mid-word
    // at 0.81 (portrait) / 0.85 (landscape). The interval label follows on its
    // own schedule: it is the last thing said in this room, so it holds until
    // 0.78 and is gone by 0.855, where the bottom edge would have taken it.
    d.t1.position.set(A.t1[0] * sx, A.t1[1], z0);
    d.s1.position.set(A.s1[0] * sx, A.s1[1], z0);
    d.t2.position.set(A.t2[0] * sx, A.t2[1], z0);
    d.s2.position.set(A.s2[0] * sx, A.s2[1], z0);
    d.t1.material.opacity = said;
    d.s1.material.opacity = said;
    d.t2.material.opacity = said;
    d.s2.material.opacity = said;
    d.t1.visible = d.s1.visible = d.t2.visible = d.s2.visible = said > 0.004;
    d.band.position.set(0, BAND_Y, rodZ);
    d.band.material.opacity = named;
    d.band.visible = named > 0.004;

    // ── every possible patient ────────────────────────────────────────────
    // A value inside the band has nowhere legal to be, so it lifts off the
    // line and hangs inside the seam. It does not turn red and it does not
    // vanish: it is a patient the statute has no answer for, which is a state,
    // not a verdict.
    const cand = d.cand;
    for (let i = 0; i < d.n; i++) {
      const v = d.score[i];
      const arrive = smoothstep(sub(p, 0.26 + (i / d.n) * 0.12, 0.52 + (i / d.n) * 0.12));
      let y = ROD_Y + 0.13;
      if (d.stuck[i]) {
        y = lerp(y, WALL_Y - 0.46, glow) + 0.05 * glow * Math.sin(p * 21 + i * 1.7);
      }
      _v.set((v - V_MID) * UNIT * sx, y, rodZ);
      cand.setAt(i, _v, clamp01(arrive) * (1 - 0.55 * leave), p * 1.1 + i, 1);
    }
    cand.commit();
  },
};
