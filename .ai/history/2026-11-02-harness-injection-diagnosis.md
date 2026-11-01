# Android Harness browser-injection diagnosis (2026-11-02)

**Read-only.** No Velnox file changed. The Harness (WebView + injected scripts) source is **not in this
workspace**, so no root cause could be confirmed by reading that code — only by observing runtime state.

## Evidence collected

On `http://127.0.0.1:5174/profile` (velShop preview, served `127.0.0.1:5174`, curl 200 for `/` and `/profile`):

```json
{ "url": "http://127.0.0.1:5174/profile", "readyState": "loading", "hasBody": false,
  "bodyChildren": null, "title": "", "upd": "undefined", "vw": 980 }
```

Console (ERROR filter), same page, every entry tagged `http://127.0.0.1:5174/profile:7` or `:3`:

1. `Uncaught TypeError: Cannot read properties of null (reading 'appendChild')` — line **7**
2. `Uncaught TypeError: window.__harnessUpdateScroll is not a function` — line **3**, repeated many times

A second fixture (`http://127.0.0.1:4180/`, static HTML with `<h1>`/`<button>`/`<input>`) loaded **normally**
in the same session: title `VelNox UI Probe`, 1 button, 1 input, `vw=492`, `scrollWidth=492`.

## Classification (evidence-backed)

| Error | Class | Evidence |
|---|---|---|
| `appendChild` on null | **Harness injection failure (timing)** — the injector runs while `document.body` is still null (line 7 is injected, not app code) | `hasBody:false` on the affected page; the static fixture (body present early) never shows this error |
| `__harnessUpdateScroll is not a function` | **Harness lifecycle race** — the scroll helper is *conditionally defined* but called **unconditionally**; runtime proves the global is absent (`typeof === "undefined"`) while the caller still runs | `upd:"undefined"` at the same moment the console repeats the call error; the error's source is the injected `:3` script |
| Page never rendered | **WebView lifecycle** — `readyState` stuck at `"loading"`, `document.body === null`, title empty | direct measurement above; server answered 200, so this is post-response |
| VelShop defect | **Not implicated** — no app-origin error and no app stack frame appears | all errors originate at document line 3/7, i.e. injected scripts |

Nothing suggests the target app; conversely the static fixture working proves the tool can render when
instrumentation survives.

## What cannot be confirmed from here

- **Which** injected script does the `appendChild` (the host app's source is not in this workspace).
- Whether the failure is triggered by navigation timing, by a page that stays in `loading`, or by the script
  re-injecting on every `DOMContentLoaded`/`pushState`.
- Whether `vw:980` is the WebView's real viewport at that moment or a default before layout.

## Proposed smallest fix (for the Harness repo, not applied)

1. Inject only after `document.readyState !== "loading"` **and** `document.body` exists — attach to
   `DOMContentLoaded` with a `MutationObserver` fallback, and guard `if (!document.body) return;`.
2. Define `window.__harnessUpdateScroll` **before** any caller is installed, and make the call site
   `window.__harnessUpdateScroll?.()` so a lost document (SPA navigation) cannot throw.
3. Make repeated injection idempotent (`if (window.__harnessInjected) return;`).
4. Re-inject on `pageshow` / after `pushState` instead of assuming one document per session.

## Verification status

**Not verified** — a fix can only be validated after the Harness source is available and a build can be run.
Until then the documented limit stands: a page may be reachable (HTTP 200) and still be unrenderable for the
agent, so render/DOM/screenshot claims must stay "NOT VERIFIED".

## Cleanup

Test servers were stopped earlier: job 15 killed, `curl → 000`; the static fixture job was killed the same way.
No process from this diagnosis is running.
