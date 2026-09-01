// Per-chapter camera keyframes.
//
// Each key is { p, at, off }:
//   at  = look-at target, STATION-RELATIVE, so a scene's props and its camera
//         keys are authored in the same local frame.
//   off = camera offset from the spline point, world-space.
//
// ── The shape of a chapter ────────────────────────────────────────────────
// `cameraT` puts the camera half a segment BEHIND its station at p=0, ON the
// station at p=0.5, and half a segment PAST it at p=1. So one chapter is a
// single continuous move: dolly in on the focal object, drift past it, hand
// off to the next station. The keys follow that arc:
//
//   p=0    at = HANDOFF          → look straight down the path at this station
//   middle at.z ≈ -5 to -12      → target stays AHEAD of the camera as it
//                                  passes through the room; x/y frame the props
//   p=1    at = (next station - this station) + HANDOFF
//                                → look at the NEXT station
//
// `at.z` is therefore always negative (forward, -z). A positive `at.z` would
// put the target behind the camera for the back half of the chapter and the
// shot would whip 180° when p resets at the boundary.
//
// ── Why the seam values are what they are ─────────────────────────────────
// A chapter's last key and the next chapter's first key must describe the SAME
// world pose, or the camera jumps at the boundary. Both sides are pinned to two
// per-orientation constants:
//
//   at:  chapter i ends at (STATIONS[i+1] - STATIONS[i]) + HANDOFF, and
//        chapter i+1 opens at HANDOFF — both resolve to STATIONS[i+1] + HANDOFF.
//   off: both sides use NEUTRAL.
//
// That makes every seam continuous by construction. `cameraRig.update` also
// converges on the next chapter's opening pose over the last slice of each
// chapter, so the seam survives future edits to these numbers.
//
// Chapter 00's first key and chapter 10's last key have no neighbour to match,
// so they are free — 00 opens looking down the corridor (its camera is parked
// ON station 0 for the first half, so its target must be well ahead), and 10
// rises off the line for the closing crane.
//
// Portrait re-frames rather than letterboxes (spec §6): a higher eye line, the
// camera pulled back on z to recover the width the narrow aspect costs, and
// gentler lateral swings, authored per chapter.
//
// ── The aim-hold twin ─────────────────────────────────────────────────────
// `cameraT` is strictly linear in p, so the camera never stops moving and no
// key in this file is a hold on its own. Every chapter's settle key used to sit
// at p = 0.72-0.88, which put the finished, framed, readable image inside the
// chapter's own exit ramp: the payoff and the swing away from it were the same
// instant, and nine of the eleven chapters gave the reader less than one wheel
// notch of composed frame.
//
// So each interior chapter now settles at p ~= 0.64-0.70 and carries a FOURTH
// interior key at p = 0.88 that repeats the settle key's `at`. The aim is what
// holds the composition, and freezing it across 0.64 -> 0.88 buys 1.0-1.9
// notches of readable frame while the camera keeps travelling underneath it.
//
// THE TWIN'S `off` IS THE SEAM VALUE, NOT THE SETTLE KEY'S, and that detail is
// load-bearing: a naive twin that freezes the whole pose measures 0.1969 units
// per frame (0.1956 portrait) on the 2400-step journey sweep and fails the 0.15
// budget in tests/cameraRig.test.js. Letting `off` finish its move into N/NP
// over the hold — where the aim is still, so it costs nothing visible —
// measures 0.1435 (0.1481 portrait) and passes. Copy the settle key's `off`
// into a twin and the suite goes red.

// Landscape: seam look-target offset and seam camera offset.
const H = [0, 0.2, 0];
const N = [0, 0.35, 0];
// Portrait equivalents.
const HP = [0, 0.5, 0];
const NP = [0, 0.6, 1.2];

export const CAMERA_KEYS = {
  // cameraT parks the camera ON station 0 until p = 0.5, so the whole opening
  // drift out of the haze has to live in `off`: it starts 4.6u BEHIND the
  // station and closes on it, then the spline carries it out to z ≈ -8.8. The
  // page hangs on the path at (0.9, 0.2, -8.2) — ~13u out at p = 0, on the fog's
  // near edge, full frame from p ≈ 0.8, and passed through in the last few
  // percent. Portrait keeps its own page distance by scaling the page down
  // (scenes/00-hero.js) rather than by hanging the camera further back: the
  // back half of this chapter already spends 9u of spline on the shortest
  // chapter in the piece, and there is no per-frame move budget left for more.
  '00-hero': {
    keys:     [{ p: 0, at: [0.4, 0.3, -9], off: [0, 0.35, 4.6] },
               { p: 0.55, at: [0.9, 0.3, -8.4], off: [0.3, 0.5, 0.6] },
               { p: 1, at: [3.5, 0.6, -17.6], off: N }],
    portrait: [{ p: 0, at: [0.5, 0.5, -9], off: [0, 0.6, 6.2] },
               { p: 0.55, at: [0.8, 0.4, -7.2], off: [0, 0.7, 1.6] },
               { p: 1, at: [3.5, 0.9, -17.6], off: NP }],
  },
  // Two beats: up at the fanning cards (they ride at y ≈ 1.75, z -2.6…-4.4, and
  // the camera sweeps under them), then onto the cost chart at
  // (0.5, -2.4, -13.6) — which is the chapter's set piece, and is framed like
  // one.
  //
  // ── THE AIM IS 28° OFF THE SUBJECT, ON PURPOSE ────────────────────────────
  // Landscape docks chapter 01's card on the RIGHT, so ndc x = 0.10 rightward
  // is behind frosted glass and the composable frame is x ∈ [-0.95, 0.10]. Its
  // centre is -0.42, not 0. Aiming AT the chart therefore hides it: that is
  // exactly what the old (1.7, -1.0, -11.6) key did, and the reason the whole
  // cost chart used to render behind the panel with only the SHORT bar poking
  // out at frame-bottom-centre.
  //
  // So the settle key aims 3.0u to the right of the chart — the axis points
  // into the card, and the bars sit in the clear left of the frame where a
  // reader can actually see them. The cards key moved the other way, 0.40 →
  // 0.34, so the swing onto the chart is finished well before it. `off.z` came
  // DOWN from 0.9 to 0.55 (the chart is 2u further out, so the standoff is no
  // longer needed there).
  //
  // THE SETTLE KEY IS 0.70, NOT 0.84. It sat at 0.84 to keep the chart composed
  // when the hand-off fired, back when the hand-off was 0.88 and there was no
  // hold — which bought this chapter 67px of finished, readable chart. The
  // aim-hold twin does that job properly instead: the aim freezes at 0.70 and
  // the chart stays composed all the way to 0.88 while the camera keeps closing
  // underneath it. Measured off the real rig at 1440x900 across the whole hold
  // (p = 0.70 → 0.88), the bars, the sleeve and all three labels span ndc
  // x -0.87…-0.08 and screen y 0.02…0.99 — never crossing the card's own
  // ndc x = 0.10 edge, and never leaving the frame.
  //
  // Portrait aims 3.7u BELOW the chart for the same reason chapters 04 and 06
  // do: its card is docked across the bottom 46svh, so the readable frame is
  // ndc y > -0.08 and its centre is +0.46, not 0. Dropping the target tips the
  // axis down and lifts the whole chart above the card line. Measured at
  // 390x844 across the same hold: every part of the chart sits at screen y
  // 0.00…0.49, i.e. 0% below the card line at 0.70, 0.78, 0.84 AND 0.88 — the
  // hold does not cost the portrait framing anything, because the aim that
  // composed it is the aim being held.
  '01-clinical': {
    keys:     [{ p: 0, at: H, off: N },
               { p: 0.34, at: [-0.2, 1.4, -4.4], off: [-0.4, 0.5, 0] },
               { p: 0.70, at: [3.48, -0.65, -13.6], off: [0.15, 0.55, 0.55] },
               { p: 0.88, at: [3.48, -0.65, -13.6], off: N },
               { p: 1, at: [-5.5, -0.8, -17.8], off: N }],
    portrait: [{ p: 0, at: HP, off: NP },
               { p: 0.34, at: [-0.05, 1.5, -4.6], off: [0, 0.9, 2.2] },
               { p: 0.70, at: [0.63, -3.26, -13.6], off: [0.15, 1.05, 1.3] },
               { p: 0.88, at: [0.63, -3.26, -13.6], off: NP },
               { p: 1, at: [-5.5, -0.5, -17.8], off: NP }],
  },
  // The stream runs down the flight path itself, so the shot stays on axis:
  // mid-chapter the target is straight ahead, then it settles onto the code
  // block — (1.6, 0.9, -13.5) landscape, (1.19, 1.2, -11.0) portrait — at p =
  // 0.70 and holds there until the handoff. It used to settle at p = 0.88,
  // which was HANDOFF_START to the digit: the block finished writing at 0.86
  // and the shot that was supposed to hold it lasted 13px of scroll. The twin
  // at 0.88 is what makes the comment true. Those are the block's own coordinates in
  // scenes/02-engine.js; move one and you must move the other. The portrait
  // key aims 0.31 SHORT of the block on x on purpose: in a 31°-wide frustum the
  // swing toward station 3 that starts at HANDOFF_START would otherwise push
  // the plate off the left edge before the chapter is over.
  '02-engine': {
    keys:     [{ p: 0, at: H, off: N },
               { p: 0.40, at: [0.9, 0.35, -9], off: [0, 0.5, 0] },
               { p: 0.70, at: [1.6, 0.9, -13.5], off: [0, 0.5, 0] },
               { p: 0.88, at: [1.6, 0.9, -13.5], off: N },
               { p: 1, at: [4.5, 1.6, -17.8], off: N }],
    portrait: [{ p: 0, at: HP, off: NP },
               { p: 0.40, at: [0.5, 0.9, -8], off: [0, 0.8, 1.2] },
               { p: 0.70, at: [1.19, 1.2, -11.0], off: [0, 0.8, 1.2] },
               { p: 0.88, at: [1.19, 1.2, -11.0], off: NP },
               { p: 1, at: [4.5, 1.9, -17.8], off: NP }],
  },
  // Two subjects, one behind the other: the sentence strip at z = -5.2 and the
  // node tree it compiles into at z = -10.9. The p=0.30 key frames the strip
  // (the -0.6 on `off.z` closes the gap early, so the sentence is out of the
  // fog while it is still worth reading); the p=0.66 key settles on the tree
  // and its `off.z` of +1.3 hangs the camera back so the finished tree, its
  // verbatim line and the accent tether are all still in frame through the hold
  // to p = 0.88, where the hand-off to station 4 takes over. Portrait holds ~1.3u further
  // back again and re-frames the tree as a column — see scenes/03-compile.js.
  '03-compile': {
    keys:     [{ p: 0, at: H, off: N },
               { p: 0.30, at: [0.10, 0.90, -6.6], off: [-0.30, 0.55, -0.6] },
               { p: 0.66, at: [0.42, 1.20, -11.0], off: [-0.80, 1.05, 1.3] },
               { p: 0.88, at: [0.42, 1.20, -11.0], off: N },
               { p: 1, at: [-6.0, -0.4, -17.8], off: N }],
    portrait: [{ p: 0, at: HP, off: NP },
               { p: 0.30, at: [0.05, 1.15, -6.6], off: [0, 0.85, 0.5] },
               { p: 0.66, at: [0.17, 1.25, -9.9], off: [0, 1.10, 2.0] },
               { p: 0.88, at: [0.17, 1.25, -9.9], off: NP },
               { p: 1, at: [-6.0, -0.1, -17.8], off: NP }],
  },
  // Chapter 04 flies PAST the machine, not through it. The intake tube, the
  // gate and the three verdicts sit around x ≈ -5.4 (see scenes/04-three.js),
  // 6-7u left of the flight path — far enough that the camera never enters the
  // machine, close enough that the fan fills the frame.
  //
  // THE SPLIT BEAT IS A LIFT, and it has to be — this is the one place in the
  // piece where eye level is the wrong height. The fan opens in the horizontal
  // plane, so from the flight line the three streams leave the gate along
  // screen vectors barely 1° apart: they overlap for most of their length and
  // read as ONE band of cubes crossing the slabs. Elevation is what separates
  // them. At p = 0.50 the camera is 6u above the line and tipped 26° down, and
  // the three streams then diverge by ~13.5° of screen angle each — three
  // lanes, not one. The same pose still holds the intake, the gate (ndc x -0.56
  // to -0.17) and all three slabs (ndc x 0.08 to 0.93, 11-14u out).
  //
  // Then p = 0.70 is the verdict beat, held to 0.88: the camera has come back
  // down to 2u,
  // the gate is behind it on the left, and the three slabs sit at 7.8-12.1u
  // dead ahead — the chapter ends with every verdict still AHEAD of the camera.
  // Nothing is flown through: the closest approach to any part of this machine
  // is ~5.5u.
  '04-three': {
    keys:     [{ p: 0, at: H, off: N },
               { p: 0.50, at: [-8.91, -0.26, -11.09], off: [0.9, 6.0, -1.2] },
               { p: 0.70, at: [-8.87, -2.30, -14.96], off: [0.7, 2.0, -0.4] },
               { p: 0.88, at: [-8.87, -2.30, -14.96], off: N },
               { p: 1, at: [5.0, -0.8, -18.0], off: N }],
    // Portrait is ~31° WIDE against landscape's ~73°, and the machine does not
    // shrink to fit. The arithmetic: the camera runs ~6u to the machine's
    // right, so the gate and the middle slab — which share an x — are pulled
    // ~19° apart by parallax alone, and the outer slabs add ±10° on top of
    // that. The only way to squeeze 39° into 31° is to hang back, and hanging
    // back pushes the slabs past the fog's mid point.
    //
    // So portrait keeps landscape's lift — 5.6u up at p = 0.50, which is what
    // makes the streams diverge (9.5° of screen angle apart here) — and spends
    // its narrow width on the fan rather than on the gate:
    //   p = 0.50  three streams, three slabs, all three labels, 13.6-15.2u out;
    //             the gate is just off the left edge, behind the streams it made;
    //   p = 0.70  the verdicts at 11.1-13.4u, the camera back down to 2.4u
    //             and 2u further back on z, which is what a 31° frame needs to
    //             hold all three slabs and all three labels at once.
    //
    // ── why at.y is 3.6u BELOW the station in portrait ────────────────────
    // Landscape docks its card to one side, so the shot may compose on the
    // middle of the frame. Portrait docks it across the bottom 46svh, so the
    // readable frame is the top 0.54 and its centre is 0.27, not 0.5. Aiming
    // at the slabs themselves put them at 0.44-0.93 of the screen — most of
    // the machine behind the card, measured (68% of the room's ink hidden at
    // p = 0.45). The fix is the look target, not the camera: the eye stays 5.6u
    // up, and the target drops to -3.60, which tips the axis ~17° further down
    // and lifts the slabs into 0.25-0.51. Only `at` moves, so the per-frame
    // position step is untouched at 0.1204u against the rig test's 0.15 —
    // pulling the camera back instead would have spent that headroom.
    portrait: [{ p: 0, at: HP, off: NP },
               { p: 0.50, at: [-5.11, -3.60, -13.25], off: [0.1, 5.6, 0.4] },
               { p: 0.70, at: [-6.02, -2.80, -14.96], off: [0.2, 2.4, 2.0] },
               { p: 0.88, at: [-6.02, -2.80, -14.96], off: NP },
               { p: 1, at: [5.0, -0.5, -18.0], off: NP }],
  },
  // The contradiction is one object — a slab of scores standing where two
  // clauses cross — and this chapter walks around it rather than at it. The
  // camera runs from 9u behind the station to 9u past it, and `off` swings
  // -1.35 → +1.35 on x between p = 0.44 and p = 0.70: 2.7u of lateral travel at
  // ~10u range, which is ~15° of parallax and reads as an orbit even though
  // the flight path never turns.
  //
  // The composition therefore CANNOT sit on the station. At p ≈ 0.5 the camera
  // passes within 1.3u of the station origin (0.98u in portrait), so
  // scenes/05-clash.js hangs the whole room at z ≈ -11.6 — 21u out and deep in
  // fog at p = 0, ~12u and readable through the middle of the chapter, and
  // still 3.4u AHEAD of the camera at the hand-off. Move one and you must move
  // the other. The small +z on the interior `off` keys buys back the standoff
  // the 5.6u-wide walls need at the p = 0.70 beat without it unwinding into a
  // fast frame at the seam.
  //
  // Portrait aims shorter and swings less — ±0.85 rather than ±1.35 — because
  // a 31°-wide frustum turns the same parallax into the seam leaving frame.
  // The room answers by narrowing its own score axis; see PORTRAIT sx there.
  '05-clash': {
    keys:     [{ p: 0, at: H, off: N },
               { p: 0.44, at: [-1.30, 0.30, -9.2], off: [-1.35, 0.55, 0.4] },
               { p: 0.70, at: [1.35, 0.35, -11.4], off: [1.35, 0.75, 0.9] },
               { p: 0.88, at: [1.35, 0.35, -11.4], off: N },
               { p: 1, at: [2.5, 2.2, -18.0], off: N }],
    portrait: [{ p: 0, at: HP, off: NP },
               { p: 0.44, at: [-0.55, 0.55, -9.4], off: [-0.85, 0.85, 1.6] },
               { p: 0.70, at: [0.85, 0.60, -11.6], off: [0.85, 1.00, 1.9] },
               { p: 0.88, at: [0.85, 0.60, -11.6], off: NP },
               { p: 1, at: [2.5, 2.5, -18.0], off: NP }],
  },
  // Two subjects, one behind the other, and the camera changes height between
  // them. The hole in the floor is centred on the station itself — the camera
  // is 3u above nothing at p ≈ 0.5 — so the first key lifts to 1.2u and tips
  // ~14° down at p = 0.28, which is where both lips of the hole sit in the
  // lower third of the frame and the seven are still walking. After that the
  // floor is behind and below, and the p = 0.68 key settles on the cluster at
  // (-3.6, -0.15, -15.5): 12u out, dead centre, coming clear of the fog. It is
  // still 6.5u ahead of the camera when the chapter ends, so nothing here is
  // ever flown through either.
  '06-chasm': {
    keys:     [{ p: 0, at: H, off: N },
               { p: 0.28, at: [0, -1.90, -6.6], off: [0, 1.20, 0.3] },
               { p: 0.68, at: [-3.20, 0.20, -14.4], off: [-0.20, 0.80, 0.5] },
               { p: 0.88, at: [-3.20, 0.20, -14.4], off: N },
               { p: 1, at: [-6.5, -0.5, -18.0], off: N }],
    // Portrait re-aims both beats for the docked card, same reasoning as 04:
    // "the lower third of the frame" and "dead centre" are landscape framings,
    // and in portrait both of them are behind the card. The eye and its path do
    // not move — only the two look targets — so the 0.1157u step stands.
    //   p = 0.28  target 3.85u below the station instead of 1.35: the far lip,
    //             the [30, 45) markers, both bound labels and the statute line
    //             all clear the card line, and the subject ink above it goes
    //             from 340px to 2,079px. The near lip still runs off the bottom
    //             edge — the camera is 1.45u above a hole centred on its own
    //             station, so it always will; that is the floor, not the shot.
    //   p = 0.68  target 0.20 instead of 1.10, which moves the cluster off dead
    //             centre and up to 0.20-0.65, 7% of it behind the card.
    portrait: [{ p: 0, at: HP, off: NP },
               { p: 0.28, at: [0, -3.85, -6.6], off: [0, 1.45, 1.5] },
               { p: 0.68, at: [-2.35, 0.20, -14.4], off: [-0.10, 1.05, 1.5] },
               { p: 0.88, at: [-2.35, 0.20, -14.4], off: NP },
               { p: 1, at: [-6.5, -0.2, -18.0], off: NP }],
  },
  // Chapter 07 has two subjects on the same side of the path, 4.6u apart on z:
  // the reading table at (-4.4, 0.1, -8.6) and the closed approval door at
  // (-3.0, 0, -13.2), with the verdict gate 3u behind the door in the fog. The
  // camera flies past both on their right and enters neither — the door is 4.5u
  // off the flight line, so nothing, including the camera, ever crosses it.
  //
  // Two middle keys is all the rig test allows (5 per orientation, endpoints
  // pinned to the seam, plus the aim-hold twin), and they are spent on the two
  // beats: p = 0.36 frames the lens and the note it is reading, p = 0.66 frames
  // the door and the reviewer's mark and then holds it to p = 0.88. The shot the
  // chapter is really about is the BLEND between the two, p ≈ 0.47 to 0.64,
  // where the tethered suggestions sit on the left of
  // the frame and the shut accent door on the right — the AI's output and the
  // thing standing between it and the engine, in one frame.
  //
  // That blend is what the numbers below are cut to, and it is a WINDOW, not a
  // moment: all three suggestion cards and all three tethers have to stay whole
  // for its whole length, or a reader scrolling at their own speed meets the
  // chapter's claim with the top card — the primary suggestion — already gone
  // off the top edge. Two things buy that. The far key aims at x = -3.30 rather
  // than at the door's own -3.00, which holds the table 0.05 of NDC further in
  // from the left edge and still leaves the door 0.25 clear of the right one.
  // And the near key follows the table forward to z = -8.6 (07-ai.js moved it),
  // so the note the tethers hang off is still 5u AHEAD of the camera at p =
  // 0.64 instead of 3u abreast of it. Measured margin over p ∈ [0.47, 0.64],
  // worst corner of any card and either end of any tether: 0.37 of NDC inside
  // the frame, against +0.42 outside it before the aim was retuned. The earlier
  // settle key bought the extra room — the same window measured 0.21 when it
  // sat at p = 0.74.
  //
  // `off` is untouched — the whole fix is aim and staging. Worst per-frame
  // camera move on the 2400-step journey sweep stays 0.066u (limit 0.15).
  //
  // Portrait is ~31° wide against landscape's ~75°, and 28° of bearing between
  // the two set pieces does not fit in it. So scenes/07-ai.js pulls both pieces
  // in toward the path in portrait, closing that gap to ~13°; these keys aim at
  // the moved positions, not the landscape ones. Even
  // closed, that gap is wider than the frame, so portrait reads the two in
  // sequence — the note beat at p ≈ 0.40, the door beat from p ≈ 0.55 — and its
  // near key follows the table forward for the same reason landscape's does.
  // Portrait pays for the extra distance with scale rather than with standoff
  // (07-ai.js grows the table to 1.14), so its note beat lands the size it was
  // composed at and nothing here has to move off the seam.
  '07-ai': {
    keys:     [{ p: 0, at: H, off: N },
               { p: 0.36, at: [-4.20, 0.45, -8.60], off: [-0.45, 0.55, 0.50] },
               { p: 0.66, at: [-3.30, 0.45, -12.40], off: [0.35, 0.55, 0.30] },
               { p: 0.88, at: [-3.30, 0.45, -12.40], off: N },
               { p: 1, at: [4.5, -0.7, -18.0], off: N }],
    portrait: [{ p: 0, at: HP, off: NP },
               { p: 0.36, at: [-2.85, 0.90, -8.60], off: [0, 0.85, 0.90] },
               { p: 0.66, at: [-1.70, 0.75, -12.80], off: [0.10, 0.85, 1.40] },
               { p: 0.88, at: [-1.70, 0.75, -12.80], off: NP },
               { p: 1, at: [4.5, -0.4, -18.0], off: NP }],
  },
  // Chapter 08 is a wheel standing across the flight path: ten charts on one
  // circle centred at (0, 0.45, -11) station-local, which the camera meets face
  // on and then flies through. Both beats aim straight up the axis of that
  // wheel, so all ten cards are the same distance out, the same size and the
  // same obliquity — the framing has to be as even-handed as the room is.
  //
  //   p = 0.38  the counting beat, ~11.9u out: with the ring at its assembled
  //             radius of 3.05 the topmost card sits at 0.63 of the frame's
  //             half-height, so all ten are inside the frame at once and can
  //             actually be counted.
  //   p = 0.64  the tally beat, held to p = 0.88. The aim drifts a little left,
  //             which both keeps the wheel centred and starts the turn toward
  //             station 9. The ring itself now stays SHUT through this whole
  //             hold — 08-intake.js opens it from 0.88, not from the settle key.
  //
  // `off` is left at the seam values through both interior keys in landscape:
  // 08 is the shortest chapter in the piece (62vh), so it already covers its
  // segment faster than any other, and there is no per-frame move budget here
  // to spend on hanging the camera back.
  '08-intake': {
    keys:     [{ p: 0, at: H, off: N },
               { p: 0.38, at: [0, 0.45, -11.0], off: [0, 0.45, 0] },
               { p: 0.64, at: [-0.45, 0.55, -12.0], off: [0, 0.45, 0] },
               { p: 0.88, at: [-0.45, 0.55, -12.0], off: N },
               { p: 1, at: [-5.0, 1.5, -18.0], off: N }],
    // Portrait is ~31° WIDE, and the wheel is a circle: width is the binding
    // constraint and the only two ways to buy it are a smaller ring or more
    // standoff. Both are spent. The scene narrows the ring to r = 2.32 and the
    // cards to 0.86 (08-intake.js, applied equally to all ten), and the camera
    // holds 0.4u further back than the seam value across both interior keys —
    // constant through the chapter, so it costs travel and not per-frame move.
    portrait: [{ p: 0, at: HP, off: NP },
               { p: 0.38, at: [0, 0.50, -11.0], off: [0, 0.7, 1.4] },
               { p: 0.64, at: [-0.40, 0.60, -12.0], off: [0, 0.7, 1.4] },
               { p: 0.88, at: [-0.40, 0.60, -12.0], off: NP },
               { p: 1, at: [-5.0, 1.8, -18.0], off: NP }],
  },
  // Chapter 09 is one set piece, parked at (-4.0, 0.85, -13.0) station-local —
  // deliberately on the LEFT. Station 10 lies off to the right and down-range,
  // so chapter 10's opening run passes station-9-local x ≈ +2 at that depth;
  // anything on the +x side of this room gets flown through on the way out
  // while room 09 is still resident. From over here the closing crane never
  // gets nearer than ~2.5u to any mark on it, and the workbench reads as
  // something you pass, twice.
  //
  //   p = 0.36  the room out of the fog, ~15u out, aimed a little short of it
  //             so the approach still points down the path;
  //   p = 0.66  the money shot, held to p = 0.88: 9.2u out, aimed dead at the
  //             wall centre, which puts the suite and all five screens inside
  //             the middle half of the frame. Everything is assembled by here —
  //             the hand-off at 0.90 pulls the room off frame and nothing may
  //             still be arriving.
  //
  // Both interior `off` values sit within 0.4u of the seam values, so the
  // 50°-odd pan from the workbench to station 10 over the last quarter is a
  // turn, not a lurch: ~1.0° per frame at a 40s read-through.
  '09-build': {
    keys:     [{ p: 0, at: H, off: N },
               { p: 0.36, at: [-2.6, 0.80, -11.0], off: [-0.4, 0.5, 0] },
               { p: 0.66, at: [-4.0, 0.85, -13.0], off: [-0.2, 0.6, 0] },
               { p: 0.88, at: [-4.0, 0.85, -13.0], off: N },
               { p: 1, at: [3.0, 1.8, -18.0], off: N }],
    // Portrait does not hang further back here: at 10.5u a 31°-wide frustum is
    // 2.9u of half-width and the room re-lays itself to fit inside that (the
    // wall re-flows to 19 columns, the screens stack into a column — see
    // 09-build.js). Height is free in portrait, so the room spends it.
    portrait: [{ p: 0, at: HP, off: NP },
               { p: 0.36, at: [-2.4, 0.85, -11.0], off: [0, 0.8, 1.3] },
               { p: 0.66, at: [-4.0, 0.90, -13.0], off: [0, 0.8, 1.3] },
               { p: 0.88, at: [-4.0, 0.90, -13.0], off: NP },
               { p: 1, at: [3.0, 2.1, -18.0], off: NP }],
  },
  // Last chapter: no successor, so the closing pose is free. The camera is
  // parked on station 10 from p=0.5 (cameraT saturates), so the crane is all
  // `off` — it rises off the line and tips down over the path it just flew.
  //
  // THE p = 1 KEY IS LOAD-BEARING, and it is the only key in this file that is.
  // Chapter 10 is the one chapter whose progress actually reaches 1.000 and
  // then HOLDS there for as long as the reader sits at the bottom of the page,
  // so its last pose is a composed frame rather than a moment in a move. The
  // closing three marks in scenes/10-close.js are placed ON this key's look
  // axis — landscape (0, 5.0, 0) → (0, -3.2, -12), i.e. direction
  // (0, -0.564, -0.826), 4.6u out; portrait (0, 5.2, 1.4) → (0, -2.8, -12),
  // direction (0, -0.512, -0.858), same 4.6u — which is what brings them to
  // dead centre exactly as the scroll runs out. Change either p = 1 key and the
  // final frame goes off-centre: `marksPos` and `marksTilt` in that scene move
  // with it.
  '10-close': {
    keys:     [{ p: 0, at: H, off: N },
               { p: 0.5, at: [0, -0.6, -9], off: [0, 1.8, 0] },
               { p: 0.85, at: [0, -2.4, -11], off: [0, 4.2, 0] },
               { p: 1, at: [0, -3.2, -12], off: [0, 5.0, 0] }],
    portrait: [{ p: 0, at: HP, off: NP },
               { p: 0.5, at: [0, -0.2, -9], off: [0, 2.0, 1.2] },
               { p: 0.85, at: [0, -2.0, -11], off: [0, 4.4, 1.4] },
               { p: 1, at: [0, -2.8, -12], off: [0, 5.2, 1.4] }],
  },
};
