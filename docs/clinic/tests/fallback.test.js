import { describe, it, expect, vi, afterEach } from 'vitest';
import { fallbackDecision, shouldOfferFallback, installBanner } from '../src/core/fallback.js';

describe('fallbackDecision', () => {
  it('redirects when WebGL2 is missing', () => {
    expect(fallbackDecision({ webgl2: false, reducedMotion: false })).toEqual({ redirect: true, reason: 'no-webgl2' });
  });
  it('redirects on prefers-reduced-motion', () => {
    expect(fallbackDecision({ webgl2: true, reducedMotion: true })).toEqual({ redirect: true, reason: 'reduced-motion' });
  });
  it('does not redirect a capable, motion-tolerant visitor', () => {
    expect(fallbackDecision({ webgl2: true, reducedMotion: false })).toEqual({ redirect: false, reason: null });
  });
  it('reports no-webgl2 first when both are true', () => {
    expect(fallbackDecision({ webgl2: false, reducedMotion: true }).reason).toBe('no-webgl2');
  });
});

describe('shouldOfferFallback', () => {
  it('offers only when the LOWEST tier still fails the probe', () => {
    expect(shouldOfferFallback({ tier: 'low', verdict: 'fail' })).toBe(true);
    expect(shouldOfferFallback({ tier: 'medium', verdict: 'fail' })).toBe(false);
    expect(shouldOfferFallback({ tier: 'low', verdict: 'ok' })).toBe(false);
    expect(shouldOfferFallback({ tier: 'low', verdict: 'pending' })).toBe(false);
  });
});

// The banner runs in a `node` test environment, so `root` is a hand-rolled stand-in
// for the one div it touches, and `navigate` is injected instead of calling
// location.replace. Everything the banner actually decides — the 5s auto-navigate
// and, more importantly, its cancellation — is real.
function fakeRoot() {
  const handlers = new Map();
  return {
    hidden: true,
    innerHTML: '',
    querySelector(sel) {
      return { addEventListener: (_type, cb) => handlers.set(sel, cb) };
    },
    click(sel) { handlers.get(sel)(); },
    has(sel) { return handlers.has(sel); },
  };
}

describe('installBanner', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('stays hidden until show() is called', () => {
    const root = fakeRoot();
    const banner = installBanner({ root, navigate: () => {} });
    expect(root.hidden).toBe(true);
    banner.show();
    expect(root.hidden).toBe(false);
    expect(root.innerHTML).toContain('/plain');
  });

  it('navigates to /plain after the auto delay', () => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    const banner = installBanner({ root: fakeRoot(), navigate, autoAfterMs: 5000 });
    banner.show();
    vi.advanceTimersByTime(4999);
    expect(navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(navigate).toHaveBeenCalledWith('/plain');
  });

  it('"stay here" hides the banner AND cancels the auto-navigate', () => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    const onDismiss = vi.fn();
    const root = fakeRoot();
    const banner = installBanner({ root, navigate, onDismiss, autoAfterMs: 5000 });
    banner.show();
    root.click('.banner-stay');
    expect(root.hidden).toBe(true);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60000);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('show() twice does not leave two timers armed', () => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    const banner = installBanner({ root: fakeRoot(), navigate, autoAfterMs: 5000 });
    banner.show();
    banner.show();
    vi.advanceTimersByTime(20000);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
