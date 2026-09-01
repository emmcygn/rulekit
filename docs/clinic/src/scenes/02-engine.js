// Chapter 02 — "The engine". The money shot: every loose word from chapters 00
// and 01 streams past you in a laminar flow and lands as four lines of a
// compiled rule, hanging in the fog ahead.
//
// Three things make this room work, and all three are load-bearing:
//
// 1. ONE DRAW CALL FOR THE STREAM. The words are a single InstancedMesh over a
//    glyph atlas. A plane's UVs are shared by every instance, so which word an
//    instance shows comes from a per-instance `aTile` attribute (the atlas cell
//    rect) that a small ShaderMaterial folds into the lookup. Without that all
//    340 quads would show the whole atlas grid at once — mush, not words.
//    The same shader reads `instanceColor.r` as ALPHA rather than tint, because
//    on a white ground a word has to fade out, not darken.
//
// 2. THE LANES FOLLOW THE FLIGHT PATH. The camera's route through this station
//    is a curve, not a line, so a lattice of straight tubes would drift out of
//    frame. `centerline()` bakes the camera path once, resampled onto a uniform
//    grid of station-local z, and every word rides `centre(z) + laneOffset`.
//    That is what keeps the flow reading as parallel lanes from every point on
//    the dolly.
//
// 3. NOTHING ELSE IS IN THE ROOM — AND NOTHING BEHIND IT EITHER. One swarm, one
//    code plate, four lines, one accent tick, one rule border. Three rooms are
//    resident at once and the fog only reaches ~55% at 18u, so at the held frame
//    chapter 03's token strip read straight through a 13%-alpha plate, legibly.
//    Two things stop that now: the plate goes fully opaque at full reveal (its
//    tint moved from alpha into its colour, so the look is unchanged), and a
//    white scrim behind the block closes over the frame for the money shot.
//    Both taper off again by p = 1, because this room stays parked in front of
//    the camera for the first stretch of chapter 03 and must not wipe it.

import * as THREE from 'three';
import { createSwarm } from '../lib/instancedSwarm.js';
import { makeGlyphAtlas, makeTextTexture } from '../lib/textures.js';
import { cloneOwned, COLORS } from '../lib/materials.js';
import { sub, smoothstep, lerp, clamp01 } from '../lib/easing.js';
import { makeCurve, cameraT, STATIONS } from '../core/cameraRig.js';
import { CHAPTERS } from '../core/chapters.js';

// The loose prose of 00/01, in the order plain.html says it.
const STREAM_WORDS = [
  'participants', 'required', 'eGFR', 'at', 'least', '30', 'screening',
  'must', 'be', 'excluded', 'if', 'protocol', 'section', 'inclusion',
];

// The compiled rule, exactly as plain.html prints it in #p-compile.
const CODE_LINES = [
  '- id: egfr-min',
  '  kind: inclusion',
  '  verbatim: "eGFR at least 30 mL/min/1.73m2"',
  '  when: { fact: egfr, op: gte, value: 30 }',
];

const IDX = CHAPTERS.findIndex((c) => c.id === '02-engine');

// One atlas cell is 6px wide by 1.4px tall (see makeGlyphAtlas), so the quad
// carries that aspect exactly or the words come out stretched.
const CELL_W = 0.72;
const CELL_H = CELL_W * (1.4 / 6);

// The lane lattice. Eight columns, six rows, no lane on the axis itself so
// nothing flies through the lens.
const LANE_X = [-3.05, -2.2, -1.35, -0.6, 0.6, 1.35, 2.2, 3.05];
const LANE_Y = [-1.45, -0.8, -0.25, 0.35, 0.95, 1.6];
const LANES = LANE_X.length * LANE_Y.length;

const BEHIND = 4.5;    // a word is born this far behind the camera...
const SPAN = 33;       // ...and dies this far in front of it
const CYCLES = 2.1;    // lane traversals over one chapter

// Camera z in station-local space is linear in p to within 3mm over the
// chapter (measured off the spline), so the stream tracks it with a lerp.
const CAM_Z0 = 8.9;
const CAM_Z1 = -8.9;

// The code block, in block-local units. Scale and placement are set per
// orientation in update().
const LINE_H = 0.26;
const LINE_STEP = 0.36;
const LAND_POS = [1.6, 0.9, -13.5];
const PORT_POS = [1.5, 1.2, -11.0];
const LAND_SCALE = 1.25;
// Portrait is width-bound, not height-bound: 44 monospace columns across a
// 390px phone is the whole constraint, and this is the largest scale that keeps
// the plate inside a 31°-wide frustum — including the swing the camera has
// already started toward the next station by p = 0.9.
const PORT_SCALE = 0.46;
// ...and portrait spends what little width is left on the text rather than on
// margin, so the plate hugs the block instead of carrying landscape's padding.
const PORT_PAD = 0.30;

// How far the plate's fill is pushed from paper white toward the data blue.
// This used to be the plate's ALPHA over a data-blue material; it is its COLOUR
// now, so alpha is free to run to 1. Ramping alpha 0->1 over this colour and
// ramping alpha 0->0.13 over data blue are the same interpolation away from
// white, so the plate looks exactly as it did — it just stops being a window.
const PLATE_MIX = 0.13;

// The scrim: a white plane parked behind the block, big enough to overrun the
// frustum in either orientation at the distance the block hangs (widest case is
// landscape at ~10.5u across, tallest is portrait at ~8.4u down). White on a
// white ground with white fog, so it costs nothing visually — all it does is
// end the sightline through the room.
const SCRIM_W = 32;
const SCRIM_H = 26;
const SCRIM_Z = -0.16;

// ── the flight path, resampled on z ──────────────────────────────────────────
// Baked once for the page, not per build: it is a property of the spline, and
// three rooms of this chapter over one scroll would otherwise pay for it three
// times.
const NZ = 96;
const Z_NEAR = 27.5;
const Z_FAR = -27.5;
let CENTER = null;

function centerline() {
  if (CENTER) return CENTER;
  const curve = makeCurve();
  const st = STATIONS[IDX];
  const v = new THREE.Vector3();
  const N = 512;
  const sx = new Float64Array(N);
  const sy = new Float64Array(N);
  const sz = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    // p runs past both ends of the chapter so the sampled z covers the whole
    // length of the stream, not just the part the camera occupies.
    const pe = -1.05 + (3.1 * k) / (N - 1);
    curve.getPoint(cameraT(IDX, pe), v);
    sx[k] = v.x - st[0];
    sy[k] = v.y - st[1];
    sz[k] = v.z - st[2];
  }
  const cx = new Float32Array(NZ);
  const cy = new Float32Array(NZ);
  let k = 0;
  for (let j = 0; j < NZ; j++) {
    const z = Z_NEAR + ((Z_FAR - Z_NEAR) * j) / (NZ - 1);
    while (k < N - 2 && sz[k + 1] > z) k++;
    const d = sz[k + 1] - sz[k];
    const t = d === 0 ? 0 : clamp01((z - sz[k]) / d);
    cx[j] = sx[k] + (sx[k + 1] - sx[k]) * t;
    cy[j] = sy[k] + (sy[k + 1] - sy[k]) * t;
  }
  CENTER = { cx, cy };
  return CENTER;
}

// ── the swarm shader ─────────────────────────────────────────────────────────
const STREAM_VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
attribute vec4 aTile;
varying vec2 vTile;
varying float vAlpha;
void main() {
  vTile = uv * aTile.zw + aTile.xy;
  vAlpha = instanceColor.r;
  #include <begin_vertex>
  #include <project_vertex>
  #include <fog_vertex>
}`;

const STREAM_FRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uMap;
uniform vec3 uInk;
varying vec2 vTile;
varying float vAlpha;
void main() {
  float a = texture2D(uMap, vTile).a * vAlpha;
  if (a < 0.03) discard;
  gl_FragColor = vec4(uInk, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// ── frame-path scratch: this file allocates nothing inside update() ──────────
const _v = new THREE.Vector3();
let _cx = 0;
let _cy = 0;

function centreAt(z, cx, cy) {
  const f = clamp01((Z_NEAR - z) / (Z_NEAR - Z_FAR)) * (NZ - 1);
  let j = f | 0;
  if (j > NZ - 2) j = NZ - 2;
  const t = f - j;
  _cx = cx[j] + (cx[j + 1] - cx[j]) * t;
  _cy = cy[j] + (cy[j + 1] - cy[j]) * t;
}

export default {
  id: '02-engine',
  budget: { calls: 12, tris: 3000 },

  build(ctx) {
    const g = new THREE.Group();
    const { cx, cy } = centerline();

    // ── the stream ───────────────────────────────────────────────────────────
    const n = ctx.quality.count(340);
    const atlas = makeGlyphAtlas(STREAM_WORDS, { px: 64 });

    const geometry = new THREE.PlaneGeometry(CELL_W, CELL_H);
    const tiles = new Float32Array(n * 4);
    // laneX, laneY, phase, speed — fixed for the whole chapter, which is what
    // makes the flow laminar rather than a cloud.
    const lanes = new Float32Array(n * 4);
    const perLane = Math.max(1, Math.ceil(n / LANES));
    for (let i = 0; i < n; i++) {
      const word = STREAM_WORDS[i % STREAM_WORDS.length];
      const u = atlas.uv.get(word);
      tiles[i * 4 + 0] = u.x;
      tiles[i * 4 + 1] = u.y;
      tiles[i * 4 + 2] = u.w;
      tiles[i * 4 + 3] = u.h;

      const lane = i % LANES;
      const jx = (((i * 37) % 11) / 11 - 0.5) * 0.08;
      const jy = (((i * 53) % 13) / 13 - 0.5) * 0.06;
      lanes[i * 4 + 0] = LANE_X[lane % LANE_X.length] + jx;
      lanes[i * 4 + 1] = LANE_Y[(lane / LANE_X.length) | 0] + jy;
      // Even spacing down the lane, offset per lane so the lanes do not pulse
      // in unison.
      lanes[i * 4 + 2] = ((((i / LANES) | 0) / perLane) + lane * 0.0193) % 1;
      // Speed is a property of the LANE, not the word: two words in one lane
      // must never overtake each other or the flow stops reading as laminar.
      lanes[i * 4 + 3] = 0.85 + (lane % 7) * 0.045;
    }
    geometry.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 4));

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uMap: { value: null }, uInk: { value: new THREE.Color(COLORS.ink) } },
      ]),
      vertexShader: STREAM_VERT,
      fragmentShader: STREAM_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    // Assigned after the merge: UniformsUtils.merge clones uniform values, and
    // cloning the atlas texture would mint a second copy of it per room.
    material.uniforms.uMap.value = atlas.texture;

    const swarm = createSwarm({ geometry, material, count: n });
    g.add(swarm.mesh);

    // ── the destination: four lines of monospace over a faint plate ──────────
    const block = new THREE.Group();
    const lines = [];
    let maxW = 0;
    for (const text of CODE_LINES) {
      const tex = makeTextTexture(text, { px: 64, color: '#1A1D21' });
      const w = LINE_H * (tex.userData.aspect || 8);
      maxW = Math.max(maxW, w);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, LINE_H),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }),
      );
      lines.push(mesh);
    }
    lines.forEach((mesh, i) => {
      // Left-aligned: a code block whose lines are centred is not a code block.
      mesh.position.set(-maxW / 2 + mesh.geometry.parameters.width / 2, (1.5 - i) * LINE_STEP, 0);
      block.add(mesh);
    });

    const plateW = maxW + 0.7;
    const plateH = CODE_LINES.length * LINE_STEP + 0.34;
    // Owned clone: this scene animates its opacity and tints it, and mutating
    // the shared glass would leak both into every other room.
    const plateMat = cloneOwned(ctx.materials.glass);
    // White on white is invisible, so the plate carries a cool tint — baked
    // into the colour rather than paid for with alpha (see PLATE_MIX).
    const tint = new THREE.Color(COLORS.data);
    plateMat.color.setRGB(
      1 + (tint.r - 1) * PLATE_MIX,
      1 + (tint.g - 1) * PLATE_MIX,
      1 + (tint.b - 1) * PLATE_MIX,
    );
    plateMat.opacity = 0;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(plateW, plateH), plateMat);
    plate.position.z = -0.02;
    block.add(plate);

    // Behind everything the block draws: the sightline stop. Sorted farther
    // from the camera than the plate, so it paints over chapter 03 and under
    // the rule. Scaled in update(), since the block's own scale is orientation
    // and reveal dependent and the scrim's world size must not be.
    const scrimMat = cloneOwned(ctx.materials.glass);
    scrimMat.opacity = 0;
    const scrim = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), scrimMat);
    scrim.position.z = SCRIM_Z;
    block.add(scrim);

    const borderMat = cloneOwned(ctx.materials.line);
    borderMat.transparent = true;
    borderMat.opacity = 0;
    const hx = plateW / 2;
    const hy = plateH / 2;
    const border = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([
        -hx, hy, 0, hx, hy, 0,
        hx, hy, 0, hx, -hy, 0,
        hx, -hy, 0, -hx, -hy, 0,
        -hx, -hy, 0, -hx, hy, 0,
      ], 3)),
      borderMat,
    );
    border.position.z = -0.01;
    block.add(border);

    // The one accent element in the room: a gutter tick against the rule.
    const accentMat = cloneOwned(ctx.materials.accent);
    accentMat.transparent = true;
    accentMat.opacity = 0;
    const accent = new THREE.Mesh(
      new THREE.PlaneGeometry(0.05, CODE_LINES.length * LINE_STEP * 0.88),
      accentMat,
    );
    accent.position.set(-maxW / 2 - 0.22, 0, 0.01);
    block.add(accent);

    g.add(block);

    g.userData = {
      swarm, lanes, n, block, lines, plate, border, scrim,
      plateMat, borderMat, accentMat, scrimMat, maxW, plateW, cx, cy,
    };
    return g;
  },

  update(g, p, ctx) {
    const {
      swarm, lanes, n, block, lines, plate, border, scrim,
      plateMat, borderMat, accentMat, scrimMat, maxW, plateW, cx, cy,
    } = g.userData;
    const portrait = !!(ctx && ctx.portrait);

    // Where the block hangs. Read at update time, never at build time: the
    // phone can turn after the room is already standing.
    const pos = portrait ? PORT_POS : LAND_POS;
    const bs = portrait ? PORT_SCALE : LAND_SCALE;
    // Portrait's frustum is half as wide and half again as tall, so the lane
    // lattice is squeezed on x and stretched on y — otherwise half the stream
    // flies past outside the frame while the bottom third of it stays empty.
    const spreadX = portrait ? 0.62 : 1;
    const spreadY = portrait ? 1.35 : 1;

    // 0.00-1.00 the flow never stops advancing; 0.46-0.80 the words converge on
    // the block; 0.62-0.89 they dissolve into the lines that replace them.
    const flow = p * CYCLES;
    const camZ = lerp(CAM_Z0, CAM_Z1, p);
    const cols = Math.max(2, Math.ceil(n / CODE_LINES.length));
    const rowSpan = maxW * 0.98 * bs;

    for (let i = 0; i < n; i++) {
      const speed = lanes[i * 4 + 3];
      let ph = (lanes[i * 4 + 2] + flow * speed) % 1;
      if (ph < 0) ph += 1;

      const z = camZ + BEHIND - ph * SPAN;
      centreAt(z, cx, cy);
      const lx = _cx + lanes[i * 4 + 0] * spreadX;
      const ly = _cy + lanes[i * 4 + 1] * spreadY;

      // A staggered arrival: the block writes itself rather than snapping shut.
      const d = ((i * 29) % 17) / 17;
      const snap = smoothstep(sub(p, 0.46 + d * 0.08, 0.72 + d * 0.08));
      const gone = smoothstep(sub(p, 0.62 + d * 0.09, 0.80 + d * 0.09));

      const row = i % CODE_LINES.length;
      const col = ((i / CODE_LINES.length) | 0) % cols;
      const tx = pos[0] + (col / (cols - 1) - 0.5) * rowSpan;
      const ty = pos[1] + (1.5 - row) * LINE_STEP * bs;

      _v.set(
        lerp(lx, tx, snap),
        lerp(ly, ty, snap),
        lerp(z, pos[2] + 0.02, snap),
      );

      // Alpha, not tint: the shader reads instanceColor.r as coverage.
      const fadeIn = clamp01((ph - 0.12) / 0.14);
      const fadeOut = clamp01((1 - ph) / 0.14);
      // Converging words thin out as they arrive, so the pile-up over the block
      // stays a forming block of text rather than a black smear.
      const a = 0.92 * fadeIn * fadeOut * (1 - gone) * lerp(1, 0.55, snap);
      swarm.setAt(i, _v, lerp(1, 0.52, snap), 0, a);
    }
    swarm.commit();

    // The rule writes itself top line first, so the block reads as compiling
    // rather than as a card fading up.
    let reveal = 0;
    for (let i = 0; i < lines.length; i++) {
      const r = smoothstep(sub(p, 0.58 + i * 0.04, 0.74 + i * 0.04));
      lines[i].material.opacity = r;
      reveal = Math.max(reveal, r);
    }
    // The room hands over at HANDOFF_START and is then left parked, frozen at
    // p ~ 1, directly in the camera's path for the first stretch of chapter 03.
    // So everything that closes the sightline opens again before the seam:
    // opaque for the held shot, a pane you fly through by the time you do.
    const exit = 1 - smoothstep(sub(p, 0.93, 1));
    const frame = smoothstep(sub(p, 0.54, 0.74));
    plateMat.opacity = frame * exit;
    borderMat.opacity = 0.85 * frame;
    accentMat.opacity = smoothstep(sub(p, 0.68, 0.86));
    scrimMat.opacity = smoothstep(sub(p, 0.78, 0.86)) * exit;

    const pad = portrait ? (maxW + PORT_PAD) / plateW : 1;
    plate.scale.x = pad;
    border.scale.x = pad;

    block.position.set(pos[0], pos[1], pos[2]);
    const s = bs * lerp(0.94, 1, reveal);
    block.scale.setScalar(s);
    // Undo the block's scale: the scrim covers the frame, not the block.
    scrim.scale.set(SCRIM_W / s, SCRIM_H / s, 1);
  },
};
