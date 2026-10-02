const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { createProvider } = require('./provider.cjs')
const { normalizeBaseURL } = require('./store.cjs')

function completion(message) {
  return { id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: 'local-model', choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] }
}

test('compatible API uses Chat Completions, passes tool results, and omits auth when no key is set', async () => {
  const requests = []
  const server = http.createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push({ url: request.url, auth: request.headers.authorization, body: JSON.parse(body) })
    const message = requests.length === 1
      ? { role: 'assistant', content: '# Test job' }
      : requests.length === 2
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] }
        : { role: 'assistant', content: 'The README is current.' }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(completion(message)))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = server.address().port
    const provider = await createProvider({ provider: 'compatible', model: 'local-model', baseURL: `http://127.0.0.1:${port}/v1` }, '')
    assert.equal(await provider.complete('Write a job', 'Maintain this project'), '# Test job')
    const session = provider.start('You are Kora', 'Begin work')
    const first = await session.next()
    assert.deepEqual(first.calls, [{ id: 'call_1', name: 'read_file', arguments: '{"path":"README.md"}' }])
    session.submit([{ id: 'call_1', output: '# README' }], ['Please check the title too'], 'Updated instructions')
    const second = await session.next()
    assert.equal(second.text, 'The README is current.')
    assert.deepEqual(second.calls, [])
    assert.ok(requests.every((request) => request.url === '/v1/chat/completions'))
    assert.ok(requests.every((request) => !request.auth))
    assert.equal(requests[1].body.tools[0].type, 'function')
    assert.equal(requests[1].body.tools[0].function.name, 'run_command')
    assert.equal(requests[2].body.messages[2].tool_calls[0].id, 'call_1')
    assert.deepEqual(requests[2].body.messages[3], { role: 'tool', tool_call_id: 'call_1', content: '# README' })
    assert.equal(requests[2].body.messages[4].content, 'Please check the title too')
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('OpenAI path keeps Responses tool calls and previous response IDs', async () => {
  const requests = []
  const client = { responses: { create: async (request) => {
    requests.push(request)
    if (requests.length === 1) return { id: 'resp_1', output_text: '', output: [{ type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"path":"README.md"}' }] }
    return { id: 'resp_2', output_text: 'Done', output: [] }
  } } }
  const provider = await createProvider({ provider: 'openai', model: 'gpt-5.6-terra' }, 'test-key', client)
  const session = provider.start('Instructions', 'Start')
  const first = await session.next()
  assert.equal(first.calls[0].name, 'read_file')
  session.submit([{ id: 'call_1', output: 'README contents' }], [], 'New instructions')
  const second = await session.next()
  assert.equal(second.text, 'Done')
  assert.equal(requests[1].previous_response_id, 'resp_1')
  assert.deepEqual(requests[1].input, [{ type: 'function_call_output', call_id: 'call_1', output: 'README contents' }])
})

test('compatible API sends a supplied key as a bearer token', async () => {
  let authorization
  const server = http.createServer((request, response) => {
    authorization = request.headers.authorization
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(completion({ role: 'assistant', content: 'Ready' })))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const provider = await createProvider({ provider: 'compatible', model: 'remote-model', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, 'provider-secret')
    assert.equal(await provider.complete('Instructions', 'Hello'), 'Ready')
    assert.equal(authorization, 'Bearer provider-secret')
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('compatible API falls back to JSON tool protocol when a wrapper rejects native tool calls', async () => {
  const requests = []
  const server = http.createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    requests.push(input)
    response.writeHead(input.tools ? 400 : 200, { 'content-type': 'application/json' })
    if (input.tools) {
      response.end(JSON.stringify({ error: { message: 'Multiple choices and tool calling are not supported', type: 'invalid_request_error' } }))
      return
    }
    const content = requests.length === 2
      ? '{"tool":"read_file","arguments":{"path":"README.md"}}'
      : '{"message":"I checked the README."}'
    response.end(JSON.stringify(completion({ role: 'assistant', content })))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const provider = await createProvider({ provider: 'compatible', model: 'gemini-wrapper', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, '')
    const session = provider.start('You are Kora', 'Check the README')
    const first = await session.next()
    assert.deepEqual(first.calls.map(({ name, arguments: args }) => ({ name, arguments: JSON.parse(args) })), [{ name: 'read_file', arguments: { path: 'README.md' } }])
    session.submit([{ id: first.calls[0].id, output: '# Project README' }], [], 'Updated instructions')
    assert.deepEqual(await session.next(), { text: 'I checked the README.', calls: [] })
    assert.equal(requests.length, 3)
    assert.equal(requests[0].n, 1)
    assert.ok(requests[0].tools.length > 0)
    assert.equal(requests[1].tools, undefined)
    assert.match(requests[1].messages[0].content, /does not support native tool calls/)
    assert.match(requests[2].messages[2].content, /read_file/)
    assert.match(requests[2].messages[3].content, /# Project README/)
    assert.ok(requests[2].messages.every((message) => message.role !== 'tool'))
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('base URL accepts the standard endpoint form and rejects unsafe protocols', () => {
  assert.equal(normalizeBaseURL('http://localhost:11434/v1/chat/completions'), 'http://localhost:11434/v1')
  assert.equal(normalizeBaseURL('https://api.example.com/v1/'), 'https://api.example.com/v1')
  assert.throws(() => normalizeBaseURL('file:///tmp/local'), /http or https/)
})
