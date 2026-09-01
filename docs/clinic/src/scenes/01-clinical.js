// Chapter 01 — "The clinical side". One rule, five readings, and the bill.
//
// Two beats, and the SECOND one is the set piece. First: five translucent
// copies of the same eligibility rule float in a row, start stacked so they
// look like one card, and fan apart until the numbers stop agreeing —
// 30 / 30 / over 30 / 30-ish / 40. Then they clear out, and the cost chart
// stands up front and centre: two matte bars at the Tufts Phase II and Phase
// III medians, with the share judged avoidable hatched onto the taller one.
//
// The bar HEIGHTS are proportional to the medians so the shape is honest; the
// figures themselves and the source line live in the HTML panel, never baked
// into the GL scene, because a number you cannot cite is decoration. The only
// text in the room is three fixed fragments — "Phase II", "Phase III",
// "~45% avoidable" — which name the bars without repeating the panel's money.
//
// ── Where the props sit, and why ──────────────────────────────────────────
// The camera runs local z ≈ +8.8 → -8.9 through this room, passing the station
// at p = 0.5, so anything at z ≈ 0 is something the camera flies through. The
// cards therefore sit at z -2.6…-4.4 and ride high at y ≈ 1.75, and from
// p = 0.42 they lift and sweep back over the camera — up as well as back, so
// they leave the frame by the top rather than smearing across the lens exactly
// as the bars are rising into it.
//
// The chart is at (0.5, -2.4, -13.6) station-local: nearly ON the flight axis,
// which is what lets the camera meet it head-on instead of glancing at it from
// the side. It is 4.7u AHEAD of the camera when this chapter ends, and chapter
// 02's run — which is when this room is last resident — swings out to local
// x ≈ -4.8 by the time it reaches that depth, so the closest the camera ever
// comes to any part of the chart is ~3.3u. Nothing here is flown through.
//
// ── Why the chart moved, and why the camera turned with it ────────────────
// It used to sit at (1.8, -3.4, -11.6) with the camera aimed at its own x. In
// landscape chapter 01 docks its card on the RIGHT, so everything from ndc
// x = 0.10 rightward is behind frosted glass — and the chart landed at ndc
// x = 0.16…0.28. The whole cost chart, the chapter's evidence, was rendering
// behind the panel; the one bar you could see was the SHORT one, poking out at
// frame-bottom-centre. The fix is both halves at once: the chart moved onto the
// axis, and cameraKeys' 01-clinical p = 0.84 key now aims ~28° to its right, so
// the bars compose in the clear left of the frame instead of under the card.
// Measured at p = 0.84, 1280x800: bars and labels span ndc x -0.77…-0.12,
// y -0.80…0.84 — 74% of the frame's height, entirely clear of the card edge.
//
// Portrait's horizontal frustum is ~31° against landscape's ~74°, so the fan
// and the chart are both narrowed at update time (never at build time — the
// phone can turn after the room exists). Portrait also docks its card across
// the bottom 46svh, i.e. ndc y = -0.08 down, so the chart is composed to sit
// wholly above that line: at p = 0.84, 390x844, the bars and their labels span
// ndc y 0.02…0.90, with the lowest ink 0.10 of ndc clear of the card.
//
// Sizes: the taller bar is 4.815u and the shorter 1.269u, which is 535 and 141
// at 0.9u per $100K. Those are unchanged — the bars were never too small in
// world units, they were in the wrong half of the frame.

import * as THREE from 'three';
import { makeTextTexture } from '../lib/textures.js';
import { makeContactShadow } from '../lib/contactShadow.js';
import { cloneOwned } from '../lib/materials.js';
import { sub, smoothstep, lerp } from '../lib/easing.js';

// The five readings of one law, and the number each one ended up with.
const COPIES = [
  { tag: 'the protocol',        num: '30' },
  { tag: 'screening sheet',     num: '30' },
  { tag: "nurse's checklist",   num: 'over 30' },
  { tag: 'training slides',     num: '30-ish' },
  { tag: 'next draft',          num: '40' },
];

const PHASE_II = 141, PHASE_III = 535, AVOIDABLE = 0.45;
const UNITS_PER_100K = 0.9;

const CARD_Y = 1.75;
const CARD_Z = -2.6, CARD_DZ = -0.45;
// Station-local. See the header: on the axis, and 13.6u out so a 4.8u bar has
// somewhere to stand.
const CHART = { x: 0.5, y: -2.4, z: -13.6 };
// A bar is a slab, not a stick: 1.25u square in plan, 1.12u either side of the
// chart's centre, so the pair reads as a chart from 8u away.
const BAR_W = 1.25, BAR_GAP = 1.12;
const PORTRAIT_CHART = 0.8;

// The hatch tile is repeat-wrapped, and `repeat` lives on the TEXTURE, which is
// shared and module-cached — so a room may not set it. Bake the tiling into the
// geometry's own uvs instead. Equal world-space cells on u and v keep the
// diagonals at 45°; anything else shears them.
function tileUV(geo, uRepeat, vRepeat) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uRepeat, uv.getY(i) * vRepeat);
  uv.needsUpdate = true;
  return geo;
}

function labelPlane(text, height, color) {
  const tex = makeTextTexture(text, { px: 72, color });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(height * (tex.userData.aspect || 4), height), mat);
}

export default {
  id: '01-clinical',
  // 28 drawables: five cards at four each (face, outline, tag, number), plus
  // the chart's two bars, its hatched sleeve, three labels, its baseline rule
  // and its contact shadow. Measured, not guessed — tests/budget.test.js counts
  // every Mesh, Line and Points the build returns.
  budget: { calls: 28, tris: 80 },

  build(ctx) {
    const g = new THREE.Group();

    // ── the five readings ───────────────────────────────────────────────────
    // One plane geometry and one border loop, five faces: both are this room's
    // own, so both are freed with the room. The glass face alone is invisible
    // against a white ground, so each copy also carries a rule-grey outline —
    // an outline, not a tint, because colour in this piece never encodes status.
    const cards = [];
    const cardGeo = new THREE.PlaneGeometry(2.6, 1.1);
    const edgeGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1.3, -0.55, 0), new THREE.Vector3(1.3, -0.55, 0),
      new THREE.Vector3(1.3, 0.55, 0), new THREE.Vector3(-1.3, 0.55, 0),
      new THREE.Vector3(-1.3, -0.55, 0),
    ]);
    COPIES.forEach((copy, i) => {
      const card = new THREE.Group();
      card.add(new THREE.Mesh(cardGeo, ctx.materials.glass));
      card.add(new THREE.Line(edgeGeo, ctx.materials.line));
      const tag = labelPlane(copy.tag, 0.15, '#585F66');
      tag.position.set(-0.18, 0.33, 0.01);
      const num = labelPlane(copy.num, 0.34, '#1A1D21');
      num.position.set(-0.18, -0.08, 0.01);
      card.add(tag, num);
      card.position.set(0, CARD_Y, CARD_Z + i * CARD_DZ);
      g.add(card);
      cards.push(card);
    });

    // ── the cost chart ──────────────────────────────────────────────────────
    // The group's origin is the FOOT of the bars, so scaling it in portrait
    // shrinks the chart toward the floor rather than around its own middle.
    const chart = new THREE.Group();
    chart.position.set(CHART.x, CHART.y, CHART.z);

    const hII = (PHASE_II / 100) * UNITS_PER_100K;
    const hIII = (PHASE_III / 100) * UNITS_PER_100K;
    const bandH = hIII * AVOIDABLE;

    // Unit-height boxes scaled on y at update time, so one geometry covers both
    // bars and growth costs nothing.
    const barGeo = new THREE.BoxGeometry(BAR_W, 1, BAR_W);
    const barII = new THREE.Mesh(barGeo, ctx.materials.bone);
    const barIII = new THREE.Mesh(barGeo, ctx.materials.bone);
    barII.position.x = -BAR_GAP;
    barIII.position.x = BAR_GAP;
    chart.add(barII, barIII);

    // Hatched, not coloured: the avoidable share is a judgement, and a status
    // mark in this piece is solid, outline or hatched — never a colour. It is a
    // SLEEVE around the bottom 45% of the taller bar, 0.03u proud of it on
    // every side so no two faces are coplanar and nothing z-fights. The clone
    // is owned because this room fades it in, and mutating the shared hatch
    // would leak that fade into every other room that uses it.
    const sleeveGeo = tileUV(
      new THREE.BoxGeometry(BAR_W + 0.06, 1, BAR_W + 0.06),
      (BAR_W + 0.06) / 0.43, bandH / 0.43,
    );
    const sleeveMat = cloneOwned(ctx.materials.hatch);
    sleeveMat.opacity = 0;
    const sleeve = new THREE.Mesh(sleeveGeo, sleeveMat);
    sleeve.position.x = BAR_GAP;
    chart.add(sleeve);

    // The baseline the bars stand on. A chart without one is two boxes.
    const base = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-BAR_GAP - BAR_W, 0, BAR_W / 2),
        new THREE.Vector3(BAR_GAP + BAR_W, 0, BAR_W / 2),
      ]),
      ctx.materials.line,
    );
    chart.add(base);

    // Three fixed strings, and only three. makeTextTexture memoises by string
    // with no eviction (_stub.js rule 4), so nothing in this room may ever be
    // a formatted number.
    const labII = labelPlane('Phase II', 0.3, '#585F66');
    labII.position.set(-BAR_GAP, -0.34, BAR_W / 2 + 0.02);
    labII.material.opacity = 0;
    const labIII = labelPlane('Phase III', 0.3, '#585F66');
    labIII.position.set(BAR_GAP, -0.34, BAR_W / 2 + 0.02);
    labIII.material.opacity = 0;
    // Sits on the taller bar's face just above the top edge of the hatch, and
    // runs left off the bar into the clear air above the shorter one — so it
    // reads as a label for the band, not for the whole bar.
    const labAvoid = labelPlane('~45% avoidable', 0.26, '#585F66');
    labAvoid.position.set(BAR_GAP - 0.28, bandH + 0.27, BAR_W / 2 + 0.03);
    chart.add(labII, labIII, labAvoid);

    const floor = makeContactShadow(ctx.materials, { radius: 2.9, opacity: 0.16 });
    chart.add(floor);
    g.add(chart);

    g.userData = { cards, chart, barII, barIII, sleeve, sleeveMat, labII, labIII, labAvoid, hII, hIII, bandH };
    return g;
  },

  update(g, p, ctx) {
    const { cards, chart, barII, barIII, sleeve, sleeveMat, labII, labIII, labAvoid, hII, hIII, bandH } = g.userData;
    const portrait = !!(ctx && ctx.portrait);

    // ── 0.00-0.45: the copies fan apart and their numbers separate ──────────
    //
    // Landscape fans them sideways, which is what the beat wants — five copies
    // in a row, five different numbers. Portrait cannot: five 2.6u cards need
    // 8u of width and a 31°-wide frustum gives under 4u at this range. So
    // portrait fans them DOWN instead, using the 62° of vertical it does have.
    // Same five copies, same disagreement, turned through 90°.
    const drift = smoothstep(sub(p, 0, 0.45));
    // ── 0.42-0.66: they get out of the way ──────────────────────────────────
    //
    // They do not simply fly at the lens. They lift 3.2u as they go back 9u and
    // shrink to a third, so by the time the bars are half-grown the copies have
    // left through the TOP of the frame and are behind the camera — which is
    // the whole point of moving them early: the cost beat gets a clean plate,
    // and nothing large crosses the shot while the chart is standing up.
    const clear = smoothstep(sub(p, 0.42, 0.66));
    const scale = (portrait ? 0.72 : 1) * (1 - 0.67 * clear);
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const k = i - 2;
      if (portrait) {
        c.position.x = lerp(0, k * 0.22, drift);
        c.position.y = lerp(CARD_Y, CARD_Y - 0.15 - k * 1.15, drift) + clear * 3.2;
      } else {
        c.position.x = lerp(k * 0.5, k * 1.3, drift);
        c.position.y = CARD_Y + Math.sin(i * 1.7) * 0.25 * drift + clear * 3.2;
      }
      c.position.z = CARD_Z + i * CARD_DZ + clear * 9;
      c.rotation.y = lerp(0, -k * 0.16, drift);
      c.scale.setScalar(scale);
    }

    chart.scale.setScalar(portrait ? PORTRAIT_CHART : 1);

    // ── 0.48-0.72: the bars rise ────────────────────────────────────────────
    //
    // Late on purpose. The camera is still swinging off the cards until about
    // p = 0.55, and a bar that has already topped out while the shot is still
    // moving reads as scenery. Starting at 0.48 puts the growth INSIDE the move,
    // so the bars come up as the frame settles onto them, and they are at full
    // height from p = 0.72 — well before the hand-off at 0.88, which is the last
    // moment anything in this room may still be arriving.
    const grow = smoothstep(sub(p, 0.48, 0.72));
    barII.scale.y = Math.max(0.001, hII * grow);
    barII.position.y = barII.scale.y / 2;
    barIII.scale.y = Math.max(0.001, hIII * grow);
    barIII.position.y = barIII.scale.y / 2;

    // The sleeve is always exactly 45% of the taller bar's CURRENT height, so
    // the share is true at every frame of the rise, not only at the end.
    sleeve.scale.y = Math.max(0.001, bandH * grow);
    sleeve.position.y = sleeve.scale.y / 2;

    // The two names arrive with their bars. Before the beat there is nothing
    // for them to name, and a label under an empty floor is a caption without
    // a subject.
    labII.material.opacity = grow;
    labIII.material.opacity = grow;

    // ── 0.60-0.80: the judgement lands ──────────────────────────────────────
    // The hatch and its label fade in over the finished bar. Fading, not
    // growing: the band's height is the claim, and a claim that slides into
    // place is a claim you can watch being chosen.
    const judged = smoothstep(sub(p, 0.60, 0.80));
    sleeveMat.opacity = judged;
    labAvoid.material.opacity = judged;
  },
};
