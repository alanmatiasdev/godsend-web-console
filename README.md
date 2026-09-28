# GODsend Web

A lightweight React interface for the [GODsend 360](https://github.com/ghostyshell/GODSend-360) Go backend. It runs in a browser and can be embedded in the original Go binary, which serves both the UI and its HTTP API. Electron and Node.js are not needed on the device opening the page.

The official desktop renderer is already written in React, but most screens call `window.godsendApi` through Electron's [preload/IPC bridge](https://github.com/ghostyshell/GODSend-360/blob/main/src/electron-app/preload.ts). This project implements the browser-compatible parts against the [documented HTTP API](https://github.com/ghostyshell/GODSend-360/blob/main/docs/api-reference.md). It does not copy the full desktop renderer or claim feature parity. The upstream project is [MIT licensed](https://github.com/ghostyshell/GODSend-360/blob/main/LICENSE).

## Feature status

| Area | Web v1 | Electron features still missing from the web UI |
| --- | --- | --- |
| Browse and install | Browse and search local Transfer ISOs, Minerva, Internet Archive, and the backend's retro ROM systems; view a cover when available, see source guidance, choose drive and GOD/Content/XEX where applicable, register and trigger a job. | Cover thumbnails throughout the catalog and richer disc/install details in the desktop browser. |
| Xbox Library | Read Aurora `content.db` and `settings.db` over FTP in the browser; search, sort and filter installed games, load installed cover thumbnails as rows become visible, view title metadata/favorites/play counts, refresh the library, enqueue moves between drives, manage artwork, and open DLC or saves for a selected title. The Aurora root is saved in this browser. | Automatic artwork sync after transfers and inline per-title DLC/TU panels. |
| DLC and Title Updates | Discover DLC and title updates by Title ID and Xbox drive, queue installs, activate/deactivate TUs, and delete or move installed files between drives. | Per-title content panels inside Xbox Library. |
| Save games | Discover profiles, inspect per-title save files, back up a profile or every profile, copy a title save between profiles with optional KeyVault re-signing, and delete a profile's title save. | Profile labels and the richer inline presentation from the Electron library. |
| FTP Manager | Browse folders, create/delete folders and files, select multiple entries, move/copy them, upload files selected in the browser or paths on the GODsend host, download individual files or selected folders/files as a ZIP, and track FTP jobs. | Large browser downloads are buffered by the browser while the archive is prepared on the server. |
| ISO tools | Pick a local ISO or enter a path on the GODsend host, then probe, convert to GOD, or extract to XEX. Browser-picked ISOs upload to Transfer with progress and fill the server paths automatically. Optionally queue an FTP upload of the converted folder to an explicit Xbox destination. | Automatic destination selection based on the resulting format. |
| ISO upload | On **Catalog → Local files**: upload `.iso` files from the browser into GODsend's Transfer folder (streamed to disk with a progress bar, written as `.part` and renamed only when complete). They appear in the Local catalog immediately. | Resuming an interrupted upload; folders or non-ISO files. |
| Aurora artwork | From **Xbox Library → Artwork**: preview the cover, background, banner, icon, and screenshots installed on the console; search XboxUnity and the Xbox catalog by Title ID or name, or pick a PNG/JPEG from the browser device; upload the result as an Aurora `.asset` (icon/banner and screenshots share a file, so the other slots are kept). | Automatic artwork sync after transfers; BMP/GIF input; bulk cover download. |
| Job queue | Unified game pipeline and FTP jobs with state, FTP progress, refresh, and removal of completed jobs. **Waiting queue**: games wait in an ordered list and are sent to GODsend one at a time (configurable 1–6 at once); pause/resume, hold, reorder, start now, return to the wish list, remove, and clear finished jobs. **Wish list**: prepare games with their drive and format and send some or all to the waiting queue later; nothing reaches GODsend until then. | Pausing or cancelling a job GODsend is already running: upstream has no such control, so running jobs can only be removed. |
| Xbox setup | Store the Xbox IP in this browser, test FTP connectivity or supplied credentials, choose the Aurora scripts folder on the GODsend host and destination on Xbox, then enqueue an upload that patches `state.lua`. | Persist FTP credentials in the server configuration and automatic network discovery. |
| Server settings | Read the default destination drive from `/config`, inspect cache/data status, refresh catalogs, and clear job and temporary data after confirmation. | Configure Internet Archive login, Debrid providers, storage/Transfer/backup/temp paths, default drive, custom GOD/XEX and ROM paths, and aria2 ports; these options are currently loaded from the server environment at startup. |
| Desktop operations | — | Start/restart/stop the backend, inspect live terminal and logs, launch at login, and use the tray. These are host-specific operations and need a different web/server design. |
| BadAvatar USB | — | Format/build the BadAvatar USB payload and manage its options. This requires host device access. |

Many missing operations already have Go HTTP endpoints. Others currently live in Electron's Node services and need backend work before a browser can use them. The comparison is based on the upstream [feature reference](https://github.com/ghostyshell/GODSend-360/blob/main/docs/features.md) and the v2.13.3 desktop source.

On mobile, the sidebar opens from the menu button in the top bar. It shows the full page names and both connection states.

## Language

English is the default. Use the **EN / PT-BR** selector in the top bar to switch the UI to Brazilian Portuguese. The choice is saved in this browser and updates the page language. Game titles, job detail messages, disc notes, and server errors returned by GODsend are shown as the backend provides them.

## Development

Requires Node.js 20+.

```sh
npm install
npm run dev
```

Open `http://localhost:5173/ui/`. Vite proxies API calls to `http://10.77.15.115:8080` by default in this repository. To use another backend:

```sh
GODSEND_DEV_BACKEND=http://192.168.1.10:8080 npm run dev
```

Set the Xbox IP on the **Connection** page. Its connection status is shown in the sidebar and the address is stored only in this browser. The same page can point the web UI at another GODsend HTTP server; the selected server is tested before it replaces the default address. A transfer starts only after selecting **Add to queue** in the game dialog.

## Embed in the original Go binary

With a checkout of the [upstream repository](https://github.com/ghostyshell/GODSend-360), run from this project:

```sh
npm run build
npm run integrate -- /path/to/GODSend-360
```

The integration script copies `dist/` to `src/server/interfaces/http/webui/`, adds the Go `embed.FS` handler and its test, adds browser upload/download routes (`/webui/upload-file`, `/webui/download-file`, `/webui/archive`, `/webui/upload-iso`), ROM system and host path discovery (`/webui/rom-systems`, `/webui/paths`), the queue scheduler (`/webui/queue/state` and `/webui/queue/action`, persisted to `webui-queue.json` in the GODsend data folder), and `/webui/artwork/search` (a server-side proxy for the artwork sources, which are plain HTTP without CORS and cannot be called from a browser; it only connects to public addresses), and registers `/ui/` in the router. It is idempotent but modifies the upstream checkout. This was validated against upstream v2.13.3 (commit `ff70dadc7c86c8a52dbd366595ae93419d4b55f4`). Build the backend from the upstream root; for Linux x64:

```sh
npm run build:server:linux:x64
```

The resulting binary serves the UI at `http://<server>:8080/ui/` and redirects `/` there. The integration also enables CORS for the GODsend API, allowing a web UI hosted elsewhere to use a configured server address. Reapply the integration after updating the upstream checkout.

The GODsend API has no authentication. Keep port 8080 on a trusted LAN, or add authentication at a reverse proxy before exposing it elsewhere.
