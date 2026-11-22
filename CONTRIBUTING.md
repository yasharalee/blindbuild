# Contributing

Thanks for helping. Blindbuild follows its own rules, so contributions do too.

1. Open an issue first for anything bigger than a typo, so we agree on the shape before code.
2. Branch from `main`, one change per pull request.
3. Follow the [core rules](plugins/blindbuild/rules/core-rules.md). Changing the core rules needs an issue and a new checksum (`plugins/blindbuild/rules/core-rules.sha256`, SHA-256 of the file with LF line endings).
4. Logic lives once, in Node (`plugins/blindbuild/scripts/`, Node 18+, no dependencies). Shell files are only thin `.ps1` + `.sh` launcher pairs.
5. CI runs the tests on Windows, macOS and Linux with Node 18 and 22. Locally, run `npm test`, `claude plugin validate --strict ./plugins/blindbuild` and `node plugins/blindbuild/scripts/cli.mjs verify-rules` before opening the PR.
6. Add a line to `CHANGELOG.md`.
