# Roder Chrome Browser Bridge

Chrome Manifest V3 extension (v0.2.0) for collaborative browser control between
a user's active Chrome session and the Roder/Gode coding-agent runtime in
`../gode`.

The extension is written in TypeScript + React and provides:

- a side-panel UI with chat, debug, recordings, and permissions tabs;
- connection settings for Roder remote app-server pairing;
- active-tab visibility for the agent;
- enriched page snapshots (aria roles, form metadata, bounding boxes, iframe
  boundaries), screenshots, and element highlighting;
- DOM interaction: click, type, keypress, scroll, select;
- CDP-backed console and network reads (redacted, bounded, metadata only);
- action-trace recordings;
- per-origin site permissions;
- visible activity cards so the user can see or approve what the agent controls.

## Development

```bash
pnpm install
pnpm build
```

`pnpm build` type-checks, runs Vite, and writes the manifest. Load `dist/` as an
unpacked extension in Chrome (`chrome://extensions`, Developer mode). Requires
Chrome 116+ (MV3 side panel + debugger APIs). Run `pnpm test` for the Vitest
suite.

## Pairing with Roder/Gode

In `../gode`, start the remote app-server or open the TUI remote/Chrome panel:

```bash
roder app-server --remote --listen ws://127.0.0.1:0
# or in the TUI:  /remote start   (or /chrome for the Chrome panel)
```

Copy the printed WebSocket URL and bearer token into the extension options page.
Browser clients authenticate using the WebSocket subprotocols documented by
`../gode/docs/app-server/remote.md`:

```text
roder.remote.v1, bearer.<token>
```

The bridge protocol accepts either JSON messages shaped as `{ "type": "..." }`
or JSON-RPC-like messages where `method` maps to the command `type` and `params`
are spread into the command object.

## Agent command set

Commands are dispatched as `{ type, id, ...params }`; the extension replies with
`{ type: "command/result", id, ok, result?, error? }`.

Chat / tabs:

- `chat` `{ text }` — show an agent message in the browser UI.
- `tabs/list` — return all Chrome tabs visible to the extension.
- `tab/activate` `{ tabId }` / `tab/open` `{ url, active? }` / `tab/close` `{ tabId }`.
- `tab/navigate` `{ tabId?, url }` — navigate when enabled (control mode).
- `tabs/group` `{ tabIds, title? }`.

Inspect:

- `page/snapshot` `{ tabId?, include? }` — title, URL, text, controls, forms,
  iframes, viewport; tagged `untrusted: true`.
- `page/screenshot` `{ tabId?, region? }` — full visible-tab PNG data URL.
  Region cropping is not supported in an MV3 service worker.
- `page/getText` `{ tabId? }`.
- `page/highlight` `{ tabId?, selector?/text?/ref? }`.

Interact (control mode + interact permission):

- `page/click`, `page/type` `{ ..., submit? }`, `page/keypress` `{ key }`,
  `page/scroll` `{ dx?, dy? }`, `page/select` `{ selector, value }`.
- `page/upload` — **not supported**: MV3 cannot synthesize a file chooser; the
  user must attach files via the page UI.
- `page/eval` `{ expression }` — protected: control mode + `eval` site permission.

Debug (`debugger` site permission):

- `debug/attach` / `debug/detach`.
- `debug/console/read` `{ tabId?, limit? }` — redacted console entries.
- `debug/network/read` `{ tabId?, limit? }` — redacted request metadata, no
  bodies or headers.

Recording / permissions:

- `recording/start` `{ tabId? }` -> `{ recordingId, startedAt }`.
- `recording/stop` `{ recordingId }` -> full `Recording` with the action trace.
- `permissions/get` `{ origin? }` / `permissions/set` `{ origin, perms }`.

## Permissions

Two gates apply: the session **control mode** (observe / assist / control) and
**per-origin site permissions**. Site permission flags: `inspect`, `interact`,
`eval`, `debugger`, `download`, `upload`, `recording`, `schedule`,
`alwaysAllow`. Defaults are inspect-only; everything else is opt-in per origin.

## Security defaults

- The extension starts disconnected; nothing runs until paired and enabled.
- Navigation, input, eval, debugger, download, upload, and recording are all
  disabled by default.
- Assist mode queues privileged actions for user approval.
- Chrome internal pages (`chrome://`) and extension pages are never controlled.
- Only `http:` and `https:` URLs are accepted.
- Untrusted-content rule: page/console/network text is tagged `untrusted: true`
  and is data, never instructions.
- Redaction: cookies and auth headers (Authorization, x-api-key, x-auth-token,
  x-csrf-token, …) are never transmitted; password/hidden/secret-hinting inputs
  are never captured; URLs are stripped to origin + pathname; request/response
  bodies and headers are never captured.
- Prefer `ws://127.0.0.1` or a trusted private network / Tailscale endpoint. Do
  not expose Roder remote mode to the public internet.

## Project layout

```text
src/background/     MV3 service worker, WebSocket bridge, debugger, recording, permissions
src/content/        page snapshot + action content scripts
src/popup/          small action popup
src/sidepanel/      live control panel: chat, debug, recordings, permissions
src/options/        pairing and settings
src/shared/         typed wire protocol, redaction, storage, hooks, styles
```

See `../gode/docs/roder-chrome-browser-extension.md` for the full user guide
(architecture, parity matrix, privacy checklist, troubleshooting).
