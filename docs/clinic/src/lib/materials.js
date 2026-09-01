import * as THREE from 'three';
import { makeHatchTexture, makeShadowTexture } from './textures.js';

export const COLORS = { paper: 0xF4F6F8, ink: 0x1A1D21, data: 0x7FA8C9, accent: 0xE2582A, rule: 0xD8DEE4 };

export function createMaterials() {
  const mats = {
    // matte white/bone structure - shadowless daylight, the cheapest lighting there is
    bone:   new THREE.MeshLambertMaterial({ color: COLORS.paper }),
    boneT:  new THREE.MeshLambertMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.40, depthWrite: false }),
    glass:  new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
    ink:    new THREE.MeshBasicMaterial({ color: COLORS.ink }),
    data:   new THREE.MeshLambertMaterial({ color: COLORS.data }),
    accent: new THREE.MeshBasicMaterial({ color: COLORS.accent }),
    hatch:  new THREE.MeshBasicMaterial({ map: makeHatchTexture({}), transparent: true }),
    shadow: new THREE.MeshBasicMaterial({ map: makeShadowTexture({}), transparent: true, depthWrite: false }),
    line:   new THREE.LineBasicMaterial({ color: COLORS.rule }),
  };
  for (const m of Object.values(mats)) m.userData.shared = true;
  mats.dispose = () => { for (const m of Object.values(mats)) if (m.dispose) m.dispose(); };
  return mats;
}

// THE ONLY WAY A SCENE MAY CLONE A SHARED MATERIAL.
//
// THREE.Material.copy() deep-copies userData, so `materials.bone.clone()` comes
// back still carrying `userData.shared = true`. The scene manager reads that
// flag to decide what not to free, so a plain clone is a material that is born
// room-owned and can never be disposed — one leaked material per build/drop
// cycle, forever. cloneOwned() clears the flag, which is what makes the clone
// this room's to keep and this room's to lose.
export function cloneOwned(mat) {
  const c = mat.clone();
  c.userData.shared = false;
  return c;
}
