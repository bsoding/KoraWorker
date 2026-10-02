const fs = require('node:fs')
const path = require('node:path')
const { app, safeStorage } = require('electron')

const sessionKeys = { openai: '', compatible: '' }

function dataRoot() {
  const root = app.getPath('userData')
  fs.mkdirSync(root, { recursive: true })
  return root
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeJson(file, value) {
  const temp = `${file}.tmp`
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(temp, file)
}

function normalizeBaseURL(raw) {
  let url
  try { url = new URL(String(raw || '').trim()) } catch { throw new Error('Enter a valid API base URL, such as http://localhost:11434/v1.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('The API base URL must use http or https and cannot contain credentials.')
  }
  if (url.search || url.hash) throw new Error('Enter the API base URL without query parameters or a fragment.')
  url.pathname = url.pathname.replace(/\/(?:chat\/completions|responses)\/?$/i, '') || '/'
  return url.toString().replace(/\/$/, '')
}

function settings() {
  const saved = readJson(path.join(dataRoot(), 'settings.json'), {})
  const provider = saved.provider === 'compatible' ? 'compatible' : 'openai'
  const openaiModel = saved.openaiModel || saved.model || 'gpt-5.6-terra'
  const compatibleModel = saved.compatibleModel || ''
  const compatibleBaseURL = saved.compatibleBaseURL || ''
  return {
    provider,
    openaiModel,
    compatibleModel,
    compatibleBaseURL,
    model: provider === 'openai' ? openaiModel : compatibleModel,
    baseURL: provider === 'compatible' ? compatibleBaseURL : '',
  }
}

function apiKey(provider = settings().provider) {
  if (sessionKeys[provider]) return sessionKeys[provider]
  const filenames = provider === 'openai' ? ['openai-api-key.bin', 'api-key.bin'] : ['compatible-api-key.bin']
  if (safeStorage.isEncryptionAvailable()) {
    for (const name of filenames) {
      try {
        const secretPath = path.join(dataRoot(), name)
        if (fs.existsSync(secretPath)) return safeStorage.decryptString(fs.readFileSync(secretPath))
      } catch { /* The key can be replaced in Settings. */ }
    }
  }
  return provider === 'openai' ? process.env.OPENAI_API_KEY || '' : process.env.KORA_COMPATIBLE_API_KEY || ''
}

function saveSettings(input) {
  const previous = settings()
  const provider = input.provider === 'compatible' ? 'compatible' : 'openai'
  const model = String(input.model || '').trim()
  if (!model) throw new Error('Enter a model ID for this provider.')
  const next = {
    provider,
    openaiModel: provider === 'openai' ? model : previous.openaiModel,
    compatibleModel: provider === 'compatible' ? model : previous.compatibleModel,
    compatibleBaseURL: provider === 'compatible' ? normalizeBaseURL(input.baseURL) : previous.compatibleBaseURL,
  }
  writeJson(path.join(dataRoot(), 'settings.json'), next)
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    const key = input.apiKey.trim()
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(path.join(dataRoot(), `${provider}-api-key.bin`), safeStorage.encryptString(key))
      sessionKeys[provider] = ''
    } else {
      sessionKeys[provider] = key
    }
  }
  return publicSettings()
}

function publicSettings() {
  return {
    ...settings(),
    hasApiKey: Boolean(apiKey()),
    openaiHasApiKey: Boolean(apiKey('openai')),
    compatibleHasApiKey: Boolean(apiKey('compatible')),
    keyStorage: safeStorage.isEncryptionAvailable() ? 'encrypted' : 'session',
  }
}

function jobPath() { return path.join(dataRoot(), 'job.json') }
function loadJob() { return readJson(jobPath(), null) }
function saveJob(job) { writeJson(jobPath(), job) }
function jobMarkdownPath() { return path.join(dataRoot(), 'JOB.md') }
function saveJobMarkdown(markdown) { fs.writeFileSync(jobMarkdownPath(), markdown, 'utf8') }
function loadJobMarkdown() {
  try { return fs.readFileSync(jobMarkdownPath(), 'utf8') } catch { return '' }
}

module.exports = { dataRoot, apiKey, settings, publicSettings, saveSettings, normalizeBaseURL, loadJob, saveJob, loadJobMarkdown, saveJobMarkdown }
