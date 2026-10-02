import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Check,
  CircleHelp, ExternalLink, FileText, FolderOpen,
  Globe2, LoaderCircle, MessageCircle, Minus,
  PanelTop, Plus, RotateCw, Search, Settings2, Terminal, X,
} from 'lucide-react'
import type { Activity, AppId, Job, KoraSettings, KoraState, Message, ProviderId, ProviderInput } from './types'

const emptyState: KoraState = { job: null, jobMarkdown: '', settings: { provider: 'openai', model: 'gpt-5.6-terra', baseURL: '', openaiModel: 'gpt-5.6-terra', compatibleModel: '', compatibleBaseURL: '', hasApiKey: false, openaiHasApiKey: false, compatibleHasApiKey: false, keyStorage: 'session' } }
const formatTime = (date: string | number | Date) => new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const formatDate = (date: string) => new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric' })
const appNames: Record<AppId, string> = { chat: 'Chat', browser: 'Browser', command: 'Command', search: 'Search', job: 'JOB.md' }

function KoraMark({ small = false }: { small?: boolean }) {
  return <div className={`kora-mark ${small ? 'small' : ''}`} aria-hidden="true"><span className="eye left" /><span className="eye right" /><span className="smile" /></div>
}

function AppIcon({ app, size = 26 }: { app: AppId; size?: number }) {
  const icon = app === 'chat' ? <MessageCircle size={size} strokeWidth={2.25} />
    : app === 'browser' ? <Globe2 size={size} strokeWidth={2.1} />
    : app === 'command' ? <Terminal size={size} strokeWidth={2.1} />
    : app === 'job' ? <FileText size={size} strokeWidth={2.1} />
    : <Search size={size} strokeWidth={2.2} />
  return <span className={`app-icon ${app}`}>{icon}</span>
}

function StatusPill({ job, onWake }: { job: Job | null; onWake: () => void }) {
  const status = job?.status || 'unassigned'
  const label = status === 'running' ? 'At work' : status === 'sleeping' ? 'On a break' : status === 'error' ? 'Needs attention' : status === 'ready' ? 'Ready to work' : 'Waiting for a job'
  return status === 'sleeping'
    ? <button className={`status-pill ${status}`} onClick={onWake} title="Wake Kora now"><span className="status-dot" />{label}</button>
    : <span className={`status-pill ${status}`}><span className="status-dot" />{label}</span>
}

function DesktopWindow({ app, title, z, initial, onClose, onFocus, children, className = '' }: {
  app: AppId; title: string; z: number; initial: { x: number; y: number; width: number; height: number };
  onClose: () => void; onFocus: () => void; children: ReactNode; className?: string
}) {
  const [position, setPosition] = useState({ x: initial.x, y: initial.y })
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  useEffect(() => {
    const keepVisible = () => setPosition((current) => ({
      x: Math.max(12, Math.min(current.x, window.innerWidth - Math.min(initial.width, window.innerWidth - 28) - 12)),
      y: Math.max(64, Math.min(current.y, window.innerHeight - 125)),
    }))
    window.addEventListener('resize', keepVisible)
    keepVisible()
    return () => window.removeEventListener('resize', keepVisible)
  }, [initial.width])
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button')) return
    onFocus()
    drag.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    const x = Math.max(12, Math.min(window.innerWidth - 220, drag.current.left + event.clientX - drag.current.x))
    const y = Math.max(64, Math.min(window.innerHeight - 140, drag.current.top + event.clientY - drag.current.y))
    setPosition({ x, y })
  }
  function onPointerUp() { drag.current = null }
  return <section className={`desktop-window ${className}`} style={{ left: position.x, top: position.y, width: initial.width, height: initial.height, zIndex: z }} onPointerDown={onFocus} aria-label={title}>
    <div className="window-header" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div className="window-dots"><button className="window-dot close" aria-label={`Close ${title}`} onClick={onClose}><X size={11} /></button><button className="window-dot minimize" aria-label={`Minimize ${title}`} onClick={onClose}><Minus size={11} /></button></div>
      <div className="window-heading"><AppIcon app={app} size={16} /><strong>{title}</strong></div>
      <div className="window-header-end" />
    </div>
    <div className="window-body">{children}</div>
  </section>
}

function ChatApp({ job, onSend, onOpenSettings }: { job: Job; onSend: (text: string) => Promise<void>; onOpenSettings: () => void }) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [job.messages.length, job.status])
  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setDraft('')
    setSending(true)
    try { await onSend(text) } catch { setDraft(text) } finally { setSending(false) }
  }
  return <div className="chat-app">
    <div className="chat-person"><KoraMark small /><strong>Kora</strong></div>
    <div className="chat-scroll">
      <div className="chat-day">{formatDate(job.createdAt)}</div>
      {job.messages.length === 0 && <div className="chat-intro"><h2>Message Kora</h2></div>}
      {job.messages.map((message: Message) => <div className={`message-row ${message.role}`} key={message.id}>{message.role === 'assistant' && <KoraMark small />}<div className="message-stack"><div className="message-bubble">{message.content}</div><span>{message.role === 'user' ? 'You' : 'Kora'} · {formatTime(message.timestamp)}</span></div></div>)}
      {job.lastError && <div className="chat-error"><CircleHelp size={17} /><div><strong>Request failed</strong><p>{job.lastError}</p><button onClick={onOpenSettings}>Open settings <ArrowRight size={14} /></button></div></div>}
      <div ref={endRef} />
    </div>
    <form className="chat-composer" onSubmit={submit}><input aria-label="Message Kora" placeholder="Message Kora" value={draft} onChange={(e) => setDraft(e.target.value)} /><button type="submit" disabled={!draft.trim() || sending} aria-label="Send message"><ArrowUpRight size={20} /></button></form>
  </div>
}

function BrowserApp({ activities, initialUrl }: { activities: Activity[]; initialUrl: string | null }) {
  const latest = activities.find((activity) => activity.app === 'browser')
  const [address, setAddress] = useState(initialUrl || '')
  const [pageUrl, setPageUrl] = useState<string | null>(null)
  const [showResults, setShowResults] = useState(true)
  useEffect(() => {
    if (!latest) return
    if (latest.kind === 'search') { setAddress(latest.detail); setPageUrl(null); setShowResults(true) }
    else if (latest.url) { setAddress(latest.url); setPageUrl(latest.url); setShowResults(false) }
  }, [latest?.id, latest?.url, latest?.kind, latest?.detail])
  useEffect(() => { if (initialUrl) { setAddress(initialUrl); setPageUrl(initialUrl); setShowResults(false) } }, [initialUrl])
  function navigate(raw: string) {
    const value = raw.trim()
    if (!value) return
    const url = /^https?:\/\//i.test(value) ? value : value.includes('.') && !value.includes(' ') ? `https://${value}` : `https://www.bing.com/search?q=${encodeURIComponent(value)}`
    setAddress(url)
    setPageUrl(url)
    setShowResults(false)
  }
  const webview = pageUrl ? <div className="webview-frame"><webview key={pageUrl} src={pageUrl} partition="persist:kora-browser" /></div> : null
  return <div className="browser-app">
    <div className="browser-toolbar"><div className="browser-arrows"><button aria-label="Back" onClick={() => { setPageUrl(null); setShowResults(true) }}><ArrowLeft size={17} /></button><button aria-label="Forward" disabled><ArrowRight size={17} /></button><button aria-label="Reload" onClick={() => { if (pageUrl) setPageUrl(`${pageUrl}#${Date.now()}`) }}><RotateCw size={16} /></button></div><form onSubmit={(e) => { e.preventDefault(); navigate(address) }}><span className="address-lock"><Globe2 size={15} /></span><input aria-label="Website address or search" placeholder="Search or enter a website" value={address} onChange={(e) => setAddress(e.target.value)} /><button aria-label="Go"><ArrowRight size={16} /></button></form>{pageUrl && <button className="browser-external" onClick={() => window.kora?.openExternal(pageUrl)} aria-label="Open in browser" title="Open in browser"><ExternalLink size={17} /></button>}</div>
    <div className="browser-content">
      {showResults && latest?.kind === 'search' ? <div className="search-page"><h2>Results for <em>{latest.detail}</em></h2>{latest.results?.map((result) => <button className="web-result" key={result.url} onClick={() => navigate(result.url)}><span className="web-result-url">{new URL(result.url).hostname} <ArrowUpRight size={13} /></span><strong>{result.title}</strong><span>{result.summary}</span></button>)}{latest.status === 'error' && <div className="browser-error">{latest.output}</div>}</div>
        : webview || <div className="browser-home"><form onSubmit={(e) => { e.preventDefault(); navigate(address) }}><Search size={19} /><input placeholder="Search the web or enter a URL" value={address} onChange={(e) => setAddress(e.target.value)} /><button aria-label="Search"><ArrowRight size={18} /></button></form></div>}
    </div>
  </div>
}

function CommandApp({ activities, workspace }: { activities: Activity[]; workspace: string }) {
  const commandActivities = activities.filter((activity) => activity.app === 'command')
  return <div className="command-app"><div className="terminal-topline"><span>{workspace}</span></div><div className="terminal-scroll">{commandActivities.length === 0 ? <div className="terminal-empty"><span className="terminal-prompt">&gt;_</span></div> : commandActivities.map((activity) => <article className="terminal-entry" key={activity.id}><div className="terminal-meta"><span>{formatTime(activity.timestamp)}</span></div><div className="terminal-command"><span className="prompt-symbol">❯</span>{activity.title}</div>{activity.output && <pre>{activity.output}</pre>}</article>)}</div></div>
}

function SearchApp({ job, onOpen, onWeb }: { job: Job | null; onOpen: (app: AppId) => void; onWeb: (query: string) => void }) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const messages = (job?.messages || []).filter((message) => message.content.toLowerCase().includes(needle)).slice(-5).reverse()
  const activities = (job?.activities || []).filter((activity) => `${activity.title} ${activity.detail} ${activity.output || ''}`.toLowerCase().includes(needle)).slice(0, 5)
  return <div className="search-app"><div className="spotlight-input"><Search size={23} /><input autoFocus placeholder="Search Kora’s desk..." value={query} onChange={(e) => setQuery(e.target.value)} /></div><div className="spotlight-results">{!needle ? <div className="quick-apps">{(['chat', 'browser', 'command', 'job'] as AppId[]).map((app) => <button key={app} onClick={() => onOpen(app)}><AppIcon app={app} size={21} />{appNames[app]}<ArrowUpRight size={15} /></button>)}</div> : <>{job?.title.toLowerCase().includes(needle) && <button className="spotlight-result" onClick={() => onOpen('job')}><FileText size={18} /><span><strong>{job.title}</strong><small>Job description</small></span><ArrowUpRight size={15} /></button>}{messages.map((message) => <button className="spotlight-result" key={message.id} onClick={() => onOpen('chat')}><MessageCircle size={18} /><span><strong>{message.content.slice(0, 90)}</strong><small>Chat · {formatDate(message.timestamp)}</small></span><ArrowUpRight size={15} /></button>)}{activities.map((activity) => <button className="spotlight-result" key={activity.id} onClick={() => onOpen(activity.app === 'browser' ? 'browser' : 'command')}><ActivityIcon activity={activity} /><span><strong>{activity.title.slice(0, 90)}</strong><small>{activity.app} · {formatDate(activity.timestamp)}</small></span><ArrowUpRight size={15} /></button>)}{!messages.length && !activities.length && !job?.title.toLowerCase().includes(needle) && <p className="no-results">No results. Try the web instead.</p>}<button className="search-web-action" onClick={() => onWeb(query)}><Globe2 size={18} /> Search the web for “{query}” <ArrowUpRight size={16} /></button></>}</div></div>
}

function ActivityIcon({ activity }: { activity: Activity }) { return activity.app === 'browser' ? <Globe2 size={18} /> : <Terminal size={18} /> }

function JobApp({ job, markdown }: { job: Job; markdown: string }) {
  return <div className="job-app"><div className="job-document-header"><div className="job-paper-icon"><FileText size={25} /></div><div><h2>{job.title}</h2><p>{job.workspace}</p></div></div><div className="job-document"><pre>{markdown}</pre></div></div>
}

type ProviderDraft = {
  provider: ProviderId
  openaiModel: string
  compatibleModel: string
  compatibleBaseURL: string
  openaiKey: string
  compatibleKey: string
}

function providerDraft(settings: KoraSettings): ProviderDraft {
  return {
    provider: settings.provider,
    openaiModel: settings.openaiModel,
    compatibleModel: settings.compatibleModel,
    compatibleBaseURL: settings.compatibleBaseURL,
    openaiKey: '',
    compatibleKey: '',
  }
}

function providerInput(draft: ProviderDraft): ProviderInput {
  return {
    provider: draft.provider,
    model: draft.provider === 'openai' ? draft.openaiModel : draft.compatibleModel,
    baseURL: draft.compatibleBaseURL,
    apiKey: draft.provider === 'openai' ? draft.openaiKey : draft.compatibleKey,
  }
}

function ProviderFields({ draft, setDraft, settings }: {
  draft: ProviderDraft; setDraft: (draft: ProviderDraft) => void; settings: KoraSettings
}) {
  const compatible = draft.provider === 'compatible'
  const model = compatible ? draft.compatibleModel : draft.openaiModel
  const key = compatible ? draft.compatibleKey : draft.openaiKey
  const hasKey = compatible ? settings.compatibleHasApiKey : settings.openaiHasApiKey
  return <>
    <label className="field-label">AI PROVIDER</label>
    <div className="provider-switch" role="group" aria-label="AI provider">
      <button type="button" className={!compatible ? 'selected' : ''} aria-pressed={!compatible} onClick={() => setDraft({ ...draft, provider: 'openai' })}>OpenAI</button>
      <button type="button" className={compatible ? 'selected' : ''} aria-pressed={compatible} onClick={() => setDraft({ ...draft, provider: 'compatible' })}>Compatible API</button>
    </div>
    {compatible && <>
      <label className="field-label" htmlFor="provider-base-url">API BASE URL</label>
      <input id="provider-base-url" className="text-field" type="url" placeholder="http://localhost:11434/v1" value={draft.compatibleBaseURL} onChange={(event) => setDraft({ ...draft, compatibleBaseURL: event.target.value })} />
    </>}
    <label className="field-label" htmlFor="provider-model">MODEL ID</label>
    <input id="provider-model" className="text-field" placeholder={compatible ? 'Enter the model ID from your provider' : 'gpt-5.6-terra'} value={model} onChange={(event) => setDraft({ ...draft, [compatible ? 'compatibleModel' : 'openaiModel']: event.target.value })} />
    <label className="field-label" htmlFor="provider-key">{compatible ? 'API KEY · OPTIONAL FOR LOCAL SERVERS' : 'OPENAI API KEY'}</label>
    <input id="provider-key" className="text-field" type="password" placeholder={hasKey ? 'Key already saved — enter to replace' : compatible ? 'Leave blank if no key is needed' : 'sk-...'} value={key} onChange={(event) => setDraft({ ...draft, [compatible ? 'compatibleKey' : 'openaiKey']: event.target.value })} />
  </>
}

function SetupModal({ settings, setupMessage, onSaveSettings, onCreate, onChoose }: {
  settings: KoraSettings; setupMessage: string; onSaveSettings: (input: ProviderInput) => Promise<void>;
  onCreate: (data: { goal: string; context: string; workspace: string }) => Promise<void>; onChoose: () => Promise<string | null>
}) {
  const [goal, setGoal] = useState('')
  const [context, setContext] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [provider, setProvider] = useState(() => providerDraft(settings))
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!goal.trim()) return
    setWorking(true)
    setError('')
    try {
      await onSaveSettings(providerInput(provider))
      await onCreate({ goal, context, workspace })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally { setWorking(false) }
  }
  return <div className="setup-scrim"><div className="setup-card">
    <aside className="setup-aside">
      <div className="setup-aside-glow" />
      <div className="setup-top-brand"><KoraMark small /><strong>KORA <span>WORKER</span></strong></div>
      <div className="setup-illustration"><div className="setup-orbit orbit-one" /><div className="setup-orbit orbit-two" /><div className="setup-face"><KoraMark /></div><span className="illustration-star star-one">✦</span><span className="illustration-star star-two">✳</span><span className="illustration-star star-three">✧</span></div>
      <div className="setup-aside-copy"><h2>Kora Worker</h2></div>
    </aside>
    <form className="setup-form" onSubmit={submit}>
      <div className="setup-form-head"><h1>What should Kora work on?</h1><p>Describe the job and choose an AI provider.</p></div>
      <label className="field-label" htmlFor="job-goal">THE JOB</label>
      <textarea id="job-goal" className="goal-input" placeholder="For example: Maintain the README for my project, keep it accurate as the code changes, and check in each morning." value={goal} onChange={(event) => setGoal(event.target.value)} autoFocus />
      <details className="setup-extras"><summary><span>Workspace and extra context <small>optional</small></span><Plus size={17} /></summary><div className="setup-extra-content">
        <label className="field-label" htmlFor="job-context">EXTRA CONTEXT</label>
        <input id="job-context" className="text-field" placeholder="Anything Kora should know about your preferences" value={context} onChange={(event) => setContext(event.target.value)} />
        <label className="field-label">WORKSPACE FOLDER</label>
        <button type="button" className="folder-picker" onClick={async () => { const folder = await onChoose(); if (folder) setWorkspace(folder) }}><FolderOpen size={19} /><span>{workspace || 'Choose a project folder'}</span><Plus size={17} /></button>
      </div></details>
      <div className="provider-fields"><ProviderFields draft={provider} setDraft={setProvider} settings={settings} /></div>
      {error && <div className="setup-error">{error}</div>}
      <div className="setup-actions"><button type="submit" disabled={working || !goal.trim()}>{working ? <><LoaderCircle className="spin" size={18} /> {setupMessage || 'Setting up...'}</> : <>Hire Kora <ArrowRight size={18} /></>}</button></div>
    </form>
  </div></div>
}

function SettingsModal({ settings, onSave, onClose }: {
  settings: KoraSettings; onSave: (input: ProviderInput) => Promise<void>; onClose: () => void
}) {
  const [provider, setProvider] = useState(() => providerDraft(settings))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try { await onSave(providerInput(provider)); onClose() }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <div className="modal-scrim" onMouseDown={onClose}><form className="settings-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
    <div className="settings-head"><div className="settings-icon"><Settings2 size={23} /></div><h2>Settings</h2><button type="button" onClick={onClose} aria-label="Close settings"><X size={19} /></button></div>
    <ProviderFields draft={provider} setDraft={setProvider} settings={settings} />
    {error && <div className="setup-error">{error}</div>}
    <button className="save-settings" disabled={busy}>{busy ? 'Saving...' : 'Save settings'} <Check size={17} /></button>
  </form></div>
}

export default function App() {
  const [state, setState] = useState<KoraState>(emptyState)
  const [loaded, setLoaded] = useState(false)
  const [setupMessage, setSetupMessage] = useState('')
  const [openWindows, setOpenWindows] = useState<Partial<Record<AppId, boolean>>>({})
  const [focusOrder, setFocusOrder] = useState<AppId[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [browserTarget, setBrowserTarget] = useState<string | null>(null)
  const [clock, setClock] = useState(Date.now())
  const latestActivityId = useRef<string | null>(null)
  useEffect(() => {
    let live = true
    window.kora?.getState().then((snapshot) => { if (live) { setState(snapshot); setLoaded(true); if (snapshot.job) { setOpenWindows({ chat: true }); setFocusOrder(['chat']); latestActivityId.current = snapshot.job.activities[0]?.id || null } } })
    if (!window.kora) setLoaded(true)
    const offState = window.kora?.onState((snapshot) => {
      setState(snapshot)
      const newest = snapshot.job?.activities[0]
      if (newest && newest.id !== latestActivityId.current) {
        latestActivityId.current = newest.id
        if (newest.app === 'browser' || newest.app === 'command') {
          const app = newest.app as AppId
          setOpenWindows((windows) => ({ ...windows, [app]: true }))
          setFocusOrder((order) => [...order.filter((item) => item !== app), app])
        }
      }
    })
    const offSetup = window.kora?.onSetup((update) => setSetupMessage(update.message))
    const interval = window.setInterval(() => setClock(Date.now()), 30000)
    return () => { live = false; offState?.(); offSetup?.(); clearInterval(interval) }
  }, [])
  const job = state.job
  const open = (app: AppId) => { setOpenWindows((windows) => ({ ...windows, [app]: true })); setFocusOrder((order) => [...order.filter((item) => item !== app), app]) }
  const close = (app: AppId) => setOpenWindows((windows) => ({ ...windows, [app]: false }))
  const z = (app: AppId) => 10 + focusOrder.indexOf(app)
  async function saveSettings(input: ProviderInput) { const settings = await window.kora?.saveSettings(input); if (settings) setState((current) => ({ ...current, settings })) }
  async function createJob(input: { goal: string; context: string; workspace: string }) { const snapshot = await window.kora?.createJob(input); if (!snapshot) throw new Error('Open the Windows app to create a job.'); setState(snapshot); open('chat') }
  async function sendMessage(text: string) { await window.kora?.sendMessage(text) }
  const dockApps: AppId[] = ['search', 'browser', 'command', 'chat', 'job']
  return <div className="desktop"><div className="wallpaper" aria-hidden="true" />
    <header className="system-bar"><div className="brand-lockup"><KoraMark small /><div><strong>KORA</strong><span>WORKER</span></div></div><div className="bar-center"><StatusPill job={job} onWake={() => window.kora?.wake()} />{job && <><span className="bar-divider" /><span>{job.title}</span></>}</div><div className="system-actions"><span className="top-date">{new Date(clock).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span><span className="top-time">{formatTime(clock)}</span><button className="header-icon" aria-label="Settings" onClick={() => setSettingsOpen(true)}><Settings2 size={18} /></button><div className="window-controls"><button aria-label="Minimize" onClick={() => window.kora?.windowAction('minimize')}><Minus size={15} /></button><button aria-label="Maximize" onClick={() => window.kora?.windowAction('maximize')}><PanelTop size={14} /></button><button aria-label="Close" className="close-app" onClick={() => window.kora?.windowAction('close')}><X size={17} /></button></div></div></header>
    {job && openWindows.chat && <DesktopWindow app="chat" title="Chat" initial={{ x: Math.max(520, window.innerWidth - 560), y: 112, width: 480, height: Math.min(620, window.innerHeight - 290) }} z={z('chat')} onClose={() => close('chat')} onFocus={() => open('chat')} className="chat-window"><ChatApp job={job} onSend={sendMessage} onOpenSettings={() => setSettingsOpen(true)} /></DesktopWindow>}
    {openWindows.browser && <DesktopWindow app="browser" title="Browser" initial={{ x: 130, y: 105, width: Math.min(850, window.innerWidth - 190), height: Math.min(620, window.innerHeight - 280) }} z={z('browser')} onClose={() => close('browser')} onFocus={() => open('browser')} className="browser-window"><BrowserApp activities={job?.activities || []} initialUrl={browserTarget} /></DesktopWindow>}
    {openWindows.command && <DesktopWindow app="command" title="Command" initial={{ x: 165, y: 133, width: Math.min(790, window.innerWidth - 230), height: Math.min(555, window.innerHeight - 300) }} z={z('command')} onClose={() => close('command')} onFocus={() => open('command')} className="command-window"><CommandApp activities={job?.activities || []} workspace={job?.workspace || 'No workspace yet'} /></DesktopWindow>}
    {openWindows.search && <DesktopWindow app="search" title="Search" initial={{ x: Math.max(140, (window.innerWidth - 630) / 2), y: 120, width: 630, height: 520 }} z={z('search')} onClose={() => close('search')} onFocus={() => open('search')} className="search-window"><SearchApp job={job} onOpen={open} onWeb={(query) => { setBrowserTarget(`https://www.bing.com/search?q=${encodeURIComponent(query)}`); open('browser') }} /></DesktopWindow>}
    {job && openWindows.job && <DesktopWindow app="job" title="JOB.md" initial={{ x: Math.max(160, (window.innerWidth - 680) / 2), y: 110, width: 680, height: Math.min(620, window.innerHeight - 280) }} z={z('job')} onClose={() => close('job')} onFocus={() => open('job')} className="job-window"><JobApp job={job} markdown={state.jobMarkdown} /></DesktopWindow>}
    <div className="dock-wrap"><div className="dock"><div className="dock-start"><KoraMark small /></div><span className="dock-divider" />{dockApps.map((app) => <button className="dock-item" key={app} onClick={() => open(app)} aria-label={`Open ${appNames[app]}`} title={appNames[app]}><AppIcon app={app} /><span className="dock-label">{appNames[app]}</span></button>)}<span className="dock-divider" /><button className="dock-extra" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings"><Settings2 size={23} /></button></div></div>
    {loaded && !job && <SetupModal settings={state.settings} setupMessage={setupMessage} onSaveSettings={saveSettings} onCreate={createJob} onChoose={async () => (await window.kora?.chooseFolder()) || null} />}
    {settingsOpen && <SettingsModal settings={state.settings} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}
  </div>
}
