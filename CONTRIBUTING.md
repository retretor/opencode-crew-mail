# Contributing

Thank you for helping. Bug reports, ideas, documentation fixes and code are all welcome.

## Before you start

- **Bugs and small fixes:** open a pull request directly, or an issue first if you are not sure it is a bug.
- **New features or changed behaviour:** open an issue first and describe the problem it solves, so that we agree on the approach before you spend time on code.
- **Security problems:** do not open an issue; see [SECURITY.md](SECURITY.md).

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

You need Node.js 20 or newer; for the end-to-end test also [opencode](https://opencode.ai) 2.2 or newer on `PATH`. There are no dependencies and no build step.

```sh
git clone https://github.com/<you>/opencode-crew-mail.git
cd opencode-crew-mail
git config core.hooksPath .githooks   # local branch rules, and the unit tests before a push
npm test                              # unit tests, any OS
CREW_MAIL_E2E=1 npm run test:e2e      # also end-to-end, against a real `opencode serve` with a fake model
```

In PowerShell set the variable with `$env:CREW_MAIL_E2E = "1"`. The end-to-end test works in temporary folders only and needs no provider or account.

To try a change in opencode, copy `crew-mail.js` into `~/.config/opencode/plugins/` and restart opencode.

## Making a pull request

1. Fork the repository and create a branch from `main`: `git switch -c fix/short-description` (or `feat/...`, `docs/...`).
2. Make the change. Keep it focused: one problem per pull request.
3. Add or update tests. A change in how the plugin talks to opencode needs the end-to-end test to pass as well.
4. Update the documentation: `README.md` with its settings table, and a line under `## Unreleased` in `CHANGELOG.md`.
5. Run `npm test` (the pre-push hook runs it too).
6. Commit with a clear message in the [Conventional Commits](https://www.conventionalcommits.org/) style: `fix: refuse messages to finished subagents`, `feat: ...`, `docs: ...`, `test: ...`.
7. Push the branch to your fork and open a pull request against `main`. Fill in the template.
8. CI must pass. A maintainer reviews the change. Please answer review comments with new commits rather than a force-push, so that the review stays readable. Pull requests are merged with "Squash and merge".

## Code style

- Plain JavaScript modules: no dependencies, no build step, no network access.
- Only the default export of `crew-mail.js` is a plugin. Do not add named exports (opencode may load them as plugins); test helpers go into `_test`.
- Comments say why, not what. Messages that agents see say what to do instead.
- Two spaces, double quotes, no semicolons, as in the existing code.

## Translations

English is the main language of the project, and `README.md` is the reference. Translations live in `docs/i18n/README.<language>.md` and may lag behind: when you change `README.md`, updating them is welcome but not required. To add a language, copy `README.md` to `docs/i18n/README.<code>.md`, translate it, fix the relative links, and add it to the language line at the top of every README.

## Branch rules

`main` is protected on GitHub: changes go in through pull requests with passing CI, history stays linear, `main` cannot be force-pushed or deleted, and release tags (`v*`) cannot be moved or deleted. The hooks in `.githooks` apply the same rules locally (no commits on `main`, no direct pushes to it) and run the unit tests before a push. `ALLOW_MAIN=1` overrides them in an emergency.

## Releases (maintainers)

1. In a pull request: move the `Unreleased` lines of `CHANGELOG.md` under a new version heading and set the same version in `package.json` (`npm version <x.y.z> --no-git-tag-version`).
2. After the merge: `git switch main`, `git pull`, `git tag v<x.y.z>`, `git push origin v<x.y.z>`.
3. The release workflow makes the GitHub release from the changelog and, when enabled, publishes to npm with provenance.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE) of this project.
