import * as THREE from 'three';

export function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch { return false; }
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isPortrait() {
  return window.innerHeight >= window.innerWidth;
}

// `antialias` is baked into the WebGL context and cannot change afterwards, so
// it is chosen once here from the tier detected at boot. A later step-down from
// the FPS monitor moves DPR, density and postFx only — see setDpr below.
export function createStage({ canvas, antialias = true, dprCap = 2 }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0xFFFFFF, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xFFFFFF);
  scene.fog = new THREE.Fog(0xFFFFFF, 8, 26);

  // Shadowless clinical daylight.
  //
  // These intensities look absurd next to the usual 0.5-1.0, and they are not.
  // Lambert diffuse in three is `irradiance * albedo / PI`, so an ambient of
  // 1.0 puts a bone (#F4F6F8) surface at 0.29 linear — mid-gray #818181 against
  // a pure white background and white fog. Everything here is roughly PI times
  // what it would be if the divide were not there.
  //
  // The hemisphere fill does most of the work (white above, faint paper gray
  // below) so the darkest possible face still lands on the rule gray; the key
  // is weak and only shapes edges. Measured on a bone sphere, no face falls
  // below ~#D8 and the best-lit face reaches ~#F5 — light gray to paper, from
  // every angle, which is the whole art direction. Nothing casts a shadow.
  scene.add(new THREE.HemisphereLight(0xFFFFFF, 0xE2E8EE, 1.6));
  scene.add(new THREE.AmbientLight(0xFFFFFF, 1.1));
  const key = new THREE.DirectionalLight(0xFFFFFF, 0.45);
  key.position.set(4, 8, 6);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 60);
  let cap = dprCap;

  function resize() {
    const w = window.innerWidth;
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    camera.fov = isPortrait() ? 62 : 50;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));
    renderer.setSize(w, h, false);
    canvas.style.height = h + 'px';
  }

  function setDpr(next) { cap = next; renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap)); }

  resize();
  return { renderer, scene, camera, resize, setDpr, render: () => renderer.render(scene, camera) };
}
