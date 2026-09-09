// Chapter 04 — "Three answers". The signature machine: patient data goes in
// single file, a gate reads it, and every record lands on one of three
// monoliths.
//
// THE THREE MONOLITHS ARE THE STATUS MARKS IN THREE DIMENSIONS.
//
//   pass    ■  solid    — a filled ink slab, no border
//   fail    □  outline  — a paper slab with a drawn ink border, nothing inside
//   unknown ▨  hatched  — a slab under diagonal hatching
//
// No colour carries any of that. There is no red and no green anywhere in this
// room, and no accent either — accent belongs to chapters 05 and 07. Turn the
// frame greyscale and all three are still instantly distinguishable, because
// fill / border / hatch is a difference in *ink*, not in hue. That is the whole
// reason the mark language exists, and this is the room that says so out loud.
//
// "DON'T KNOW" IS A DESTINATION, NOT AN ERROR.
//
// So it is built like one. The three exits sit on ONE ring centred on the gate:
// same radius (every stream is exactly R long), same geometry, same rise curve
// driven by the same scalar, same label treatment, same contact shadow. Nothing
// about the third slab is smaller, later, dimmer or off to the side. Three in
// ten records go there, and the routing table says so in the open.
//
// Contract notes (see ./_stub.js):
//   • the only cloned shared material is one cloneOwned(materials.line), which
//     draws both the tube rails and the outline monolith's border;
//   • the cube stream is a single InstancedMesh through createSwarm, sized by
//     ctx.quality.count();
//   • labels are three fixed strings, so the memoised text cache stays bounded;
//   • ctx.portrait is read in update() only — it narrows the fan by angle, which
//     keeps all three exits exactly R from the gate in either orientation;
//   • update() allocates nothing: two module-level scratch values and two typed
//     arrays made once in build().

import * as THREE from 'three';
import { createSwarm } from '../lib/instancedSwarm.js';
import { makeTextTexture } from '../lib/textures.js';
import { makeContactShadow } from '../lib/contactShadow.js';
import { cloneOwned } from '../lib/materials.js';
import { sub, smoothstep, lerp } from '../lib/easing.js';

// The gate, and the ring the three verdicts stand on.
const GX = -5.4, GY = 0.7, GZ = -5.6;
const R = 7.8;              // every exit is this far from the gate. All three.
const FLOOR = -1.7;         // the plane the monoliths stand on
const TUBE_LEN = 7.5;
// The intake runs along +x, athwart the flight path, so the single file of
// records is read broadside instead of end-on. The gate turns the stream 90°
// and discharges down -z, which is also the only direction with room for the
// fan that the camera never flies into.
const FEED_X = GX - TUBE_LEN;   // the mouth of the intake tube

// THE FAN IS SIZED BY THE SHOT, NOT BY THE STORYBOARD'S PLACEHOLDER NUMBERS.
//
// Half the fan angle. The camera passes this machine at ~6u on its left and
// only ever gets to z ≈ -9 (station-local), so the whole fan — gate at the near
// end, three slabs at the far end — has to fit inside about 13u of depth or the
// far slabs sit past the fog's mid point (THREE.Fog 8→26) and grey out. R 7.8
// with a 0.40 rad half-angle puts the outer exits ±3.04 off the centre line and
// the far face only 7.2u beyond the gate: 23° between neighbouring streams
// where a 9-unit, 0.293 rad fan gave 17°, and every slab ~1.4u closer.
//
// Portrait narrows the ANGLE, never the radius, so all three stay exactly R
// from the gate in either orientation. 0.72 of the fan is what a 31°-wide
// frustum holds with all three labels inside it — wider and "unknown" walks
// off the right edge.
const FAN = 0.40;
const PORTRAIT_FAN = 0.72;

// Where the three labels face. Not per-exit and not billboarded — the scene
// contract hands update() no camera — but one fixed turn toward the stretch of
// flight path this room is read from, plus the 0.42 standoff that puts the
// label clear of its slab. See the label block in build().
const LABEL_YAW = 0.65;
const LABEL_DX = Math.sin(LABEL_YAW) * 0.42;
const LABEL_DZ = Math.cos(LABEL_YAW) * 0.42;

// Fraction of one loop a record spends in the tube. The rest is the sorted
// run out to its monolith — longer in time and in distance, because that is
// the part of the machine the chapter is about.
const TUBE_T = 0.26;

const EXITS = [
  { key: 'pass',    ang: -FAN, label: 'pass' },
  { key: 'fail',    ang:  0,   label: 'fail' },
  { key: 'unknown', ang:  FAN, label: 'unknown' },
];

// Fixed routing: 4 in 10 pass, 3 fail, 3 land on "unknown". Not a rounding
// error, not a leftover — a third of the traffic, stated as a constant.
// Interleaved rather than blocked (0,0,0,0,1,1,1,2,2,2), because consecutive
// indices carry consecutive phases: a blocked table sends four cubes down the
// same exit shoulder to shoulder and the streams arrive in clumps.
const PATTERN = [0, 1, 2, 0, 1, 2, 0, 1, 0, 2];

const _v = new THREE.Vector3();

export default {
  id: '04-three',
  budget: { calls: 18, tris: 30000 },

  build(ctx) {
    const g = new THREE.Group();
    const M = ctx.materials;

    // One owned line material for every drawn edge in the room — the tube rails
    // and the outline monolith's border. cloneOwned, never .clone(): a plain
    // clone comes back still flagged shared and the manager never frees it.
    const lineMat = cloneOwned(M.line);
    lineMat.color.setHex(0x1A1D21);

    // ── intake ────────────────────────────────────────────────────────────
    // Glass, so the single file of records inside stays visible all the way in.
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, TUBE_LEN, 16, 1, true),
      M.glass,
    );
    tube.rotation.z = Math.PI / 2;
    tube.position.set(GX - TUBE_LEN / 2, GY, GZ);
    g.add(tube);

    // Two rails under it. 16% white glass against a white room is nearly
    // nothing; the rails are what tell you there is a tube there at all.
    const railGeo = new THREE.BufferGeometry();
    railGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      FEED_X, GY - 0.42, GZ - 0.42, GX, GY - 0.42, GZ - 0.42,
      FEED_X, GY - 0.42, GZ + 0.42, GX, GY - 0.42, GZ + 0.42,
    ], 3));
    g.add(new THREE.LineSegments(railGeo, lineMat));

    // ── the gate ──────────────────────────────────────────────────────────
    const gate = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), M.bone);
    gate.position.set(GX, GY, GZ);
    g.add(gate);

    // No intake-mouth ring on the gate's -x face: the camera flies past this
    // machine on its +x side for the whole chapter, so that face is never once
    // in shot. It was a draw call that rendered nothing.

    // The sorter itself: one paddle across the top of the gate, turning as the
    // room decides. The only moving part that is not a record.
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.07, 0.15), M.ink);
    rotor.position.set(GX, GY + 0.89, GZ);
    g.add(rotor);

    const gateShadow = makeContactShadow(M, { radius: 1.15, opacity: 0.16 });
    gateShadow.position.set(GX, FLOOR + 0.01, GZ);
    g.add(gateShadow);

    // ── the three verdicts ────────────────────────────────────────────────
    // ONE geometry for all three, so "identical but for the mark" is true in
    // the data and not just in the eye. Its UVs are pre-tiled for the hatch;
    // the ink and bone materials carry no map and ignore them.
    const monoGeo = new THREE.BoxGeometry(1.3, 2.6, 0.7);
    const uv = monoGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.5, uv.getY(i) * 3);
    uv.needsUpdate = true;
    const edgeGeo = new THREE.EdgesGeometry(monoGeo);

    const monos = [];
    const bodies = [];
    const labels = [];

    for (let e = 0; e < EXITS.length; e++) {
      const exit = EXITS[e];
      const slot = new THREE.Group();

      // solid ■ / outline □ / hatched ▨ — the mark, and nothing but the mark.
      const mat = exit.key === 'pass' ? M.ink : exit.key === 'fail' ? M.bone : M.hatch;
      const body = new THREE.Mesh(monoGeo, mat);
      slot.add(body);

      // The outline mark is a paper body plus a drawn border. The border is a
      // child of the body so it rises and stretches with it, exactly.
      if (exit.key === 'fail') body.add(new THREE.LineSegments(edgeGeo, lineMat));

      const tex = makeTextTexture(exit.label, { px: 72, color: '#1A1D21' });
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(0.4 * (tex.userData.aspect || 3), 0.4),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
      );
      // The labels do NOT ride in the slot. A slot is turned by its own fan
      // angle, and a label inheriting that turn is read at a different
      // obliquity on each exit — "unknown", the outermost, ends up visibly
      // skewed while "yes" is square, which is exactly the quiet demotion this
      // room exists to avoid. So all three hang off the room group at ONE fixed
      // orientation: turned LABEL_YAW toward the flight path and tipped back
      // 18°, which is where the camera reads this machine from (cameraKeys
      // '04-three' lifts to 6u for the split beat). Identical in world space,
      // for all three, in both orientations.
      //
      // 'YXZ' matters: the 18° tip has to happen about the label's OWN
      // horizontal axis, after the turn. In the default XYZ order it happens
      // about the room's x instead, and the label lands on screen visibly
      // ROLLED rather than tipped — 12-15° of lean at the split beat, which is
      // what made "don't know" look like a sticker rather than a caption.
      label.rotation.order = 'YXZ';
      label.rotation.set(-0.32, LABEL_YAW, 0);
      g.add(label);

      const shadow = makeContactShadow(M, { radius: 1.05, opacity: 0.2 });
      shadow.position.y = FLOOR + 0.01;
      slot.add(shadow);

      g.add(slot);
      monos.push(slot);
      bodies.push(body);
      labels.push(label);
    }

    // ── the records ───────────────────────────────────────────────────────
    const n = ctx.quality.count(64);
    const cubes = createSwarm({
      geometry: new THREE.BoxGeometry(0.24, 0.24, 0.24),
      material: M.data,
      count: n,
    });
    g.add(cubes.mesh);

    const route = new Uint8Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      route[i] = PATTERN[i % 10];
      phase[i] = i / n;
    }

    g.userData = {
      cubes, route, phase, n, monos, bodies, labels, rotor,
      // x,z of each exit, rewritten in update() so portrait can narrow the fan
      // without allocating.
      ex: new Float32Array(6),
    };
    return g;
  },

  update(g, p, ctx) {
    const u = g.userData;
    const fan = ctx && ctx.portrait ? PORTRAIT_FAN : 1;

    // Place the three exits on one ring centred on the gate. Portrait scales
    // the ANGLE, never the radius, so all three stay exactly R from the gate
    // and no orientation quietly demotes one of them.
    for (let e = 0; e < 3; e++) {
      const a = EXITS[e].ang * fan;
      const x = GX + Math.sin(a) * R;
      const z = GZ - Math.cos(a) * R;
      u.ex[e * 2] = x;
      u.ex[e * 2 + 1] = z;
      const slot = u.monos[e];
      slot.position.set(x, 0, z);
      slot.rotation.y = -a;             // the slab squares up to the gate
    }

    // All three rise on ONE scalar. There is no per-exit offset here and there
    // must never be: "don't know" arrives with the others or the room is lying.
    const rise = smoothstep(sub(p, 0.20, 0.60));
    const h = rise < 0.0015 ? 0.0015 : rise;
    for (let e = 0; e < 3; e++) {
      const body = u.bodies[e];
      body.scale.y = h;
      body.position.y = FLOOR + 1.3 * h;
      // Room-space, because the labels are not children of the slots — same
      // height, same standoff, same facing on all three.
      const label = u.labels[e];
      label.position.set(u.ex[e * 2] + LABEL_DX, FLOOR + 2.6 * h + 0.42, u.ex[e * 2 + 1] + LABEL_DZ);
      label.visible = rise > 0.06;
    }

    // The sorted run only exists once there is somewhere to sort to.
    const reach = smoothstep(sub(p, 0.13, 0.44));
    const flow = p * 1.35;
    const exitT = 1 - TUBE_T;

    for (let i = 0; i < u.n; i++) {
      const t = (u.phase[i] + flow) % 1;
      let fade;
      if (t < TUBE_T) {
        // single file down the tube, dead straight, no lane changes
        const q = t / TUBE_T;
        _v.set(lerp(FEED_X, GX, q), GY, GZ);
        fade = q < 0.08 ? q / 0.08 : 1;
      } else {
        // sorted: a straight radial run out of the gate to its own monolith.
        // Linear in q, so spacing stays even and the three streams read as
        // three rates rather than three speeds.
        const q = (t - TUBE_T) / exitT;
        const r = u.route[i] * 2;
        _v.set(
          lerp(GX, u.ex[r], q),
          lerp(GY, FLOOR + 1.15, q),
          lerp(GZ, u.ex[r + 1], q),
        );
        fade = reach * (q > 0.88 ? (1 - q) / 0.12 : 1);
      }
      // Fade is scale, not instance colour: setColorAt multiplies the material
      // colour, so fading by colour would drive a blue cube to BLACK against a
      // white room instead of away.
      u.cubes.setAt(i, _v, fade, u.phase[i] * 6.2832 + p * 1.7, 1);
    }
    u.cubes.commit();

    u.rotor.rotation.y = p * 2.4;
  },
};
