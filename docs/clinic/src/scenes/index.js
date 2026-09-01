// The id -> module map the scene manager builds rooms from. One entry per
// chapter, in chapter order.
//
// THIS FILE IS FINISHED. Every chapter already has its own file and its own
// entry here; a Phase 2 scene task rewrites exactly one file in this directory
// and touches nothing else. If you find yourself editing index.js to add a
// scene, you are in the wrong file.

import { CHAPTERS } from '../core/chapters.js';

import hero from './00-hero.js';
import clinical from './01-clinical.js';
import engine from './02-engine.js';
import compile from './03-compile.js';
import three from './04-three.js';
import clash from './05-clash.js';
import chasm from './06-chasm.js';
import ai from './07-ai.js';
import intake from './08-intake.js';
import build from './09-build.js';
import close from './10-close.js';

const MODULES = {
  '00-hero': hero,
  '01-clinical': clinical,
  '02-engine': engine,
  '03-compile': compile,
  '04-three': three,
  '05-clash': clash,
  '06-chasm': chasm,
  '07-ai': ai,
  '08-intake': intake,
  '09-build': build,
  '10-close': close,
};

// A scene whose `id` drifts from its key would be built at the wrong station
// and would be invisible to the HUD's room list. Cheap to check once at import,
// impossible to spot in a browser.
for (const c of CHAPTERS) {
  const mod = MODULES[c.id];
  if (!mod) throw new Error(`src/scenes: no module registered for chapter ${c.id}`);
  if (mod.id !== c.id) throw new Error(`src/scenes: module for ${c.id} declares id "${mod.id}"`);
}

export default MODULES;
