# Kora Worker

Kora Worker gives an AI an ongoing job and a small virtual desktop to work from. You can watch its commands and web activity, talk to it in Chat, and see the `JOB.md` it writes to remember its role.

## Get started

1. Install [Node.js](https://nodejs.org/) and run `npm install`.
2. Run `npm run dist` to build the Windows portable executable in `release/`.
3. Open `Kora-Worker-0.1.0-x64.exe`.
4. Describe the job, choose a workspace folder if you have one, then choose OpenAI or Compatible API.

OpenAI uses the Responses API and defaults to `gpt-5.6-terra`. Enter an OpenAI API key or set `OPENAI_API_KEY`. Compatible API uses standard `/v1/chat/completions`. Enter its base URL (for example `http://localhost:11434/v1`), model ID, and a key if that server needs one. `KORA_COMPATIBLE_API_KEY` also works. Local servers that require no key can leave the key field blank. The two providers keep separate model choices and keys, and you can switch between them in Settings. Kora tries native function calls first. If an API rejects tool calling, Kora switches to a one-tool-at-a-time JSON prompt protocol.

## How it works

Kora inspects the selected workspace, asks the model to turn your goal into a working `JOB.md`, then starts the job. If you leave the folder blank and provide a GitHub URL, Kora makes a shallow clone to inspect before writing `JOB.md`. It can run PowerShell commands, read and write files, search the web, and open pages. Tool calls appear in the Command or Browser app as they happen. Chat messages join its work queue, including while it is busy. The worker can call `take_break` to choose a later check; if it finishes a turn without one, it checks again after 30 minutes. A saved break resumes while the app is running, or when you next open it if its deadline passed while the app was closed.

This first version has one job. Kora's `JOB.md`, messages, activities, settings, and encrypted API keys are stored in Electron's user data folder. On Windows that is normally `%APPDATA%\kora-worker`. If Windows encryption is unavailable, a key entered in Settings is held only for the current app session. Kora's local tools are unrestricted, so choose a workspace and goal accordingly. The JSON prompt fallback depends on the model following its requested format. No MCP integrations are included yet.

## Development

- `npm run build` checks TypeScript and builds the renderer.
- `npm start` runs the latest built renderer in Electron.
- `npm run dev` serves the renderer for visual development; native worker features require Electron.
- `npm test` runs local tool tests.
- `npm run dist` rebuilds and packages the latest source as a Windows `.exe`.

The app uses Electron for the native runtime and React and Vite for the desktop UI. The provider adapter in `electron/provider.cjs` uses Responses for OpenAI and Chat Completions for compatible servers. Native tools and activity metadata are registered together in `electron/tools.cjs`, leaving a straightforward place for later capabilities.
