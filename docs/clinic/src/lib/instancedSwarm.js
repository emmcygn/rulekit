import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3(0, 1, 0);
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _zero = new THREE.Vector3();

export function createSwarm({ geometry, material, count }) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  for (let i = 0; i < count; i++) mesh.setColorAt(i, _c.setScalar(1));
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

  return {
    mesh,
    count,
    setAt(i, pos, scale = 1, rotY = 0, opacity = 1) {
      _q.setFromAxisAngle(_axis, rotY);
      _s.setScalar(scale);
      _m.compose(pos, _q, _s);
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _c.setScalar(opacity));
    },
    commit() {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() {
      mesh.geometry.dispose();
      if (!mesh.material.userData.shared) mesh.material.dispose();
      mesh.dispose();
    },
  };
}

export function hideRest(swarm, fromIndex) {
  for (let i = fromIndex; i < swarm.count; i++) swarm.setAt(i, _zero, 0, 0, 0);
}
