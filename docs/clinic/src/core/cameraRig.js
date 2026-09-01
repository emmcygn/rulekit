// Camera rig: the whole journey is one gently curving Catmull-Rom spline
// through 11 stations, ~18 units apart. Per chapter, keyframes push the camera
// off the spline (`off`, world-space) and swing the look-at target around the
// station (`at`, station-relative).
//
// Everything on the frame path writes into module-level scratch vectors, so
// update() allocates nothing.

import * as THREE from 'three';
import { CHAPTERS } from './chapters.js';
import { CAMERA_KEYS } from './cameraKeys.js';
import { clamp01, smoothstep, lerp } from '../lib/easing.js';

export const STATIONS = [
  [ 0.0,  0.0,    0.0],
  [ 3.5,  0.4,  -17.6],
  [-2.0, -0.6,  -35.4],
  [ 2.5,  0.8,  -53.2],
  [-3.5,  0.2,  -71.0],
  [ 1.5, -0.8,  -89.0],
  [ 4.0,  1.2, -107.0],
  [-2.5,  0.5, -125.0],
  [ 2.0, -0.4, -143.0],
  [-3.0,  0.9, -161.0],
  [ 0.0,  2.5, -179.0],
];

export function stationVec(i) { const s = STATIONS[i]; return new THREE.Vector3(s[0], s[1], s[2]); }

export function makeCurve() {
  return new THREE.CatmullRomCurve3(STATIONS.map((s) => new THREE.Vector3(s[0], s[1], s[2])), false, 'centripetal', 0.5);
}

// The camera trails its station by half a segment, so it flies INTO the room
// rather than opening the chapter already standing in the middle of it.
export function cameraT(index, p, n = STATIONS.length) {
  return clamp01((index + p - 0.5) / (n - 1));
}

// Shared by the `at` and `off` blends. `field` names which triple to read, so
// neither path builds a temporary key list on the way through.
function blendField(keys, p, field, out) {
  const first = keys[0];
  if (p <= first.p) { const v = first[field]; return out.set(v[0], v[1], v[2]); }
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i].p) {
      const a = keys[i - 1][field], b = keys[i][field];
      const t = smoothstep((p - keys[i - 1].p) / (keys[i].p - keys[i - 1].p));
      return out.set(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
    }
  }
  const last = keys[keys.length - 1][field];
  return out.set(last[0], last[1], last[2]);
}

export function blendLook(keys, p, out) { return blendField(keys, p, 'at', out); }

export function blendOff(keys, p, out) { return blendField(keys, p, 'off', out); }

// Over the last slice of a chapter the pose converges on the next chapter's
// opening pose, so the boundary is continuous no matter what the two chapters
// were authored to do independently. The authored values already agree at every
// seam; this keeps that true if a later scene task edits them.
//
// 0.90 rather than 0.88, and it only works paired with the aim-hold twin key
// every interior chapter now carries at p = 0.88 (see cameraKeys.js). Alone,
// moving this later just compresses the same swing into a shorter ramp; with
// the twin, the composed frame holds from the settle key all the way to 0.88
// and the exit is a 10% ramp off a pose whose `off` has already arrived at the
// seam value. The panel fade-out at panels.js starts at the same 0.90, so the
// card and the room leave together.
export const HANDOFF_START = 0.90;

const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _off = new THREE.Vector3();
const _station = new THREE.Vector3();
const _nextOff = new THREE.Vector3();
const _nextLook = new THREE.Vector3();

export function createCameraRig({ camera }) {
  const curve = makeCurve();

  function update(state, dt, elapsed, portrait) {
    const chapter = CHAPTERS[state.index];
    const set = CAMERA_KEYS[chapter.id];
    const keys = portrait ? set.portrait : set.keys;

    // The spline point itself is already continuous across chapters —
    // cameraT(i, 1) and cameraT(i + 1, 0) are the same t.
    curve.getPoint(cameraT(state.index, state.p), _pos);
    blendOff(keys, state.p, _off);

    const s = STATIONS[state.index];
    _station.set(s[0], s[1], s[2]);
    blendLook(keys, state.p, _look).add(_station);

    const nextIndex = state.index + 1;
    if (nextIndex < CHAPTERS.length && state.p > HANDOFF_START) {
      const nextSet = CAMERA_KEYS[CHAPTERS[nextIndex].id];
      const nk = (portrait ? nextSet.portrait : nextSet.keys)[0];
      const ns = STATIONS[nextIndex];
      const w = smoothstep((state.p - HANDOFF_START) / (1 - HANDOFF_START));
      _nextOff.set(nk.off[0], nk.off[1], nk.off[2]);
      _off.lerp(_nextOff, w);
      _nextLook.set(nk.at[0] + ns[0], nk.at[1] + ns[1], nk.at[2] + ns[2]);
      _look.lerp(_nextLook, w);
    }

    _pos.add(_off);

    // Idle float: only while the scroll has settled, so it reads as the room
    // breathing rather than as drift fighting the scrub.
    if (state.atRest) {
      const w = Math.PI * 0.2 * elapsed;             // 0.1 Hz
      _pos.x += Math.sin(w) * 0.05;
      _pos.y += Math.sin(w * 1.37 + 1.1) * 0.05;
    }

    camera.position.copy(_pos);
    camera.lookAt(_look);
  }

  // Behind ?debug — the bare spline plus a cube at each station, so the flight
  // path is visible before any chapter scene exists.
  function debugGroup() {
    const g = new THREE.Group();
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(400)),
      new THREE.LineBasicMaterial({ color: 0x7FA8C9 }),
    );
    g.add(line);
    const geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const mat = new THREE.MeshLambertMaterial({ color: 0x1A1D21 });
    for (let i = 0; i < STATIONS.length; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(stationVec(i));
      g.add(m);
    }
    return g;
  }

  return { update, curve, debugGroup };
}
