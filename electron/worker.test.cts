import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import Module from 'node:module'
import type { AddressInfo } from 'node:net'
import type { Worker as KoraWorker } from './worker.cjs'
import type OpenAI from 'openai'

test('a compatible model creates JOB.md, uses a tool, and schedules the next check', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kora-worker-'))
  const project = path.join(root, 'project')
  fs.mkdirSync(project)
  fs.writeFileSync(path.join(project, 'README.md'), '# Project README')
  let requests = 0
  const server = http.createServer(async (request, response) => {
    for await (const _ of request) { /* Drain the request. */ }
    requests++
    const message: Pick<OpenAI.Chat.Completions.ChatCompletionMessage, 'role' | 'content' | 'tool_calls'> = requests === 1
      ? { role: 'assistant', content: '# Maintain this project\n\nKeep the README current.' }
      : requests === 2
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_read', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] }
        : { role: 'assistant', content: 'I reviewed the README and will check it again later.' }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ id: `chatcmpl-${requests}`, object: 'chat.completion', created: 0, model: 'local-model', choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const modules = Module as typeof Module & { _load: (request: string, parent: NodeJS.Module | undefined, isMain: boolean) => unknown }
  const load = modules._load
  modules._load = function (request, parent, isMain) {
    if (request === 'electron') return {
      app: { getPath: () => root },
      safeStorage: { isEncryptionAvailable: () => false },
    }
    return load.call(this, request, parent, isMain)
  }
  let store: typeof import('./store.cjs')
  let Worker: typeof KoraWorker
  try {
    store = require('./store.cjs') as typeof import('./store.cjs')
    Worker = (require('./worker.cjs') as typeof import('./worker.cjs')).Worker
  } finally { modules._load = load }
  let worker: KoraWorker | undefined
  try {
    store.saveSettings({ provider: 'compatible', model: 'local-model', baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, apiKey: '' })
    worker = new Worker(() => {})
    await worker.createJob({ goal: 'Maintain this project README', context: '', workspace: project })
    assert.ok(worker.job)
    const deadline = Date.now() + 5000
    while (worker.job.status !== 'sleeping' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(worker.job.status, 'sleeping')
    assert.match(fs.readFileSync(path.join(root, 'JOB.md'), 'utf8'), /Maintain this project/)
    assert.equal(worker.job.activities[0].title, 'read file · README.md')
    assert.match(worker.job.activities[0].output || '', /Project README/)
    assert.match(worker.job.messages[0].content, /I reviewed the README/)
    assert.equal(requests, 3)
    if (worker.timer) clearTimeout(worker.timer)
    worker.job.breakUntil = null
    worker.job.status = 'error'
    worker.job.lastError = '400 Multiple choices and tool calling are not supported'
    store.saveJob(worker.job)
    worker = new Worker(() => {})
    assert.ok(worker.job)
    const resumeDeadline = Date.now() + 5000
    while (worker.job.status !== 'sleeping' && Date.now() < resumeDeadline) await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(worker.job.status, 'sleeping')
    assert.equal(worker.job.lastError, null)
    assert.equal(requests, 4)
  } finally {
    if (worker?.timer) clearTimeout(worker.timer)
    delete require.cache[require.resolve('./worker.cjs')]
    delete require.cache[require.resolve('./store.cjs')]
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    fs.rmSync(root, { recursive: true, force: true })
  }
})
