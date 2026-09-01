import * as THREE from 'three';
import { cloneOwned } from './materials.js';

const GEO = new THREE.PlaneGeometry(1, 1);
GEO.userData.shared = true;

export function makeContactShadow(materials, { radius = 1, opacity = 0.22 } = {}) {
  // cloneOwned, not clone: Material.copy() deep-copies userData, so a plain
  // clone would still claim to be shared and would never be freed.
  const mat = cloneOwned(materials.shadow);
  mat.opacity = opacity;
  const mesh = new THREE.Mesh(GEO, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.set(radius * 2, radius * 2, 1);
  mesh.renderOrder = -1;
  return mesh;
}
