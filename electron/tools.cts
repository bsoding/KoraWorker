import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { load } from 'cheerio'
import type { FunctionTool } from 'openai/resources/responses/responses'
import type { ActivityInput, ActivityUpdate } from '../src/types.js'

export type ToolArguments = Record<string, unknown>
export type UpdateActivity = (patch: ActivityUpdate) => void

const schema = (properties: Record<string, Record<string, unknown>>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const string = (description: string) => ({ type: 'string', description })

export const definitions: (FunctionTool & { description: string; parameters: ReturnType<typeof schema> })[] = [
  { type: 'function', name: 'run_command', description: 'Run a shell command in the job workspace. Use this for project work, git, and other command line tasks.', strict: true, parameters: schema({ command: string('The complete shell command.'), cwd: { type: ['string', 'null'], description: 'Working directory, or null to use the job workspace.' } }) },
  { type: 'function', name: 'list_files', description: 'List files in a directory, up to two levels deep.', strict: true, parameters: schema({ path: string('Absolute path or path relative to the job workspace.') }) },
  { type: 'function', name: 'read_file', description: 'Read a UTF-8 text file.', strict: true, parameters: schema({ path: string('Absolute path or path relative to the job workspace.') }) },
  { type: 'function', name: 'write_file', description: 'Write a UTF-8 text file, creating parent directories if necessary.', strict: true, parameters: schema({ path: string('Absolute path or path relative to the job workspace.'), content: string('Complete new file contents.') }) },
  { type: 'function', name: 'search_web', description: 'Search the web and return results with titles, URLs, and summaries.', strict: true, parameters: schema({ query: string('Web search query.') }) },
  { type: 'function', name: 'open_page', description: 'Visit a web page and read its title, text, and links.', strict: true, parameters: schema({ url: string('The full http or https URL.') }) },
  { type: 'function', name: 'take_break', description: 'Pause work for a number of minutes. You will be resumed with the message “Wait over.”', strict: true, parameters: schema({ minutes: { type: 'number', description: 'How many minutes to wait; can be fractional.' }, reason: string('What you will check or do when the break ends.') }) },
]

function stringArgument(args: ToolArguments, key: string): string {
  const value = args[key]
  if (typeof value !== 'string') throw new Error(`Tool argument ${key} must be a string.`)
  return value
}

function resolvePath(workspace: string, candidate: string) { return path.resolve(workspace, candidate) }

export async function listFiles(root: string) {
  const results: string[] = []
  async function visit(dir: string, depth: number) {
    if (results.length >= 200 || depth > 2) return
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (results.length >= 200) break
      if (['.git', 'node_modules', 'dist', 'dist-node', 'release', '.next'].includes(entry.name)) continue
      const full = path.join(dir, entry.name)
      results.push(`${entry.isDirectory() ? 'dir ' : 'file'} ${full}`)
      if (entry.isDirectory()) await visit(full, depth + 1)
    }
  }
  await visit(root, 0)
  return results.join('\n') || '(empty directory)'
}

function runCommand(command: string, cwd: string, update: UpdateActivity): Promise<string> {
  return new Promise((resolve) => {
    const windows = process.platform === 'win32'
    const shell = windows ? 'powershell.exe' : '/bin/sh'
    const args = windows ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-lc', command]
    let output = ''
    let lastPush = 0
    const child = spawn(shell, args, { cwd, windowsHide: true, env: process.env })
    const onChunk = (chunk: Buffer) => {
      output += chunk.toString('utf8')
      if (output.length > 120000) output = output.slice(-120000)
      if (Date.now() - lastPush > 70) { update({ output }); lastPush = Date.now() }
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.on('error', (error) => resolve(`Command failed to start: ${error.message}`))
    child.on('close', (code) => {
      update({ output })
      resolve(`Exit code: ${code}\n${output || '(no output)'}`)
    })
  })
}

async function searchWeb(query: string, update: UpdateActivity) {
  const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`
  update({ url })
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 KoraWorker/0.1' }, signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`Search returned HTTP ${response.status}`)
  const xml = await response.text()
  const $ = load(xml, { xmlMode: true })
  const results = $('item').slice(0, 8).map((_, item) => ({
    title: $(item).find('title').first().text(),
    url: $(item).find('link').first().text(),
    summary: $(item).find('description').first().text().replace(/<[^>]*>/g, ''),
  })).get()
  update({ results, output: results.map((r) => `${r.title}\n${r.url}\n${r.summary}`).join('\n\n') })
  return results.length ? JSON.stringify(results) : 'No search results were returned.'
}

async function openPage(rawUrl: string, update: UpdateActivity) {
  const url = new URL(rawUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https URLs can be opened.')
  update({ url: url.toString() })
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 KoraWorker/0.1' }, signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`Page returned HTTP ${response.status}`)
  const html = await response.text()
  const $ = load(html)
  $('script, style, noscript, svg, nav, footer, header').remove()
  const title = $('title').first().text().trim() || url.hostname
  const excerpt = $('main, article').first().text().replace(/\s+/g, ' ').trim() || $('body').text().replace(/\s+/g, ' ').trim()
  const links = $('a[href]').slice(0, 30).map((_, anchor) => {
    try {
      const href = $(anchor).attr('href')
      if (!href) return null
      return { title: $(anchor).text().replace(/\s+/g, ' ').trim(), url: new URL(href, response.url).toString() }
    } catch { return null }
  }).get().filter((link): link is { title: string; url: string } => Boolean(link && link.title && /^https?:/.test(link.url)))
  const page = { title, url: response.url, excerpt: excerpt.slice(0, 16000), links }
  update({ url: response.url, page, output: `${title}\n${response.url}\n${excerpt.slice(0, 2000)}` })
  return JSON.stringify(page)
}

export async function execute(name: string, args: ToolArguments, context: { workspace: string }, update: UpdateActivity): Promise<string> {
  const workspace = context.workspace
  switch (name) {
    case 'run_command': return runCommand(stringArgument(args, 'command'), args.cwd ? resolvePath(workspace, stringArgument(args, 'cwd')) : workspace, update)
    case 'list_files': {
      const root = resolvePath(workspace, stringArgument(args, 'path'))
      const result = await listFiles(root)
      update({ output: result })
      return result
    }
    case 'read_file': {
      const file = resolvePath(workspace, stringArgument(args, 'path'))
      const result = (await fs.readFile(file, 'utf8')).slice(0, 60000)
      update({ output: result })
      return result
    }
    case 'write_file': {
      const file = resolvePath(workspace, stringArgument(args, 'path'))
      const content = stringArgument(args, 'content')
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, content, 'utf8')
      const result = `Wrote ${file} (${content.length} characters)`
      update({ output: result })
      return result
    }
    case 'search_web': return searchWeb(stringArgument(args, 'query'), update)
    case 'open_page': return openPage(stringArgument(args, 'url'), update)
    default: throw new Error(`Unknown tool: ${name}`)
  }
}

export function activityFor(name: string, args: ToolArguments): ActivityInput {
  if (name === 'search_web') return { app: 'browser', kind: 'search', title: `Searching for “${args.query}”`, detail: String(args.query) }
  if (name === 'open_page') return { app: 'browser', kind: 'page', title: 'Opening a page', detail: String(args.url), url: String(args.url) }
  if (name === 'run_command') return { app: 'command', kind: 'command', title: String(args.command), detail: String(args.cwd || 'Job workspace') }
  return { app: 'command', kind: 'file', title: `${name.replace('_', ' ')} · ${args.path}`, detail: String(args.path) }
}
