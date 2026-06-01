# Roder Chrome Browser Bridge

Chrome Manifest V3 extension for collaborative browser control between a user's active Chrome session and the Roder/Gode coding-agent runtime in `../gode`.

The extension is written in TypeScript + React and provides:

- a side-panel chat UI for the user and agent;
- connection settings for Roder remote app-server pairing;
- active-tab visibility for the agent;
- opt-in page snapshots, element highlighting, navigation, clicking, and typing;
- visible activity cards so the user can see or approve what the agent is controlling.

## Development

```powershell
pnpm install`r`npnpm build
```

Load `dist/` as an unpacked extension in Chrome (`chrome://extensions`, Developer mode).

## Pairing with Roder/Gode

In `../gode`, start the remote app-server or open the TUI remote panel:

```powershell
roder app-server --remote --listen ws://127.0.0.1:0
# or in the TUI: /remote start
```

Copy the printed WebSocket URL and bearer token into the extension options page. Browser clients authenticate using the WebSocket subprotocols documented by `../gode/docs/app-server/remote.md`:

```text
roder.remote.v1, bearer.<token>
```

The current bridge protocol accepts either JSON messages shaped as `{ "type": "..." }` or JSON-RPC-like messages where `method` maps to the command `type` and `params` are spread into the command object.

## Agent command sketch

Supported initial commands:

- `chat` `{ text }` - show an agent message in the browser UI.
- `tabs/list` - return all Chrome tabs visible to the extension.
- `tab/activate` `{ tabId }` - activate a tab.
- `tab/navigate` `{ tabId?, url }` - navigate when enabled by the user.
- `page/snapshot` `{ tabId? }` - return title, URL, visible text, and controls.
- `page/highlight` `{ tabId?, selector?, text? }` - highlight an element.
- `page/click` `{ tabId?, selector?, text? }` - click when Control mode + input capability are enabled.
- `page/type` `{ tabId?, selector?, text }` - type when Control mode + input capability are enabled.

## Security defaults

- The extension starts disconnected.
- Navigation and input automation are disabled by default.
- Assist mode queues privileged actions for user approval.
- Chrome internal pages and extension pages are never controlled.
- Only `http:` and `https:` navigation is accepted.
- Prefer `ws://127.0.0.1` or a trusted private network/Tailscale endpoint. Do not expose Roder remote mode to the public internet.

## Project layout

```text
src/background/     MV3 service worker and WebSocket bridge
src/content/        page snapshot/action content script
src/popup/          small action popup
src/sidepanel/      collaborative live control panel
src/options/        pairing and permissions settings
src/shared/         shared types, storage, hooks, and styles
```

