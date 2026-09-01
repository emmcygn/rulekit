// Chapter 03 — "The sentence compiles".
//
// The protocol's own sentence hangs in the air as a strip of phrase tokens.
// Over four sub-beats the grammar drops away, the three load-bearing words fly
// forward and take their posts as a 3D node tree (boxes joined by tubes), the
// tree wires itself up and a blue pulse runs down it as it evaluates, and the
// original wording arrives above the logic on an accent tether — carried along,
// word for word.
//
// The four beats are the same four steps as plain.html's `#p-compile` scrub:
//   0.00-0.25  the statute line, as the protocol states it
//   0.25-0.50  the three load-bearing words; the rest is grammar
//   0.50-0.75  the words take their posts
//   0.75-1.00  the verbatim line rides along
// The 3D timings below run a little ahead of those boundaries because the
// camera drifts past this room from p≈0.88 and hands off to station 4 — every
// beat has to have landed while the room is still in frame.
//
// Contract notes (see ./_stub.js): authored in station-local space; nothing is
// offset by ctx.station; build() never reads ctx.portrait — both orientations
// are laid out here and update() picks one; every string handed to
// makeTextTexture is fixed for the life of the page.

import * as THREE from 'three';
import { makeTextTexture } from '../lib/textures.js';
import { makeContactShadow } from '../lib/contactShadow.js';
import { createSwarm } from '../lib/instancedSwarm.js';
import { cloneOwned } from '../lib/materials.js';
import { sub, smoothstep, lerp, clamp01 } from '../lib/easing.js';

// The statute's own words. `load` marks the three that actually carry the law.
const TOKENS = [
  { t: 'participants', load: false }, { t: 'are', load: false }, { t: 'required', load: false },
  { t: 'to', load: false }, { t: 'have', load: false }, { t: 'an', load: false },
  { t: 'eGFR', load: true }, { t: 'of', load: false }, { t: 'at least', load: true },
  { t: '30', load: true }, { t: 'at', load: false }, { t: 'screening', load: false },
];

const POST_LABEL = ['fact: egfr', 'op: gte', 'value: 30'];
const ROOT_LABEL = 'egfr-min';
const SRC_LABEL = 'the protocol · section 5.2';
const VERB_TAG = 'verbatim';
const VERB_TEXT = '"eGFR at least 30 mL/min/1.73m²"';

const TOKEN_H = 0.22;
const TOKEN_GAP = 0.10;
const LABEL_H = 0.16;
const SRC_H = 0.11;
const VERB_H = 0.16;
const VERB_TAG_H = 0.105;

const NODE_W = 1.15, NODE_H = 0.42, NODE_D = 0.26;
const ROOT_W = 1.55;
const TUBE_R = 0.021;
const PULSES_PER_BRANCH = 4;

// Sub-beat windows. Everything is complete by ~0.88, where the camera turns
// away toward station 4.
const B_DIM = [0.25, 0.46];      // grammar greys out
const B_FLY = [0.48, 0.68];      // the three words fly to their posts
const B_VANISH = [0.50, 0.64];   // the greyed grammar leaves altogether
const B_SRC = [0.50, 0.62];      // ...and so does the source tag
const B_POP = [0.52, 0.66];      // leaf nodes pop in (staggered per node)
const B_ROOT = [0.58, 0.72];     // the root node
const B_VERB = [0.66, 0.78];     // the verbatim line
const B_TETHER = [0.70, 0.82];   // the accent tether that attaches it
const B_PULSE = [0.70, 0.90];    // the tree evaluates

const TUBE_COLD = new THREE.Color(0xCBD3DA);
const TUBE_LIVE = new THREE.Color(0x7FA8C9);

// Reused every frame; update() allocates nothing.
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

// Greedy line wrap. Landscape passes maxW = Infinity and gets one row back;
// portrait passes a real width and gets the sentence stacked.
function wrapRows(widths, gap, maxW, rowGap) {
  const rows = [[]];
  let w = 0;
  for (let i = 0; i < widths.length; i++) {
    const cur = rows[rows.length - 1];
    const add = cur.length ? gap + widths[i] : widths[i];
    if (cur.length && w + add > maxW) { rows.push([i]); w = widths[i]; }
    else { cur.push(i); w += add; }
  }
  const out = new Array(widths.length);
  const top = ((rows.length - 1) / 2) * rowGap;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let total = 0;
    for (let k = 0; k < row.length; k++) total += widths[row[k]] + (k ? gap : 0);
    let x = -total / 2;
    for (let k = 0; k < row.length; k++) {
      const i = row[k];
      x += widths[i] / 2;
      out[i] = { x, y: top - r * rowGap };
      x += widths[i] / 2 + gap;
    }
  }
  return out;
}

// One orientation's whole composition, in station-local space. Both are built
// up front and update() switches between them, because ctx.portrait flips
// mid-session and anything decided at build time would be stale.
//
// `tubes` are authored as (start, unit direction, length) so they can grow out
// from the root rather than fading in place. `rz` is 0 for a vertical run and
// PI/2 for a horizontal one — a cylinder is symmetric, so the sign never
// matters.
const HALF = Math.PI / 2;

function landscapeLayout() {
  const postX = [-1.62, 0, 1.62];
  const bus = 0.30, rootY = 1.02, leafY = -0.42, top = NODE_H / 2;
  return {
    stripZ: -5.2, stripY: 1.05, stripMaxW: Infinity, stripRowGap: 0,
    srcY: 1.62,
    tree: [0.35, 0.55, -10.9],
    root: [0, rootY],
    posts: [[postX[0], leafY], [postX[1], leafY], [postX[2], leafY]],
    ghost: [0, 0.42, 0.26],
    tubes: [
      { sx: 0, sy: rootY - top, dx: 0, dy: -1, len: (rootY - top) - (leafY + top), rz: 0 },
      { sx: 0, sy: bus, dx: -1, dy: 0, len: -postX[0], rz: HALF },
      { sx: 0, sy: bus, dx: 1, dy: 0, len: postX[2], rz: HALF },
      { sx: postX[0], sy: bus, dx: 0, dy: -1, len: bus - (leafY + top), rz: 0 },
      { sx: postX[2], sy: bus, dx: 0, dy: -1, len: bus - (leafY + top), rz: 0 },
    ],
    // root bottom -> bus -> across -> leaf top
    branch: (i) => [[0, rootY - top], [0, bus], [postX[i], bus], [postX[i], leafY + top]],
    shadow: { y: -0.60, r: 2.6 },
    verb: [0.35, 2.36, -10.9],
    tether: { x: 0.35, y0: 1.78, y1: 2.28 },
  };
}

function portraitLayout() {
  const rootX = -0.55, rootY = 1.20, leafX = 0.45;
  const leafY = [0.34, -0.44, -1.22];
  const side = NODE_W / 2, top = NODE_H / 2;
  const stub = (leafX - side) - rootX;
  return {
    stripZ: -4.9, stripY: 1.15, stripMaxW: 2.7, stripRowGap: 0.36,
    srcY: 2.02,
    tree: [0.15, 0.30, -9.6],
    root: [rootX, rootY],
    posts: [[leafX, leafY[0]], [leafX, leafY[1]], [leafX, leafY[2]]],
    ghost: [0, 0.38, 0.26],
    tubes: [
      { sx: rootX, sy: rootY - top, dx: 0, dy: -1, len: (rootY - top) - leafY[2], rz: 0 },
      { sx: rootX, sy: leafY[0], dx: 1, dy: 0, len: stub, rz: HALF },
      { sx: rootX, sy: leafY[1], dx: 1, dy: 0, len: stub, rz: HALF },
      { sx: rootX, sy: leafY[2], dx: 1, dy: 0, len: stub, rz: HALF },
      { sx: rootX, sy: rootY - top, dx: 0, dy: -1, len: 0, rz: 0 },
    ],
    branch: (i) => [[rootX, rootY - top], [rootX, leafY[i]], [leafX - side, leafY[i]], [leafX - side, leafY[i]]],
    shadow: { y: -1.34, r: 1.5 },
    // pushed right of the tree's own centre so the "verbatim" tag keeps a
    // margin on the left edge of a 390px frame
    verb: [0.32, 2.25, -9.6],
    tether: { x: rootX + 0.15, y0: 1.71, y1: 2.17 },
  };
}

// Cumulative arc length along a branch polyline, so a pulse moves at a constant
// speed instead of jumping at each corner.
function measure(points) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    const d = Math.hypot(dx, dy);
    seg.push(d);
    total += d;
  }
  return { points, seg, total };
}

function pulseAt(branch, u, out) {
  const { points, seg, total } = branch;
  if (total <= 0) return out.set(points[0][0], points[0][1], 0);
  let want = clamp01(u) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const t = seg[i] > 0 ? clamp01(want / seg[i]) : 1;
      return out.set(
        lerp(points[i][0], points[i + 1][0], t),
        lerp(points[i][1], points[i + 1][1], t),
        0,
      );
    }
    want -= seg[i];
  }
  return out.set(points[points.length - 1][0], points[points.length - 1][1], 0);
}

export default {
  id: '03-compile',
  budget: { calls: 40, tris: 9000 },

  build(ctx) {
    const g = new THREE.Group();
    const L = landscapeLayout();
    const P = portraitLayout();

    // ── the statute line, as a strip of phrase tokens ────────────────────
    const tokens = [];
    const widths = [];
    let post = 0;
    for (const tok of TOKENS) {
      const m = textMesh(tok.t, TOKEN_H, '#1A1D21');
      m.userData.load = tok.load;
      m.userData.post = tok.load ? post++ : -1;
      widths.push(m.userData.w);
      g.add(m);
      tokens.push(m);
    }
    const homeL = wrapRows(widths, TOKEN_GAP, L.stripMaxW, L.stripRowGap);
    const homeP = wrapRows(widths, TOKEN_GAP, P.stripMaxW, P.stripRowGap);

    const src = textMesh(SRC_LABEL, SRC_H, '#858D95');
    g.add(src);

    // ── the node tree the three words compile into ───────────────────────
    const tree = new THREE.Group();
    g.add(tree);

    const nodeGeo = new THREE.BoxGeometry(NODE_W, NODE_H, NODE_D);
    const nodes = [];
    for (let i = 0; i < 3; i++) {
      const box = new THREE.Mesh(nodeGeo, ctx.materials.bone);
      const label = textMesh(POST_LABEL[i], LABEL_H, '#1A1D21');
      label.position.set(0, 0, NODE_D / 2 + 0.005);
      box.add(label);
      box.scale.setScalar(0.0001);
      tree.add(box);
      nodes.push(box);
    }
    const root = new THREE.Mesh(new THREE.BoxGeometry(ROOT_W, NODE_H, NODE_D), ctx.materials.bone);
    const rootLabel = textMesh(ROOT_LABEL, LABEL_H, '#1A1D21');
    rootLabel.position.set(0, 0, NODE_D / 2 + 0.005);
    root.add(rootLabel);
    root.scale.setScalar(0.0001);
    tree.add(root);

    // One owned material for all five tubes: it warms from rule grey toward
    // data blue as the tree evaluates, which is one color write per frame.
    const tubeMat = cloneOwned(ctx.materials.bone);
    tubeMat.color.copy(TUBE_COLD);
    const tubeGeo = new THREE.CylinderGeometry(TUBE_R, TUBE_R, 1, 6);
    const tubes = [];
    // spine first, then the run across, then the drops into the leaves
    const tubeWin = [[0.62, 0.72], [0.65, 0.75], [0.65, 0.75], [0.70, 0.80], [0.70, 0.80]];
    for (let i = 0; i < 5; i++) {
      const t = new THREE.Mesh(tubeGeo, tubeMat);
      t.visible = false;
      tree.add(t);
      tubes.push(t);
    }

    // The evaluation pulse: one instanced swarm, one draw call for all of it.
    const swarm = createSwarm({
      geometry: new THREE.BoxGeometry(1, 1, 1),
      material: ctx.materials.data,
      count: 3 * PULSES_PER_BRANCH,
    });
    tree.add(swarm.mesh);

    const shadow = makeContactShadow(ctx.materials, { radius: 1, opacity: 0.2 });
    shadow.visible = false;
    g.add(shadow);

    // ── the verbatim line, one line above the logic ──────────────────────
    const verb = new THREE.Group();
    const vbText = textMesh(VERB_TEXT, VERB_H, '#3A4148');
    const vbTag = textMesh(VERB_TAG, VERB_TAG_H, '#858D95');
    vbTag.position.x = -(vbText.userData.w / 2 + 0.10 + vbTag.userData.w / 2);
    verb.add(vbText, vbTag);
    verb.visible = false;
    g.add(verb);

    // The single accented element in this room: the tether that attaches the
    // protocol's own wording to the rule it compiled into.
    const tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 1, 6),
      ctx.materials.accent,
    );
    tether.visible = false;
    g.add(tether);

    Object.assign(g.userData, {
      L, P, tokens, homeL, homeP, src, tree, nodes, root, tubes, tubeWin, tubeMat,
      swarm, shadow, verb, vbText, vbTag, tether,
      branchL: [measure(L.branch(0)), measure(L.branch(1)), measure(L.branch(2))],
      branchP: [measure(P.branch(0)), measure(P.branch(1)), measure(P.branch(2))],
    });
    return g;
  },

  update(g, p, ctx) {
    const d = g.userData;
    const portrait = !!(ctx && ctx.portrait);
    const A = portrait ? d.P : d.L;
    const home = portrait ? d.homeP : d.homeL;
    const branches = portrait ? d.branchP : d.branchL;

    const dim = smoothstep(sub(p, B_DIM[0], B_DIM[1]));
    const vanish = smoothstep(sub(p, B_VANISH[0], B_VANISH[1]));
    const fly = smoothstep(sub(p, B_FLY[0], B_FLY[1]));
    const rootPop = smoothstep(sub(p, B_ROOT[0], B_ROOT[1]));
    const verbIn = smoothstep(sub(p, B_VERB[0], B_VERB[1]));
    const tetherIn = smoothstep(sub(p, B_TETHER[0], B_TETHER[1]));
    const live = smoothstep(sub(p, B_PULSE[0], B_PULSE[1]));

    d.tree.position.set(A.tree[0], A.tree[1], A.tree[2]);

    // ── beats 1 & 2: the sentence, then the grammar stepping back ────────
    for (let i = 0; i < d.tokens.length; i++) {
      const m = d.tokens[i];
      const h = home[i];
      if (m.userData.load) {
        const post = A.posts[m.userData.post];
        const tx = A.tree[0] + post[0] + A.ghost[0];
        const ty = A.tree[1] + post[1] + A.ghost[1];
        const tz = A.tree[2] + A.ghost[2];
        m.position.set(
          lerp(h.x, tx, fly),
          lerp(A.stripY + h.y, ty, fly),
          lerp(A.stripZ, tz, fly),
        );
        m.material.opacity = lerp(1, 0.32, fly);
      } else {
        m.position.set(h.x, A.stripY + h.y, A.stripZ);
        m.material.opacity = lerp(1, 0.2, dim) * (1 - vanish);
      }
      m.visible = m.material.opacity > 0.004;
    }
    d.src.position.set(0, A.srcY, A.stripZ + 0.02);
    d.src.material.opacity = 1 - smoothstep(sub(p, B_SRC[0], B_SRC[1]));
    d.src.visible = d.src.material.opacity > 0.004;

    // ── beat 3: the words take their posts ───────────────────────────────
    for (let i = 0; i < d.nodes.length; i++) {
      const n = d.nodes[i];
      const pop = smoothstep(sub(p, B_POP[0] + i * 0.04, B_POP[1] + i * 0.04));
      n.position.set(A.posts[i][0], A.posts[i][1], 0);
      n.scale.setScalar(Math.max(0.0001, pop));
      n.visible = pop > 0.002;
    }
    d.root.position.set(A.root[0], A.root[1], 0);
    d.root.scale.setScalar(Math.max(0.0001, rootPop));
    d.root.visible = rootPop > 0.002;

    for (let i = 0; i < d.tubes.length; i++) {
      const t = d.tubes[i];
      const s = A.tubes[i];
      const w = smoothstep(sub(p, d.tubeWin[i][0], d.tubeWin[i][1])) * s.len;
      t.visible = w > 0.002;
      if (!t.visible) continue;
      t.position.set(s.sx + s.dx * w * 0.5, s.sy + s.dy * w * 0.5, 0);
      t.rotation.z = s.rz;
      t.scale.set(1, w, 1);
    }
    d.tubeMat.color.copy(TUBE_COLD).lerp(TUBE_LIVE, live);

    d.shadow.position.set(A.tree[0], A.shadow.y, A.tree[2]);
    d.shadow.scale.set(A.shadow.r * 2, A.shadow.r * 2, 1);
    d.shadow.material.opacity = 0.2 * rootPop;
    d.shadow.visible = rootPop > 0.01;

    // ── beat 4: the original wording rides along ─────────────────────────
    d.verb.position.set(A.verb[0], A.verb[1], A.verb[2]);
    d.verb.visible = verbIn > 0.004;
    d.vbText.material.opacity = verbIn;
    d.vbTag.material.opacity = verbIn * 0.9;

    const tl = (A.tether.y1 - A.tether.y0) * tetherIn;
    d.tether.visible = tl > 0.002;
    d.tether.position.set(A.tether.x, A.tether.y0 + tl * 0.5, A.tree[2]);
    d.tether.scale.set(1, tl, 1);

    // the tree lights up as it evaluates
    const sw = d.swarm;
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < PULSES_PER_BRANCH; k++) {
        const u = clamp01(live * 1.9 - i * 0.06 - k * 0.16);
        const s = (u <= 0 || u >= 1) ? 0 : 0.085 * Math.sin(Math.PI * u);
        pulseAt(branches[i], u, _v);
        sw.setAt(i * PULSES_PER_BRANCH + k, _v, s, 0, 1);
      }
    }
    sw.commit();
  },
};
