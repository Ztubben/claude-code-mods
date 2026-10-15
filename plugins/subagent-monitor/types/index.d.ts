export type AgentRow = {
  id: string
  description: string
  type: string
  model?: string
  status: 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
  startedAt: number
  endedAt?: number
  /** Tokens the agent's last model request was answered over, plus its output: what its next request re-sends. */
  contextTokens: number
  steps: number
  toolCalls: number
  /** What it is doing now: its latest tool call, summarized. */
  activity: string
}

declare module 'claude-code' {
  interface PluginState {
    'subagent-monitor': { agents: AgentRow[]; now: number; window: number }
  }
}
