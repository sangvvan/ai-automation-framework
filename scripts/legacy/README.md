# scripts/legacy — Deprecated Shell/Python Orchestration

These scripts were the original way to invoke SDLC agents via the terminal.
They have been **superseded** by Claude Code slash commands and `AGENTS.md`.

## Do NOT use these scripts for new work

| Old command | New equivalent |
|---|---|
| `./scripts/run.sh /ps "..."` | `/ps` in Claude Code |
| `./scripts/run.sh /ba REQ-001` | `/ba REQ-001` in Claude Code |
| `./scripts/run.sh /advisor` | `/advisor` in Claude Code |
| `./scripts/run.sh /planning REQ-001` | `/planning REQ-001` in Claude Code |
| `./scripts/run.sh /design US-001` | `/design US-001` in Claude Code |
| `./scripts/run.sh /feature REQ-001` | `/feature REQ-001` in Claude Code |
| `./scripts/run.sh /implement TASK-001` | `codex -a never "implement TASK-001"` |
| `./scripts/run.sh /qa US-001` | `codex -a never "qa US-001"` |
| `./scripts/run.sh /devops` | `codex -a never "devops — open PR"` |
| `./scripts/run.sh /sprint start SPRINT-001` | `/sprint execute SPRINT-001` in Claude Code |
| `./scripts/run.sh /status` | `/status` in Claude Code |

## Why kept

Archived (not deleted) for reference if you need to understand the previous
orchestration logic or roll back to script-based invocation.

## Current workflow

See `CLAUDE.md` → Quick Start section for the two-tool workflow.
