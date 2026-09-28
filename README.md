# GODsend Web

A lightweight React interface for the [GODsend 360](https://github.com/ghostyshell/GODSend-360) Go backend. It runs in a browser and can be embedded in the original Go binary, which serves both the UI and its HTTP API. Electron and Node.js are not needed on the device opening the page.

The official desktop renderer is already written in React, but most screens call `window.godsendApi` through Electron's [preload/IPC bridge](https://github.com/ghostyshell/GODSend-360/blob/main/src/electron-app/preload.ts). This project implements the browser-compatible parts against the [documented HTTP API](https://github.com/ghostyshell/GODSend-360/blob/main/docs/api-reference.md). It does not copy the full desktop renderer or claim feature parity. The upstream project is [MIT licensed](https://github.com/ghostyshell/GODSend-360/blob/main/LICENSE).

## Feature status

| Area | Web v1 | Electron features still missing from the web UI |
| --- | --- | --- |
| Browse and install | Browse and search local Transfer ISOs, Minerva, and Internet Archive across the listed Xbox platforms; choose drive and GOD/Content/XEX where applicable; register and trigger a job. | Cover art retrieval, ROM catalog browsing, source-specific guidance, and the richer disc/install details in the desktop browser. |
| Xbox Library | — | Read the Aurora databases, browse installed games with artwork and metadata, inspect titles, refresh the library, and move games between drives. |
| DLC and Title Updates | — | Discover installed and available DLC/TUs, install them, activate/deactivate TUs, delete content, and move content. |
| Save games | — | Browse profiles and per-title saves, download/restore/copy/delete saves, and back up all profiles and saves. |
| FTP Manager | Test Xbox FTP and list destination drives in the install dialog. | Browse files and folders, create/rename/delete, multi-select, cut/copy/paste, upload/download, and track FTP operations. |
| ISO tools | The game install flow can request GOD/Content/XEX processing. | Standalone ISO to GOD and ISO to XEX conversion tools, file picking, disc probing, and optional transfers. |
| Aurora artwork | — | Search, preview, decode/encode, and upload cover, background, banner, icon, and screenshot assets; automatic artwork sync after transfers. |
| Job queue | Read and refresh game pipeline jobs. | Unified game and FTP job view, progress/speed details, and removal of completed or stuck jobs. |
| Xbox setup | Store the Xbox IP in this browser and test FTP connectivity. | Upload and patch Aurora scripts, choose FTP script path, edit FTP credentials, and scan/test connection settings. |
| Server settings | Read the default destination drive from `/config`. | Configure Internet Archive login, Debrid providers, storage/Transfer/backup/temp paths, default drive, custom GOD/XEX and ROM paths, aria2 ports, cache refresh, and local data cleanup. |
| Desktop operations | — | Start/restart/stop the backend, inspect live terminal and logs, launch at login, and use the tray. These are host-specific operations and need a different web/server design. |
| BadAvatar USB | — | Format/build the BadAvatar USB payload and manage its options. This requires host device access. |

Many missing operations already have Go HTTP endpoints. Others currently live in Electron's Node services and need backend work before a browser can use them. The comparison is based on the upstream [feature reference](https://github.com/ghostyshell/GODSend-360/blob/main/docs/features.md) and the v2.13.3 desktop source.

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

Set the Xbox IP on the **Connection** page. It is stored only in this browser. A transfer starts only after selecting **Add to queue** in the game dialog.

## Embed in the original Go binary

With a checkout of the [upstream repository](https://github.com/ghostyshell/GODSend-360), run from this project:

```sh
npm run build
npm run integrate -- /path/to/GODSend-360
```

The integration script copies `dist/` to `src/server/interfaces/http/webui/`, adds the Go `embed.FS` handler and its test, and registers `/ui/` in the router. It is idempotent but modifies the upstream checkout. This was validated against upstream v2.13.3 (commit `ff70dadc7c86c8a52dbd366595ae93419d4b55f4`). Build the backend from the upstream root; for Linux x64:

```sh
npm run build:server:linux:x64
```

The resulting binary serves the UI at `http://<server>:8080/ui/` and redirects `/` there. The UI and API share an origin, so production needs no CORS proxy. Reapply the integration after updating the upstream checkout.

The GODsend API has no authentication. Keep port 8080 on a trusted LAN, or add authentication at a reverse proxy before exposing it elsewhere.
