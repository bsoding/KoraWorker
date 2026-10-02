const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { execFile, execFileSync } = require('node:child_process')
const { promisify } = require('node:util')
const store = require('./store.cjs')
const tools = require('./tools.cjs')
const { createProvider } = require('./provider.cjs')
const execFileAsync = promisify(execFile)

function githubRepository(text) {
  const match = String(text).match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i)
  if (!match) return null
  const repository = match[2].replace(/[.,;:!?)]*$/, '').replace(/\.git$/i, '')
  return `https://github.com/${match[1]}/${repository}.git`
}

class Worker {
  constructor(emit) {
    this.emit = emit
    this.job = store.loadJob()
    this.jobMarkdown = store.loadJobMarkdown()
    this.queue = []
    this.pumping = false
    this.timer = null
    if (this.job) {
      this.job.activities ||= []
      this.job.messages ||= []
      if (this.job.breakUntil) this.armBreak()
      else if (this.job.status === 'running') {
        this.job.status = 'ready'
        this.queue.push('Resume your work after the app restarted. Review the latest activity and continue.')
        queueMicrotask(() => this.pump())
      } else if (this.job.status === 'error' && store.settings().provider === 'compatible' && /multiple choices and tool calling are not supported/i.test(this.job.lastError || '')) {
        this.job.status = 'ready'
        this.job.lastError = null
        this.queue.push('Resume your job after the compatible API tool-call update. Review the job and continue working.')
        queueMicrotask(() => this.pump())
      }
    }
  }

  snapshot() {
    return { job: this.job, jobMarkdown: this.jobMarkdown, settings: store.publicSettings() }
  }

  broadcast() { this.emit('worker:state', this.snapshot()) }

  persist() {
    if (this.job) store.saveJob(this.job)
    this.broadcast()
  }

  async provider() {
    const config = store.settings()
    const key = store.apiKey(config.provider)
    if (config.provider === 'openai' && !key) throw new Error('Add an OpenAI API key in Settings to start the worker.')
    if (config.provider === 'compatible' && (!config.baseURL || !config.model)) {
      throw new Error('Add a compatible API base URL and model ID in Settings to start the worker.')
    }
    return createProvider(config, key)
  }

  projectContext(workspace) {
    const sections = [`Workspace: ${workspace}`]
    try {
      const remote = execFileSync('git', ['remote', '-v'], { cwd: workspace, encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] })
      if (remote.trim()) sections.push(`Git remotes:\n${remote.trim()}`)
    } catch { /* The workspace may not be a Git repository. */ }
    for (const name of ['README.md', 'README.txt', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'AGENTS.md']) {
      try {
        const file = path.join(workspace, name)
        sections.push(`${name}:\n${fs.readFileSync(file, 'utf8').slice(0, 14000)}`)
      } catch { /* Optional context file. */ }
    }
    try {
      const names = fs.readdirSync(workspace).filter((name) => name !== 'node_modules' && name !== '.git').slice(0, 80)
      sections.push(`Top-level files: ${names.join(', ') || '(none)'}`)
    } catch { /* Newly created workspace. */ }
    return sections.join('\n\n')
  }

  async createJob(input) {
    if (this.job) throw new Error('This first version supports one ongoing job at a time.')
    const goal = String(input.goal || '').trim()
    if (!goal) throw new Error('Describe the job you want your worker to do.')
    const provider = await this.provider()
    const id = randomUUID()
    const workspace = input.workspace ? path.resolve(String(input.workspace)) : path.join(store.dataRoot(), 'workspaces', id)
    let importNote = ''
    const repository = input.workspace ? null : githubRepository(`${goal}\n${input.context || ''}`)
    if (repository) {
      this.emit('worker:setup', { phase: 'cloning', message: 'Fetching the project' })
      fs.mkdirSync(path.dirname(workspace), { recursive: true })
      try {
        await execFileAsync('git', ['clone', '--depth', '1', repository, workspace], {
          timeout: 60000,
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        })
        importNote = `Cloned repository: ${repository}`
      } catch (error) {
        importNote = `Could not clone ${repository} before writing JOB.md: ${error.message}. The worker should inspect it during its first turn.`
      }
    }
    fs.mkdirSync(workspace, { recursive: true })
    this.emit('worker:setup', { phase: 'reading', message: 'Reading the workspace' })
    const context = `${importNote}\n\n${this.projectContext(workspace)}`
    this.emit('worker:setup', { phase: 'writing', message: 'Writing the job description' })
    const markdown = await provider.complete(
      'You write useful internal job descriptions for an ongoing AI worker. Produce only Markdown for JOB.md. Include the mission, known project context, responsibilities, practical first steps, how to decide what to check next, and open questions. Ground it in the provided evidence. Do not invent project facts. Keep it concise enough to reread every time the worker resumes.',
      `The user hired a worker for this job:\n${goal}\n\nAdditional user context:\n${String(input.context || '').trim() || '(none)'}\n\nProject inspection:\n${context}`,
    )
    if (!markdown) throw new Error('The model did not return a job description. Please try again.')
    this.jobMarkdown = markdown
    store.saveJobMarkdown(markdown)
    this.job = {
      id,
      title: goal.split('\n')[0].slice(0, 60),
      goal,
      context: String(input.context || '').trim(),
      workspace,
      createdAt: new Date().toISOString(),
      status: 'ready',
      breakUntil: null,
      breakReason: null,
      currentAction: 'Getting oriented',
      lastError: null,
      messages: [],
      activities: [],
    }
    this.persist()
    this.queue.push('Begin your job now. Inspect what matters, make useful progress, and tell the user what you did. Call take_break when the next check should happen later.')
    this.pump()
    return this.snapshot()
  }

  sendMessage(raw) {
    if (!this.job) throw new Error('Create a job first.')
    const content = String(raw || '').trim()
    if (!content) return this.snapshot()
    this.addMessage('user', content)
    if (this.job.breakUntil) this.clearBreak()
    this.queue.push(content)
    this.pump()
    return this.snapshot()
  }

  addMessage(role, content) {
    this.job.messages.push({ id: randomUUID(), role, content, timestamp: new Date().toISOString() })
    this.job.messages = this.job.messages.slice(-120)
    this.persist()
  }

  addActivity(base) {
    const activity = { id: randomUUID(), timestamp: new Date().toISOString(), status: 'running', output: '', ...base }
    this.job.activities.unshift(activity)
    this.job.activities = this.job.activities.slice(0, 80)
    this.job.currentAction = activity.title
    this.persist()
    return activity
  }

  updateActivity(activity, patch) {
    Object.assign(activity, patch)
    this.broadcast()
  }

  clearBreak() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.job.breakUntil = null
    this.job.breakReason = null
    this.job.status = 'ready'
    this.persist()
  }

  scheduleBreak(minutes, reason) {
    const safeMinutes = Number.isFinite(minutes) ? Math.max(0.1, minutes) : 30
    this.job.breakUntil = new Date(Date.now() + safeMinutes * 60000).toISOString()
    this.job.breakReason = reason || 'Check back on the job'
    this.job.status = 'sleeping'
    this.job.currentAction = this.job.breakReason
    this.persist()
    this.armBreak()
  }

  armBreak() {
    if (this.timer) clearTimeout(this.timer)
    const remaining = new Date(this.job.breakUntil).getTime() - Date.now()
    if (remaining <= 0) {
      queueMicrotask(() => this.wake())
      return
    }
    this.timer = setTimeout(() => this.armBreak(), Math.min(remaining, 2147483647))
  }

  wake() {
    if (!this.job || !this.job.breakUntil) return this.snapshot()
    this.clearBreak()
    this.addActivity({ app: 'system', kind: 'wake', title: 'Break is over', detail: 'Returning to the job', status: 'done' })
    this.queue.push('Wait over.')
    this.pump()
    return this.snapshot()
  }

  instructions() {
    const recentMessages = this.job.messages.slice(-24).map((m) => `${m.role === 'user' ? 'User' : 'Worker'}: ${m.content}`).join('\n\n')
    const recentActivity = this.job.activities.slice(0, 12).reverse().map((a) => `${a.app}: ${a.title} (${a.status})`).join('\n')
    return `You are Kora Worker, an ongoing AI worker hired by the user. Work toward the job described below, using your tools when helpful. You have access to the user's selected workspace and can operate the computer through the provided tools. Explain material progress to the user in plain language. When there is no useful immediate work, call take_break for an appropriate interval and state what you plan to check next. A message from the user takes priority over your current plan. Do not claim to have completed actions that you have not performed.\n\nJOB.md:\n${this.jobMarkdown}\n\nWorkspace: ${this.job.workspace}\n\nRecent conversation:\n${recentMessages || '(none)'}\n\nRecent activity:\n${recentActivity || '(none)'}`
  }

  async pump() {
    if (this.pumping || !this.job || this.job.breakUntil) return
    this.pumping = true
    try {
      while (this.queue.length && !this.job.breakUntil) {
        const prompt = this.queue.shift()
        this.job.status = 'running'
        this.job.lastError = null
        this.job.currentAction = 'Thinking through the next step'
        this.persist()
        try { await this.runTurn(prompt) } catch (error) {
          this.job.status = 'error'
          this.job.lastError = error.message || String(error)
          this.job.currentAction = 'Needs attention'
          this.persist()
          break
        }
      }
      if (this.job && !this.job.breakUntil && this.job.status === 'running') {
        this.job.status = 'ready'
        this.job.currentAction = 'Ready for your next message'
        this.persist()
      }
    } finally { this.pumping = false }
  }

  async runTurn(prompt) {
    const provider = await this.provider()
    const session = provider.start(this.instructions(), prompt)
    while (true) {
      const step = await session.next()
      const calls = step.calls
      if (step.text) this.addMessage('assistant', step.text)
      if (!calls.length) {
        if (!this.queue.length) this.scheduleBreak(30, 'Check on the job again')
        return
      }
      const outputs = []
      for (const call of calls) {
        let args
        try { args = JSON.parse(call.arguments) } catch { args = {} }
        if (call.name === 'take_break') {
          if (this.queue.length) return
          const minutes = Number(args.minutes)
          const reason = String(args.reason || 'Continue the job')
          this.addActivity({ app: 'system', kind: 'break', title: 'Taking a break', detail: reason, status: 'done' })
          this.scheduleBreak(minutes, reason)
          if (!step.text) this.addMessage('assistant', `I’m taking a break. I’ll be back to ${reason.toLowerCase()}.`)
          return
        }
        const activity = this.addActivity(tools.activityFor(call.name, args))
        let result
        try {
          result = await tools.execute(call.name, args, { workspace: this.job.workspace }, (patch) => this.updateActivity(activity, patch))
          this.updateActivity(activity, { status: 'done', output: activity.output || String(result).slice(0, 30000) })
        } catch (error) {
          result = `Tool error: ${error.message || String(error)}`
          this.updateActivity(activity, { status: 'error', output: result })
        }
        this.persist()
        outputs.push({ id: call.id, output: String(result).slice(0, 80000) })
      }
      const userMessages = this.queue.splice(0)
      this.job.currentAction = 'Reviewing the result'
      this.persist()
      session.submit(outputs, userMessages, this.instructions())
    }
  }
}

module.exports = { Worker }
