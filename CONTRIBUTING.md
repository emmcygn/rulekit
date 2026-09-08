# Contributing to rulekit

Clinical trial coordinators, clinicians, researchers, designers and developers
can all contribute. A description of a confusing decision or a missing review
step is useful without a code change.

## Start with an example

- For workflow feedback or collaboration, read the
  [clinical collaboration guide](docs/clinical-collaboration.md) and open a
  [collaboration issue](https://github.com/emmcygn/rulekit/issues/new?template=collaboration.yml).
- For a bug, use the
  [bug report](https://github.com/emmcygn/rulekit/issues/new?template=bug_report.yml)
  with reproduction steps and expected behavior.
- For a security concern, follow [SECURITY.md](SECURITY.md).

Public issues, pull requests and attachments must use fabricated examples.
Do not include patient records, identifying details, private protocols or
credentials. The bundled synthetic examples are a good starting point.

## Make a change

1. Follow the [development guide](docs/development.md) to install and run the
   part of the project you want to change.
2. Keep each pull request focused on one problem. For a larger behavior change,
   describe the proposed outcome in an issue first so others can contribute.
3. Explain what changes for a reader or user and run the relevant checks from
   the development guide. Record the commands and results in the pull request.

Rule changes should retain source wording and explain any partial or unmodeled
criteria; see [FORMAT.md](FORMAT.md). Changes to a synthetic note may also require
updating its grounded quotes and recorded extraction fixture; see
[the notes guide](corpus/notes/README.md). Keep the distinction between demo
behavior and clinical validation clear in documentation and examples.

The project uses [Apache-2.0](LICENSE). Preserve existing copyright and license
notices, and document the source of any added third-party material in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
