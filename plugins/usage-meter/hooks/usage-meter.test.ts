import { expect, test } from 'claude-code/testing'

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, columns: 120 } as never
const NOW = Date.parse('2026-10-15T12:00:00Z')

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: shows context bar, both limits and their resets`, async ($, on) => {
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    on('clock.now', () => ({ value: NOW }))
    await $.session.measure({
      context: { tokens: 50_000, window: 200_000, percent: 25 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 42.5, resetsAt: '2026-10-15T14:14:00Z' },
        { kind: 'seven_day', percentUsed: 91, resetsAt: '2026-10-18T16:00:00Z' },
      ],
      changed: ['context', 'rateLimits'],
    })
    const ui = await $.ui.mount({ plugin: 'usage-meter', surface, component: 'AbovePrompt', props: PROPS })
    expect((await ui.find({ type: 'Box' }))?.text).toBe(
      `ctx ${'█'.repeat(5)}${'░'.repeat(15)} 25% 50k/200k  5h 43% (2h14m)  week 91% (3d4h)`,
    )
  })

  test(`${surface}: no countdown without a reset time, dashes before any reading`, async ($, on) => {
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    on('clock.now', () => ({ value: NOW }))
    await $.session.measure({
      context: { window: 200_000 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 7 }],
      changed: ['context', 'rateLimits'],
    })
    const ui = await $.ui.mount({ plugin: 'usage-meter', surface, component: 'AbovePrompt', props: PROPS })
    expect((await ui.find({ type: 'Box' }))?.text).toBe(`ctx ${'░'.repeat(20)} –  5h 7%  week –`)
  })
}
