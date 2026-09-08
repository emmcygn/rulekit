# Dependency review

Reviewed **2026-09-09** with Node 22.22.2 and npm 10.9.0. Audit results are a
snapshot of the registry advisories and locked versions, not a guarantee that
all vulnerabilities have been found.

## Root and workbench results

| Scope | Result |
| --- | --- |
| Root `npm audit` | Five high-severity package findings in the optional promptfoo / Transformers dependency chain |
| Root `npm audit --omit=dev` | Zero reported vulnerabilities |
| `web/` `npm audit` | Zero reported vulnerabilities |

Compatible root lockfile updates moved `fast-uri` to 3.1.7, `hono` to 4.13.7,
`qs` to 6.16.0, and promptfoo's direct optional `sharp` to 0.35.4. No direct
dependency was downgraded or moved across a major version.

The workbench keeps Monaco 0.56.0 and narrowly overrides its pinned DOMPurify
3.4.8 to **3.4.15**, a patch release addressing the reported sanitizer issues.
The override is under `monaco-editor` in `web/package.json`; remove it when
Monaco's own dependency includes a patched version and the workbench tests and
build pass. See the [DOMPurify advisory](https://github.com/advisories/GHSA-55q2-fjhq-7xh7).

## Remaining optional evaluation dependencies

The five findings describe propagation through one dependency chain, not five
independent defects in rulekit's engine:

```text
promptfoo 0.122.0 (development dependency)
└── @huggingface/transformers 4.2.0 (optional)
    ├── onnxruntime-node 1.24.3 → adm-zip 0.5.18
    └── sharp 0.34.5
```

- `adm-zip` has a [crafted-ZIP memory allocation advisory](https://github.com/advisories/GHSA-xcpc-8h2w-3j85)
  and an [extraction-through-symlinks advisory](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9).
  The published latest version, 0.6.0 at review time, still falls within the
  latter advisory's affected range.
- Transformers' nested `sharp` 0.34.5 falls within the reported
  [libvips](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) and
  [libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) affected ranges.
  The patched 0.35.4 is outside Transformers' declared `^0.34.5` range.

The latest published Transformers 4.2.0 still declares these dependency ranges.
Overriding its native inference/image stack would require separate local-model
and image-processing validation; the ten recorded text cases cannot establish
that compatibility. `npm audit fix --force` proposes downgrading promptfoo to
0.120.14, so it was not applied.

These optional packages can be installed on a developer's machine. The normal
recorded config uses committed JSON responses and does not configure a local
Transformers model or image/ZIP input. The final Docker stage serves static
assets and does not copy root development dependencies. This limits exposure
for the shipped demo, but does not remove the dependency findings. Recheck
upstream releases before adding local-model or untrusted image/archive flows.

## Recorded evaluation and network behavior

`npm run eval` builds the engine, then runs `scripts/eval-recorded.ts` with the
fixed recorded configuration. It makes no live model calls and needs no API
key. The wrapper sets the supported `PROMPTFOO_DISABLE_TELEMETRY=1` and
`PROMPTFOO_DISABLE_UPDATE=1` options and refuses arguments that could select a
different provider/configuration.

Promptfoo 0.122.0 nevertheless sends a telemetry opt-out notification; its
[upstream telemetry implementation](https://github.com/promptfoo/promptfoo/blob/0.122.0/src/telemetry.ts)
calls the notification endpoint even when the telemetry flag is set. The
recorded promptfoo command therefore does not promise zero network traffic.
Use `npm run facts:eval` for rulekit's standalone local corpus evaluation.
