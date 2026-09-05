// Chapter 09 — "What exists, and the build". One set piece: the workbench's
// five screens floating in front of the test suite that was written before
// them.
//
// THE WALL IS A REPRESENTATIVE FIELD OF SOLID MARKS, AND IT IS NOT GREEN.
//
// #build says automated regression suites run in CI. The decorative field is
// deliberately not presented as an exact count. It is not drawn green. In
// this piece a verdict is a shape, never a hue:
//
//   pass    ■  solid            ← this room
//   fail    □  outline
//   unknown ▨  hatched
//
// So the wall is filled ink squares — the solid mark, in bulk, and the only
// place in the piece it appears in bulk. Chapter 08 is ten charts and not one
// solid mark between them; this is the same mark language saying the opposite
// thing about the only things in the project that do pass. Greyscale the frame
// and nothing is lost, because nothing was ever carried by colour. No accent
// here either: that belongs to chapters 05 and 07.
//
// THE COUNT IS TIER-SCALED AND THE FOOTPRINT IS NOT.
//
// `ctx.quality.count(CHECK_MARKS)` thins the wall on a phone, which is allowed here and
// was not allowed in chapter 08, for one reason: the panel beside this room
// describes it as a suite, so the wall is an impression rather than a thing
// you are asked to count. What must NOT change with the
// tier is how much of the room the suite occupies — a suite that visibly shrank
// on a slower machine would understate itself. So the column count is derived
// from the instance count and the spacing from the column count: the wall keeps
// the same width and roughly the same height on every tier, with coarser marks.
//
// THE COVERAGE NUMBER IS NOT IN HERE. 56.7% is a heuristic estimate with a
// caveat attached, and a number floating in a 3D room loses its caveat on the
// way past. It stays in the HTML panel, in text, next to the sentence that
// qualifies it. Nothing in this room is a numeral.
//
// BEATS:
//   p 0.06-0.56  the wall assembles row by row, bottom to top
//   p 0.22-0.58  the five screens arrive out of the fog, staggered, OVER THE
//                TOP of the wall — never through it (see SCREEN_RISE)
// Everything is finished by p = 0.58, before the camera settles on the room at
// p = 0.66 and then holds that aim to p = 0.88 — so the money shot is a
// finished room, not a room still arriving. The hand-off at 0.90 pulls it off
// frame.
// The wall starts before the screens exist and is still going when they land,
// which is the honest picture of a suite written first and kept growing.
//
// Contract notes (see ./_stub.js):
//   • the only cloned shared material is one cloneOwned(materials.line);
//   • the decorative checks are ONE InstancedMesh through createSwarm, sized by
//     ctx.quality.count();
//   • five fixed label strings, so the memoised text cache stays bounded;
//   • ctx.portrait is read in update() only — it re-lays the room for a tall
//     frame (the wall re-flows to 19 columns, the screens stack into a column)
//     rather than shrinking everything until the labels stop being readable;
//   • update() allocates nothing: module scratch plus typed arrays made once.

import * as THREE from 'three';
import { createSwarm } from '../lib/instancedSwarm.js';
import { makeTextTexture } from '../lib/textures.js';
import { cloneOwned } from '../lib/materials.js';
import { sub, smoothstep, lerp } from '../lib/easing.js';

const SCREENS = ['funnel', 'thresholds', 'amendment', 'checks', 'review'];
const CHECK_MARKS = 470;

// The workbench stands off the flight path, on the side AWAY from station 10:
// chapter 10's camera runs from here toward (+3.0, +1.6, -18) station-local, so
// anything parked on the +x side of this room gets flown through on the way
// out. At (-4.0, 0.85, -13.0) the closing crane never gets nearer than ~2.5u to
// any mark on this wall, and this chapter frames it head on from p 0.66 to 0.88.
const WX = -4.0, WY = 0.85, WZ = -13.0;
// One yaw for the whole room, toward the stretch of path it is read from. The
// scene contract hands update() no camera, so this is a fixed turn, not a
// billboard — and because everything in the room is a child of the same yawed
// group, no part of it is read at a different obliquity than any other.
const WB_YAW = 0.42;

// The suite. Width is fixed; columns come from the instance count so the wall
// keeps its footprint on every tier (see the header). The aspect is chosen per
// orientation to fill the frame it is read in rather than to letterbox inside
// it: 1.7:1 against a 1.6:1 landscape frame, 0.78:1 against a tall one.
const WALL_W = 7.0, WALL_AR = 1.7;        // landscape: 28 x 17 at the high tier
const WALL_W_P = 3.9, WALL_AR_P = 0.78;   // portrait: the same field, reflowed
const MARK_FRAC = 0.48;                   // mark size as a fraction of the pitch
const WALL_DEEP = 4.2;                    // how far back a mark starts, in fog

// The screen is tall enough to carry its own name. A label hung UNDERNEATH a
// screen lands on the wall behind it, and ink text on top of ink marks is not
// text any more — the caption goes inside the paper, like the tab it is.
const SCREEN_W = 1.2, SCREEN_H = 0.98;
const SHW = SCREEN_W / 2, SHH = SCREEN_H / 2;
const SCREEN_Z = 1.6;                     // in front of the wall, room-local
const SCREEN_DX = 1.45;                   // landscape: a row, 5 wide, wall-wide
const SCREEN_DY = 1.22;                   // portrait: a column, 5 tall
const SCREEN_ARC = 0.16;                  // outer screens sit back this much per step²
const SCREEN_YAW = 0.10;                  // ...and turn in by this much per step
const LABEL_H = 0.19, LABEL_Y = -0.34;
const SCREEN_DEEP = 7.0;

// THE ARRIVAL IS TWO LEGS, AND THE ORDER OF THEM IS THE WHOLE POINT.
// A screen that flies straight from its fogged start (room-local z -7, behind
// the wall) to its resting place (z +1.6, in front of it) spends a third of the
// arrival INSIDE the mark grid — a pale rectangle sliced by the marks it is
// supposed to stand clear of. So the screen makes the crossing high, above the
// top row, and only drops into place once it is safely in front:
//
//   leg 1  t 0 .. ARRIVE_Z   forward, at SCREEN_RISE, over the top of the wall
//   leg 2  t ARRIVE_Y .. 1   down into place, wholly in front of the wall
//
// SCREEN_RISE clears the tallest wall this room ever builds — portrait at the
// low tier, whose top row sits at y 2.57 — by half a metre with the screen at
// full size. ARRIVE_Y starts after the last screen has cleared the wall plane
// (the outermost crosses at t ≈ 0.40), so the two legs never overlap in the
// danger zone. The fan spreads the entry heights so the PORTRAIT column, whose
// five screens share one x, does not stack all five in the same spot in the fog.
const SCREEN_RISE = 4.0, SCREEN_FAN = 0.22;
const ARRIVE_Z = 0.50, ARRIVE_Y = 0.58;

// Each screen carries three rows of fields. The funnel's rows narrow, because
// that is what a funnel does; the rest are just enough to read as an interface.
const S_ROWS = 3, S_COLS = 4;
const TICKS_PER_SCREEN = S_ROWS * S_COLS;
const S_TICK_X0 = -0.30, S_TICK_DX = 0.20;
const S_TICK_Y = [0.30, 0.14, -0.02];
const S_FILL = [
  [4, 3, 1],   // funnel
  [2, 4, 3],   // thresholds
  [3, 2, 4],   // amendment
  [4, 4, 4],   // checks
  [3, 4, 2],   // review
];

const LINE_DZ = 0.012, TICK_DZ = 0.008;
const SEGS = 4, VERTS = SEGS * 2;
const BASE = new Float32Array([
  -SHW, -SHH, SHW, -SHH,
  SHW, -SHH, SHW, SHH,
  SHW, SHH, -SHW, SHH,
  -SHW, SHH, -SHW, -SHH,
]);

const _v = new THREE.Vector3();

export default {
  id: '09-build',
  budget: { calls: 14, tris: 4000 },

  build(ctx) {
    const g = new THREE.Group();
    const M = ctx.materials;

    // Everything lives in one yawed, offset child group, so the whole room is
    // authored in plain workbench coordinates and turned toward the path once.
    const wb = new THREE.Group();
    wb.position.set(WX, WY, WZ);
    wb.rotation.y = WB_YAW;
    g.add(wb);

    const lineMat = cloneOwned(M.line);
    lineMat.color.setHex(0x1A1D21);

    // ── the test suite ────────────────────────────────────────────────────
    // A plane, not a box: `ink` is unlit MeshBasicMaterial, so every face of a
    // box renders the identical flat silhouette and five of the six are paid
    // for and never seen. One plane per representative mark keeps this cheap.
    const n = ctx.quality.count(CHECK_MARKS);
    const checks = createSwarm({
      geometry: new THREE.PlaneGeometry(1, 1),
      material: M.ink,
      count: n,
    });
    wb.add(checks.mesh);

    // ── the five screens ──────────────────────────────────────────────────
    const faces = createSwarm({
      geometry: new THREE.PlaneGeometry(SCREEN_W, SCREEN_H),
      material: M.bone,
      count: SCREENS.length,
    });
    wb.add(faces.mesh);

    const ticks = createSwarm({
      geometry: new THREE.PlaneGeometry(0.13, 0.055),
      material: M.data,
      count: SCREENS.length * TICKS_PER_SCREEN,
    });
    wb.add(ticks.mesh);

    // One buffer for all five screen rectangles: five draw calls become one,
    // and the screens still arrive one at a time.
    const lineGeo = new THREE.BufferGeometry();
    const pos = new THREE.Float32BufferAttribute(new Float32Array(SCREENS.length * VERTS * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    lineGeo.setAttribute('position', pos);
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    lines.frustumCulled = false;
    wb.add(lines);

    // Five fixed strings, five cached textures, five draw calls. These cannot
    // share an instance the way the ten `synthetic` tags in chapter 08 do —
    // five different maps is five different materials.
    const labels = [];
    for (let i = 0; i < SCREENS.length; i++) {
      const tex = makeTextTexture(SCREENS[i], { px: 64, color: '#1A1D21' });
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(LABEL_H * (tex.userData.aspect || 4), LABEL_H),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
      );
      wb.add(label);
      labels.push(label);
    }

    const fill = new Uint8Array(SCREENS.length * S_ROWS);
    for (let i = 0; i < SCREENS.length; i++) {
      for (let r = 0; r < S_ROWS; r++) fill[i * S_ROWS + r] = S_FILL[i][r];
    }

    g.userData = { checks, n, faces, ticks, lines, pos, labels, fill };
    return g;
  },

  update(g, p, ctx) {
    const u = g.userData;
    const portrait = !!(ctx && ctx.portrait);
    const arr = u.pos.array;
    const n = u.n;

    // ── the suite assembles, bottom row first ─────────────────────────────
    // Columns from the count, pitch from the columns: the footprint is the same
    // on every tier, only the grain changes.
    const w = portrait ? WALL_W_P : WALL_W;
    const cols = Math.max(1, Math.round(Math.sqrt(n * (portrait ? WALL_AR_P : WALL_AR))));
    const rows = Math.ceil(n / cols);
    const pitch = w / cols;
    const size = pitch * MARK_FRAC;
    const x0 = -(cols - 1) * pitch * 0.5;
    const y0 = -(rows - 1) * pitch * 0.5;

    const assemble = sub(p, 0.06, 0.56);
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = (i / cols) | 0;
      const at = rows > 1 ? row / (rows - 1) : 0;
      const t = smoothstep(sub(assemble, at * 0.8, at * 0.8 + 0.2));
      _v.set(x0 + col * pitch, y0 + row * pitch, lerp(-WALL_DEEP, 0, t));
      // Scale, never instance colour: setColorAt multiplies the material
      // colour, so fading an ink mark by colour drives it toward black — more
      // present, not less, against a white room.
      u.checks.setAt(i, _v, size * t, 0, 1);
    }
    u.checks.commit();

    // ── the workbench arrives ─────────────────────────────────────────────
    // Landscape lays the five out in a shallow arc across the wall; portrait
    // stacks them into a column. Same five screens, same size, same labels at
    // the same height — a 31°-wide frustum gets a different arrangement, not a
    // smaller one, because shrinking is what makes the labels unreadable.
    for (let i = 0; i < SCREENS.length; i++) {
      const k = i - 2;
      const t = smoothstep(sub(p, 0.22 + i * 0.05, 0.38 + i * 0.05));
      const s = lerp(0.55, 1, t);
      const yaw = portrait ? 0 : -SCREEN_YAW * k;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);

      // Resting place, then the two-leg path to it: forward first, high above
      // the wall's top row, and down only once the screen is clear in front of
      // the plane. Nothing here ever puts a screen inside the mark grid.
      const cx = portrait ? 0 : k * SCREEN_DX;
      const homeY = portrait ? -k * SCREEN_DY : 0.12;
      const homeZ = SCREEN_Z - (portrait ? 0 : SCREEN_ARC * k * k);
      const cy = lerp(SCREEN_RISE + k * SCREEN_FAN, homeY, smoothstep(sub(t, ARRIVE_Y, 1)));
      const cz = lerp(-SCREEN_DEEP, homeZ, smoothstep(sub(t, 0, ARRIVE_Z)));

      _v.set(cx, cy, cz);
      u.faces.setAt(i, _v, s, yaw, 1);

      // Every offset below is a screen-local (x, y, z) turned by the screen's
      // own yaw: x' = x·cos + z·sin, z' = -x·sin + z·cos.
      const label = u.labels[i];
      label.position.set(cx + LINE_DZ * sn, cy + LABEL_Y * s, cz + LINE_DZ * cs);
      label.rotation.y = yaw;
      label.scale.setScalar(s);
      label.visible = t > 0.02;

      for (let row = 0; row < S_ROWS; row++) {
        const on = u.fill[i * S_ROWS + row];
        for (let col = 0; col < S_COLS; col++) {
          const ti = i * TICKS_PER_SCREEN + row * S_COLS + col;
          if (col >= on) { _v.set(cx, cy, cz); u.ticks.setAt(ti, _v, 0, 0, 1); continue; }
          const bx = (S_TICK_X0 + col * S_TICK_DX) * s;
          _v.set(cx + bx * cs + TICK_DZ * sn, cy + S_TICK_Y[row] * s, cz - bx * sn + TICK_DZ * cs);
          u.ticks.setAt(ti, _v, s, yaw, 1);
        }
      }

      const base = i * VERTS * 3;
      for (let v = 0; v < VERTS; v++) {
        const bx = BASE[v * 2] * s;
        const by = BASE[v * 2 + 1] * s;
        const o = base + v * 3;
        arr[o] = cx + bx * cs + LINE_DZ * sn;
        arr[o + 1] = cy + by;
        arr[o + 2] = cz - bx * sn + LINE_DZ * cs;
      }
    }

    u.faces.commit();
    u.ticks.commit();
    u.pos.needsUpdate = true;
  },
};
