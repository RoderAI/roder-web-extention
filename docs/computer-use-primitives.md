# Computer-use primitives and evaluation

Audit branch: `pz/computer-use-primitives`. Changes are local and must be paired
with Roder branch `pz/browser-computer-use-audit`. The installed extension has
not been replaced by this evaluation.

## Execution

- Click, type, keypress and wheel scroll use the tab-targeted Chrome debugger
  transport for CDP `Input` commands. No page `.click()` or synthetic key events.
- Type rejects noneditable, disabled, readonly and covered targets before input,
  checks focus, replaces through the browser editing command, and uses
  `Input.insertText`. Enter invokes native browser form behavior.
- Select uses a semantic DOM selection with input/change events. It verifies
  the resulting value and reports `method: DOM selection`, `eventsTrusted: false`.
  Native select popups on macOS did not respond to CDP keys in the evaluation.
- Element references live in the isolated content-script world, use a cryptographic document
  nonce, and reject stale or ambiguous targets. Page attributes cannot forge them.
- Actions return a fresh, untrusted page observation after loading/settling.
- Approvals bind to one concrete tab, origin and document. Execution rechecks
  current settings and site permission; switching the active tab cannot retarget
  a queued action. No additional sensitive-action consent was introduced.
- Screenshots target the requested tab, preserve CSS viewport coordinates,
  validate crops, and mask filled sensitive fields. This masking is heuristic.
  Input and screenshots serialize per tab. Input work has a 20 second deadline,
  and cleanup releases held input and removes masks on failure or cancellation.
- `command/cancel` identifies the original command by `targetId`; it aborts
  running work or rejects its queued approval. Disconnect cancels pending work.
  Cleanup remains best effort if Chrome is unavailable or the extension exits.

The extension controls the selected Chrome profile. It does not create profile
isolation; use a dedicated agent profile when that boundary is required. A site
can navigate before the next permission check; checks stop subsequent actions
and data reads, and do not implement a network firewall.

## Reproduce the loaded-extension evaluation

```sh
pnpm install --frozen-lockfile
RODER_CHROMIUM=/path/to/chrome-for-testing pnpm eval:computer-use
pnpm test
```

The harness uses Playwright Core only to create a throwaway browser/profile,
serve fixture pages, load the packaged MV3 extension, and independently check
page state. Actions under evaluation go through the real WebSocket bridge and
Chrome APIs. No user profile or account is used. The temporary profile is removed.
The eval output is in `output/playwright/extension-eval.json`; the genuine masked
viewport screenshot is `output/playwright/extension-viewport.png`.

Cancellation tests delay the acknowledgement after Chrome applies a real press
or captures a masked screenshot. They check release/removal before reusing the
tab. This instrumentation runs only in the evaluation worker, not product code.
Content and pairing scripts build as self-contained IIFEs because MV3 content
scripts are classic scripts; the service worker builds as an ES module.
