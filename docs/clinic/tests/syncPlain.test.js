import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { injectBacklink, syncPlain, BACKLINK_MARKER } from '../scripts/sync-plain.mjs';

const sourcePath = fileURLToPath(new URL('../../plain.html', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');

describe('injectBacklink', () => {
  it('adds exactly one back-link block', () => {
    const out = injectBacklink(source);
    expect(out.split(BACKLINK_MARKER)).toHaveLength(2);
    expect(out).toContain('see the 3D version');
    expect(out).toContain('href="/walkthrough/"');
  });

  it('is idempotent - running it twice does not duplicate the block', () => {
    expect(injectBacklink(injectBacklink(source))).toBe(injectBacklink(source));
  });

  it('changes nothing else: the source is a strict prefix of the copy', () => {
    const out = injectBacklink(source);
    expect(out.startsWith(source)).toBe(true);
    expect(out.length).toBeGreaterThan(source.length);
  });

  it('leaves every claim in the source intact', () => {
    const out = injectBacklink(source);
    for (const needle of ['56.7%', 'heuristic estimate', 'no open implementation', 'not medical software']) {
      expect(out).toContain(needle);
    }
  });
});

describe('syncPlain', () => {
  it('writes a copy that is the untouched source plus exactly one appended block', () => {
    const { src, out } = syncPlain();
    expect(readFileSync(src, 'utf8')).toBe(source); // source never written to
    const copy = readFileSync(out, 'utf8');
    expect(copy.startsWith(source)).toBe(true);
    expect(copy.slice(source.length)).not.toContain('</script>');
    expect(copy.split(BACKLINK_MARKER)).toHaveLength(2);
  });

  it('re-running the sync is stable - the copy does not grow', () => {
    const { out } = syncPlain();
    const first = readFileSync(out, 'utf8');
    syncPlain();
    expect(readFileSync(out, 'utf8')).toBe(first);
  });

  it('keeps the /plain URL contract: the back-link points at /walkthrough', () => {
    // The static host must resolve /plain to this file, and this file's only
    // link back must resolve to the 3D page. In the combined rulekit deploy the
    // 3D page is mounted at /walkthrough — `/` is the landing page — so a
    // back-link to `/` would quietly send readers to the wrong document. Pinned
    // here so the topology cannot drift without a red test.
    const copy = readFileSync(syncPlain().out, 'utf8');
    const block = copy.slice(source.length);
    expect(block).toContain('href="/walkthrough/"');
    expect(block).not.toContain('href="/"');
    expect(block).toContain('see the 3D version');
  });
});
