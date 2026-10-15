import { expect, mock, test } from 'claude-code/testing'

import { contextOf, formatElapsed, formatTokens, summarizeCall } from '../hooks/register'

test('formats elapsed time and token counts', async () => {
  expect(formatElapsed(42_000)).toBe('42s')
  expect(formatElapsed(185_000)).toBe('3m 05s')
  expect(formatElapsed(3_720_000)).toBe('1h 02m')
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(4_321)).toBe('4.3k')
  expect(formatTokens(48_200)).toBe('48k')
})

test('summarizes a call by its telling argument', async () => {
  expect(summarizeCall('Bash', { command: 'cargo  test\n--lib' })).toBe('Bash cargo test --lib')
  expect(summarizeCall('Read', { file_path: '/a/b.rs', limit: 10 })).toBe('Read /a/b.rs')
  expect(summarizeCall('TodoWrite', { todos: [] })).toBe('TodoWrite')
})

test('context is the whole input side plus the output', async () => {
  expect(
    contextOf({
      model: 'm',
      input_tokens: 10,
      cache_read_input_tokens: 30_000,
      cache_creation_input_tokens: 2_000,
      output_tokens: 500,
    }),
  ).toBe(32_510)
})

test('the pane follows a subagent from spawn through its tool calls and usage to its end', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'Find the PWM setup', type: 'Explore', status: 'running' as const }],
  }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: {}, cost: {} } }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'tool_use' as const,
      usage: {
        model: 'claude-sonnet-5-5',
        input_tokens: 0,
        cache_read_input_tokens: 40_000,
        cache_creation_input_tokens: 9_000,
        output_tokens: 1_000,
      },
    }
  })

  on('turn.complete', () => ({ text: 'done' }))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('session.start', (_$, e) => e as never)
  await $.session.start({ source: 'startup', cwd: '/repo' } as never)
  await $.agent.spawn({
    tool_use_id: 't0',
    prompt: 'Find where the PWM timer is configured',
    description: 'Find the PWM setup',
    subagentType: 'Explore',
  } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'TIM1', agentId: 'a1' } as never)
  const step = $.turn.step({ turnId: 'u1', index: 0, model: 'claude-sonnet-5-5', messageCount: 3, agentId: 'a1' })
  for await (const _ of step) void _
  await clock.advance(65_000)

  const pane = await $.ui.mount({
    plugin: 'subagent-monitor',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'subagents',
    props: { title: 'Subagents' },
    viewport: { columns: 120, rows: 30 },
  } as never)
  expect(await pane.find({ type: 'Text', text: 'Find the PWM setup' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /1m 05s · ctx 50k \(25%\) · 1 tools · 1 steps/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Grep TIM1' })).toBeDefined()

  await $.turn.complete({ turnId: 'u1', agentId: 'a1', answer: 'done', reason: 'answer' } as never)
  expect(await pane.find({ type: 'Text', text: /0 active · 1 finished/ })).toBeDefined()
})
