// Quality tiers. One object decides how much of everything the scene gets:
// pixel ratio, how many instances a swarm draws, whether the post pass runs.
//
// Three inputs pick the tier: device hints at boot (detectTier), a one-second
// render probe that can drop it once before the first chapter is really moving,
// and a rolling window of real frame times that can drop it again later. It can
// only ever get cheaper — a session that falls to `medium` stays there even if
// the machine recovers, because stepping back up mid-scroll reads as a glitch
// and costs a shader recompile at the worst possible moment.
//
// The step-down rule needs BOTH a low frame rate and evidence that our own work
// is what filled the frame. A tab on a 30Hz display, or one Chrome has throttled
// because it is occluded, hands us 33ms frames while our draw takes 2ms; that is
// the browser's cadence, not our cost, and downgrading for it would strand a
// perfectly capable machine on `low` for the rest of the session. Hence
// `sample(rafDt, workMs)` — see WORK_RATIO.
//
// Everything here is pure arithmetic on numbers, so it tests in Node with no
// WebGL context. The frame path allocates nothing: two preallocated ring
// buffers with running sums, no shift(), no reduce().

export const TIERS = {
  high:   { dprCap: 2,    density: 1.00, antialias: true,  postFx: true,  blur: true },
  medium: { dprCap: 1.5,  density: 0.60, antialias: true,  postFx: false, blur: false },
  low:    { dprCap: 1.25, density: 0.35, antialias: false, postFx: false, blur: false },
};

export const TIER_ORDER = ['high', 'medium', 'low'];

// Ambient tick rate while the scroll is settled. The room keeps breathing, but
// at a fifth of the frames.
export const IDLE_FPS = 12;

const WINDOW = 90;          // rolling judgement window: ~1.5s of frames at 60fps
const COOLDOWN = 180;       // ~3s before a second step is even considered
const STEP_DOWN_FPS = 45;
const PROBE_FLOOR_FPS = 24; // below this at `low`, nothing cheaper is left
const PROBE_MS = 1000;      // the boot render probe: one verdict, ~1s in
const PROBE_MIN_FRAMES = 8; // ...but never on a handful of noisy first frames

// How much of the frame interval our own draw must occupy before a slow frame
// rate counts as our fault. At 60Hz that is a 13.3ms draw inside a 16.7ms
// budget; at 30Hz vsync with a 2ms draw it is nowhere close, so we hold.
const WORK_RATIO = 0.8;

export function detectTier({ dpr = 1, cores = 4, mobile = false } = {}) {
  if (cores <= 4) return 'low';
  if (mobile || dpr > 2 || cores <= 6) return 'medium';
  return 'high';
}

// `?tier=low` — the flag the README documents, for testing a cheap tier on a
// machine that would never be given one. Only a real tier name is honoured;
// `?tier=potato`, an absent flag and an empty one all fall through to whatever
// detection decided. The forced tier is a starting point, not a floor: the
// frame-time watchdog can still step a forced `high` down if it deserves it.
export function resolveTier(requested, detected) {
  return TIER_ORDER.includes(requested) ? requested : detected;
}

export function stepDown(tier) {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(i + 1, TIER_ORDER.length - 1)];
}

export function createQuality(initialTier, {
  stepDownFps = STEP_DOWN_FPS,
  workRatio = WORK_RATIO,
  windowFrames = WINDOW,
  cooldownFrames = COOLDOWN,
  probeMs = PROBE_MS,
  probeMinFrames = PROBE_MIN_FRAMES,
  probeFloorFps = PROBE_FLOOR_FPS,
} = {}) {
  const listeners = [];

  // Ring buffers, written in place. `dts` is seconds per rAF interval, `works`
  // is milliseconds spent inside our own draw call on that same frame.
  const dts = new Float64Array(windowFrames);
  const works = new Float64Array(windowFrames);
  let cursor = 0;
  let filled = 0;
  let dtSum = 0;
  let workSum = 0;

  let cooldown = 0;
  let elapsed = 0;        // seconds of samples seen, for the boot probe
  let probeDone = false;

  function push(dt, workMs) {
    if (filled === windowFrames) { dtSum -= dts[cursor]; workSum -= works[cursor]; }
    else filled++;
    dts[cursor] = dt;
    works[cursor] = workMs;
    dtSum += dt;
    workSum += workMs;
    cursor = (cursor + 1) % windowFrames;
  }

  function clear() {
    cursor = 0; filled = 0; dtSum = 0; workSum = 0;
  }

  // True when our draw is plausibly what set the frame rate, rather than the
  // display's refresh or a throttled tab.
  function computeBound() {
    if (filled === 0) return false;
    const intervalMs = (dtSum / filled) * 1000;
    return (workSum / filled) > workRatio * intervalMs;
  }

  function tryStep() {
    if (q.meanFps() >= stepDownFps) return null;
    if (!computeBound()) return null;
    const next = stepDown(q.tier);
    if (next === q.tier) return null;
    q.tier = next;
    cooldown = cooldownFrames;
    // Frame times from before the step describe a scene that no longer exists;
    // judging the new tier on them would cascade all the way to low.
    clear();
    listeners.forEach((cb) => cb(next));
    return next;
  }

  const q = {
    tier: initialTier,
    get settings() { return TIERS[q.tier]; },

    // Every plural thing in the scene sizes itself through this, so one tier
    // change thins the whole room at once. Never returns zero — a swarm of one
    // is still a swarm; a swarm of none is a missing scene.
    count(n) { return Math.max(1, Math.round(n * TIERS[q.tier].density)); },

    onChange(cb) { listeners.push(cb); },

    meanFps() {
      if (filled === 0) return 60;
      return 1 / (dtSum / filled);
    },

    // Mean milliseconds inside our own draw. Exposed so the HUD can show why a
    // slow frame rate did or did not move the tier.
    meanWorkMs() {
      if (filled === 0) return 0;
      return workSum / filled;
    },

    // `rafDt` is the raw, UNCLAMPED interval between animation frames, in
    // seconds — clamping it (main.js clamps its animation dt to 0.05) would
    // floor the observable rate at 20fps and hide exactly the frames worth
    // reacting to. `workMs` is how long stage.render() took on this frame.
    sample(rafDt, workMs = 0) {
      const dt = Math.max(rafDt, 1e-4);
      push(dt, Math.max(workMs, 0));
      elapsed += dt;

      // The boot render probe: one verdict at ~1s, so a machine that cannot
      // hold its detected tier drops before the first chapter is really moving
      // rather than 1.5s of frames later.
      if (!probeDone && elapsed * 1000 >= probeMs && filled >= probeMinFrames) {
        probeDone = true;
        const stepped = tryStep();
        if (stepped) return stepped;
      }

      if (cooldown > 0) { cooldown--; return null; }
      if (filled < windowFrames) return null;
      return tryStep();
    },

    // Consumed later by the /plain fallback banner: `fail` means we are already
    // at the cheapest tier and the machine still cannot hold a usable rate.
    probeVerdict() {
      if (filled < windowFrames) return 'pending';
      if (q.tier === 'low' && q.meanFps() < probeFloorFps) return 'fail';
      return 'ok';
    },
  };

  return q;
}
