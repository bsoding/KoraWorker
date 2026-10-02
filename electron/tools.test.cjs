const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execute, activityFor } = require('./tools.cjs')

test('file tools work in the selected job workspace and emit visible output', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'kora-tools-'))
  const changes = []
  const update = (change) => changes.push(change)
  try {
    const written = await execute('write_file', { path: 'notes/hello.txt', content: 'hello Kora' }, { workspace }, update)
    assert.match(written, /Wrote .*hello\.txt/)
    assert.equal(await execute('read_file', { path: 'notes/hello.txt' }, { workspace }, update), 'hello Kora')
    const files = await execute('list_files', { path: '.' }, { workspace }, update)
    assert.match(files, /hello\.txt/)
    assert.ok(changes.some((change) => change.output === 'hello Kora'))
    assert.equal(activityFor('read_file', { path: 'notes/hello.txt' }).app, 'command')
  } finally { await fs.rm(workspace, { recursive: true, force: true }) }
})

test('command tool returns the exit code and streamed output', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'kora-command-'))
  try {
    const output = await execute('run_command', { command: process.platform === 'win32' ? 'Write-Output kora-test' : 'printf kora-test', cwd: null }, { workspace }, () => {})
    assert.match(output, /Exit code: 0/)
    assert.match(output, /kora-test/)
  } finally { await fs.rm(workspace, { recursive: true, force: true }) }
})
