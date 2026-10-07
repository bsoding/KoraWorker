import { contextBridge } from 'electron'
import type { KoraBridge, KoraState } from '../src/types.js'

const now = new Date().toISOString()
const state: KoraState = {
  settings: { provider: 'openai', model: 'gpt-5.6-terra', baseURL: '', openaiModel: 'gpt-5.6-terra', compatibleModel: '', compatibleBaseURL: '', hasApiKey: true, openaiHasApiKey: true, compatibleHasApiKey: false, keyStorage: 'encrypted' },
  jobMarkdown: '# Maintain the project README\n\nKeep the documentation accurate as the project evolves.\n\n## First steps\n\nInspect the repository and compare the README with the current features.',
  job: {
    id: 'demo', title: 'Maintain the project README', goal: 'Maintain the project README',
    workspace: 'C:\\Projects\\example', createdAt: now, status: 'running', breakUntil: null, breakReason: null,
    currentAction: 'checking the repository', lastError: null,
    messages: [
      { id: 'm1', role: 'user', content: 'Please keep the README current as the project changes.', timestamp: now },
      { id: 'm2', role: 'assistant', content: 'I’ve read the project and my job description. I’m checking the code against the README now, then I’ll make the first update.', timestamp: now },
    ],
    activities: [
      { id: 'a0', timestamp: now, app: 'browser', kind: 'search', title: 'Searching for “README examples”', detail: 'README examples', status: 'done', url: 'https://www.bing.com/search?q=README%20examples', results: [
        { title: 'Make a README', url: 'https://www.makeareadme.com/', summary: 'A guide to writing a useful README for your project.' },
        { title: 'GitHub README examples', url: 'https://github.com/matiassingers/awesome-readme', summary: 'A curated list of projects with helpful documentation.' },
      ] },
      { id: 'a1', timestamp: now, app: 'command', kind: 'command', title: 'Get-ChildItem -Recurse src | Select-Object -First 30', detail: 'Job workspace', status: 'done', output: 'src\\App.tsx\nsrc\\components\\Header.tsx\nsrc\\components\\Dashboard.tsx' },
      { id: 'a2', timestamp: now, app: 'command', kind: 'file', title: 'read file · README.md', detail: 'README.md', status: 'done', output: '# Example Project\n\nAn overview of the application.' },
    ],
  },
}

const bridge: KoraBridge = {
  getState: () => Promise.resolve(state),
  saveSettings: () => Promise.resolve(state.settings),
  chooseFolder: () => Promise.resolve(null),
  createJob: () => Promise.resolve(state),
  sendMessage: () => Promise.resolve(state),
  wake: () => Promise.resolve(state),
  windowAction: () => Promise.resolve(),
  openExternal: () => Promise.resolve(),
  onState: () => () => {},
  onSetup: () => () => {},
}

contextBridge.exposeInMainWorld('kora', bridge)
