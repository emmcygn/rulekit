# Reporting a security concern

rulekit is an experimental demonstration using synthetic data. It has no
published supported-version schedule or security response deadline.

Do not put vulnerability details, credentials, patient information or private
protocols in a public issue or pull request.

If the repository's
[Security tab](https://github.com/emmcygn/rulekit/security) offers **Report a
vulnerability**, use that private reporting option. Otherwise, open an issue
titled **Private security contact request**, include no vulnerability details,
and ask [@emmcygn](https://github.com/emmcygn) to arrange a private channel.
No separate private security contact is currently documented here.

Once a private channel is available, provide the affected version or commit,
reproduction steps using synthetic data, and the impact you observed. If a
credential was exposed, revoke it with its provider; do not copy it into the
report.

For ordinary bugs that do not expose sensitive information, use the
[bug report](https://github.com/emmcygn/rulekit/issues/new?template=bug_report.yml).

The [dependency review](docs/dependency-audit.md) records current audit findings,
the scoped Monaco patch override, and remaining optional development-tool
dependencies that require upstream fixes.
