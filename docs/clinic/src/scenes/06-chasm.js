// Chapter 06 — "One calculation". Two beats in one room, because the chapter
// carries two of plain.html's sections: the chasm, then the engine everything
// reads from.
//
// BEAT ONE — the floor is the statute, and it has a hole in it.
//
// The same collision as chapter 05, walked instead of drawn. The floor is one
// slab of law with a rectangular hole cut out of it between 30 and 45, and the
// camera flies down the middle of the hole for the first two thirds of the
// chapter: for that whole stretch there is no floor under you. Seven people
// cross. Three are on lanes past the far lip and walk straight over. Three are
// on lanes that run through the hole and drop out of the world. One reaches the
// lip at exactly 30 and stops there, admitted by one clause and barred by the
// other, with nowhere to put its foot down.
//
// The void is hatched, not empty. ▨ is this piece's mark for "don't know", and
// that is precisely what the statute says about the interval: nothing. Empty
// white would have read as "fine".
//
// BEAT TWO — every number comes from one calculation.
//
// A dark core hanging out past the end of the floor, a ring of small paper
// screens around it, and a thin conduit from every one of them back to the
// core. Two of the screens are named and larger — the printed report and the
// visual app — and both carry the same count, because there is no second copy
// of the math for them to disagree about.
//
// NO ACCENT IN THIS ROOM. #E2582A is chapter 05's seam and chapter 07's, and
// spending it again here would demote the one place it means something. Status
// is ink, paper and hatch only.
//
// CAMERA. cameraKeys '06-chasm' passes within 0.97u of the station origin at
// p = 0.52 (1.20u at p = 0.58 in portrait — measured off the real rig, handoff
// blend included), so the origin is exactly where the hole is: the nearest solid
// thing to it is the inner top edge of a side strip, 2.84u away (2.64u
// portrait). The cluster hangs at z ≈ -15.5 — 25u out and almost pure fog at
// p = 0, arriving through the fog from p ≈ 0.5, and still 6.49u AHEAD of the
// camera at the hand-off (7.39u portrait), so nothing is ever flown through.
//
// Contract notes (see ./_stub.js): station-local, nothing offset by
// ctx.station; build() never branches on ctx.portrait — both orientations live
// here and update() picks one; every label is a fixed string; the four cloned
// shared materials (two line, one bone, one hatch) all go through cloneOwned;
// update() allocates nothing — one module scratch vector, and the home and
// conduit arrays are typed arrays made once in build().

import * as THREE from 'three';
import { createSwarm } from '../lib/instancedSwarm.js';
import { makeTextTexture } from '../lib/textures.js';
import { cloneOwned } from '../lib/materials.js';
import { sub, smoothstep, lerp, clamp01 } from '../lib/easing.js';

// ── the floor ─────────────────────────────────────────────────────────────
const FLOOR_TOP = -2.20, THICK = 0.42;
const FY = FLOOR_TOP - THICK / 2;
const FX = 11;                      // half width of the slab
// FZ_NEAR IS A HARD LIMIT, NOT A COMPOSITION CHOICE, AND IT IS SET BY CHAPTER
// 05. This station is at world z = -107, so local z maps to world z - 107: the
// near strip's front edge sits at world -102.4. Chapter 05's set piece hangs at
// world -100.6 (portrait -101.2, and a splayed wall corner reaches -101.94), so
// every part of it is NEARER to the camera than this slab and none of it can be
// occluded by it. That margin is the whole point. `lay` below fades the floor in
// over chapter 06's first eighth, but the fade is ONE-DIRECTIONAL: the manager
// only updates the room you are standing in, so once a reader has scrolled past
// p ≈ 0.14 of this chapter, room 06 stays frozen at lay = 1 for the rest of the
// session — including when they scroll BACK into chapter 05. At the old
// FZ_NEAR = 9.0 (world -98) this strip lay 2.6u in front of the contradiction
// and 1.2u above its sightlines, and on the way back it cut the number line,
// both ticks, the "30"/"45", the [30, 45) label and the bottom of the seam out
// of every frame of chapter 05, in both orientations.
// The strip carries nothing: every lane is at local z <= 0.2 and the near lip is
// at HZ, so shortening it costs no walker and no label. Its own cut edge does not
// show either. At p = 0.10 it is 2.65u ahead of the camera and 2.0u below it —
// 37 degrees under a shot that is level, against a 25-degree half-frame. Portrait
// sits higher and wider (30 degrees under a 31-degree half-frame), which lands
// the edge at ndc y = -0.83, under the panel card; checked in the browser at
// p = 0.06, 0.10 and 0.16 in both orientations, and the ground reads as
// continuous in every one.
const FZ_NEAR = 4.6, FZ_FAR = -13.5;
const HZ = 4.2;                     // half depth of the hole
const HX_L = 1.80, HX_P = 1.45;     // half width of the hole — 30 to 45
const VOID_Y = -4.7;                // where the hatch that fills it hangs

// Read-only, for tests/chasmSightlines.test.js. The near strip's depth is
// FZ_NEAR - HZ, and the margin that keeps chapter 05 out of its shadow is a
// Critical invariant, so the numbers it is made of are readable from outside
// instead of being copied into a test file where a future edit here would not
// reach them. Nothing in this module reads this object.
export const FLOOR_Z = { FZ_NEAR, FZ_FAR, HZ, FLOOR_TOP, THICK };

// ── the seven ─────────────────────────────────────────────────────────────
// A fixed cast, not a swarm to be thinned: "seven patients cross it" is a
// count the copy states out loud, so ctx.quality never touches it. The screens
// in beat two are the plural thing that scales.
const LANE_Z = [-5.4, -6.6, -7.8, -1.4, -2.6, -3.7, 0.2];
const CROSS = 0, FALL = 1, HANG = 2;
const FATE = [CROSS, CROSS, CROSS, FALL, FALL, FALL, HANG];
const WALK_FROM = -7.6, WALK_TO = 7.6;

// ── the cluster ───────────────────────────────────────────────────────────
const SCREENS = 12;
const CORE_R = 0.62;

const L_ONE = 'one calculation';
const L_ALWAYS = 'same input, same answer, always';
const L_REPORT = 'printed report';
const L_APP = 'visual app';
const L_COUNT = '7 screen fail of 10';
const L_STATUTE = 'the floor is the statute';
const L_BAND = '[30, 45)';

// Both orientations, built up front, chosen in update(). Portrait is ~31° wide
// against landscape's ~73°: it narrows the hole a little and, more importantly,
// stands the cluster up as a column — the two named panels move from left and
// right of the ring to above and below it, and the screens themselves come
// down to 55%, which is the only way twelve of them plus both panels stay
// inside a 390px frame at the 8-13u the camera reads them from without piling
// on top of each other.
//
// NOTHING IN THE CLUSTER MAY HANG BELOW THE FLOOR PLANE. The floor runs out to
// z = FZ_FAR and the cluster sits past it, so any panel whose lowest corner
// drops under FLOOR_TOP is occluded by 22 units of slab between it and the
// camera — which is exactly what happened to the portrait "visual app" panel.
// MEASURE THE LABEL, NOT THE BOX: each panel's name hangs 0.745u below its own
// centre in portrait (ph/2 + NAME_DROP + half the 0.17 cap height; 0.77u in
// landscape), so the stack reaches a long way past the box it belongs to. Landscape's lowest point is a screen at the
// bottom of the ring, y = -1.95. Portrait's is the "visual app" name, and at the
// symmetric ±2.75 offsets it landed at -2.195 — 5 THOUSANDTHS of a unit above
// the plane, which is a graze, not a clearance: the sightline to it runs within
// a hair of the slab for its whole length. The lower panel therefore sits at
// -2.45 rather than -2.75, which is not a broken symmetry but the correction for
// the name hanging under it, and puts that name at y = -1.90 — 0.30 clear.
const NAME_DROP = 0.16;
const L = {
  hx: HX_L, numDx: 0.45,
  core: [-3.60, 0.20, -15.50],
  rx: 2.25, ry: 1.95, ss: 0.82, cs: 1.00,
  panel: [[-3.30, 1.30], [3.30, -1.30]],
  pw: 1.70, ph: 1.05,
  capY: [-0.84, -1.25], capS: 1.00,
  floorS: 1.00,
};
const P = {
  hx: HX_P, numDx: 0.26,
  core: [-2.55, 1.30, -15.20],
  rx: 1.45, ry: 2.00, ss: 0.55, cs: 0.72,
  panel: [[0, 2.75], [0, -2.45]],
  pw: 1.60, ph: 1.00,
  capY: [-0.95, -1.24], capS: 0.85,
  // Portrait reads the floor from further away and through a 31°-wide frustum,
  // and the panel card takes the bottom of the screen with it, so the caption
  // printed on the statute has to be bigger to survive the trip: 1.4x puts it
  // back at the ~250px it has in landscape instead of 180.
  floorS: 1.40,
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

// A caption printed on the floor rather than floating over it. The camera reads
// this room from above and ahead, so -PI/2 about x is square to the eye for the
// whole chapter and needs no billboarding — which the scene contract could not
// give it anyway, since update() is handed no camera.
function floorText(text, height, color) {
  const m = textMesh(text, height, color);
  m.rotation.x = -Math.PI / 2;
  return m;
}

export default {
  id: '06-chasm',
  budget: { calls: 26, tris: 1500 },

  build(ctx) {
    const g = new THREE.Group();
    const M = ctx.materials;

    // One owned line material for every drawn edge: the lip of the hole and
    // the conduits. cloneOwned clears userData.shared, which is what makes it
    // this room's to free.
    const lineMat = cloneOwned(M.line);
    lineMat.color.setHex(0x1A1D21);
    // The lip gets its own line material because it fades on a different
    // schedule from the conduits — see the ARRIVES LATE note in update().
    const lipMat = cloneOwned(M.line);
    lipMat.color.setHex(0x1A1D21);
    lipMat.transparent = true;
    // The slab and the hatch are owned clones so the whole chasm can fade. A
    // shared material could not: it is the same object in every other room.
    const slabMat = cloneOwned(M.bone);
    slabMat.transparent = true;
    const voidMat = cloneOwned(M.hatch);
    voidMat.opacity = 0;

    // ── the floor, in four strips around the hole ─────────────────────────
    // One unit box for all four, scaled per strip, so the room owns exactly
    // one slab geometry no matter how the hole is sized.
    const slabGeo = new THREE.BoxGeometry(1, 1, 1);
    const strips = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(slabGeo, slabMat);
      // A transparent floor joins the back-to-front transparent pass, where it
      // is far larger than anything else and sorts in front of the captions
      // lying on it. renderOrder pins the slab first and the hatch second, so
      // the "30", "45" and "[30, 45)" printed on the statute are drawn onto it
      // rather than under it.
      m.renderOrder = -3;
      strips.push(m);
      g.add(m);
    }

    // The void reads ▨, not empty: the statute does not say "allowed" about
    // [30, 45), it says nothing at all.
    const voidGeo = new THREE.PlaneGeometry(1, 1);
    const uv = voidGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 9);
    uv.needsUpdate = true;
    const hole = new THREE.Mesh(voidGeo, voidMat);
    hole.rotation.x = -Math.PI / 2;
    hole.renderOrder = -2;
    g.add(hole);

    // The lip: four drawn edges round the hole, rewritten in update() so the
    // portrait width change moves the line with the slabs.
    const lipPos = new Float32Array(24);
    const lipGeo = new THREE.BufferGeometry();
    lipGeo.setAttribute('position', new THREE.BufferAttribute(lipPos, 3));
    const lip = new THREE.LineSegments(lipGeo, lipMat);
    g.add(lip);

    const numLo = floorText('30', 0.34, '#1A1D21');
    const numHi = floorText('45', 0.34, '#1A1D21');
    const bandLab = floorText(L_BAND, 0.44, '#3A4148');
    const statute = floorText(L_STATUTE, 0.26, '#858D95');
    g.add(numLo, numHi, bandLab, statute);

    const walkers = createSwarm({
      geometry: new THREE.BoxGeometry(0.22, 0.22, 0.22),
      material: M.data,
      count: LANE_Z.length,
    });
    g.add(walkers.mesh);

    // ── one calculation ───────────────────────────────────────────────────
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(CORE_R, 1), M.ink);
    g.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.03, 6, 32), M.data);
    g.add(ring);

    const oneLab = textMesh(L_ONE, 0.22, '#1A1D21');
    const alwaysLab = textMesh(L_ALWAYS, 0.135, '#858D95');
    g.add(oneLab, alwaysLab);

    const n = ctx.quality.count(SCREENS);
    const screens = createSwarm({
      // Thin BOXES, not planes: a flat white plane facing the camera in a
      // white room with shadowless daylight is a rectangle you cannot see. The
      // 0.05 of depth gives every screen a shaded edge, which is the only
      // reason twelve of them read as twelve.
      geometry: new THREE.BoxGeometry(1.06, 0.66, 0.05),
      material: M.bone,
      count: n,
    });
    g.add(screens.mesh);

    // Every screen's resting place, and the conduit that ties it to the core.
    // Both are recomputed in update() because the ring's radii differ per
    // orientation; the arrays are made once here so the frame path allocates
    // nothing.
    const home = new Float32Array(n * 3);
    const wirePos = new Float32Array(n * 6);
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.BufferAttribute(wirePos, 3));
    g.add(new THREE.LineSegments(wireGeo, lineMat));

    // The two that are named. Same size, same treatment, same count printed on
    // both — the whole claim of this beat is that they cannot differ.
    const panelGeo = new THREE.BoxGeometry(1, 1, 1);
    const panels = [];
    const names = [];
    const counts = [];
    for (let i = 0; i < 2; i++) {
      const box = new THREE.Mesh(panelGeo, M.bone);
      const name = textMesh(i === 0 ? L_REPORT : L_APP, 0.17, '#1A1D21');
      const cnt = textMesh(L_COUNT, 0.135, '#3A4148');
      g.add(box, name, cnt);
      panels.push(box);
      names.push(name);
      counts.push(cnt);
    }

    Object.assign(g.userData, {
      L, P, strips, hole, lip, lipGeo, lipPos, slabMat, voidMat, lipMat,
      numLo, numHi, bandLab, statute, walkers,
      core, ring, oneLab, alwaysLab,
      screens, n, home, wireGeo, wirePos,
      panels, names, counts,
    });
    return g;
  },

  update(g, p, ctx) {
    const d = g.userData;
    const A = (ctx && ctx.portrait) ? d.P : d.L;
    const hx = A.hx;

    // 0.02-0.55  the seven cross, and three of them do not
    // 0.34-0.62  the screens arrive out of the fog
    // 0.42-0.66  the conduits draw themselves back to the core
    // The wiring used to finish at 0.90, two hundredths after the panel fade
    // and the hand-off both fired — so this chapter's whole claim, one
    // calculation feeding every surface, was true for 7px of scroll. It now
    // completes at p ~= 0.645, just inside the camera's settle key at 0.68, and
    // the finished picture holds from there to the twin at 0.88.
    // THE CHASM ARRIVES LATE ON PURPOSE. The manager poses a room ahead of you
    // at p = 0 and leaves it frozen there, so this room's p = 0 state is what
    // chapter 05's audience is looking at for the whole of chapter 05 — and a
    // 22-unit slab of floor sitting at eye level 8u past the contradiction drew
    // a horizon straight across it. So the statute is not there yet at p = 0: it
    // comes up over the first eighth of its own chapter, while the camera is
    // still short of the near lip and deep in fog.
    // THIS FADE IS THE MANNERS, NOT THE GUARANTEE. It only ever runs forwards:
    // the manager updates the room you are standing in and nobody else, so after
    // one pass through p ≈ 0.14 this room is pinned at lay = 1 for good, and a
    // reader scrolling back up into chapter 05 sees the floor at full strength.
    // What keeps chapter 05 clean on the way back is FZ_NEAR — see the note on
    // it above. Never move the floor forward on z to sell an earlier arrival.
    const lay = smoothstep(sub(p, 0.00, 0.14));
    const born = smoothstep(sub(p, 0.24, 0.50));
    const arrive = smoothstep(sub(p, 0.34, 0.62));
    const wire = smoothstep(sub(p, 0.42, 0.66));

    // ── the floor ─────────────────────────────────────────────────────────
    const sideW = FX - hx;
    const s = d.strips;
    s[0].scale.set(FX * 2, THICK, FZ_NEAR - HZ);
    s[0].position.set(0, FY, (FZ_NEAR + HZ) / 2);
    s[1].scale.set(FX * 2, THICK, -HZ - FZ_FAR);
    s[1].position.set(0, FY, (FZ_FAR - HZ) / 2);
    s[2].scale.set(sideW, THICK, HZ * 2);
    s[2].position.set(-(hx + sideW / 2), FY, 0);
    s[3].scale.set(sideW, THICK, HZ * 2);
    s[3].position.set(hx + sideW / 2, FY, 0);

    d.hole.position.set(0, VOID_Y, 0);
    d.hole.scale.set(hx * 2, HZ * 2, 1);
    d.slabMat.opacity = lay;
    d.voidMat.opacity = 0.55 * lay;
    d.lipMat.opacity = lay;
    d.lip.visible = lay > 0.01;
    for (let i = 0; i < 4; i++) s[i].visible = lay > 0.01;
    d.hole.visible = lay > 0.01;

    const ly = FLOOR_TOP + 0.006;
    const lp = d.lipPos;
    // left lip, right lip, near lip, far lip
    lp[0] = -hx; lp[1] = ly; lp[2] = HZ;   lp[3] = -hx; lp[4] = ly; lp[5] = -HZ;
    lp[6] = hx;  lp[7] = ly; lp[8] = HZ;   lp[9] = hx;  lp[10] = ly; lp[11] = -HZ;
    lp[12] = -hx; lp[13] = ly; lp[14] = HZ;  lp[15] = hx; lp[16] = ly; lp[17] = HZ;
    lp[18] = -hx; lp[19] = ly; lp[20] = -HZ; lp[21] = hx; lp[22] = ly; lp[23] = -HZ;
    d.lipGeo.attributes.position.needsUpdate = true;

    // Portrait sets the two numbers closer to the lip and further down the
    // hole: a 31°-wide frame simply has no room for them at landscape's
    // standoff, and a "30" that has walked off the left edge is worse than a
    // "30" sitting tight against the edge it labels.
    d.numLo.position.set(-hx - A.numDx, ly + 0.006, -2.6);
    d.numHi.position.set(hx + A.numDx, ly + 0.006, -2.6);
    d.bandLab.position.set(0, ly + 0.006, -5.9);
    // PRINTED WHERE THE CAMERA IS ACTUALLY LOOKING. This caption used to sit at
    // (3.9, 2.4) — off to the right on the near floor — where it was never once
    // inside the frame in either orientation: by p = 0.04 it is already past the
    // right edge, and the camera has flown over it by p ≈ 0.3. The p = 0.32
    // camera key aims at local (0, -1.9, -6.6), so the caption goes on the far
    // strip just past the far lip, on the axis the shot is built around, between
    // the lip at -HZ and the [30, 45) label at -5.9. It clears both, and lane
    // -5.4 (the nearest walker) passes 0.16u behind its far edge in portrait,
    // 0.21u in landscape. Fully in frame and at full strength from p = 0.12 to
    // 0.52 landscape, and to 0.36 portrait, where the panel card takes the
    // bottom of the screen — against the nothing it had before.
    d.statute.position.set(0, ly + 0.006, -4.95);
    d.statute.scale.setScalar(A.floorS);
    d.numLo.material.opacity = lay;
    d.numHi.material.opacity = lay;
    d.bandLab.material.opacity = lay;
    d.statute.material.opacity = lay * 0.9;

    // ── the seven ─────────────────────────────────────────────────────────
    for (let i = 0; i < LANE_Z.length; i++) {
      const t = smoothstep(sub(p, 0.02 + i * 0.028, 0.40 + i * 0.028));
      let x, y = FLOOR_TOP + 0.11, scale = 1;
      if (FATE[i] === CROSS) {
        x = lerp(WALK_FROM, WALK_TO, t);
      } else if (FATE[i] === FALL) {
        const march = clamp01(t / 0.58);
        x = lerp(WALK_FROM, -hx + 0.14, march);
        // Accelerating, because a fall is not a fade.
        const drop = clamp01((t - 0.58) / 0.42);
        y -= 5.6 * drop * drop;
        scale = 1 - 0.9 * smoothstep(drop);
      } else {
        const march = clamp01(t / 0.70);
        x = lerp(WALK_FROM, -hx + 0.06, march);
        // Exactly 30: it gets to the edge and there is nothing past it.
        y -= 0.26 * smoothstep(clamp01((t - 0.70) / 0.30));
      }
      _v.set(x, y, LANE_Z[i]);
      d.walkers.setAt(i, _v, Math.max(0.001, scale * lay), 0.25 + i, 1);
    }
    d.walkers.commit();

    // ── one calculation ───────────────────────────────────────────────────
    const cx = A.core[0], cy = A.core[1], cz = A.core[2];
    d.core.position.set(cx, cy, cz);
    d.core.rotation.y = p * 1.5;
    d.core.scale.setScalar(A.cs * lerp(0.45, 1, born));
    d.ring.position.set(cx, cy, cz);
    d.ring.rotation.z = -p * 1.1;
    d.ring.scale.setScalar(A.cs * lerp(0.3, 1, born));

    // Both captions live INSIDE the ring of screens, between the blue ring and
    // the nearest screen edge. Below it they were read through two overlapping
    // panels; this is the only clear band in the composition.
    d.oneLab.position.set(cx, cy + A.capY[0], cz + 0.14);
    d.oneLab.scale.setScalar(A.capS);
    d.oneLab.material.opacity = born;
    d.alwaysLab.position.set(cx, cy + A.capY[1], cz + 0.14);
    d.alwaysLab.scale.setScalar(A.capS);
    d.alwaysLab.material.opacity = born * 0.95;

    const wp = d.wirePos;
    for (let i = 0; i < d.n; i++) {
      const a = ((i + 0.5) / d.n) * Math.PI * 2;
      const hxp = cx + Math.cos(a) * A.rx;
      const hyp = cy + Math.sin(a) * A.ry;
      const hzp = cz + Math.sin(a * 2) * 0.40;
      d.home[i * 3] = hxp;
      d.home[i * 3 + 1] = hyp;
      d.home[i * 3 + 2] = hzp;

      // In from the fog, along its own radius, from behind and further out.
      const k = clamp01(arrive * 1.15 - (i / d.n) * 0.15);
      const e = smoothstep(k);
      _v.set(
        lerp(cx + (hxp - cx) * 3.0, hxp, e),
        hyp,
        lerp(hzp - 9, hzp, e),
      );
      d.screens.setAt(i, _v, A.ss * lerp(0.4, 1, e), Math.sin(a) * 0.18, 1);

      const w = clamp01(wire * 1.2 - (i / d.n) * 0.2);
      wp[i * 6] = cx; wp[i * 6 + 1] = cy; wp[i * 6 + 2] = cz;
      wp[i * 6 + 3] = lerp(cx, hxp, w);
      wp[i * 6 + 4] = lerp(cy, hyp, w);
      wp[i * 6 + 5] = lerp(cz, hzp, w);
    }
    d.screens.commit();
    d.wireGeo.attributes.position.needsUpdate = true;

    // ── the two that are named ────────────────────────────────────────────
    for (let i = 0; i < 2; i++) {
      const px = cx + A.panel[i][0];
      const py = cy + A.panel[i][1];
      const pz = cz + 0.45;
      const pop = smoothstep(clamp01(arrive * 1.25 - 0.2 - i * 0.08));
      const box = d.panels[i];
      box.position.set(px, py, pz);
      box.scale.set(A.pw, A.ph * Math.max(0.001, pop), 0.09);
      box.visible = pop > 0.01;
      d.counts[i].position.set(px, py, pz + 0.06);
      d.counts[i].material.opacity = pop;
      d.counts[i].visible = pop > 0.02;
      d.names[i].position.set(px, py - A.ph / 2 - NAME_DROP, pz + 0.06);
      d.names[i].material.opacity = pop;
      d.names[i].visible = pop > 0.02;
    }
  },
};
