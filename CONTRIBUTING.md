# Contributing to GODsend Web

Thanks for helping improve GODsend Web. Contributions are welcome for bug fixes, documentation, compatibility work, tests, and new browser-compatible GODsend workflows.

## Before you start

- Search [issues](https://github.com/alanmatiasdev/godsend-web-console/issues) and [pull requests](https://github.com/alanmatiasdev/godsend-web-console/pulls) to avoid duplicate work.
- For a substantial change, open an issue first to agree on scope and compatibility expectations.
- Never include Xbox IP addresses, credentials, private logs, personal data, copyrighted game content, or other sensitive material in issues, commits, or pull requests.

## Local setup

Use Node.js 20 or newer. Install the locked dependencies and start Vite:

```sh
npm ci
GODSEND_DEV_BACKEND=http://192.168.1.10:8080 npm run dev
```

The UI is served at `http://localhost:5173/ui/`. `GODSEND_DEV_BACKEND` must point to a GODsend server reachable from your machine. Do not rely on the fallback in `vite.config.ts`.

To create a production build and release integration kit:

```sh
npm run build
npm run package
```

When changing the Go integration, test it against the supported GODsend 360 revision identified in the README. The integration script modifies the upstream checkout, so work in a disposable clone or a branch you are comfortable changing.

## Pull requests

Keep each pull request focused. In its description, explain what changed, how it was tested, and the GODsend 360 version or commit used when relevant. Update the README or other documentation whenever behavior, setup, support status, or release output changes.

Before requesting review, run:

```sh
npm run build
npm run package
```

Every commit **must** follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. See [docs/conventional-commits.md](docs/conventional-commits.md) for the required format and examples. Release Please derives releases and changelog entries from those messages.

Maintainers may request changes for scope, compatibility, test coverage, documentation, or release-note clarity.

## Security issues

Do not disclose suspected vulnerabilities in a public issue. Contact the repository maintainer privately through GitHub first, with enough detail to reproduce and assess the issue.

## License

By contributing, you agree that your contributions are licensed under the repository's [MIT License](LICENSE).
