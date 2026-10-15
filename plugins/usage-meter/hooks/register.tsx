import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Limit, Meter } from '../types'

const meter = atom({ plugin: 'usage-meter', key: 'meter' } as const, null)
// Wall clock as of the last tick: the reset countdowns redraw when it moves.
const now = atom({ plugin: 'usage-meter', key: 'now' } as const, 0)

const BAR_CELLS = 20
const TICK_MS = 60_000

const toLimit = (r: SessionRateLimit | undefined): Limit | null =>
  r === undefined ? null : { percent: r.percentUsed, resetsAt: r.resetsAt ? Date.parse(r.resetsAt) : null }

const toMeter = (context: SessionContextUsage, rateLimits: SessionRateLimit[]): Meter => ({
  contextPercent: context.percent ?? null,
  contextTokens: context.tokens ?? null,
  contextWindow: context.window,
  fiveHour: toLimit(rateLimits.find(r => r.kind === 'five_hour')),
  weekly: toLimit(rateLimits.find(r => r.kind === 'seven_day')),
})

const bar = (percent: number) => {
  const filled = Math.round((Math.min(Math.max(percent, 0), 100) / 100) * BAR_CELLS)
  return { filled: '█'.repeat(filled), empty: '░'.repeat(BAR_CELLS - filled) }
}

const levelColor = (percent: number | null) =>
  percent === null ? undefined : percent >= 90 ? 'red' : percent >= 70 ? 'yellow' : 'green'

const kTokens = (n: number) => `${Math.round(n / 1000)}k`

// Time left as its two largest units: 3d4h, 2h14m, 9m.
const until = (resetsAt: number, at: number) => {
  const minutes = Math.max(0, Math.ceil((resetsAt - at) / 60_000))
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  return d > 0 ? `${d}d${h}h` : h > 0 ? `${h}h${m}m` : `${m}m`
}

const limitText = (limit: Limit | null, at: number) =>
  limit === null
    ? '–'
    : `${Math.round(limit.percent)}%${limit.resetsAt === null ? '' : ` (${until(limit.resetsAt, at)})`}`

const tick = async ($: EngineInterface) => {
  const t = await $.clock.now()
  await update($, now, () => t)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const usage = await $.session.usage()
    await update($, meter, () => toMeter(usage.context, usage.rateLimits))
    await tick($)
    $.clock.every(TICK_MS, () => tick($))
    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, meter, () => toMeter(e.context, e.rateLimits))
    await tick($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, meter)
    if (e.props.hasSurvey || m === null) {
      return next(e)
    }

    const at = await read($, now)
    const { Box, Text } = $.ui.resolve(e)
    const pct = m.contextPercent
    const { filled, empty } = bar(pct ?? 0)
    const tokens = m.contextTokens === null ? '' : ` ${kTokens(m.contextTokens)}/${kTokens(m.contextWindow)}`

    return (
      <Box>
        <Text>
          <Text dimColor>ctx </Text>
          <Text color={levelColor(pct)}>{filled}</Text>
          <Text dimColor>{empty}</Text>
          <Text> {pct === null ? '–' : `${pct}%`}{tokens}</Text>
          <Text dimColor>  5h </Text>
          <Text color={levelColor(m.fiveHour?.percent ?? null)}>{limitText(m.fiveHour, at)}</Text>
          <Text dimColor>  week </Text>
          <Text color={levelColor(m.weekly?.percent ?? null)}>{limitText(m.weekly, at)}</Text>
        </Text>
      </Box>
    )
  })
}
