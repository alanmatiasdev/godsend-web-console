# GODsend Web

> A browser-based, community-maintained interface for [GODsend 360](https://github.com/ghostyshell/GODSend-360).

GODsend Web is a lightweight React interface for the GODsend 360 Go backend. It runs in a browser and can be embedded in a GODsend binary, which serves both the UI and its HTTP API. Electron and Node.js are not needed on the device opening the page.

The upstream desktop renderer is written in React, but most of its screens call `window.godsendApi` through Electron's [preload/IPC bridge](https://github.com/ghostyshell/GODSend-360/blob/main/src/electron-app/preload.ts). This project implements browser-compatible workflows against the [documented HTTP API](https://github.com/ghostyshell/GODSend-360/blob/main/docs/api-reference.md). It is an independent web interface: it does not copy the desktop renderer or claim full feature parity.

## What this project provides

- A responsive web console for catalog browsing, Xbox library management, saves, DLC/title updates, FTP files, ISO tools, artwork, jobs, logs, and connection settings.
- An integration script and Go handler patches for embedding the built UI into a compatible GODsend 360 checkout.
- Release artifacts: integration kits, prebuilt server binaries, and a multi-architecture container image.

The project currently targets GODsend 360 v2.13.3 at commit [`ff70dad`](https://github.com/ghostyshell/GODSend-360/commit/ff70dadc7c86c8a52dbd366595ae93419d4b55f4). Compatibility with newer upstream revisions should be tested before use or release.

## Feature status

| Area | Web interface | Remaining Electron-only features |
| --- | --- | --- |
| Browse and install | Browse and search local Transfer ISOs, Minerva, Internet Archive, and the backend's retro ROM systems; view a cover when available, see source guidance, choose drive and GOD/Content/XEX where applicable, register and trigger a job. | Cover thumbnails throughout the catalog and richer disc/install details in the desktop browser. |
| Xbox Library | Read Aurora `content.db` and `settings.db` over FTP in the browser; search, sort and filter installed games, load cover thumbnails as rows become visible, view title metadata/favorites/play counts, refresh the library, enqueue moves between drives, manage artwork, and open inline DLC/TU or save panels for a selected title. The Aurora root is saved in this browser. | — |
| DLC and Title Updates | Discover DLC and title updates by Title ID and Xbox drive, queue installs, activate/deactivate TUs, and delete or move installed files between drives. | Per-title content panels inside Xbox Library. |
| Save games | Discover profiles, inspect per-title save files, back up a profile or every profile, copy a title save between profiles with optional KeyVault re-signing, and delete a profile's title save. | Profile labels and the richer inline presentation from the Electron library. |
| FTP Manager | Browse nested folders, create/delete folders and files, select multiple entries, move/copy them, upload files or whole folders from the browser while preserving folder structure, or upload paths on the GODsend host; download individual files or selected folders/files as a ZIP, and track FTP jobs. | Large browser downloads are buffered by the browser while the archive is prepared on the server. |
| ISO tools | Pick a local ISO or enter a path on the GODsend host, then probe, convert to GOD, or extract to XEX. Browser-picked ISOs upload to Transfer with progress and fill the server paths automatically. Optionally queue an FTP upload of the converted folder to a chosen destination, or leave it blank to use the configured drive and GOD/XEX folder. | — |
| ISO import | On **Catalog → Local files**: upload `.iso` files from the browser or fetch an authorized direct `.iso`/`.7z` URL into GODsend's Transfer folder. Files are streamed to disk, written as `.part` and renamed only when complete. `.7z` imports extract one ISO with `7z`, `7zz`, or `7za`. | Resuming interrupted imports; archives with no or multiple ISOs. |
| Aurora artwork | From **Xbox Library → Artwork**: preview installed cover, background, banner, icon, and screenshots; search XboxUnity and the Xbox catalog by Title ID or name; select PNG/JPEG/GIF/BMP from the browser; convert GIF/BMP to PNG and upload as an Aurora `.asset`. Bulk sync artwork for library titles and configure GODsend to fetch artwork after completed FTP transfers. | — |
| XboxUnity archive fallback | A separate Aurora utility script looks up missing game names, covers and icons by Title ID through the GODsend backend, using the [XboxUnity-Scraper archive](https://github.com/UncreativeXenon/XboxUnity-Scraper). Names are applied in Aurora; images are staged for Aurora's **Assets → Import** action. | Descriptions, publisher, developer and release dates are absent from that archive. |
| Job queue | Unified game pipeline and FTP jobs with state, FTP progress, refresh, and removal of completed jobs. **Waiting queue**: games wait in an ordered list and are sent to GODsend one at a time (configurable 1–6 at once); pause/resume, hold, reorder, start now, return to the wish list, remove, and clear finished jobs. **Wish list**: prepare games with their drive and format and send some or all to the waiting queue later; nothing reaches GODsend until then. | Pausing or cancelling a job GODsend is already running: upstream has no such control, so running jobs can only be removed. |
| Xbox setup | Store the Xbox IP in this browser, test FTP connectivity or supplied credentials, choose the Aurora scripts folder on the GODsend host and destination on Xbox, then enqueue an upload that patches `state.lua`. | Persist FTP credentials in the server configuration and automatic network discovery. |
| Server settings | Read the default destination drive from `/config`, inspect cache/data status, refresh catalogs, and clear job and temporary data after confirmation. | Configure Internet Archive login, Debrid providers, storage/Transfer/backup/temp paths, default drive, custom GOD/XEX and ROM paths, and aria2 ports; these options are currently loaded from the server environment at startup. |
| GODsend logs | Follow recent backend log messages in the web panel, filter them, pause following, download the visible log, or clear the local view. The server keeps a bounded in-memory tail of 500 lines. | Desktop terminal window and OS log integration. |
| Desktop operations | — | Start/restart/stop the backend, launch at login, and use the tray. These are host-specific operations and need a different web/server design. |
| BadAvatar USB | — | Format/build the BadAvatar USB payload and manage its options. This requires host device access. |

The comparison is based on the upstream [feature reference](https://github.com/ghostyshell/GODSend-360/blob/main/docs/features.md) and the v2.13.3 desktop source. Tray operations and BadAvatar USB creation are intentionally outside this web project because they require host operating-system or USB device access.

On mobile, the sidebar opens from the menu button in the top bar. It shows the full page names and both connection states.

## Language

English is the default. Use the **EN / PT-BR** selector in the top bar to switch the UI to Brazilian Portuguese. The choice is saved in this browser and updates the page language. Game titles, job detail messages, disc notes, and server errors returned by GODsend are shown as the backend provides them.

## Development

Requires Node.js 20+.

```sh
npm ci
npm run dev
```

The development server is available at `http://localhost:5173/ui/`. It proxies API calls to the URL in `GODSEND_DEV_BACKEND`. Set that variable to a GODsend server reachable from your machine:

```sh
GODSEND_DEV_BACKEND=http://192.168.1.10:8080 npm run dev
```

If the variable is omitted, the repository's Vite configuration supplies its current fallback. Contributors should set `GODSEND_DEV_BACKEND` explicitly rather than relying on that fallback.

Set the Xbox IP on the **Connection** page. Its connection status is shown in the sidebar and the address is stored only in that browser. The same page can point the web UI at another GODsend HTTP server; the selected server is tested before it replaces the default address. A transfer starts only after selecting **Add to queue** in the game dialog.

### Build and checks

```sh
npm ci
npm run build
npm run package
```

Use `npm install` only when intentionally updating dependencies and the lockfile. CI runs the build and validates the release integration kit on pull requests and pushes to `main`.

## Embed in a GODsend binary

### Published packages

Each [GitHub Release](https://github.com/alanmatiasdev/godsend-web-console/releases) provides:

| Package | Purpose |
| --- | --- |
| `godsend-web-console-vX.Y.Z.tar.gz` | Built UI, Go integration files, Aurora fallback scripts, and the integration command. Use this with your own GODsend source checkout; Node.js runs the patcher, but npm is not needed. |
| `godsend-vX.Y.Z-<os>-<arch>.tar.gz` or `.zip` | GODsend server already compiled with the web UI embedded. Linux amd64/arm64, macOS amd64/arm64, and Windows amd64 are built. |
| `SHA256SUMS` | Checksums for every archive. |

The same release publishes `ghcr.io/alanmatiasdev/godsend-web-console:vX.Y.Z` (and `:latest`) for Linux amd64 and arm64 through [GitHub Container Registry](https://github.com/alanmatiasdev/godsend-web-console/pkgs/container/godsend-web-console). It contains the complete server, UI, `aria2`, and 7-Zip for remote `.7z` imports. Pin a version tag in deployments. The binaries and image currently integrate [GODSend-360 commit `ff70dad`](https://github.com/ghostyshell/GODSend-360/commit/ff70dadc7c86c8a52dbd366595ae93419d4b55f4); this is updated only after compatibility is verified. Standalone binaries need `aria2c` on `PATH` for BitTorrent downloads and `7z`, `7zz`, or `7za` on `PATH` for remote `.7z` imports.

For a local build using a downloaded integration kit:

```sh
tar xzf godsend-web-console-vX.Y.Z.tar.gz
node godsend-web-console-vX.Y.Z/scripts/integrate.mjs /path/to/GODSend-360
cd /path/to/GODSend-360/src/server
CGO_ENABLED=0 go build -o godsend .
```

For a Docker or home-server deployment, reference the prebuilt GHCR image directly:

```yaml
services:
  godsend:
    image: ghcr.io/alanmatiasdev/godsend-web-console:vX.Y.Z
    environment:
      GODSEND_HOME: /data
    volumes:
      - ./data:/data
    ports:
      - "8080:8080"
```

Keep the existing GODsend environment variables and data/save mounts when replacing a source-built image. The backend API has no authentication; expose it only on a trusted network.

### Build from this checkout

With a checkout of the [upstream repository](https://github.com/ghostyshell/GODSend-360), run from this project:

```sh
npm run build
npm run integrate -- /path/to/GODSend-360
```

The integration script copies `dist/` to `src/server/interfaces/http/webui/`, adds the Go `embed.FS` handler and test, browser file/folder upload and download/archive routes, ISO upload, ROM system and host path discovery, queue APIs, artwork search and thumbnails, cursor-based GODsend logs, automatic/manual artwork sync endpoints, and the Unity archive fallback. It patches GODsend log and FTP completion callbacks, registers `/ui/`, and keeps the queue and artwork sync settings in GODsend's data folder. It is idempotent but modifies the upstream checkout. This was validated against upstream v2.13.3 (commit `ff70dadc7c86c8a52dbd366595ae93419d4b55f4`). Build the backend from the upstream root; for Linux x64:

```sh
npm run build:server:linux:x64
```

The resulting binary serves the UI at `http://<server>:8080/ui/` and redirects `/` there. The integration also enables CORS for the GODsend API, allowing a web UI hosted elsewhere to use a configured server address. Reapply the integration after updating the upstream checkout.

The GODsend API has no authentication. Keep port 8080 on a trusted LAN, or add authentication at a reverse proxy before exposing it elsewhere.

Remote ISO import accepts direct HTTP(S) URLs only, blocks local and private-network destinations, limits each download to 32 GiB, and follows at most five redirects. Install a compatible 7-Zip command (`7z`, `7zz`, or `7za`) on the GODsend host to import `.7z` archives. Use it only with files you are authorized to download.

## Contributing

Contributions are welcome: bug reports, compatibility testing against newer GODsend 360 versions, documentation improvements, and pull requests all help. See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and contribution expectations, and [docs/conventional-commits.md](docs/conventional-commits.md) for the required Conventional Commit format.

Use [GitHub Issues](https://github.com/alanmatiasdev/godsend-web-console/issues) for reproducible bugs and feature proposals, and [Pull Requests](https://github.com/alanmatiasdev/godsend-web-console/pulls) for contributions. Do not include Xbox IP addresses, credentials, private logs, or other sensitive information in public reports.

### Security

The GODsend API has no built-in authentication. Do not expose it directly to the public internet; keep it on a trusted network or put authentication in front of it with a reverse proxy. For a suspected vulnerability, do not publish exploit details in an issue—contact the repository maintainers privately through GitHub first.

### License and upstream relationship

GODsend Web is released under the [MIT License](LICENSE) (copyright © 2026 Alan Matias). It integrates with, but is not affiliated with, GODsend 360; consult the [upstream license](https://github.com/ghostyshell/GODSend-360/blob/main/LICENSE) and notices for third-party material before redistributing builds or derivative work.

### Aurora archive fallback

The integration also adds `/webui/unity-archive/title`, `/cover`, and `/icon` (each requires `?title_id=XXXXXXXX`) and copies the standalone Lua script to `<upstream>/aurora-scripts-archive-fallback/`. The server reads the archive's `metadata.json` into a 24-hour memory cache, and fetches only the selected game's PNG files. It keeps the last good index if GitHub is temporarily unavailable. The Xbox connects only to the GODsend server.

To install, use **Server settings → Install Aurora scripts** with source `<upstream>/aurora-scripts-archive-fallback` and Xbox destination `/Hdd1/Aurora/User/Scripts/Utility/ArchiveFallback` (adjust the Aurora drive and root as needed). Enter the GODsend host IP and port, then upload. Restart Aurora if the script does not appear under Utility scripts. Run **GODsend Archive Fallback** to check the library. The script retains existing names and assets, stages missing PNGs in `Aurora/User/Import/<TitleID>/`, and reports the results. Then choose **Aurora Settings → Assets → Import** to install staged images.

The fallback needs access from the GODsend host to `raw.githubusercontent.com`; it does not need XboxUnity to be online. The archive's README reports its last scrape as June 16, 2025. The archive's original content is CC BY-NC 4.0, while XboxUnity images retain their owners' rights; this integration downloads images on demand and does not bundle them.

## Release process (maintainers)

Release Please opens a version and changelog PR from Conventional Commits on `main`. Merging it creates a GitHub Release. The release workflow then builds the integration kit, tests the patched Go handlers, cross-compiles the binaries, attaches the archives and checksums, and publishes the multi-architecture image to GHCR. Nothing is published to npm.
