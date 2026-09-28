# GODsend Web

A lightweight React interface for the [GODsend 360](https://github.com/ghostyshell/GODSend-360) Go backend. It runs in a browser and can be embedded in the original Go binary, which serves both the UI and its HTTP API. Electron and Node.js are not needed on the device opening the page.

The official desktop renderer is already written in React, but most screens call `window.godsendApi` through Electron's [preload/IPC bridge](https://github.com/ghostyshell/GODSend-360/blob/main/src/electron-app/preload.ts). This project implements the browser-compatible parts against the [documented HTTP API](https://github.com/ghostyshell/GODSend-360/blob/main/docs/api-reference.md). It does not copy the full desktop renderer or claim feature parity. The upstream project is [MIT licensed](https://github.com/ghostyshell/GODSend-360/blob/main/LICENSE).

## Feature status

| Area | Web interface | Remaining Electron-only features |
| --- | --- | --- |
| Browse and install | Browse and search local Transfer ISOs, Minerva, Internet Archive, and the backend's retro ROM systems; view a cover when available, see source guidance, choose drive and GOD/Content/XEX where applicable, register and trigger a job. | Cover thumbnails throughout the catalog and richer disc/install details in the desktop browser. |
| Xbox Library | Read Aurora `content.db` and `settings.db` over FTP in the browser; search, sort and filter installed games, load cover thumbnails as rows become visible, view title metadata/favorites/play counts, refresh the library, enqueue moves between drives, manage artwork, and open inline DLC/TU or save panels for a selected title. The Aurora root is saved in this browser. | — |
| DLC and Title Updates | Discover DLC and title updates by Title ID and Xbox drive, queue installs, activate/deactivate TUs, and delete or move installed files between drives. | Per-title content panels inside Xbox Library. |
| Save games | Discover profiles, inspect per-title save files, back up a profile or every profile, copy a title save between profiles with optional KeyVault re-signing, and delete a profile's title save. | Profile labels and the richer inline presentation from the Electron library. |
| FTP Manager | Browse nested folders, create/delete folders and files, select multiple entries, move/copy them, upload files or whole folders from the browser while preserving folder structure, or upload paths on the GODsend host; download individual files or selected folders/files as a ZIP, and track FTP jobs. | Large browser downloads are buffered by the browser while the archive is prepared on the server. |
| ISO tools | Pick a local ISO or enter a path on the GODsend host, then probe, convert to GOD, or extract to XEX. Browser-picked ISOs upload to Transfer with progress and fill the server paths automatically. Optionally queue an FTP upload of the converted folder to a chosen destination, or leave it blank to use the configured drive and GOD/XEX folder. | — |
| ISO upload | On **Catalog → Local files**: upload `.iso` files from the browser into GODsend's Transfer folder (streamed to disk with a progress bar, written as `.part` and renamed only when complete). They appear in the Local catalog immediately. | Resuming an interrupted upload; folders or non-ISO files. |
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

The integration script copies `dist/` to `src/server/interfaces/http/webui/`, adds the Go `embed.FS` handler and test, browser file/folder upload and download/archive routes, ISO upload, ROM system and host path discovery, queue APIs, artwork search and thumbnails, cursor-based GODsend logs, automatic/manual artwork sync endpoints, and the Unity archive fallback. It patches GODsend log and FTP completion callbacks, registers `/ui/`, and keeps the queue and artwork sync settings in GODsend's data folder. It is idempotent but modifies the upstream checkout. This was validated against upstream v2.13.3 (commit `ff70dadc7c86c8a52dbd366595ae93419d4b55f4`). Build the backend from the upstream root; for Linux x64:

```sh
npm run build:server:linux:x64
```

The resulting binary serves the UI at `http://<server>:8080/ui/` and redirects `/` there. The integration also enables CORS for the GODsend API, allowing a web UI hosted elsewhere to use a configured server address. Reapply the integration after updating the upstream checkout.

The GODsend API has no authentication. Keep port 8080 on a trusted LAN, or add authentication at a reverse proxy before exposing it elsewhere.

### Aurora archive fallback

The integration also adds `/webui/unity-archive/title`, `/cover`, and `/icon` (each requires `?title_id=XXXXXXXX`) and copies the standalone Lua script to `<upstream>/aurora-scripts-archive-fallback/`. The server reads the archive's `metadata.json` into a 24-hour memory cache, and fetches only the selected game's PNG files. It keeps the last good index if GitHub is temporarily unavailable. The Xbox connects only to the GODsend server.

To install, use **Server settings → Install Aurora scripts** with source `<upstream>/aurora-scripts-archive-fallback` and Xbox destination `/Hdd1/Aurora/User/Scripts/Utility/ArchiveFallback` (adjust the Aurora drive and root as needed). Enter the GODsend host IP and port, then upload. Restart Aurora if the script does not appear under Utility scripts. Run **GODsend Archive Fallback** to check the library. The script retains existing names and assets, stages missing PNGs in `Aurora/User/Import/<TitleID>/`, and reports the results. Then choose **Aurora Settings → Assets → Import** to install staged images.

The fallback needs access from the GODsend host to `raw.githubusercontent.com`; it does not need XboxUnity to be online. The archive's README reports its last scrape as June 16, 2025. The archive's original content is CC BY-NC 4.0, while XboxUnity images retain their owners' rights; this integration downloads images on demand and does not bundle them.
