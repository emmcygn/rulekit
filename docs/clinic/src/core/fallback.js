// The whole fallback policy, spec section 9, in one place:
//
//   boot:
//     no WebGL2                      -> location.replace('/plain')
//     prefers-reduced-motion: reduce -> location.replace('/plain')
//     probe fails at the low tier    -> banner offering /plain (auto after 5s)
//   persistent footer link           -> "prefer the flat version?"  (index.html)
//
// The two decisions are pure functions on plain values so they test in Node with
// no DOM and no WebGL context. The banner is the only part that touches an
// element, and even it takes its navigation as an injected function.

export function fallbackDecision({ webgl2, reducedMotion }) {
  // Order matters: a visitor with neither WebGL2 nor motion tolerance is sent to
  // /plain for the harder reason, because that is the one that would have left
  // them looking at a blank canvas.
  if (!webgl2) return { redirect: true, reason: 'no-webgl2' };
  if (reducedMotion) return { redirect: true, reason: 'reduced-motion' };
  return { redirect: false, reason: null };
}

// Only the LOWEST tier earns the banner. Anywhere above it there is still a
// cheaper scene to fall to, and quality.js will fall to it on its own; offering
// the flat version before that has happened gives up too early. `pending` is the
// verdict before enough frames have been seen to judge, and is never an offer.
export function shouldOfferFallback({ tier, verdict }) {
  return tier === 'low' && verdict === 'fail';
}

export function installBanner({
  root,
  onDismiss,
  autoAfterMs = 5000,
  navigate = (href) => { location.replace(href); },
} = {}) {
  let timer = 0;
  let wired = false;

  function hide() {
    clearTimeout(timer);
    timer = 0;
    root.hidden = true;
  }

  function show() {
    // Re-arming on a second show() would leave the first timer running, and the
    // reader would be moved to /plain by a countdown they already dismissed.
    clearTimeout(timer);
    root.hidden = false;
    if (!wired) {
      root.innerHTML = `
      <span>This device is struggling with the 3D version. The flat version reads the same.</span>
      <a href="/plain" class="banner-go">read the flat version</a>
      <button type="button" class="banner-stay">stay here</button>`;
      // "stay here" is the escape hatch from spec section 2: it hides the banner
      // AND cancels the auto-navigate. A dismissal that still navigated five
      // seconds later would be worse than no escape at all.
      root.querySelector('.banner-stay').addEventListener('click', () => {
        hide();
        if (onDismiss) onDismiss();
      });
      wired = true;
    }
    timer = setTimeout(() => { timer = 0; navigate('/plain'); }, autoAfterMs);
  }

  return { show, hide };
}
