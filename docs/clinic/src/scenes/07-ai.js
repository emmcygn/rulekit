// Chapter 07 — "The AI part".
//
// The claim this room has to make good on, from `#ai-intro`: *the AI reads, it
// never decides.* Two set pieces, both on the left of the flight path, staged so
// the camera flies past them and never through them:
//
//   1. THE READING TABLE (station-local ~(-4.4, 0.1, -8.6)). A stream of
//      document pages drifts past a hovering reading lens. One of them — the
//      note — is the hero: the lens scans down it, three lines highlight as they
//      are read, and three suggestions lift off the page. Every suggestion
//      carries a TETHER back to the exact line it was read from.
//   2. THE APPROVAL DOOR (station-local ~(-3.0, 0, -13.2)), further down the
//      path, with the verdict gate from chapter 04 waiting behind it in the fog.
//      The door is closed. It is the single accent element in the room, and it
//      never opens on any progress value.
//
// TWO INVARIANTS, because breaking either one would contradict `#p-ai`:
//
//   A. A QUOTE IS NEVER UNTETHERED. The tether is not animated — it is DERIVED
//      every frame from the two things it joins (the highlighted source line on
//      the note, and the card that quotes it). A card starts life sitting on its
//      own source line, so the tether starts at zero length and grows with the
//      card. `tether.visible = card.visible` is assigned, not computed twice, so
//      the two cannot disagree. There is no code path that draws a card without
//      its receipt.
//   B. THE DOOR NEVER OPENS. No update() line writes door rotation or door
//      position; the leaves are posed once in build() and never touched again.
//      Nothing crosses the threshold on any p, forward or backward. The only
//      motion on that side of the room is the reviewer's mark landing on the
//      NEAR side of it.
//
// Contract notes (see ./_stub.js): authored in station-local space; nothing is
// offset by ctx.station; build() never reads ctx.portrait — both orientations
// are laid out here and update() picks one; every string handed to
// makeTextTexture is fixed for the life of the page; update() allocates nothing.

import * as THREE from 'three';
import { makeTextTexture, makePageTexture } from '../lib/textures.js';
import { makeContactShadow } from '../lib/contactShadow.js';
import { createSwarm } from '../lib/instancedSwarm.js';
import { cloneOwned, COLORS } from '../lib/materials.js';
import { sub, smoothstep, lerp } from '../lib/easing.js';

// ── the note, and what the AI reads off it ────────────────────────────────
// Every quote below is a word-for-word substring of the synthetic note in
// plain.html's `#p-ai`. That is the whole point of the tether: the receipt has
// to match the source, or the suggestion does not exist.
const NOTE_W = 1.70, NOTE_H = 2.20;
const NOTE_LINES = 14;

// Line rows on the page texture, in note-local space. makePageTexture lays its
// rules out from h*0.14 in steps of h*0.78/lines, with a w*0.12 margin — these
// three land on real drawn lines rather than on blank paper.
const lineY = (i) => NOTE_H * (0.5 - (0.14 + i * (0.78 / NOTE_LINES)));
const MARGIN_X = -NOTE_W * (0.5 - 0.12);

const SUGGESTIONS = [
  { row: 4,  bar: 1.15, fact: 'nyha_class = III',      quote: '"NYHA class III heart failure"' },
  { row: 7,  bar: 0.92, fact: 'hf_hospitalized = yes', quote: '"decompensated heart failure"' },
  { row: 10, bar: 1.26, fact: 'activity = limited',    quote: '"marked limitation of physical activity"' },
];
const CARDS = SUGGESTIONS.length;

// The band of pages sits below the middle of the table so the suggestions have
// clear air to rise into: the note reads as something on a desk, the cards as
// something lifted off it.
const BAND_Y = -0.95;

// Where each card comes to rest, in table-local space: stacked up and toward
// the viewer, clear of the lens and of the page band behind it. Three
// constraints box these numbers in, and all three were measured — by
// projecting the card's own corners with the real camera keys over the beat
// window p ∈ [0.55, 0.72] — rather than guessed.
//
//   FLOOR (y > 0.60). Not a height: a sightline. Below y ≈ 0.60 the eye ray
//   through the card's grey quote line carries on into the ruled paper of the
//   stream drifting past behind it, and grey on grey is not a receipt anyone
//   can check. 1.35 keeps 0.75 of clearance.
//
//   CEILING (y < ~2.1). The frame. The camera passes the table 3-5u away, so
//   a card at height y sits about atan(y / 4) above the eye line and landscape
//   only has ±25° to give. The stack used to top out at 2.90 — 35° up — and
//   the top card, nyha_class = III, the primary suggestion and the one the
//   chapter is actually about, left through the top of the frame at p ≈ 0.60
//   and took its tether with it. 2.07 is 27° at p = 0.55 and closer to 22° by
//   p = 0.72, which holds.
//
//   LEFT OF THE DOOR (x ≈ -0.6). Coming down the stack put it across the one
//   accent object in the room: grey quote text on an orange leaf. The cards
//   are text with no plate behind them, so they need bare fog to read against.
//   Held at x ≈ -0.6 the widest of them still clears the door's near jamb by
//   0.1 of NDC through the whole window.
//
// Worst margin over the window, worst corner of any card and either end of any
// tether: 0.21 of NDC inside the frame, against +0.42 OUTSIDE it before.
const CARD_HOME = [
  [-0.55, 2.07, 0.95],
  [-0.40, 1.71, 1.25],
  [-0.65, 1.35, 1.55],
];

const NOTE_LABEL = 'synthetic note · patient SYN-042';
const DOOR_LABEL = 'a person approves, or it does not exist';

// ── beats ─────────────────────────────────────────────────────────────────
// The note crosses under the lens between p ≈ 0.25 and p ≈ 0.75, so the reading
// and the lifting both happen while it is genuinely under the glass.
const NOTE_X0 = 1.70, NOTE_X1 = -1.70;
const B_READ = [[0.26, 0.40], [0.33, 0.47], [0.40, 0.54]];
const B_LIFT = [[0.36, 0.54], [0.43, 0.61], [0.50, 0.68]];
const B_SCAN = [0.24, 0.58];     // the lens travelling down the three lines
// Both door beats finish by p ≈ 0.78: from p = 0.88 the rig converges on
// chapter 08's opening pose and swings the door toward the frame edge, and in
// portrait's ~31°-wide frame it is gone by p ≈ 0.85.
const B_LABEL = [0.54, 0.70];    // the line under the door
const B_MARK = [0.58, 0.78];     // the reviewer's mark landing

// ── the page stream ───────────────────────────────────────────────────────
const BAND_IN = 2.90, BAND_OUT = -3.90, BAND_Z = -0.62;
const PAGE_W = 1.30, PAGE_H = 1.68;
const STREAM_SPEED = 0.55;
const FADE = 0.10;               // fraction of the run spent scaling in/out

// ── the door ──────────────────────────────────────────────────────────────
const LEAF_W = 1.30, LEAF_H = 3.36, LEAF_D = 0.14;
const LEAF_Y = 0.45;
const JAMB_X = 1.42;

// Reused every frame; update() allocates nothing.
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// Landscape and portrait are both laid out up front and update() picks one:
// ctx.portrait flips mid-session, so nothing here may be decided in build().
//
// Portrait is ~31° wide against landscape's ~75°. The two set pieces are 28° of
// bearing apart from the landscape flight line, which simply does not fit, so
// portrait pulls both of them in toward the path to close that to ~13° — the
// reading table and the closed door still share the frame around p ≈ 0.6, which
// is the one shot that carries the whole claim.
//
// The table sits at z = -8.6 rather than -6.6 for the same framing reason the
// card stack came down. The camera is past z = -3.6 by p = 0.72; a table at
// -6.6 is only 3.0u ahead of it by then and has swung 60° off the flight line,
// which drags the note — and therefore the far end of every tether — out
// through the left edge. At -8.6 it is 5.0u ahead and 46° off, the note stays
// in frame through the whole beat, and the two set pieces are 4.6u apart
// instead of 6.6u, which is what lets one shot hold both.
function landscapeLayout() {
  return {
    table: [-4.40, 0.10, -8.60], tableYaw: 0.60, tableScale: 1.00,
    door: [-3.00, 0.00, -13.20], doorYaw: 0.42, doorScale: 1.00,
    // Dead in line with the door on x, so the door is literally in the way of
    // it and the parallax of flying past is the only thing that reveals it.
    gate: [-3.00, 0.15, -16.20], gateYaw: 0.42,
  };
}

function portraitLayout() {
  return {
    // Moved forward with the landscape table, and scaled UP to pay for it.
    // Portrait reads the two set pieces in sequence rather than in one shot, and
    // its note beat is composed at p ≈ 0.45; the extra 1.7u of distance would
    // shrink exactly that shot by ~20%, so the table grows by the same ratio and
    // the beat lands the size it was composed at. What the move buys is the far
    // end: the note and its tethers are 0.8 of NDC less far outside the frame at
    // p = 0.72 than before.
    table: [-3.10, 0.55, -8.60], tableYaw: 0.44, tableScale: 1.14,
    door: [-1.70, 0.35, -13.60], doorYaw: 0.26, doorScale: 0.92,
    gate: [-1.70, 0.50, -16.40], gateYaw: 0.26,
  };
}

// A text plane whose origin is its LEFT edge, so a card's fact and its quote
// line up on the left the way a receipt does — and so the tether has an obvious
// place to attach.
function textMesh(text, height, color, px) {
  const tex = makeTextTexture(text, { px, color });
  const w = height * (tex.userData.aspect || 4);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, height),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.position.x = w / 2;
  m.userData.w = w;
  return m;
}

// Centred variant, for standalone captions.
function captionMesh(text, height, color, px) {
  const m = textMesh(text, height, color, px);
  m.position.x = 0;
  return m;
}

export default {
  id: '07-ai',
  // Measured, not guessed: swept p 0 -> 1 at 0.005 in a real WebGL context with
  // every other room hidden, this room peaks at 30 draw calls and 908 triangles
  // — both at p = 0.59, the frame where the three cards, the three tethers, the
  // reviewer's mark and the door's line are all on screen at once. Identical in
  // both orientations. The stream is the only thing the quality tier thins, and
  // it is one InstancedMesh either way.
  budget: { calls: 30, tris: 1500 },

  build(ctx) {
    const g = new THREE.Group();

    // One owned clone of the shared line material, recoloured for the two
    // drawn outlines in this room. cloneOwned, never .clone(): a plain clone
    // comes back still marked userData.shared and would never be freed.
    const outline = cloneOwned(ctx.materials.line);
    outline.color.setHex(0x9AA3AB);

    // ── 1. the reading table ─────────────────────────────────────────────
    const table = new THREE.Group();
    g.add(table);

    // The band itself — stream, note and lens — dropped below the table's
    // origin, so the cards have empty air to rise into.
    const board = new THREE.Group();
    board.position.y = BAND_Y;
    table.add(board);

    // The stream of other notes, drifting past behind the hero note. One
    // InstancedMesh, one draw call, sized by the quality tier.
    const streamCount = Math.max(3, ctx.quality.count(9));
    const stream = createSwarm({
      geometry: new THREE.PlaneGeometry(PAGE_W, PAGE_H),
      material: new THREE.MeshBasicMaterial({
        map: makePageTexture({ w: 320, h: 414, lines: 16, seed: 23 }),
        color: 0xE9EDF1,          // tinted off-white, or it vanishes into the fog
        transparent: true,
        depthWrite: false,
      }),
      count: streamCount,
    });
    board.add(stream.mesh);

    // The hero note: the one the lens is actually reading.
    const noteGeo = new THREE.PlaneGeometry(NOTE_W, NOTE_H);
    const note = new THREE.Mesh(noteGeo, new THREE.MeshBasicMaterial({
      map: makePageTexture({ w: 384, h: 496, lines: NOTE_LINES, seed: 12 }),
      color: 0xFBFCFD,
      transparent: true,
      depthWrite: false,
    }));
    board.add(note);
    // Drawn edge, so a white page still reads against white fog. Nudged off
    // the page face: the note draws in the transparent pass, after the line
    // does, and would otherwise paint over its own border.
    const noteEdge = new THREE.LineSegments(new THREE.EdgesGeometry(noteGeo), outline);
    noteEdge.position.z = 0.006;
    note.add(noteEdge);

    const noteLabel = captionMesh(NOTE_LABEL, 0.085, '#7A828A', 64);
    noteLabel.position.set(0, -NOTE_H / 2 - 0.16, 0.02);
    note.add(noteLabel);

    // The highlighter strokes. Geometry is translated so its origin is the LEFT
    // edge: a uniform instance scale then sweeps the stroke rightward along the
    // line, which is what reading one looks like.
    const barGeo = new THREE.PlaneGeometry(1, 0.09);
    barGeo.translate(0.5, 0, 0);
    const bars = createSwarm({
      geometry: barGeo,
      material: new THREE.MeshBasicMaterial({
        color: COLORS.data, transparent: true, opacity: 0.42, depthWrite: false,
      }),
      count: CARDS,
    });
    note.add(bars.mesh);

    // The reading lens, hovering at a fixed point over the band while the pages
    // pass under it. It scans DOWN the note as it reads the three lines.
    const lens = new THREE.Group();
    lens.position.set(0, 0, 0.45);
    lens.add(new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.030, 8, 40), ctx.materials.ink));
    lens.add(new THREE.Mesh(new THREE.CircleGeometry(0.53, 28), ctx.materials.glass));
    board.add(lens);

    // The suggestions, each one a fact plus the quote it is standing on, and
    // each one tethered to the line it was read from.
    const tetherGeo = new THREE.CylinderGeometry(0.011, 0.011, 1, 5);
    const cards = [];
    const tethers = [];
    for (let i = 0; i < CARDS; i++) {
      const card = new THREE.Group();
      const fact = textMesh(SUGGESTIONS[i].fact, 0.150, '#1A1D21', 72);
      const quote = textMesh(SUGGESTIONS[i].quote, 0.088, '#5A6169', 64);
      quote.position.y = -0.185;
      card.add(fact, quote);
      card.visible = false;
      table.add(card);
      cards.push({ group: card, fact, quote });

      const t = new THREE.Mesh(tetherGeo, ctx.materials.ink);
      t.visible = false;
      table.add(t);
      tethers.push(t);
    }

    // ── 2. the approval door: closed, and it stays closed ────────────────
    const door = new THREE.Group();
    g.add(door);

    // The one accent element in this room. Two leaves meeting on a visible
    // seam — the seam is the whole point, so it is authored, not animated.
    const leafGeo = new THREE.BoxGeometry(LEAF_W, LEAF_H, LEAF_D);
    for (const sx of [-1, 1]) {
      const leaf = new THREE.Mesh(leafGeo, ctx.materials.accent);
      leaf.position.set(sx * (LEAF_W / 2 + 0.015), LEAF_Y, 0);
      door.add(leaf);
    }
    const handleGeo = new THREE.BoxGeometry(0.055, 0.44, 0.07);
    for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(handleGeo, ctx.materials.ink);
      h.position.set(sx * 0.15, LEAF_Y, LEAF_D / 2 + 0.035);
      door.add(h);
    }

    const jambGeo = new THREE.BoxGeometry(0.18, LEAF_H + 0.30, 0.30);
    for (const sx of [-1, 1]) {
      const j = new THREE.Mesh(jambGeo, ctx.materials.bone);
      j.position.set(sx * JAMB_X, LEAF_Y, 0);
      door.add(j);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.02, 0.24, 0.30), ctx.materials.bone);
    lintel.position.set(0, LEAF_Y + LEAF_H / 2 + 0.12, 0);
    door.add(lintel);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(3.02, 0.16, 0.38), ctx.materials.bone);
    sill.position.set(0, LEAF_Y - LEAF_H / 2 - 0.08, 0.02);
    door.add(sill);
    // Bone on white fog is a value difference of almost nothing, so the whole
    // doorway gets a drawn silhouette. Without it the accent leaves read as a
    // rectangle floating in space rather than as a door in a frame.
    const doorEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * JAMB_X + 0.18, LEAF_H + 0.62, 0.30)),
      outline,
    );
    doorEdge.position.set(0, LEAF_Y + 0.02, 0);
    door.add(doorEdge);

    const shadow = makeContactShadow(ctx.materials, { radius: 1.85, opacity: 0.24 });
    shadow.position.set(0, LEAF_Y - LEAF_H / 2 - 0.17, 0.10);
    door.add(shadow);

    // The reviewer's mark: the solid ■ of the status language, landing on the
    // NEAR side of the door. Nothing goes through.
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.08), ctx.materials.ink);
    mark.position.set(0, LEAF_Y, LEAF_D / 2 + 0.24);
    mark.scale.setScalar(0.0001);
    door.add(mark);

    const doorLabel = captionMesh(DOOR_LABEL, 0.135, '#5A6169', 64);
    doorLabel.position.set(0, LEAF_Y - LEAF_H / 2 - 0.46, 0.20);
    doorLabel.material.opacity = 0;
    doorLabel.visible = false;
    door.add(doorLabel);

    // ── 3. the verdict gate, waiting on the other side ───────────────────
    // Chapter 04's gate, seen through the fog past a door that is shut. It is
    // drawn, never reached.
    const gate = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(3.20, 3.90, 0.50)),
      outline,
    );
    g.add(gate);

    Object.assign(g.userData, {
      L: landscapeLayout(), P: portraitLayout(),
      table, stream, streamCount, note, bars, lens, cards, tethers,
      door, mark, doorLabel, gate,
      // Precomputed per-suggestion source geometry, in note-local space.
      lineY: SUGGESTIONS.map((s) => lineY(s.row)),
      barW: SUGGESTIONS.map((s) => s.bar),
    });
    return g;
  },

  update(g, p, ctx) {
    const d = g.userData;
    const A = (ctx && ctx.portrait) ? d.P : d.L;

    d.table.position.set(A.table[0], A.table[1], A.table[2]);
    d.table.rotation.y = A.tableYaw;
    d.table.scale.setScalar(A.tableScale);
    d.door.position.set(A.door[0], A.door[1], A.door[2]);
    d.door.rotation.y = A.doorYaw;
    d.door.scale.setScalar(A.doorScale);
    d.gate.position.set(A.gate[0], A.gate[1], A.gate[2]);
    d.gate.rotation.y = A.gateYaw;

    // ── the stream never stops: the AI is always reading something ───────
    const stream = d.stream;
    for (let i = 0; i < d.streamCount; i++) {
      const t = ((i / d.streamCount) + p * STREAM_SPEED) % 1;
      // Instance colour multiplies the material colour, so fading a page by
      // colour would drive it toward BLACK against a white room. Fade by scale.
      const edge = t < FADE ? t / FADE : t > 1 - FADE ? (1 - t) / FADE : 1;
      _pos.set(
        lerp(BAND_IN, BAND_OUT, t),
        Math.sin(t * 5.6 + i) * 0.10,
        BAND_Z - (i % 3) * 0.44,
      );
      stream.setAt(i, _pos, smoothstep(edge), 0, 1);
    }
    stream.commit();

    // ── the hero note crosses under the lens ─────────────────────────────
    const noteX = lerp(NOTE_X0, NOTE_X1, p);
    d.note.position.set(noteX, 0, 0);

    // The lens travels down the three lines as it reads them.
    const scan = smoothstep(sub(p, B_SCAN[0], B_SCAN[1])) * (CARDS - 1);
    const s0 = Math.min(CARDS - 2, Math.floor(scan));
    d.lens.position.y = lerp(d.lineY[s0], d.lineY[s0 + 1], scan - s0) + 0.06;

    // ── the three suggestions, each one carrying its receipt ─────────────
    for (let i = 0; i < CARDS; i++) {
      const read = smoothstep(sub(p, B_READ[i][0], B_READ[i][1]));
      // The highlighter stroke sweeps left to right along the line it read.
      _pos.set(MARGIN_X, d.lineY[i], 0.012);
      d.bars.setAt(i, _pos, Math.max(0.0001, read * d.barW[i]), 0, 1);

      // The source point: the middle of that highlighted line, lifted out of
      // board space into table space (where the cards live). It moves with the
      // note, every frame, forever.
      _from.set(noteX + MARGIN_X + (d.barW[i] * 0.5), BAND_Y + d.lineY[i], 0.02);

      const lift = smoothstep(sub(p, B_LIFT[i][0], B_LIFT[i][1]));
      const home = CARD_HOME[i];
      const card = d.cards[i];
      // A card is born ON its own source line, so the tether it drags out
      // starts at zero length. There is no moment where one exists without the
      // other.
      card.group.position.set(
        lerp(_from.x, home[0], lift),
        lerp(_from.y, home[1], lift),
        lerp(_from.z, home[2], lift),
      );
      card.group.visible = lift > 0.004;
      card.fact.material.opacity = lift;
      card.quote.material.opacity = lift;

      // The tether is DERIVED from its two ends — never posed, never animated
      // independently. It attaches to the card's left edge, where the quote
      // starts.
      const tether = d.tethers[i];
      _to.set(card.group.position.x, card.group.position.y - 0.09, card.group.position.z);
      _dir.subVectors(_to, _from);
      const len = _dir.length();
      _pos.copy(_from).addScaledVector(_dir, 0.5);
      tether.position.copy(_pos);
      if (len > 1e-4) {
        _dir.multiplyScalar(1 / len);
        tether.quaternion.setFromUnitVectors(_up, _dir);
      }
      tether.scale.set(1, Math.max(1e-4, len), 1);
      // Assigned, not recomputed: a card can never be drawn without its line
      // back to the page.
      tether.visible = card.group.visible;
    }
    d.bars.commit();

    // ── the door does not move. the reviewer's mark lands in front of it ──
    const landed = smoothstep(sub(p, B_MARK[0], B_MARK[1]));
    d.mark.scale.setScalar(Math.max(0.0001, landed));
    d.mark.position.y = LEAF_Y + (1 - landed) * 0.85;
    d.mark.visible = landed > 0.002;

    const say = smoothstep(sub(p, B_LABEL[0], B_LABEL[1]));
    d.doorLabel.material.opacity = say;
    d.doorLabel.visible = say > 0.004;

    // Deliberately absent: any write to the door's leaves, to their positions
    // or to their rotation, and anything at all that crosses the threshold.
    // The door has no open state to animate, on this or any other progress
    // value — that is the claim the chapter is making.
  },
};
