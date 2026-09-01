#!/usr/bin/env node
//
// sync-plain: publish the 2D essay into the clinic build.
//
// BINDING RULE: `docs/plain.html` — this folder's `../plain.html` — is the
// source of truth and is NEVER written to. The build copy at `public/plain.html`
// differs from it by exactly one appended, marked block: the link back to the 3D
// version. The source is therefore a strict prefix of the copy, and
// `tests/syncPlain.test.js` asserts that. If you need to change the essay, edit
// the source; if you need to change the back-link, edit BLOCK below.
//
// URL CONTRACT (/plain): the deployed page must answer at the clean path `/plain`,
// not only `/plain.html`.
//   - dev + preview: the `plainCleanUrl` plugin in vite.config.js rewrites
//     /plain -> /plain.html.
//   - production: the Dockerfile at the repo root lifts this build's
//     dist/plain.html to site/plain.html, and `serve site` resolves /plain
//     natively (clean URLs).
//   - any other static host MUST do the same, either through clean-URL support
//     or an explicit /plain -> /plain.html rewrite. Nothing here can enforce
//     that at build time.
//
// BACK-LINK TARGET (/walkthrough): the clinic is no longer a service of its own
// answering at `/`. It is mounted under /walkthrough of the combined rulekit
// deploy, where `/` is the landing page — so the link back has to name
// /walkthrough or it sends readers to the wrong document entirely. That is a
// deploy-topology fact, not a style choice: change it only when the mount point
// in the root Dockerfile changes with it.
//
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

export const BACKLINK_MARKER = 'data-clinic-backlink';

const BLOCK = `
<div ${BACKLINK_MARKER} style="max-width:720px;margin:0 auto;padding:28px 20px 64px;
     font:400 14px/1.6 'Public Sans',Helvetica,Arial,sans-serif;color:#6B655C">
  <a href="/walkthrough/?force3d=1" style="color:#A6431E;border-bottom:1px solid currentColor;text-decoration:none">see the 3D version</a>
  &#8201;&#183;&#8201; same story, staged as a walk through a research clinic. Needs WebGL2 and a little motion tolerance.
</div>
`;

export function injectBacklink(html) {
  if (html.includes(BACKLINK_MARKER)) return html;
  return html + BLOCK;
}

export function syncPlain() {
  const src = fileURLToPath(new URL('../../plain.html', import.meta.url));
  const outDir = fileURLToPath(new URL('../public/', import.meta.url));
  const out = fileURLToPath(new URL('../public/plain.html', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(out, injectBacklink(readFileSync(src, 'utf8')));
  return { src, out };
}

const isMain = process.argv[1] && process.argv[1].endsWith('sync-plain.mjs');
if (isMain) {
  const { src, out } = syncPlain();
  console.log(`sync-plain: ${src} -> ${out} (+ back-link)`);
}
