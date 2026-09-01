import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { STATIONS, makeCurve, stationVec, cameraT, blendLook, blendOff, createCameraRig } from '../src/core/cameraRig.js';
import { CAMERA_KEYS } from '../src/core/cameraKeys.js';
import { CHAPTERS, globalToChapter, chapterToGlobal } from '../src/core/chapters.js';

describe('stations and spline', () => {
  it('has one station per chapter, spaced ~18 units', () => {
    expect(STATIONS).toHaveLength(11);
    for (let i = 1; i < STATIONS.length; i++) {
      const d = stationVec(i).distanceTo(stationVec(i - 1));
      expect(d).toBeGreaterThan(16);
      expect(d).toBeLessThan(21);
    }
  });

  it('the curve passes exactly through each station at t = i/(n-1)', () => {
    const curve = makeCurve();
    for (let i = 0; i < STATIONS.length; i++) {
      const pt = curve.getPoint(i / (STATIONS.length - 1));
      expect(pt.distanceTo(stationVec(i))).toBeLessThan(1e-6);
    }
  });

  it('the journey has lateral and vertical variation, not a straight hallway', () => {
    const xs = STATIONS.map((s) => s[0]);
    const ys = STATIONS.map((s) => s[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(2);
  });
});

describe('cameraT', () => {
  it('trails its station by half a segment', () => {
    expect(cameraT(3, 0.5)).toBeCloseTo(3 / 10, 8);
    expect(cameraT(3, 0)).toBeCloseTo(2.5 / 10, 8);
  });
  it('clamps at both ends', () => {
    expect(cameraT(0, 0)).toBe(0);
    expect(cameraT(10, 1)).toBe(1);
  });
});

describe('camera keyframes', () => {
  it('every chapter has landscape and portrait keys, 2 to 5 each, starting at p=0', () => {
    for (const c of CHAPTERS) {
      const k = CAMERA_KEYS[c.id];
      expect(k, `missing keys for ${c.id}`).toBeDefined();
      for (const list of [k.keys, k.portrait]) {
        expect(list.length).toBeGreaterThanOrEqual(2);
        // Five: the seam pair, two beats, and the aim-hold twin.
        expect(list.length).toBeLessThanOrEqual(5);
        expect(list[0].p).toBe(0);
        expect(list[list.length - 1].p).toBe(1);
        for (let i = 1; i < list.length; i++) expect(list[i].p).toBeGreaterThan(list[i - 1].p);
      }
    }
  });

  // THE AIM-HOLD TWIN, pinned. Every interior chapter carries a key at p = 0.88
  // that repeats the settle key's `at` — that repetition IS the hold, and it is
  // what gives each chapter a composed frame the reader can stop on. Its `off`
  // must be the seam value and NOT the settle key's: a twin that freezes the
  // whole pose measures 0.1785u per frame on the journey sweep below and blows
  // the 0.15 budget. Both halves are load-bearing, so both are asserted.
  it('holds the aim from the settle key to p = 0.88, with off already at the seam', () => {
    const interior = CHAPTERS.filter((c) => c.id !== '00-hero' && c.id !== '10-close');
    expect(interior).toHaveLength(9);
    for (const c of interior) {
      for (const list of [CAMERA_KEYS[c.id].keys, CAMERA_KEYS[c.id].portrait]) {
        expect(list, `${c.id} should carry the twin`).toHaveLength(5);
        const settle = list[2], twin = list[3], seam = list[4];
        expect(twin.p, `${c.id} twin p`).toBe(0.88);
        // The settle key sits inside the chapter, not in its own exit ramp.
        expect(settle.p, `${c.id} settle key is too late`).toBeLessThanOrEqual(0.70);
        expect(settle.p, `${c.id} settle key is too early`).toBeGreaterThanOrEqual(0.64);
        expect(twin.at, `${c.id} twin must repeat the settle aim`).toEqual(settle.at);
        expect(twin.off, `${c.id} twin off must already be the seam value`).toEqual(seam.off);
      }
    }
  });
});

describe('blendLook', () => {
  const keys = [
    { p: 0, at: [0, 0, 0], off: [0, 0, 0] },
    { p: 1, at: [10, 0, 0], off: [0, 0, 0] },
  ];
  it('returns the endpoints exactly', () => {
    const out = new THREE.Vector3();
    expect(blendLook(keys, 0, out).x).toBeCloseTo(0, 8);
    expect(blendLook(keys, 1, out).x).toBeCloseTo(10, 8);
  });
  it('eases rather than moving linearly', () => {
    const out = new THREE.Vector3();
    expect(blendLook(keys, 0.5, out).x).toBeCloseTo(5, 6);
    expect(blendLook(keys, 0.25, out).x).toBeLessThan(2.5);
  });

  // The real chapters carry 3-4 keys, so the segment search — not just the
  // two-key fast path — has to pick the right pair.
  const multi = [
    { p: 0, at: [0, 0, 0], off: [0, 0, 0] },
    { p: 0.25, at: [4, 0, 0], off: [1, 0, 0] },
    { p: 0.75, at: [4, 8, 0], off: [1, 2, 0] },
    { p: 1, at: [-2, 8, 0], off: [0, 2, 0] },
  ];
  it('lands exactly on each interior key of a 4-key list', () => {
    const out = new THREE.Vector3();
    expect(blendLook(multi, 0.25, out).toArray()).toEqual([4, 0, 0]);
    expect(blendLook(multi, 0.75, out).toArray()).toEqual([4, 8, 0]);
  });
  it('interpolates inside the correct interior segment', () => {
    const out = new THREE.Vector3();
    // Midpoint of the 0.25 -> 0.75 segment: x holds at 4, y eases to half of 8.
    blendLook(multi, 0.5, out);
    expect(out.x).toBeCloseTo(4, 6);
    expect(out.y).toBeCloseTo(4, 6);
    // A quarter into that segment eases below the linear 2.
    expect(blendLook(multi, 0.375, out).y).toBeLessThan(2);
  });
  it('clamps past the last key rather than extrapolating', () => {
    const out = new THREE.Vector3();
    expect(blendLook(multi, 1.4, out).toArray()).toEqual([-2, 8, 0]);
  });
});

describe('blendOff', () => {
  const keys = [
    { p: 0, at: [9, 9, 9], off: [0, 0, 0] },
    { p: 0.5, at: [9, 9, 9], off: [2, 0, 0] },
    { p: 1, at: [9, 9, 9], off: [2, 6, 0] },
  ];
  it('blends the off triple, not the at triple', () => {
    const out = new THREE.Vector3();
    expect(blendOff(keys, 0, out).toArray()).toEqual([0, 0, 0]);
    expect(blendOff(keys, 0.5, out).toArray()).toEqual([2, 0, 0]);
    expect(blendOff(keys, 1, out).toArray()).toEqual([2, 6, 0]);
  });
  it('eases between off keys like blendLook does', () => {
    const out = new THREE.Vector3();
    expect(blendOff(keys, 0.25, out).x).toBeCloseTo(1, 6);
    expect(blendOff(keys, 0.125, out).x).toBeLessThan(0.5);
  });
});

// ── Orientation-space continuity ──────────────────────────────────────────
// Position-only checks cannot see a camera that whips around to look backward,
// which is exactly the defect these guard. Everything below reads the actual
// camera quaternion via getWorldDirection.

// 60fps sweep of the whole 1100vh page in 40s — a deliberate read-through. The
// absolute unit bar below is scroll-rate dependent (the camera covers ~180 units
// over the journey, so a faster scroll moves further per frame no matter how
// smooth the path is); the ratio bar and the seam test are not, and those are
// what actually prove there is no jump.
const FRAME_STEP = 1 / 2400;
const MAX_FRAME_DEGREES = 15;
const MAX_FRAME_UNITS = 0.15;
// Fastest frame vs the median frame. Smooth travel varies <2x across chapters
// (dwell lengths differ, so 08-intake's short 62vh covers its segment fastest);
// a discontinuity shows up as 10x or more.
const MAX_FRAME_UNITS_RATIO = 3;

// Measured at the current keys, vh and HANDOFF_START:
//   landscape  maxDeg 5.98  maxUnits 0.1435  ratio 1.82  seams exact
//   portrait   maxDeg 4.87  maxUnits 0.1481  ratio 1.86  seams exact
//
// THE UNIT BAR IS THE TIGHT ONE, and it is only clear because of how the
// aim-hold twin is built. Camera travel per frame scales as 1/vh, so
// 08-intake's 62vh is the floor the 0.15 sets — measured on this tree, 62 ->
// 0.1435, 60 -> 0.1483, 58 -> 0.1534, 55 -> 0.1618 — and the twin at p = 0.88
// carries the SEAM `off`, not the settle key's, so `off` finishes its move
// during the hold where the aim is still. A twin that froze the whole pose
// measures 0.1969 and fails this. Both of those are asserted directly above,
// so a regression names itself rather than arriving here as an unexplained
// number.

function poseAt(rig, camera, index, p, portrait, outDir) {
  rig.update({ index, p, atRest: false }, 1 / 60, 0, portrait);
  camera.updateMatrixWorld(true);
  camera.getWorldDirection(outDir);
  return camera.position;
}

describe('camera continuity across chapter boundaries', () => {
  for (const portrait of [false, true]) {
    const label = portrait ? 'portrait' : 'landscape';

    it(`sweeps the whole journey without a jump (${label})`, () => {
      const camera = new THREE.PerspectiveCamera(portrait ? 62 : 50, portrait ? 0.5 : 1.8, 0.1, 60);
      const rig = createCameraRig({ camera });
      const dir = new THREE.Vector3();
      const prevDir = new THREE.Vector3();
      const pos = new THREE.Vector3();
      const prevPos = new THREE.Vector3();

      let maxDeg = 0;
      let worst = null;
      let first = true;
      const steps = [];

      for (let g = 0; g <= 1 + 1e-9; g += FRAME_STEP) {
        const c = globalToChapter(Math.min(g, 1));
        pos.copy(poseAt(rig, camera, c.index, c.p, portrait, dir));
        if (!first) {
          const deg = THREE.MathUtils.radToDeg(prevDir.angleTo(dir));
          if (deg > maxDeg) { maxDeg = deg; worst = { chapter: c.index, p: +c.p.toFixed(3), deg }; }
          steps.push(prevPos.distanceTo(pos));
        }
        prevDir.copy(dir);
        prevPos.copy(pos);
        first = false;
      }

      const maxUnits = Math.max(...steps);
      const median = steps.slice().sort((a, b) => a - b)[Math.floor(steps.length / 2)];

      expect(maxDeg, `worst frame: ${JSON.stringify(worst)}`).toBeLessThan(MAX_FRAME_DEGREES);
      expect(maxUnits).toBeLessThan(MAX_FRAME_UNITS);
      expect(maxUnits / median).toBeLessThan(MAX_FRAME_UNITS_RATIO);
    });

    it(`steps across each of the 10 boundaries without a jump (${label})`, () => {
      const camera = new THREE.PerspectiveCamera(portrait ? 62 : 50, portrait ? 0.5 : 1.8, 0.1, 60);
      const rig = createCameraRig({ camera });
      const dir = new THREE.Vector3();
      const prevDir = new THREE.Vector3();
      const pos = new THREE.Vector3();
      const prevPos = new THREE.Vector3();

      // Walk the last frames of chapter i straight into the first frames of
      // i+1, at the same per-frame rate the real scroll would produce.
      for (let i = 0; i < CHAPTERS.length - 1; i++) {
        const span = chapterToGlobal(i, 1) - chapterToGlobal(i, 0);
        const dp = FRAME_STEP / span;
        let first = true;
        for (let k = -6; k <= 6; k++) {
          const raw = 1 + k * dp;
          const index = raw <= 1 ? i : i + 1;
          const p = raw <= 1 ? raw : (raw - 1) * span / (chapterToGlobal(i + 1, 1) - chapterToGlobal(i + 1, 0));
          pos.copy(poseAt(rig, camera, index, Math.min(Math.max(p, 0), 1), portrait, dir));
          if (!first) {
            const deg = THREE.MathUtils.radToDeg(prevDir.angleTo(dir));
            expect(deg, `boundary ${i}->${i + 1} look jump`).toBeLessThan(MAX_FRAME_DEGREES);
            expect(prevPos.distanceTo(pos), `boundary ${i}->${i + 1} position jump`).toBeLessThan(MAX_FRAME_UNITS);
          }
          prevDir.copy(dir);
          prevPos.copy(pos);
          first = false;
        }
      }
    });

    it(`ends chapter i in exactly the pose chapter i+1 opens in (${label})`, () => {
      const camera = new THREE.PerspectiveCamera(portrait ? 62 : 50, portrait ? 0.5 : 1.8, 0.1, 60);
      const rig = createCameraRig({ camera });
      const endDir = new THREE.Vector3();
      const startDir = new THREE.Vector3();
      const endPos = new THREE.Vector3();

      for (let i = 0; i < CHAPTERS.length - 1; i++) {
        endPos.copy(poseAt(rig, camera, i, 1, portrait, endDir));
        const startPos = poseAt(rig, camera, i + 1, 0, portrait, startDir);
        expect(endPos.distanceTo(startPos), `seam ${i}->${i + 1} position`).toBeLessThan(1e-6);
        expect(endDir.angleTo(startDir), `seam ${i}->${i + 1} direction`).toBeLessThan(1e-6);
      }
    });

    it(`never looks backward down the path or at its own eye point (${label})`, () => {
      const camera = new THREE.PerspectiveCamera(portrait ? 62 : 50, portrait ? 0.5 : 1.8, 0.1, 60);
      const rig = createCameraRig({ camera });
      const dir = new THREE.Vector3();

      for (let i = 0; i < CHAPTERS.length; i++) {
        for (let p = 0; p <= 1.0001; p += 0.02) {
          const pos = poseAt(rig, camera, i, Math.min(p, 1), portrait, dir);
          // Forward is -z. The closing crane tips down but still travels forward.
          expect(dir.z, `chapter ${i} p=${p.toFixed(2)} looks backward`).toBeLessThan(0);
          expect(Number.isFinite(pos.x + pos.y + pos.z)).toBe(true);
        }
      }
    });
  }
});
