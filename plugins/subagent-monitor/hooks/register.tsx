import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeKey, TurnUsage } from 'claude-code'

import type { AgentRow } from '../types'

const PANE = 'subagents'
const TITLE = 'Subagents'
const KEEP = 50

const agents = atom({ plugin: 'subagent-monitor', key: 'agents' } as const, [])
const now = atom({ plugin: 'subagent-monitor', key: 'now' } as const, 0)
const contextWindow = atom({ plugin: 'subagent-monitor', key: 'window' } as const, 0)

const ENDED: ReadonlySet<AgentRow['status']> = new Set(['completed', 'failed', 'killed'])
const isActive = (row: AgentRow) => !ENDED.has(row.status)

/** The tool argument that best says what a call is about, by the built-in tools' names for it. */
const ARG_KEYS = ['command', 'file_path', 'pattern', 'path', 'url', 'query', 'description', 'prompt', 'skill']

export function summarizeCall(tool: string, input: Readonly<Record<string, unknown>>): string {
  for (const key of ARG_KEYS) {
    const value = input[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return `${tool} ${value.replace(/\s+/g, ' ').trim()}`
    }
  }
  return tool
}

/** What the agent's next request re-sends: the last response's whole input side plus what it wrote. */
export function contextOf(usage: TurnUsage): number {
  return (
    usage.input_tokens +
    usage.cache_read_input_tokens +
    usage.cache_creation_input_tokens +
    usage.output_tokens
  )
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

const patch = ($: EngineInterface, id: string, fn: (row: AgentRow) => AgentRow) =>
  update($, agents, list => list.map(row => (row.id === id ? fn(row) : row)))

/** Adds a row for an agent first seen by id alone (spawned before a reload, or by a path no spawn hook saw). */
async function ensure($: EngineInterface, id: string): Promise<void> {
  const list = await read($, agents)
  if (list.some(row => row.id === id)) return
  const info = (await $.agent.list()).find(one => one.id === id)
  const row: AgentRow = {
    id,
    description: info?.description ?? id,
    type: info?.type ?? 'agent',
    status: info?.status ?? 'running',
    startedAt: await $.clock.now(),
    contextTokens: 0,
    steps: 0,
    toolCalls: 0,
    activity: 'starting',
  }
  await update($, agents, rows => [...rows, row].slice(-KEEP))
}

/** Each second while any agent is active: advance the clock the pane reads, and take statuses from the engine. */
async function tick($: EngineInterface): Promise<void> {
  const list = await read($, agents)
  if (!list.some(isActive)) return
  const at = await $.clock.now()
  const infos = new Map((await $.agent.list()).map(info => [info.id, info]))
  await update($, agents, rows =>
    rows.map(row => {
      const status = infos.get(row.id)?.status ?? row.status
      if (status === row.status) return row
      return { ...row, status, endedAt: ENDED.has(status) ? (row.endedAt ?? at) : undefined }
    }),
  )
  await update($, now, () => at)
  const { context } = await $.session.usage()
  await update($, contextWindow, () => context.window)
}

const STATUS_LOOK: Record<AgentRow['status'], { glyph: string; color: ThemeKey }> = {
  pending: { glyph: '○', color: 'subtle' },
  running: { glyph: '●', color: 'success' },
  waiting: { glyph: '◐', color: 'warning' },
  idle: { glyph: '◌', color: 'suggestion' },
  completed: { glyph: '✓', color: 'subtle' },
  failed: { glyph: '✗', color: 'error' },
  killed: { glyph: '■', color: 'error' },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(1000, () => void tick($))
    await $.command.register({
      name: 'subagents',
      description: 'Show what the subagents are doing, how long they have run and their context use',
    })

    return next(e)
  })

  on('command.run', { command: 'subagents' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Subagents pane opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId === undefined) return started

    const at = await $.clock.now()
    const row: AgentRow = {
      id: started.agentId,
      description: e.description,
      type: e.subagentType,
      model: started.model,
      status: 'running',
      startedAt: at,
      contextTokens: 0,
      steps: 0,
      toolCalls: 0,
      activity: 'starting',
    }
    await update($, agents, list => [...list.filter(one => one.id !== row.id), row].slice(-KEEP))
    await update($, now, () => at)
    void $.ui.open({ id: PANE, title: TITLE })

    return started
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) return next(e)
    await ensure($, e.agentId)
    await patch($, e.agentId, row => ({ ...row, status: 'running', endedAt: undefined }))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) return next(e)
    const id = e.agentId
    await ensure($, id)
    const activity = summarizeCall(e.tool, e as unknown as Record<string, unknown>)
    await patch($, id, row => ({ ...row, toolCalls: row.toolCalls + 1, activity }))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) return yield* next(e)
    const id = e.agentId
    const response = yield* next(e)
    await ensure($, id)
    await patch($, id, row => ({
      ...row,
      steps: row.steps + 1,
      model: response.usage?.model ?? row.model ?? e.model,
      contextTokens: response.usage ? contextOf(response.usage) : row.contextTokens,
      activity: response.toolUses.length === 0 && response.answer !== '' ? 'writing its answer' : row.activity,
    }))

    return response
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) return next(e)
    const id = e.agentId
    const at = await $.clock.now()
    await patch($, id, row => ({
      ...row,
      status: e.reason === 'answer' ? 'completed' : e.reason === 'aborted' ? 'killed' : 'failed',
      endedAt: at,
      activity: e.reason === 'answer' ? 'done' : e.reason,
    }))
    await update($, now, () => at)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, agents)
    const at = await read($, now)
    const win = await read($, contextWindow)
    const active = list.filter(isActive)
    const ended = list.filter(row => !isActive(row)).reverse()
    const rows = Math.max(1, (e.viewport?.rows ?? 24) - 3)
    const shown = [...active, ...ended].slice(0, Math.max(1, Math.floor(rows / 3)))

    return (
      <Box flexDirection="column">
        <Text bold>
          {active.length} active · {ended.length} finished
        </Text>
        {list.length === 0 && <Text dimColor>No subagents yet this session.</Text>}
        {shown.map(row => {
          const look = STATUS_LOOK[row.status]
          const elapsed = formatElapsed((row.endedAt ?? Math.max(at, row.startedAt)) - row.startedAt)
          const percent = win > 0 && row.contextTokens > 0 ? ` (${Math.round((row.contextTokens / win) * 100)}%)` : ''
          return (
            <Box key={row.id} flexDirection="column">
              <Text wrap="truncate-end">
                <Text color={look.color}>{look.glyph}</Text> <Text bold>{row.type}</Text> {row.description}
              </Text>
              <Text dimColor wrap="truncate-end">
                {'  '}
                {elapsed} · ctx {formatTokens(row.contextTokens)}
                {percent} · {row.toolCalls} tools · {row.steps} steps{row.model ? ` · ${row.model}` : ''}
              </Text>
              <Text dimColor={!isActive(row)} wrap="truncate-end">
                {'  ↳ '}
                {row.activity}
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
