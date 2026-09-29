# Repository Guidelines

## Project Structure & Module Organization

The React/Vite application lives in `src/`. `App.tsx` composes the UI; feature modules such as `queue.tsx`, `management.tsx`, and `artwork.tsx` hold domain-specific screens and controls. Shared HTTP calls are in `src/api.ts`, translations in `src/i18n.tsx`, and global styling in `src/styles.css`.

The `integration/` directory contains Go handlers and Go tests that the integration script copies into a GODsend 360 checkout. `scripts/` contains packaging and integration tooling. Aurora Lua scripts are in `aurora-scripts/`. Keep technical decisions in `docs/adrs/`; repository conventions belong directly in `docs/`.

## Build, Test, and Development Commands

Use Node.js 20 or newer.

```sh
npm ci                                      # install locked dependencies
GODSEND_DEV_BACKEND=http://host:8080 npm run dev  # run Vite at /ui/
npm run build                               # type-check and build dist/
npm run package                             # create the release integration kit
npm run integrate -- /path/to/GODSend-360  # patch an upstream checkout
```

After integrating into GODsend 360, run `go test ./interfaces/http` from its `src/server` directory to test the Go handlers. There is no standalone frontend test command currently; at minimum, run the build before opening a pull request.

## Coding Style & Naming Conventions

Follow the existing TypeScript style: two-space indentation, single quotes, no semicolons, and concise functional React components. Use `PascalCase` for components, `camelCase` for functions and variables, and descriptive kebab-case filenames for non-component assets. Extend the existing i18n structure for visible UI copy instead of hard-coding new strings. Keep Go integration changes isolated to `integration/` and preserve its existing package and test conventions.

## Commit & Pull Request Guidelines

Every commit must follow [Conventional Commits](docs/conventional-commits.md), for example `feat(queue): add retry action` or `fix(ftp): preserve nested paths`. Keep pull requests focused; explain the user-facing change, validation performed, and the GODsend 360 version or commit tested. Update relevant documentation when setup, compatibility, or release output changes.

## Security & Configuration

Set `GODSEND_DEV_BACKEND` explicitly for local development and do not commit private server addresses, Xbox credentials, logs, or copyrighted game content. The backend API has no built-in authentication: deployments must stay on a trusted network or use an authenticated reverse proxy.
