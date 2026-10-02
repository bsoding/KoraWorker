const tools = require('./tools.cjs')
const { randomUUID } = require('node:crypto')

function chatTools() {
  return tools.definitions.map(({ name, description, parameters }) => ({
    type: 'function',
    function: { name, description, parameters },
  }))
}

function chatText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => part.text || '').join('')
  return ''
}

function toolCallsUnsupported(error) {
  const message = String(error?.message || '')
  return Number(error?.status) === 400 && /(?:tool|function) call(?:ing|s)?.*(?:not supported|unsupported)|(?:not supported|unsupported).*(?:tool|function) call(?:ing|s)?/i.test(message)
}

function promptToolInstructions(instructions) {
  const available = tools.definitions.map(({ name, description, parameters }) =>
    `- ${name}: ${description} Arguments: ${JSON.stringify(parameters.properties)}`,
  ).join('\n')
  return `${instructions}\n\nThis API does not support native tool calls. To use Kora's tools, reply with ONLY one JSON object and no Markdown. Choose exactly one of these forms:\n{"tool":"read_file","arguments":{"path":"README.md"}}\n{"message":"Plain-language update for the user"}\nCall one tool at a time. Never describe a tool action as completed until its result is returned. Use the exact tool names and arguments listed below. When there is no immediate work, call take_break.\n\nAvailable tools:\n${available}`
}

function parsePromptToolReply(content) {
  const raw = chatText(content).trim()
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let reply
  try { reply = JSON.parse(json) } catch { throw new Error('The compatible API could not format a tool response as JSON.') }
  if (reply && typeof reply.tool === 'string' && tools.definitions.some((tool) => tool.name === reply.tool) && reply.arguments && typeof reply.arguments === 'object' && !Array.isArray(reply.arguments)) {
    return { text: '', calls: [{ id: randomUUID(), name: reply.tool, arguments: JSON.stringify(reply.arguments) }] }
  }
  if (reply && typeof reply.message === 'string') return { text: reply.message.trim(), calls: [] }
  throw new Error('The compatible API returned an invalid tool response.')
}

function asPromptMessages(messages, instructions) {
  return messages.map((message, index) => {
    if (index === 0) return { role: 'system', content: promptToolInstructions(instructions) }
    if (message.role === 'tool') return { role: 'user', content: `Tool result (${message.tool_call_id}):\n${message.content}` }
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const calls = message.tool_calls.map((call) => `${call.function.name}(${call.function.arguments})`).join(', ')
      return { role: 'assistant', content: `Tool requested: ${calls}` }
    }
    return message
  })
}

async function createProvider(config, key, clientOverride) {
  let client = clientOverride
  if (!client) {
    const { default: OpenAI } = await import('openai')
    const noKeyFetch = !key && config.provider === 'compatible'
      ? (input, init) => {
        const headers = new Headers(init?.headers)
        headers.delete('authorization')
        return fetch(input, { ...init, headers })
      }
      : undefined
    client = new OpenAI({
      apiKey: key || 'not-needed',
      baseURL: config.provider === 'compatible' ? config.baseURL : 'https://api.openai.com/v1',
      ...(noKeyFetch ? { fetch: noKeyFetch } : {}),
    })
  }

  async function complete(instructions, input) {
    if (config.provider === 'openai') {
      const response = await client.responses.create({ model: config.model, instructions, input })
      return response.output_text?.trim() || ''
    }
    const completion = await client.chat.completions.create({
      model: config.model,
      messages: [{ role: 'system', content: instructions }, { role: 'user', content: input }],
    })
    return chatText(completion.choices?.[0]?.message?.content).trim()
  }

  function start(instructions, prompt) {
    if (config.provider === 'openai') {
      let previousId = null
      let input = prompt
      let currentInstructions = instructions
      return {
        async next() {
          const response = await client.responses.create({
            model: config.model,
            instructions: currentInstructions,
            input,
            tools: tools.definitions,
            store: true,
            ...(previousId ? { previous_response_id: previousId } : {}),
          })
          previousId = response.id
          return {
            text: response.output_text?.trim() || '',
            calls: response.output.filter((item) => item.type === 'function_call').map((call) => ({ id: call.call_id, name: call.name, arguments: call.arguments })),
          }
        },
        submit(outputs, userMessages, updatedInstructions) {
          currentInstructions = updatedInstructions
          input = [
            ...outputs.map(({ id, output }) => ({ type: 'function_call_output', call_id: id, output })),
            ...userMessages.map((content) => ({ role: 'user', content })),
          ]
        },
      }
    }

    let messages = [{ role: 'system', content: instructions }, { role: 'user', content: prompt }]
    let promptTools = false
    let currentInstructions = instructions
    return {
      async next() {
        let completion
        try {
          completion = await client.chat.completions.create({ model: config.model, messages, n: 1, ...(promptTools ? {} : { tools: chatTools() }) })
        } catch (error) {
          if (promptTools || !toolCallsUnsupported(error)) throw error
          promptTools = true
          messages = asPromptMessages(messages, currentInstructions)
          completion = await client.chat.completions.create({ model: config.model, messages, n: 1 })
        }
        const message = completion.choices?.[0]?.message
        if (!message) throw new Error('The compatible API returned no assistant message.')
        if (promptTools) {
          let result
          try { result = parsePromptToolReply(message.content) }
          catch {
            messages.push({ role: 'user', content: 'Reply with one valid JSON object using either {"tool":"name","arguments":{...}} or {"message":"text"}. No Markdown or other text.' })
            completion = await client.chat.completions.create({ model: config.model, messages, n: 1 })
            result = parsePromptToolReply(completion.choices?.[0]?.message?.content)
          }
          messages.push({ role: 'assistant', content: JSON.stringify(result.calls.length ? { tool: result.calls[0].name, arguments: JSON.parse(result.calls[0].arguments) } : { message: result.text }) })
          return result
        }
        const returnedCalls = message.tool_calls || message.toolCalls || []
        const calls = returnedCalls.filter((call) => call.type === 'function').map((call) => ({ id: call.id, name: call.function.name, arguments: call.function.arguments }))
        messages.push({ role: 'assistant', content: message.content ?? null, ...(calls.length ? { tool_calls: returnedCalls } : {}) })
        return { text: chatText(message.content).trim(), calls }
      },
      submit(outputs, userMessages, updatedInstructions) {
        currentInstructions = updatedInstructions
        for (const { id, output } of outputs) messages.push(promptTools ? { role: 'user', content: `Tool result (${id}):\n${output}` } : { role: 'tool', tool_call_id: id, content: output })
        for (const content of userMessages) messages.push({ role: 'user', content })
        messages[0] = { role: 'system', content: promptTools ? promptToolInstructions(updatedInstructions) : updatedInstructions }
      },
    }
  }

  return { complete, start }
}

module.exports = { createProvider, chatTools }
