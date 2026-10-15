export type Limit = { percent: number; resetsAt: number | null }

export type Meter = {
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  fiveHour: Limit | null
  weekly: Limit | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { meter: Meter | null; now: number }
  }
}
