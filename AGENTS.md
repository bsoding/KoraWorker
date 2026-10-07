# Kora Worker repository guide

This guide describes the code at version 0.1.0. Read it before making changes; use the source files named below for the specific area you are editing. The repository is a single Electron desktop application, not a web service. Its intended distribution is a Windows x64 portable executable.

## What the application does

Kora Worker gives one AI worker an ongoing job. The user supplies a goal, optional context and workspace folder, and an AI provider. The app inspects the workspace, asks the provider to write a `JOB.md`, then runs a tool-using worker loop. The desktop shows chat, tool activity, a browser, a search panel, and the generated job description. The worker can schedule a future check with `take_break`; the app also schedules a 30-minute check when a turn ends without a tool call. A chat message or manual wake starts work sooner.

There is **one persistent job per application profile**. `createJob` rejects a second job; there is no job list, delete/reset flow, backend server, database, MCP integration, or account system in this version.

The runtime is Electron 44 with TypeScript main-process modules (`.cts`) compiled to CommonJS (`.cjs`) in `dist-node/`. The renderer is React 19, TypeScript 5 and Vite 7. The OpenAI SDK 7 serves both API protocols; Cheerio parses web results/pages; Lucide supplies UI icons. `electron-builder` packages the app. `package-lock.json` is checked in.

## Quick start and checks

| Command | Purpose |
| --- | --- |
| `npm ci` | Install versions from `package-lock.json`. |
| `npm run build` | Type-check the renderer, compile the Electron runtime, tests, helpers and Vite config into ignored `dist-node/`, then build the renderer into ignored `dist/`. |
| `npm test` | Compile the Node TypeScript, then run `dist-node/electron/*.test.cjs` with Node's built-in test runner. |
| `npm start` | Compile the Node TypeScript via `prestart`, then launch Electron using the existing `dist/`; build the renderer first. |
| `npm run dev` | Start only the Vite renderer at `http://127.0.0.1:5173`. The page can be viewed visually, but its native operations need Electron. |
| `npm run typecheck` | Check the renderer, runtime, tests, helpers and Vite config without emitting files. |
| `npm run capture -- --active` | Build and capture the mock active desktop with Electron. |
| `npm run dist` | Build and package a Windows x64 portable `.exe` in ignored `release/` with electron-builder. |

`package.json` points Electron at `dist-node/electron/main.cjs`, compiled from `electron/main.cts`. It loads `dist/index.html` by default. It loads `KORA_DEV_URL` instead when that environment variable is set, so an Electron/Vite development session requires running Vite and then starting Electron with that URL. `npm run dev` alone has no `window.kora` bridge.

The test files mock or avoid actual Electron runtime features. In an environment where Electron's npm package exists but its desktop binary cannot be downloaded, `npm test` can fail while loading `electron/store.cts`. For **tests only**, `ELECTRON_OVERRIDE_DIST_PATH=/tmp npm test` bypasses that package's binary lookup on Linux. This does not make `npm start` or packaging work without an Electron binary. On 2026-10-02, `npm run build` passed and all 9 tests passed with this override in the cloned workspace.

## File map

| Path | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json` | Dependencies, npm scripts, electron-builder Windows portable configuration. |
| `electron/main.cts` | Electron lifecycle, frameless `BrowserWindow`, IPC handlers, folder picker and external URL handling. |
| `electron/preload.cts` | The only renderer-facing native API: exposes `window.kora` through `contextBridge`. |
| `electron/worker.cts` | One-job state machine, initial job setup, queue, model turns, activity updates, breaks and restart handling. |
| `electron/provider.cts` | OpenAI Responses and compatible Chat Completions adapters, including function-call fallback. |
| `electron/store.cts` | User-data persistence, provider settings and API key handling. |
| `electron/tools.cts` | Model-visible tool schemas, tool execution and activity metadata. |
| `electron/errors.cts` | Formats unknown caught errors for worker activity and provider fallback checks. |
| `electron/*.test.cts` | TypeScript Node tests for store migration, provider protocols, tools and a worker turn; run their compiled CommonJS output. |
| `src/types.ts` | Shared TypeScript shapes of provider configuration, settings, job, activity, snapshot, worker events and the `window.kora` bridge; imported as types by both processes. |
| `src/App.tsx` | All renderer components and desktop state; setup, settings and five desktop apps. |
| `src/styles.css`, `src/wallpaper.svg` | Desktop styling and wallpaper. CSS is compressed into a few very long lines; later rules override earlier ones. |
| `src/main.tsx`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json` | React mount, Vite entry/config, renderer TypeScript rules, and separate strict Node compilation rules. Vite uses relative asset paths (`base: './'`) for `file://` loading. |
| `scripts/capture.cts`, `scripts/mock-preload.cts` | Electron screenshot helper and a mocked active-job bridge for visual checks. |
| `scripts/make-icon.py`, `assets/kora.png`, `assets/kora.ico` | Icon generation and checked-in artwork. Python script needs Pillow separately. |

Runtime packaging includes compiled `dist-node/electron/` modules and the renderer; tests and screenshot helpers are excluded. There is no CI workflow in the repository. `.gitignore` excludes `node_modules/`, `dist/`, `dist-node/`, `release/`, `.test-user-data/`, `artifacts/`, logs and local `.env` files.

## Process and data flow

```text
React renderer (src/App.tsx)
    -> window.kora (electron/preload.cts)
    -> ipcMain handlers (electron/main.cts)
    -> Worker (electron/worker.cts)
         -> store.cts: userData files and keys
         -> provider.cts: OpenAI or compatible API
         -> tools.cts: local shell/files, Bing RSS and page fetches
    -> worker:state / worker:setup events
    -> React snapshot and live activity display
```

`electron/main.cts` creates `Worker(send)` before the window. Its `send` function forwards events to the window if it exists. The renderer calls `getState()` on mount, subscribes to `onState` and `onSetup`, and treats pushed snapshots as the current truth. `Worker.persist()` writes `job.json` and emits a full `worker:state` snapshot. `updateActivity()` emits a snapshot for streaming output but does not write each chunk; the completed tool call is persisted afterward.

The bridge methods and IPC channel names must stay aligned in three files:

| `window.kora` method | IPC channel | Backend action |
| --- | --- | --- |
| `getState()` | `kora:get-state` | `worker.snapshot()` |
| `saveSettings(input)` | `kora:save-settings` | Save provider config/key and broadcast state. |
| `chooseFolder()` | `kora:choose-folder` | Electron directory dialog. |
| `createJob(input)` | `kora:create-job` | `worker.createJob()`. |
| `sendMessage(text)` | `kora:send-message` | `worker.sendMessage()`. |
| `wake()` | `kora:wake` | End a scheduled break. |
| `windowAction(action)` | `kora:window-action` | Minimize, toggle maximize or close. |
| `openExternal(url)` | `kora:open-external` | Open an HTTP(S) URL with the OS browser. |
| `onState(callback)` | `worker:state` event | Subscribe/unsubscribe to snapshots. |
| `onSetup(callback)` | `worker:setup` event | Subscribe/unsubscribe to setup progress. |

`src/types.ts` defines the shared bridge and snapshot contracts. The backend, preload, renderer and screenshot mock import these types, so changes are checked across both processes. `Job.context` is optional to preserve compatibility with saved jobs that predate that field. Keep IPC handler implementations and channel names aligned with the bridge contract.

The main data shapes are small enough to keep in mind without reopening every file:

| Shape | Important fields |
| --- | --- |
| `KoraState` | `job: Job | null`, `jobMarkdown: string`, `settings: KoraSettings`. This is the full snapshot sent through IPC. |
| `Job` | UUID, title/goal/workspace/creation time; `status` (`ready`, `running`, `sleeping`, `error`); `breakUntil`, `breakReason`, `currentAction`, `lastError`; message and activity arrays. Also saves optional `context`. |
| `Message` | UUID, `role` (`user` or `assistant`), content and timestamp. |
| `Activity` | UUID, timestamp, app (`browser`, `command`, `system`), kind/title/detail, status (`running`, `done`, `error`), and optional output/URL/search results/extracted page. |
| `KoraSettings` | Active provider/model/base URL plus provider-specific model/base URL, key-presence flags and key-storage mode. Raw keys are deliberately absent. |

## Persistent data and settings

`electron/store.cts` uses `app.getPath('userData')` (normally `%APPDATA%\kora-worker` on Windows). It creates the directory on demand. JSON writes use a temporary file plus rename. The files are:

| File under user data | Contents |
| --- | --- |
| `settings.json` | Selected provider and each provider's model; compatible API base URL. No plain API key. |
| `job.json` | The single job, messages, activities, status, break deadline, error and workspace path. |
| `JOB.md` | AI-written job instructions. **This is not placed in the selected workspace.** |
| `openai-api-key.bin`, `compatible-api-key.bin` | Keys encrypted with Electron `safeStorage` when encryption is available. |
| `api-key.bin` | Legacy OpenAI key filename, still read for migration. |
| `workspaces/<job-id>/` | Auto-created workspace when the user does not choose one. May contain an automatic shallow GitHub clone. |

`settings()` normalizes old OpenAI-only settings (`model`) and returns active `model`/`baseURL` plus separate provider fields. `publicSettings()` adds booleans for key presence and a `keyStorage` mode; keys never enter the renderer snapshot. If OS encryption is unavailable, newly entered keys live only in the module's in-memory `sessionKeys`. Environment fallback is `OPENAI_API_KEY` or `KORA_COMPATIBLE_API_KEY`. Entering a blank key when saving settings retains the existing key. The OpenAI provider requires a key; a compatible API may run without one. For a keyless compatible server, `provider.cts` removes the SDK's Authorization header in a custom `fetch` wrapper.

`normalizeBaseURL()` accepts only HTTP(S), rejects embedded credentials, query and fragment, and trims a pasted `/chat/completions` or `/responses` suffix. The compatible endpoint is formed by the OpenAI SDK from this base URL. The default OpenAI model is `gpt-5.6-terra`; OpenAI uses `https://api.openai.com/v1`.

Messages are capped at the latest 120; activities are newest-first and capped at 80. The model prompt sees only the latest 24 messages and 12 activities, along with the entire stored `JOB.md`. These limits and the snapshot shape live in `worker.cts` and `src/types.ts`.

## Worker lifecycle

1. `Worker` loads `job.json` and `JOB.md` at startup. A saved break is rearmed; an overdue deadline wakes in a microtask. A job left `running` by a previous process is marked ready and queued to resume. There is also a narrow restart recovery for a previous compatible API tool-call error.
2. `createJob` rejects a second job, validates the goal and provider, and uses a chosen workspace or `userData/workspaces/<uuid>`. With no chosen workspace, a `github.com/owner/repo` URL in the goal/context triggers a `git clone --depth 1` (60-second timeout). Clone failure becomes context for the model; it does not abort setup.
3. `projectContext()` collects the workspace path, Git remotes, up to 14,000 characters each from `README.md`, `README.txt`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, and `AGENTS.md` (this file), plus up to 80 top-level names. The provider's `complete()` call turns this inspection and the user's goal into Markdown. Setup sends `reading` and `writing` progress events, and `cloning` when a GitHub URL triggered a clone.
4. The worker saves `JOB.md`, creates the persisted job with status `ready`, queues the initial instruction, and starts `pump()` without waiting for that first work turn to finish. `pump()` serializes turns with `this.pumping`, marks status `running`, and records an error in `lastError`/status `error` if a turn fails.
5. A turn starts a provider session with `instructions()` plus the queued prompt. Every model step can add assistant text and request tools. Tool calls in one response run **sequentially**; each gets a visible activity and a result sent back through `session.submit()`. A failing tool produces a `Tool error: ...` result rather than failing the whole turn. Chat messages arriving during work enter `queue` and are spliced into the active session after the current tool batch.
6. `take_break` is intercepted in `worker.cts`, records a system activity, saves `breakUntil`/`breakReason`, sets status `sleeping`, and arms a timer. If the model's final response has no tool calls and there is no queued user message, the worker schedules a 30-minute break. Sending a message while asleep or clicking the status pill wakes it. A wake queues `Wait over.` and records a system activity.

The queue and current provider session are in memory; `job.json` persists the displayed history and break deadline, not pending queue items or the exact in-progress model conversation. Investigate `pump()`, `runTurn()` and `armBreak()` when changing resume, error or scheduling behavior.

## Provider adapters

`createProvider(config, key)` in `electron/provider.cts` returns `complete(instructions, input)` for initial `JOB.md` generation and `start(instructions, prompt)` for an interactive tool session. A session has `next()` (assistant text and normalized calls) and `submit(outputs, userMessages, updatedInstructions)`.

- **OpenAI:** uses `client.responses.create`. A work turn sends flat tool definitions from `tools.cts` with `store: true`, carries `previous_response_id` between steps, and returns `function_call_output` entries on submit. Initial job generation uses a plain Responses call.
- **Compatible API:** uses `client.chat.completions.create` with `n: 1`. `chatTools()` converts the same flat definitions to Chat Completions function schemas. The session keeps its messages locally and appends tool responses with role `tool`.
- **Fallback:** if a compatible endpoint returns a specific HTTP 400 “tool/function calling unsupported” error, the adapter switches that session to a one-tool-at-a-time JSON prompt protocol. It rewrites prior tool messages into ordinary user/assistant text, asks for `{ "tool": ..., "arguments": ... }` or `{ "message": ... }`, and retries once after invalid JSON. Fallback relies on the model following the requested format. Do not make protocol changes without covering both native and fallback paths.

`electron/provider.test.cts` uses local HTTP servers and a mocked Responses client to verify request formats, no-key and keyed compatible requests, fallback, and URL normalization.

## Model tools and activity display

The single registry in `electron/tools.cts` contains model-facing definitions, `execute()` implementations, and `activityFor()` UI metadata. Schemas are strict objects with all declared fields required; `run_command.cwd` is required but nullable. `take_break` is defined here but handled by the worker before `execute()`.

| Tool | Implementation / visible app |
| --- | --- |
| `run_command(command, cwd)` | Spawns PowerShell on Windows, `/bin/sh -lc` elsewhere, in the workspace or requested `cwd`. Streams combined stdout/stderr to a Command activity; returns exit code plus output. Keeps the latest 120,000 output characters. No command timeout is set. |
| `list_files(path)` | Lists up to 200 entries through two directory levels, skipping `.git`, `node_modules`, `dist`, `dist-node`, `release`, `.next`. Command activity. |
| `read_file(path)` | Reads UTF-8 and returns the first 60,000 characters. Command activity. |
| `write_file(path, content)` | Creates parent directories and replaces the full UTF-8 file. Command activity. |
| `search_web(query)` | Fetches Bing RSS with a 20-second timeout and returns up to 8 title/URL/summary records. Browser activity with search results. |
| `open_page(url)` | Fetches only HTTP(S) pages with a 20-second timeout; Cheerio removes scripts/style/navigation, extracts up to 16,000 characters of text and 30 links. Browser activity. |
| `take_break(minutes, reason)` | Sets a break of at least 0.1 minutes; worker emits a system activity and schedules wake. |

Tool paths use `path.resolve(workspace, candidate)` and are **not confined to the workspace**. `run_command` inherits the app process environment and has its normal OS permissions. The tool result sent to the model is capped at 80,000 characters. This app deliberately exposes powerful local tools to its configured model; take care with any change to validation, permissions or provider trust assumptions.

## Renderer and Electron UI

`src/App.tsx` is one large component file. `App` holds the latest snapshot, opened windows, focus order, settings modal, browser target and a clock. Newest Browser/Command activities automatically open and focus their corresponding desktop window. `DesktopWindow` manages dragging and viewport clamping. `SetupModal` saves provider settings before calling `createJob`; `SettingsModal` can switch providers later. `ChatApp` sends messages and displays `lastError`; the sleeping status pill calls `wake()`.

The five dock apps are:

- **Chat:** saved message history and composer.
- **Command:** saved command/file activity and streamed output.
- **Browser:** shows worker search results or a user-controlled Electron `<webview>`. The webview has persistent partition `persist:kora-browser`. It is separate from the worker's `open_page()` fetch; opening a page in the UI does not give its contents to the model.
- **Search:** local filtering of the saved job title, messages and activities, plus a manual Bing browser search action. It is separate from the worker's `search_web()` tool.
- **JOB.md:** displays the stored Markdown as plain preformatted text; it is not a Markdown editor or renderer.

`electron/main.cts` creates a frameless 1440×900 window (minimum 1040×680), enables the webview tag, uses a context-isolated preload and disables renderer Node integration. The main renderer has `sandbox: false`; attached webviews are forced to `sandbox: true`, `nodeIntegration: false`, `contextIsolation: true`, and no preload. Window-created HTTP(S) links go to the OS browser; the explicit `openExternal` handler also checks the URL protocol. The browser UI can navigate a webview independently of those IPC handlers.

`src/styles.css` includes older selectors alongside later overrides. Search by class name and check the **last** matching rule before modifying appearance. `npm run capture` builds and runs `scripts/capture.cts` through `dist-node/scripts/capture.cjs`; it loads the built renderer in Electron and writes first-run or mock active-job screenshots to ignored `artifacts/`; `scripts/mock-preload.cts` supplies its typed fake `window.kora` state. Pass `-- --active` or `-- --compatible` to the capture command for those states.

## Where to change things

| Task | Primary files and checks |
| --- | --- |
| Add or change a native tool | Update `definitions`, `execute` and `activityFor` in `electron/tools.cts`; check worker interception if it affects scheduling; add a meaningful `tools.test.cts` or provider/worker test. |
| Change provider requests or model session flow | `electron/provider.cts`, `electron/provider.test.cts`; preserve OpenAI, compatible native calls and JSON fallback. |
| Change job setup, scheduling, restart or prompt history | `electron/worker.cts`, `electron/worker.test.cts`; consider persisted `job.json` compatibility. |
| Change settings, key storage or persisted fields | `electron/store.cts`, `electron/store.test.cts`, `src/types.ts`, and relevant setup/settings UI. |
| Change an IPC method or event payload | Keep `electron/main.cts`, `electron/preload.cts`, `src/types.ts` and `src/App.tsx` aligned. |
| Change desktop layout or styling | `src/App.tsx`, `src/styles.css`; build and inspect an Electron screenshot if practical. |
| Change packaging | `package.json` `build` section, `assets/kora.ico`, and `npm run dist` on a suitable platform. |

Run `npm run typecheck` to check both TypeScript configurations without emitting files. Run `npm run build` after renderer/type changes and `npm test` after backend changes. Tests use temporary directories and local HTTP fixtures; they do not call a real AI provider. There are currently no renderer unit tests. Keep this guide aligned with substantive architecture changes so the next agent can start here.
