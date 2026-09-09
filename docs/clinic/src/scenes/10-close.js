// Chapter 10 — "Close". The pull-back, and the three marks.
//
// Two beats, in this order, and the second one is the last thing the piece says:
//
//   1. THE PULL-BACK (p ≈ 0.15 → 0.78). The camera cranes off the flight line
//      (see CAMERA_KEYS['10-close']: `off` climbs to y +5.0 while the look
//      target drops to y -3.2) and a SCHEMATIC of the whole journey assembles
//      in front of it: a page, a file, one check, one answer — printed twice.
//      Those are the six things the reader has already met, drawn small and
//      joined by one continuous rail.
//   2. THE CLOSE (p ≈ 0.84 → 1.00). The schematic recedes and the three marks
//      are all that is left: ■ pass, □ fail, ▨ unknown, and one caption —
//      "Criterion outcomes". p = 1.000 is a HELD pose, not a fly-through: the
//      marks are placed exactly on the p = 1 look axis, so they settle dead
//      centre and stay there for as long as the reader sits at the bottom.
//
// WHY THE MACHINE IS A DRAWING AND NOT THE REAL ROOMS. Only three rooms are
// ever resident (the manager keeps you ± 1 station), so "the whole journey seen
// at once" cannot be the actual chapters — nine of them do not exist in GPU
// memory by the time you get here. It is a representation, which is also what
// plain.html's own `#assembly` does: the whole system, drawn small.
//
// WHY THE FOG DOES NOT MOVE. Thinning `scene.fog` would be a scene reaching
// into a global that ten other rooms are lit by, and it would have to be put
// back on the way out. This room does it SCENE-LOCALLY instead: every material
// it builds is its own (cloneOwned, never .clone()) and carries `fog = false`.
// The drawing therefore stays crisp while the camera cranes away from it —
// which is the "fog thins so the whole machine reads at once" beat — and there
// is nothing to restore, because the materials die with the room. No dispose()
// hook is needed and none is declared.
//
// Contract notes (see ./_stub.js): authored in station-local space and never
// offset by ctx.station; build() never reads ctx.portrait — both layouts are
// computed up front and update() picks one; every string handed to
// makeTextTexture is fixed for the life of the page; update() allocates nothing.

import * as THREE from 'three';
import { createSwarm } from '../lib/instancedSwarm.js';
import { makeTextTexture, makePageTexture } from '../lib/textures.js';
import { cloneOwned } from '../lib/materials.js';
import { sub, smoothstep, lerp } from '../lib/easing.js';

// ── copy ──────────────────────────────────────────────────────────────────
// These labels name the same workflow as plain.html's #assembly. The closing
// marks describe individual criteria, distinct from the overall eligibility result.
const PARTS = ['protocol', 'rule file', 'evaluation', 'result'];
const OUTPUTS = ['report', 'workbench'];
const BOARD_CAPTION = 'One evaluation, shared outputs';
const MARK_WORDS = ['pass', 'fail', 'unknown'];
const OUTCOME_CAPTION = 'Criterion outcomes';

// ── beats ─────────────────────────────────────────────────────────────────
const B_NODE = 0.16;        // first node lands here...
const B_NODE_STEP = 0.055;  // ...and the rest follow one step apart
const B_NODE_LEN = 0.16;
const B_RAIL = [0.30, 0.62];
const B_FORK = [0.56, 0.72];
const B_CAPTION = [0.62, 0.76];
// The whole machine is up and complete from p ≈ 0.76 and HOLDS there for a
// beat before anything moves — that hold is the shot the chapter exists for.
const B_RECEDE = [0.82, 0.94];
// The closing beat runs later in PORTRAIT. Landscape's drawing is a wide row
// well above the marks, so the two can cross-fade; portrait's is a tall column
// standing in the same part of the frame the marks rise into, and its fork and
// screens are still there at p 0.88. Overlapping them for six hundredths of a
// scroll puts three seed-sized marks on top of the diagram — so in portrait the
// marks wait for the drawing to be small and gone upward first. The words and
// outcome caption shift with them by the same amount, and both orientations
// still land fully composed at p = 1.000.
const B_MARKS = { L: [0.86, 0.97], P: [0.895, 0.975] };
const B_WORDS = { L: [0.91, 0.99], P: [0.925, 0.99] };
const B_FOURTH = { L: [0.95, 1.0], P: [0.955, 1.0] };

// The board is hidden outright once it has receded far enough to be a
// sub-pixel smear, so the closing frame costs nothing but the marks.
const GONE = 0.985;

// Below this an alpha-blended plane contributes nothing a reader can see, so it
// is switched off instead of drawn. Same threshold the marks group already used.
const OP_MIN = 0.002;

// Nominal geometry sizes. Orientation changes POSITION and SCALE, never the
// geometry — three has to rebuild a BufferGeometry that changes size, and the
// phone can turn at any moment.
const PAGE_W = 1.05, PAGE_H = 1.35;
const ENGINE = 1.15;
const ANSWER = 0.55;
const SCREEN_W = 1.50, SCREEN_H = 0.85;
const MARK = 0.50;

const CHIP_N = 12;

// Reused every frame; update() allocates nothing.
const _v = new THREE.Vector3();

// ── layouts ───────────────────────────────────────────────────────────────
// Landscape reads left-to-right, the way the story was told. Portrait is ~31°
// wide against landscape's ~73° and roughly twice as tall, so the same machine
// is stood on end and read top-to-bottom — the parts and their order do not
// change, only the axis they are strung along.
//
// `rail` and `fork` are pre-solved here rather than derived per frame: the
// drawing is rigid, so its segment lengths and angles are constants of the
// layout, not of p.
function segment(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return { x: ax, y: ay, len: Math.hypot(dx, dy), rot: Math.atan2(dy, dx) };
}

function landscapeLayout() {
  const node = [[-4.30, 0.15], [-2.10, 0.15], [0.10, 0.15], [2.30, 0.15]];
  const screen = [[4.70, 1.00], [4.70, -0.70]];
  return {
    boardPos: [0, -1.15, -9.40],
    boardTilt: -0.36,           // the drawing lies back toward the craning camera
    node,
    nodeScale: [1, 1, 1, 1],
    // A row hangs its labels on one common baseline underneath it.
    labelX: 0, labelY: -0.82, labelRel: false,
    labelH: 0.17,
    screen,
    screenScale: 1,
    screenLabelDy: -0.56,
    screenLabelH: 0.13,
    rail: segment(node[0][0], node[0][1], node[3][0], node[3][1]),
    fork: [segment(node[3][0], node[3][1], screen[0][0], screen[0][1]),
           segment(node[3][0], node[3][1], screen[1][0], screen[1][1])],
    capY: -1.62,
    capH: 0.17,
    // Where the drawing goes when it recedes, as a delta on boardPos. Straight
    // back: in landscape the machine is a wide, shallow row sitting well above
    // the marks, so shrinking it along -z alone already opens a clean gap.
    recede: [0, 0, -5.4],
    // Placed ON the p = 1 look axis (camera local (0, 5.0, 0), direction
    // (0, -0.564, -0.826) out of CAMERA_KEYS['10-close']), 4.6u out. Move one
    // and you must move the other.
    marksPos: [0, 2.41, -3.80],
    marksTilt: -0.599,          // square to that axis, so the marks face the lens
    marksScale: 1.10,
    marksSpread: 0.95,
    // Landscape has no docked card eating the bottom of the frame — the panel
    // sits on a side third instead — so the original spacing (words a clean
    // 0.03 of NDC below the squares, the outcome caption further below that
    // again) is untouched here. Portrait's own numbers are in portraitLayout().
    markWordsY: -0.44,
    fourthY: -0.86,
  };
}

function portraitLayout() {
  const node = [[0, 3.40], [0, 1.55], [0, -0.30], [0, -2.15]];
  const screen = [[-1.25, -4.05], [1.25, -4.05]];
  return {
    boardPos: [0, -0.05, -8.80],
    boardTilt: -0.33,
    node,
    nodeScale: [0.95, 0.95, 0.95, 1],
    // A column runs its rail straight down x = 0, so a label centred under its
    // node would have the rail drawn through the middle of the word. They go to
    // the right instead, level with the thing they name.
    labelX: 1.05, labelY: 0, labelRel: true,
    // Portrait is ~68px per world unit against landscape's ~92, so every label
    // is set larger here or it lands under 6px tall on a phone.
    labelH: 0.20,
    screen,
    screenScale: 0.77,
    screenLabelDy: -0.48,
    screenLabelH: 0.15,
    rail: segment(node[0][0], node[0][1], node[3][0], node[3][1]),
    fork: [segment(node[3][0], node[3][1], screen[0][0], screen[0][1]),
           segment(node[3][0], node[3][1], screen[1][0], screen[1][1])],
    capY: -5.15,
    capH: 0.19,
    // Portrait stands the machine on end, so it is 8.5u TALL and its bottom
    // (the fork and the two screens) hangs down into exactly the part of the
    // frame the marks rise into. Receding straight back does not help: the
    // drawing shrinks toward the camera axis, which is where the marks are, and
    // between p 0.87 and 0.93 the two sit on top of each other. So the portrait
    // recede also LIFTS — the drawing goes up and away, and the marks come up
    // into the space it vacates. ~2.2u at the ~13u it recedes to is ~120px of
    // clearance on a 390x844 phone. Landscape does not need it and does not get
    // it: its delta is unchanged, so that frame is bit-identical.
    recede: [0, 2.2, -5.4],
    // Move upward in the final camera's view while retaining its depth plane.
    marksPos: [0, 3.96, -3.21],
    marksTilt: -0.538,
    // A 31°-wide frame is 2.55u across at that distance. The marks are drawn
    // full size and pulled CLOSER together rather than shrunk — three legible
    // marks beat three correct-looking small ones.
    marksScale: 0.88,
    marksSpread: 0.78,
    // Lift the entire group into the visible scene above the dock. Labels sit
    // below the marks on white space, including the final outcome caption.
    markWordsY: -0.44,
    fourthY: -0.86,
  };
}

// Deterministic scatter for the chips. Build-time only.
function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Where each chip starts (scattered, toward the viewer) and where it lands (a
// point on the rail). Both in board-local space, so the chips ride the board's
// tilt and its recession for free.
function chipTrack(A, count) {
  const track = new Float32Array(count * 6);
  const r = A.rail;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const ex = r.x + Math.cos(r.rot) * r.len * t;
    const ey = r.y + Math.sin(r.rot) * r.len * t;
    const a = hash(i + 1) * Math.PI * 2;
    const spread = A.node[0][0] === A.node[3][0] ? 1.5 : 3.4;   // column vs row
    track[i * 6 + 0] = ex + Math.cos(a) * spread;
    track[i * 6 + 1] = ey + Math.sin(a) * (spread * 0.55) + 0.3;
    // They come in over the drawing, toward the reader, and are absorbed by it.
    track[i * 6 + 2] = 2.4 + hash(i + 9) * 3.0;
    track[i * 6 + 3] = ex;
    track[i * 6 + 4] = ey;
    track[i * 6 + 5] = -0.30;
  }
  return track;
}

// The rule file's ink lines, as ONE non-indexed geometry rather than six meshes
// or an InstancedMesh: the lines are ragged on purpose (that is what a rule file
// looks like), and a swarm's uniform per-instance scale cannot make a bar longer
// without also making it thicker.
const FILE_ROWS = [[0.42, 0.60], [0.26, 0.46], [0.10, 0.70], [-0.06, 0.38], [-0.22, 0.64], [-0.38, 0.26]];
const RULE_H = 0.055;

function ruledPlate(rows, margin) {
  const pos = [];
  for (let i = 0; i < rows.length; i++) {
    const x0 = margin, x1 = margin + rows[i][1];
    const y0 = rows[i][0] - RULE_H / 2, y1 = rows[i][0] + RULE_H / 2;
    pos.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// A centred text plane. Its material is born in this room, so it is this room's
// to free; the TEXTURE behind it lives in the module cache and is not.
function caption(text, height, color, px) {
  const tex = makeTextTexture(text, { px, color });
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(height * (tex.userData.aspect || 4), height),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }),
  );
  m.material.opacity = 0;
  return m;
}

export default {
  id: '10-close',
  // Measured, not guessed: the room peaks around p = 0.90, where the drawing
  // has not gone yet and the marks are already up. It is a diagram, so it is
  // nearly all planes and lines. The two mark borders add 2 draws and 0
  // triangles; the opacity gating below takes 8 no-op draws back off the p = 0
  // pose the room sits in for the whole of chapter 09.
  budget: { calls: 34, tris: 600 },

  build(ctx) {
    const g = new THREE.Group();

    // ── the room's own materials ──────────────────────────────────────────
    // All six are owned clones with fog switched off — see the header: this is
    // the whole of this chapter's "the fog thins" beat, and it cannot leak,
    // because these die with the room.
    const inkM = cloneOwned(ctx.materials.ink);
    const boneM = cloneOwned(ctx.materials.bone);
    const accentM = cloneOwned(ctx.materials.accent);
    const hatchM = cloneOwned(ctx.materials.hatch);
    const outlineM = cloneOwned(ctx.materials.line);
    outlineM.color.setHex(0x858D95);
    // The DRAWING is drawn in gray hairlines — it is a schematic seen from far
    // off, and gray is what keeps it from competing with the accent at its
    // centre. The MARKS are not: they are the piece's mark language, and
    // 04-three fixes that language at ink 0x1A1D21 (see its `lineMat`, and the
    // □ built there as a paper body plus an ink border). A gray-outlined □
    // reads a full step lighter than the ■ and the ▨ beside it, which quietly
    // demotes "fail" — the exact demotion the three-marks rule exists to stop.
    // So the closing frame gets its own ink line material.
    const markLineM = cloneOwned(ctx.materials.line);
    markLineM.color.setHex(0x1A1D21);
    const chipM = new THREE.MeshBasicMaterial({ color: 0xAAB3BB, fog: false });
    for (const m of [inkM, boneM, accentM, hatchM, outlineM, markLineM]) m.fog = false;
    // The protocol page keeps the printed look it had in chapters 00-03. The
    // texture key is one 07-ai already mints, so this costs no extra canvas.
    const pageM = new THREE.MeshBasicMaterial({
      map: makePageTexture({ w: 320, h: 414, lines: 16, seed: 23 }),
      color: 0xFBFCFD,
      fog: false,
    });

    // ── the machine, drawn small ──────────────────────────────────────────
    const board = new THREE.Group();
    g.add(board);

    const pageGeo = new THREE.PlaneGeometry(PAGE_W, PAGE_H);
    const engineGeo = new THREE.BoxGeometry(ENGINE, ENGINE * 0.87, ENGINE * 0.78);
    const answerGeo = new THREE.BoxGeometry(ANSWER, ANSWER, ANSWER * 0.3);

    // Four nodes, four different objects on purpose. This is a recap, and the
    // reader is supposed to RECOGNISE each one: the protocol page, the rule
    // file, the engine, the verdict. Four identical boxes would recap nothing.
    const nodes = [
      new THREE.Mesh(pageGeo, pageM),      // a page    — the printed protocol
      new THREE.Mesh(pageGeo, boneM),      // a file    — the rule file
      new THREE.Mesh(engineGeo, accentM),  // one check — THE one accent element
      new THREE.Mesh(answerGeo, inkM),     // one answer — the solid ■, early
    ];
    // A page and a file are the same rectangle until you draw what is ON them,
    // and the whole first half of this piece is the difference between the two:
    // printed prose in gray, a rule file in ink.
    const fileRules = new THREE.Mesh(ruledPlate(FILE_ROWS, -PAGE_W * 0.38), inkM);
    fileRules.position.z = 0.004;
    nodes[1].add(fileRules);
    // The one accent element in the room is the engine, and it is the only one:
    // "a deterministic engine as the only thing that decides" is the claim the
    // whole piece closes on, and it sits in the middle of the drawing the way it
    // sits in the middle of plain.html's own schematic.
    nodes[2].add(new THREE.LineSegments(new THREE.EdgesGeometry(engineGeo), outlineM));
    // Bone on white is an edge or it is nothing.
    for (const i of [0, 1]) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(pageGeo), outlineM);
      e.position.z = 0.004;   // off the plane, so the outline cannot z-fight it
      nodes[i].add(e);
    }
    for (const n of nodes) { n.scale.setScalar(0.0001); board.add(n); }

    const nodeLabels = PARTS.map((text) => {
      const m = caption(text, 1, '#5A6169', 64);
      board.add(m);
      return m;
    });

    // ── the rail: one continuous line through all four ────────────────────
    // Origin translated to the LEFT end, so a uniform x-scale draws it out from
    // the first node rather than growing it from the middle.
    const barGeo = new THREE.BoxGeometry(1, 0.042, 0.042);
    barGeo.translate(0.5, 0, 0);
    const rail = new THREE.Mesh(barGeo, inkM);
    board.add(rail);

    // ── printed twice ─────────────────────────────────────────────────────
    const forks = [new THREE.Mesh(barGeo, inkM), new THREE.Mesh(barGeo, inkM)];
    for (const f of forks) board.add(f);

    const screenGeo = new THREE.PlaneGeometry(SCREEN_W, SCREEN_H);
    const screens = OUTPUTS.map(() => {
      const s = new THREE.Mesh(screenGeo, boneM);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(screenGeo), outlineM);
      e.position.z = 0.004;
      s.add(e);
      s.scale.setScalar(0.0001);
      board.add(s);
      return s;
    });
    const screenLabels = OUTPUTS.map((text) => {
      const m = caption(text, 1, '#5A6169', 64);
      board.add(m);
      return m;
    });

    const boardCaption = caption(BOARD_CAPTION, 1, '#858D95', 64);
    board.add(boardCaption);

    // ── the parts, arriving ───────────────────────────────────────────────
    // Small components assemble along the evaluation path.
    // One InstancedMesh, one draw call, sized by the quality tier.
    const chipCount = Math.max(3, ctx.quality.count(CHIP_N));
    const chips = createSwarm({
      geometry: new THREE.BoxGeometry(1, 1, 1),
      material: chipM,
      count: chipCount,
    });
    board.add(chips.mesh);

    // ── the close: three marks, nothing else ──────────────────────────────
    const marks = new THREE.Group();
    marks.visible = false;
    g.add(marks);

    // The three marks, built the way 04-three builds them, because this is the
    // last time the reader sees them and they have to be the SAME three marks:
    // one geometry for all three so "identical but for the mark" is true in the
    // data, a body for each, and a drawn ink border on the two that need one.
    //
    //   ■ pass       solid ink, no border — the ink IS the mark.
    //   □ fail       PAPER BODY plus an ink border. Not a bare wireframe: a
    //                LineSegments alone is one device pixel wide (dpr 2 on a
    //                phone makes that half a CSS pixel) with white showing
    //                through, so it reads lighter and emptier than its two
    //                siblings instead of equal to them.
    //   ▨ unknown    hatch body plus the same border, so the diagonal stripes
    //                are CUT by a square edge instead of running off it. Without
    //                it the stripe ends fray and the mark has no silhouette.
    //
    // Cost of the two borders: 2 draws and 0 triangles, against a 34 / 600 room.
    const markGeo = new THREE.PlaneGeometry(MARK, MARK);
    const markEdge = new THREE.EdgesGeometry(markGeo);
    const solid = new THREE.Mesh(markGeo, inkM);
    const hollow = new THREE.Mesh(markGeo, boneM);
    const hatched = new THREE.Mesh(markGeo, hatchM);
    for (const body of [hollow, hatched]) {
      const border = new THREE.LineSegments(markEdge, markLineM);
      border.position.z = 0.004;   // off the plane, so the border cannot z-fight it
      body.add(border);            // a child, so it scales with the mark exactly
    }
    marks.add(solid, hollow, hatched);

    // y is set every frame in update(), from A.markWordsY / A.fourthY — see
    // the two layouts above for why portrait and landscape differ here.
    const markWords = MARK_WORDS.map((text) => {
      const m = caption(text, 0.13, '#5A6169', 64);
      m.position.z = 0.01;
      marks.add(m);
      return m;
    });

    const fourth = caption(OUTCOME_CAPTION, 0.14, '#858D95', 64);
    fourth.position.set(0, 0, 0.01);
    marks.add(fourth);

    Object.assign(g.userData, {
      L: landscapeLayout(), P: portraitLayout(),
      board, nodes, nodeLabels, rail, forks, screens, screenLabels, boardCaption,
      chips, chipCount,
      // Chip tracks are per-orientation because the rail they land on is.
      chipL: null, chipP: null,
      marks, solid, hollow, hatched, markWords, fourth,
    });
    g.userData.chipL = chipTrack(g.userData.L, chipCount);
    g.userData.chipP = chipTrack(g.userData.P, chipCount);
    return g;
  },

  update(g, p, ctx) {
    const d = g.userData;
    const k = ctx && ctx.portrait ? 'P' : 'L';
    const A = d[k];
    const track = k === 'P' ? d.chipP : d.chipL;

    // ── the drawing recedes at the end; everything below rides that ───────
    const recede = smoothstep(sub(p, B_RECEDE[0], B_RECEDE[1]));
    d.board.visible = recede < GONE;
    if (d.board.visible) {
      d.board.position.set(
        A.boardPos[0] + A.recede[0] * recede,
        A.boardPos[1] + A.recede[1] * recede,
        A.boardPos[2] + A.recede[2] * recede,
      );
      d.board.rotation.x = A.boardTilt;
      d.board.scale.setScalar(lerp(1, 0.06, recede));

      // ── the four parts land, one after another ────────────────────────
      for (let i = 0; i < d.nodes.length; i++) {
        const a = B_NODE + i * B_NODE_STEP;
        const in_ = smoothstep(sub(p, a, a + B_NODE_LEN));
        const n = d.nodes[i];
        n.position.set(A.node[i][0], A.node[i][1], 0);
        n.scale.setScalar(Math.max(0.0001, in_ * A.nodeScale[i]));

        const lab = d.nodeLabels[i];
        lab.position.set(
          A.node[i][0] + A.labelX,
          A.labelRel ? A.node[i][1] + A.labelY : A.labelY,
          0.02,
        );
        lab.scale.setScalar(A.labelH);
        lab.material.opacity = in_;
        // A transparent plane at opacity 0 is still a full draw call, a blend
        // and a texture bind. This room is posed at p = 0 for the whole of
        // chapter 09 — every label sits at 0 there — so the eight words below
        // are switched OFF rather than drawn invisibly.
        lab.visible = in_ > OP_MIN;
      }

      // ── one continuous rail, drawn through all four ───────────────────
      const drawn = smoothstep(sub(p, B_RAIL[0], B_RAIL[1]));
      d.rail.position.set(A.rail.x, A.rail.y, -0.30);
      d.rail.rotation.z = A.rail.rot;
      d.rail.scale.set(Math.max(0.0001, A.rail.len * drawn), 1, 1);

      // ── printed twice ─────────────────────────────────────────────────
      const out = smoothstep(sub(p, B_FORK[0], B_FORK[1]));
      for (let i = 0; i < 2; i++) {
        const f = d.forks[i];
        f.position.set(A.fork[i].x, A.fork[i].y, -0.30);
        f.rotation.z = A.fork[i].rot;
        f.scale.set(Math.max(0.0001, A.fork[i].len * out), 1, 1);

        const s = d.screens[i];
        s.position.set(A.screen[i][0], A.screen[i][1], 0);
        s.scale.setScalar(Math.max(0.0001, out * A.screenScale));

        const lab = d.screenLabels[i];
        lab.position.set(A.screen[i][0], A.screen[i][1] + A.screenLabelDy, 0.02);
        lab.scale.setScalar(A.screenLabelH);
        lab.material.opacity = out;
        lab.visible = out > OP_MIN;
      }

      d.boardCaption.position.set(0, A.capY, 0.02);
      d.boardCaption.scale.setScalar(A.capH);
      const cap = smoothstep(sub(p, B_CAPTION[0], B_CAPTION[1]));
      d.boardCaption.material.opacity = cap;
      d.boardCaption.visible = cap > OP_MIN;

      // ── the parts, flying in and being absorbed ───────────────────────
      const chips = d.chips;
      for (let i = 0; i < d.chipCount; i++) {
        const a = 0.10 + i * 0.022;
        const t = smoothstep(sub(p, a, a + 0.30));
        const b = i * 6;
        _v.set(
          lerp(track[b], track[b + 3], t),
          lerp(track[b + 1], track[b + 4], t),
          lerp(track[b + 2], track[b + 5], t),
        );
        // Instance colour MULTIPLIES the material colour, so fading by colour
        // would drive a chip toward black on a white ground. Fade by scale.
        const w = smoothstep(sub(t, 0, 0.14)) * (1 - smoothstep(sub(t, 0.72, 1)));
        chips.setAt(i, _v, Math.max(0.0001, 0.075 * w), t * 2.4 + i, 1);
      }
      chips.commit();
      chips.mesh.visible = p > 0.08 && p < B_RECEDE[1];
    }

    // ── the close ─────────────────────────────────────────────────────────
    // The marks are fixed in station-local space on the p = 1 look axis, so the
    // last of the crane brings them to dead centre and leaves them there. At
    // p = 1.000 held this is the entire frame: three marks and one line.
    const shown = smoothstep(sub(p, B_MARKS[k][0], B_MARKS[k][1]));
    d.marks.visible = shown > OP_MIN;
    if (d.marks.visible) {
      d.marks.position.set(A.marksPos[0], A.marksPos[1], A.marksPos[2]);
      d.marks.rotation.x = A.marksTilt;
      d.marks.scale.setScalar(shown * A.marksScale);
      d.solid.position.x = -A.marksSpread;
      d.hatched.position.x = A.marksSpread;
      const say = smoothstep(sub(p, B_WORDS[k][0], B_WORDS[k][1]));
      for (let i = 0; i < d.markWords.length; i++) {
        d.markWords[i].position.x = (i - 1) * A.marksSpread;
        d.markWords[i].position.y = A.markWordsY;
        d.markWords[i].material.opacity = say;
        d.markWords[i].visible = say > OP_MIN;
      }
      const fourthOp = smoothstep(sub(p, B_FOURTH[k][0], B_FOURTH[k][1]));
      d.fourth.position.y = A.fourthY;
      d.fourth.material.opacity = fourthOp;
      d.fourth.visible = fourthOp > OP_MIN;
    }
  },
};
