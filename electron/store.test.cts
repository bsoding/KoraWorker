import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Module from 'node:module'

test('existing OpenAI settings migrate and compatible credentials stay separate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kora-settings-'))
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ model: 'gpt-existing' }))
  fs.writeFileSync(path.join(root, 'api-key.bin'), Buffer.from('old-openai-key'))
  const modules = Module as typeof Module & { _load: (request: string, parent: NodeJS.Module | undefined, isMain: boolean) => unknown }
  const load = modules._load
  modules._load = function (request, parent, isMain) {
    if (request === 'electron') return {
      app: { getPath: () => root },
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
    }
    return load.call(this, request, parent, isMain)
  }
  let store: typeof import('./store.cjs')
  try { store = require('./store.cjs') as typeof import('./store.cjs') } finally { modules._load = load }
  try {
    assert.equal(store.settings().provider, 'openai')
    assert.equal(store.settings().model, 'gpt-existing')
    assert.equal(store.apiKey('openai'), 'old-openai-key')
    const compatible = store.saveSettings({ provider: 'compatible', model: 'local-model', baseURL: 'http://localhost:11434/v1/chat/completions', apiKey: 'local-key' })
    assert.equal(compatible.baseURL, 'http://localhost:11434/v1')
    assert.equal(store.apiKey('compatible'), 'local-key')
    assert.equal(store.apiKey('openai'), 'old-openai-key')
    const openai = store.saveSettings({ provider: 'openai', model: 'gpt-new', apiKey: 'new-openai-key' })
    assert.equal(openai.model, 'gpt-new')
    assert.equal(store.apiKey('openai'), 'new-openai-key')
    assert.equal(store.settings().compatibleModel, 'local-model')
    assert.ok(!fs.readFileSync(path.join(root, 'settings.json'), 'utf8').includes('local-key'))
  } finally {
    delete require.cache[require.resolve('./store.cjs')]
    fs.rmSync(root, { recursive: true, force: true })
  }
})
