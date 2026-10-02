const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')

test('existing OpenAI settings migrate and compatible credentials stay separate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kora-settings-'))
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ model: 'gpt-existing' }))
  fs.writeFileSync(path.join(root, 'api-key.bin'), Buffer.from('old-openai-key'))
  const load = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return {
      app: { getPath: () => root },
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
    }
    return load.call(this, request, parent, isMain)
  }
  let store
  try { store = require('./store.cjs') } finally { Module._load = load }
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
