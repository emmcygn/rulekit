// Chapter 06's floor must never stand in front of chapter 05.
//
// THE DEFECT THIS FILE EXISTS FOR. The scene manager updates only the room you
// are standing in, so chapter 06's `lay` fade is one-directional: once a reader
// has passed p ≈ 0.14 of chapter 06, that room is pinned at lay = 1 for the rest
// of the session, floor at full strength, including when they scroll or rail-jump
// BACK into chapter 05. With the near strip's front edge at local z 9.0 (world
// -98) it sat 2.6u in front of the contradiction and cut the number line, both
// ticks, the "30"/"45", the [30, 45) label and the bottom of the seam out of the
// frame. The fix was FZ_NEAR 9.0 -> 4.6 (world -102.4), which puts the whole
// strip BEHIND chapter 05's deepest geometry (world -101.94) by 0.46u.
//
// 0.46u is a small number guarding a Critical invariant, and it is not written
// down anywhere the machine can check — nothing stops a later edit from widening
// the hole (HZ) or pushing the strip forward again. So:
//
//   A. the real rooms, the real camera. Both rooms are built from their own
//      manifests and parked on their own stations exactly as sceneManager does,
//      room 06 is driven forward to lay = 1 through its own update(), and the
//      real rig is posed at every beat of chapter 05 in both orientations. Every
//      named element of chapter 05 is then raycast from the camera. Any hit on
//      any part of room 06 fails.
//   B. a positive control in the same test, so a green result cannot mean "the
//      harness sees nothing": the near strip is moved back to its old z 9.0 pose
//      and the same sweep must report occlusions.
//   C. the strip geometry itself: FZ_NEAR - HZ > 0 (a wider hole than the strip
//      is deep inverts the near strip), and the near face still lands behind
//      chapter 05's deepest point, measured off the built room rather than
//      copied out of it.
//
// Nothing here copies a number out of 05-clash.js: the targets are found on the
// room's own userData and sampled in each mesh's own frame, so retuning chapter
// 05's layout moves the targets with it.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createMaterials } from '../src/lib/materials.js';
import { createQuality } from '../src/core/quality.js';
import { CHAPTERS } from '../src/core/chapters.js';
import { STATIONS, stationVec, createCameraRig } from '../src/core/cameraRig.js';
import CLASH from '../src/scenes/05-clash.js';
import CHASM, { FLOOR_Z } from '../src/scenes/06-chasm.js';

const I5 = CHAPTERS.findIndex((c) => c.id === '05-clash');
const I6 = CHAPTERS.findIndex((c) => c.id === '06-chasm');

// 41 beats of chapter 05, the same resolution the fix was measured at.
const BEAT = 0.025;
const BEATS = [];
for (let p = 0; p <= 1 + 1e-9; p += BEAT) BEATS.push(Math.min(p, 1));

// Where room 06 can be frozen when a reader comes back. `lay` is 1 from p = 0.14
// on, so every one of these is the full-strength floor; the later ones also carry
// the cluster, the panels and the fallen walkers, which are geometry too.
const PINS = [0.14, 0.32, 0.60, 0.85, 1.00];

// One materials set for both rooms, as the manager hands out.
function stage(portrait, tier = 'high') {
  const materials = createMaterials();
  const quality = createQuality(tier);
  const make = (mod, index) => {
    const station = stationVec(index);
    const ctx = { THREE, quality, materials, portrait, station, chapter: CHAPTERS[index] };
    const g = mod.build(ctx);
    // Scenes are authored station-local; the manager is what parks them.
    g.position.copy(station);
    return { g, ctx };
  };
  return { r5: make(CLASH, I5), r6: make(CHASM, I6), materials };
}

// Drive room 06 forward through its OWN update() rather than poking `lay`: the
// pinned state has to be one the page can actually reach.
function pin(r6, p) {
  for (let q = 0; q <= p + 1e-9; q += 0.02) CHASM.update(r6.g, Math.min(q, p), r6.ctx);
  r6.g.updateMatrixWorld(true);
}

// Every solid thing room 06 draws. Lines are left out on purpose — the lip is a
// hairline lying on the top face of a slab that is already in this list, so it
// can occlude nothing the slab does not. Everything else counts, including the
// captions printed on the floor and both instanced meshes.
function occluders(g6) {
  const out = [];
  g6.traverse((o) => {
    if (!o.visible || o.isLine || o.isLineSegments) return;
    if (!o.isMesh && !o.isInstancedMesh) return;
    const m = o.material;
    if (m && m.transparent && m.opacity <= 0.01) return;
    // Judged as solid from either face: a sightline that crosses this geometry
    // at all is an occlusion, whichever way the winding happens to run.
    if (m) m.side = THREE.DoubleSide;
    out.push(o);
  });
  return out;
}

function nameOccluders(g6) {
  const d = g6.userData;
  const names = new Map();
  const label = ['strip-NEAR', 'strip-FAR', 'strip-LEFT', 'strip-RIGHT'];
  d.strips.forEach((s, i) => names.set(s, label[i]));
  names.set(d.hole, 'hatch');
  names.set(d.walkers.mesh, 'walkers');
  names.set(d.core, 'core');
  names.set(d.ring, 'ring');
  names.set(d.screens.mesh, 'screens');
  names.set(d.numLo, 'floor-30');
  names.set(d.numHi, 'floor-45');
  names.set(d.bandLab, 'floor-[30,45)');
  names.set(d.statute, 'floor-caption');
  names.set(d.oneLab, 'cap-one');
  names.set(d.alwaysLab, 'cap-always');
  d.panels.forEach((o, i) => names.set(o, `panel${i}`));
  d.names.forEach((o, i) => names.set(o, `panel${i}-name`));
  d.counts.forEach((o, i) => names.set(o, `panel${i}-count`));
  return (o) => names.get(o) || o.type;
}

// ── the seventeen points chapter 05 is judged on ──────────────────────────
// Sampled in each mesh's OWN frame and pushed out through its own matrix, so
// they follow the room when it is retuned. The unit-box meshes (rod, ticks,
// seam) are sampled in [-0.5, 0.5]; the text planes carry their real width on
// userData.w. Under Node the text textures are 1x1 placeholders with an
// estimated aspect, so a numeral's half-width is approximate — its centre, which
// is exact, is what the claim rests on.
const _p = new THREE.Vector3();
function targets(d, out) {
  out.length = 0;
  const put = (name, m, x, y, z) => {
    out.push({ name, point: m.localToWorld(_p.set(x, y, z)).clone() });
  };
  for (let k = 0; k <= 4; k++) put(`rod@${k}`, d.rod, k / 4 - 0.5, 0, 0);
  put('tick30', d.tickLo, 0, 0.5, 0);
  put('tick30-foot', d.tickLo, 0, -0.5, 0);
  put('tick45', d.tickHi, 0, 0.5, 0);
  put('tick45-foot', d.tickHi, 0, -0.5, 0);
  put('num30', d.numLo, 0, 0, 0);
  put('num45', d.numHi, 0, 0, 0);
  if (d.band.visible) {
    const w = d.band.userData.w;
    put('band-left', d.band, -w / 2, 0, 0);
    put('band-mid', d.band, 0, 0, 0);
    put('band-right', d.band, w / 2, 0, 0);
  }
  if (d.seam.visible) {
    put('seam-top', d.seam, 0, 0.5, 0);
    put('seam-mid', d.seam, 0, 0, 0);
    put('seam-bottom', d.seam, 0, -0.5, 0);
  }
  return out;
}

const _dir = new THREE.Vector3();
const _ray = new THREE.Raycaster();
function blockedBy(eye, point, occ) {
  _dir.subVectors(point, eye);
  const dist = _dir.length();
  if (dist < 1e-6) return null;
  _ray.set(eye, _dir.multiplyScalar(1 / dist));
  _ray.near = 0;
  // Stop a hair short of the target: touching the thing you are looking at is
  // not occluding it.
  _ray.far = dist - 1e-3;
  const hits = _ray.intersectObjects(occ, false);
  return hits.length ? hits[0].object : null;
}

// One full sweep: every beat of chapter 05, every pinned state of room 06, every
// target point. Returns what it found rather than asserting, so the positive
// control can run the identical routine.
function sweep(portrait, mutate) {
  const { r5, r6 } = stage(portrait);
  const camera = new THREE.PerspectiveCamera(portrait ? 62 : 50, portrait ? 0.5 : 1.8, 0.1, 60);
  const rig = createCameraRig({ camera });
  const name = nameOccluders(r6.g);
  const list = [];
  const found = [];
  let checked = 0;
  let maxTargets = 0;

  for (const pin6 of PINS) {
    pin(r6, pin6);
    if (mutate) mutate(r6.g);
    r6.g.updateMatrixWorld(true);
    const occ = occluders(r6.g);
    expect(occ.length, 'room 06 drew nothing to test against').toBeGreaterThan(8);

    for (const p of BEATS) {
      CLASH.update(r5.g, p, r5.ctx);
      r5.g.updateMatrixWorld(true);
      rig.update({ index: I5, p, atRest: false }, 1 / 60, 0, portrait);
      camera.updateMatrixWorld(true);

      targets(r5.g.userData, list);
      maxTargets = Math.max(maxTargets, list.length);
      for (const t of list) {
        checked++;
        const hit = blockedBy(camera.position, t.point, occ);
        if (hit) found.push(`p6=${pin6.toFixed(2)} p5=${p.toFixed(3)} ${t.name} <- ${name(hit)}`);
      }
    }
  }
  return { found, checked, maxTargets };
}

describe('chapter 06 never stands in front of chapter 05', () => {
  for (const portrait of [false, true]) {
    const label = portrait ? 'portrait' : 'landscape';

    it(`clears every sightline into chapter 05 with room 06 pinned at lay = 1 (${label})`, () => {
      const { found, checked, maxTargets } = sweep(portrait, null);
      // Not vacuous: the sweep really did run, and really did see the whole cast.
      expect(checked).toBeGreaterThan(PINS.length * BEATS.length * 10);
      expect(maxTargets, 'the seam and the interval label never appeared').toBe(17);
      expect(found.slice(0, 12).join('\n')).toBe('');
      expect(found.length, `${found.length} occlusions of chapter 05 (${label})`).toBe(0);
    });

    // The other half of the claim. Without this, a green test above could mean
    // the ray never reaches room 06 at all.
    it(`still catches the old FZ_NEAR = 9.0 strip (${label})`, () => {
      const OLD_NEAR = 9.0;
      const { HZ } = FLOOR_Z;
      const { found } = sweep(portrait, (g6) => {
        const s = g6.userData.strips[0];
        s.scale.z = OLD_NEAR - HZ;
        s.position.z = (OLD_NEAR + HZ) / 2;
      });
      expect(found.length, 'the harness cannot see the defect it was written for').toBeGreaterThan(0);
      expect(found.some((f) => f.endsWith('strip-NEAR')), found.slice(0, 5).join('\n')).toBe(true);
    });
  }
});

// ── the strip geometry itself ─────────────────────────────────────────────
describe('the near strip cannot invert or creep forward', () => {
  it('is a strip and not a fold: FZ_NEAR - HZ > 0', () => {
    const { FZ_NEAR, HZ, FZ_FAR } = FLOOR_Z;
    // s[0] is scaled by FZ_NEAR - HZ. At 0 the near floor vanishes; below 0 the
    // box flips through itself and the strip is drawn IN FRONT of the lip it is
    // supposed to end at.
    expect(FZ_NEAR - HZ, 'near strip depth (FZ_NEAR - HZ)').toBeGreaterThan(0);
    // The far strip is the same arithmetic mirrored.
    expect(-HZ - FZ_FAR, 'far strip depth (-HZ - FZ_FAR)').toBeGreaterThan(0);
  });

  it('keeps its front face behind chapter 05, measured off both built rooms', () => {
    const nearFace = STATIONS[I6][2] + FLOOR_Z.FZ_NEAR;
    const box = new THREE.Box3();
    for (const portrait of [false, true]) {
      const { r5 } = stage(portrait);
      let deepest = Infinity;
      for (const p of BEATS) {
        CLASH.update(r5.g, p, r5.ctx);
        r5.g.updateMatrixWorld(true);
        box.setFromObject(r5.g);
        deepest = Math.min(deepest, box.min.z);
      }
      // -z is away from the camera, so chapter 05's deepest point must still be
      // NEARER than the slab's front face. The margin is 0.46u today.
      expect(deepest - nearFace, `${portrait ? 'portrait' : 'landscape'} margin (deepest ${deepest.toFixed(2)} vs strip face ${nearFace.toFixed(2)})`)
        .toBeGreaterThan(0);
    }
  });
});
