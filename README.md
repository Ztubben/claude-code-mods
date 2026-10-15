# claude-code-mods

Mods and other artifacts for Claude Code. Each mod lives in `plugins/<name>/`;
the repository is a plugin marketplace listing them in
`.claude-plugin/marketplace.json`.

## Mods

| Mod | What it does |
| --- | --- |
| `usage-meter` | A band above the prompt: a context-window progress bar, plus the 5h and weekly usage limits as percentages with the time until each resets. |
| `subagent-monitor` | A pane (`/subagents`, or opens by itself when a subagent starts) listing each subagent: its status, what it is doing now, how long it has run, and how much context it holds. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-meter --marketplace Ztubben/claude-code-mods
/plugin install subagent-monitor --marketplace Ztubben/claude-code-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```
claude plugin install usage-meter --marketplace Ztubben/claude-code-mods
claude plugin install subagent-monitor --marketplace Ztubben/claude-code-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box,
then Plugins, Add marketplace with `Ztubben/claude-code-mods`, then Add plugin.
