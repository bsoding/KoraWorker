export type AppId = 'chat' | 'browser' | 'command' | 'search' | 'job'
export type ProviderId = 'openai' | 'compatible'

export type ProviderConfig = {
  provider: ProviderId
  model: string
  baseURL?: string
}

export type StoredSettings = {
  provider: ProviderId
  openaiModel: string
  compatibleModel: string
  compatibleBaseURL: string
}

export type KoraSettings = StoredSettings & ProviderConfig & {
  baseURL: string
  hasApiKey: boolean
  openaiHasApiKey: boolean
  compatibleHasApiKey: boolean
  keyStorage: 'encrypted' | 'session'
}

export type ProviderInput = { provider: ProviderId; model: string; baseURL: string; apiKey: string }
export type CreateJobInput = { goal: string; context: string; workspace: string }
export type WindowAction = 'minimize' | 'maximize' | 'close'
export type SearchResult = { title: string; url: string; summary: string }
export type Page = { title: string; url: string; excerpt: string; links: { title: string; url: string }[] }

export type Activity = {
  id: string
  timestamp: string
  app: 'browser' | 'command' | 'system'
  kind: string
  title: string
  detail: string
  status: 'running' | 'done' | 'error'
  output?: string
  url?: string
  results?: SearchResult[]
  page?: Page
}

export type ActivityInput = Pick<Activity, 'app' | 'kind' | 'title' | 'detail'> & Partial<Activity>
export type ActivityUpdate = Partial<Activity>

export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export type Job = {
  id: string
  title: string
  goal: string
  context?: string
  workspace: string
  createdAt: string
  status: 'ready' | 'running' | 'sleeping' | 'error'
  breakUntil: string | null
  breakReason: string | null
  currentAction: string
  lastError: string | null
  messages: Message[]
  activities: Activity[]
}

export type KoraState = {
  job: Job | null
  jobMarkdown: string
  settings: KoraSettings
}

export type SetupUpdate = { phase: string; message: string }
export type WorkerEvents = { 'worker:state': KoraState; 'worker:setup': SetupUpdate }
export type WorkerEmit = <Channel extends keyof WorkerEvents>(channel: Channel, payload: WorkerEvents[Channel]) => void

export type KoraBridge = {
  getState: () => Promise<KoraState>
  saveSettings: (settings: ProviderInput) => Promise<KoraSettings>
  chooseFolder: () => Promise<string | null>
  createJob: (job: CreateJobInput) => Promise<KoraState>
  sendMessage: (message: string) => Promise<KoraState>
  wake: () => Promise<KoraState>
  windowAction: (action: WindowAction) => Promise<void>
  openExternal: (url: string) => Promise<void>
  onState: (callback: (state: KoraState) => void) => () => void
  onSetup: (callback: (update: SetupUpdate) => void) => () => void
}

declare global {
  interface Window { kora?: KoraBridge }
}
