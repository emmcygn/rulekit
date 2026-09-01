// Placeholder room. Every chapter ships one of these until its own Phase 2 task
// replaces that file wholesale, so residency, station placement and the dispose
// path are all provable in the browser before a single set piece exists.
//
// It is also the smallest complete example of the scene module contract:
//
//   {
//     id: '04-three',                       // must equal its chapter id
//     budget: { calls: 40, tris: 90000 },   // per-room ceiling: 90 calls, 150k tris
//     build(ctx) -> THREE.Group,            // authored in STATION-LOCAL space
//     update(group, p, ctx) -> void,        // p is 0..1 chapter progress; NO allocation
//     dispose(group) -> void,               // optional; disposeGroup runs regardless
//   }
//   ctx = { THREE, quality, materials, portrait, station: THREE.Vector3, chapter }
//
// FOUR RULES THE MANAGER ENFORCES ON YOU:
//
// 1. CLONING A SHARED MATERIAL GOES THROUGH cloneOwned(), NEVER .clone().
//    THREE.Material.copy() deep-copies userData, so `ctx.materials.bone.clone()`
//    comes back still marked `userData.shared = true` — and the manager never
//    frees anything carrying that flag. A plain clone is a material that leaks
//    once per build/drop cycle, which over one scroll is hundreds of them.
//    `cloneOwned(ctx.materials.bone)` clears the flag; tests/sceneManager.test.js
//    walks every built room and fails any material claiming to be shared that is
//    not identity-equal to one of the nine out of createMaterials().
//    Geometries you make are yours by default; the only shared geometry is the
//    contact shadow's plane, and makeContactShadow handles it.
//
// 2. `ctx.station` IS INFORMATIONAL. The manager sets group.position to it after
//    build() returns. Author everything in station-local space around the origin
//    and do NOT offset by ctx.station — doing so puts the room twice as far down
//    the spline as it belongs.
//
// 3. `ctx.portrait` IS AN UPDATE-TIME SIGNAL. build() must not branch on it:
//    orientation flips mid-session and the manager rewrites ctx.portrait in
//    place on rooms that are already built, so anything decided at build time
//    is stale the moment the phone turns. Read it inside update() and move
//    objects you already made.
//
// 4. makeTextTexture MEMOISES BY STRING KEY WITH NO EVICTION. The cache is
//    module-level and lives for the page. Fixed labels only — a counter, a
//    formatted number, anything that varies per frame or per scroll position
//    will mint and keep a new canvas texture for every distinct string and eat
//    the tab. If a number has to change, animate geometry, not text.
//
// The manager poses a room the moment it is built: p=0 for a room ahead of you,
// p=1 for a room behind. So update(g, 0) must produce a sane opening state with
// no prior calls, and update(g, 1) a sane closing one — neither may depend on
// having been walked through in order.

import * as THREE from 'three';
import { makeTextTexture } from '../lib/textures.js';
import { makeContactShadow } from '../lib/contactShadow.js';

export function makeStub(id) {
  return {
    id,
    budget: { calls: 4, tris: 200 },

    build(ctx) {
      const g = new THREE.Group();

      const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), ctx.materials.bone);
      g.add(box);

      const tex = makeTextTexture(id, { px: 96 });
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(3 * (tex.userData.aspect || 3), 3),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
      );
      label.position.set(0, 2.4, 0);
      g.add(label);

      // Shared plane geometry, own cloned material — the two-sided ownership
      // case the manager has to get right.
      const shadow = makeContactShadow(ctx.materials, { radius: 1.6 });
      shadow.position.y = -1.02;
      g.add(shadow);

      g.userData.box = box;
      return g;
    },

    update(g, p) {
      g.userData.box.rotation.y = p * Math.PI * 2;
    },
  };
}
