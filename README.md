# Copilot Memory

Copilot is great, but it forgets everything the moment you close VS Code. This extension gives it a memory that actually sticks — across sessions, across days, across projects.

## What it does

When you work with Copilot, important decisions get made. Which patterns to follow, which bugs to watch out for, why the code is structured the way it is. Without something to hold onto those facts, you end up re-explaining the same context every time you start a new session.

Copilot Memory stores that context locally and loads it back automatically every time VS Code starts. Copilot picks up where you left off without you having to remind it.

## How memory works

There are two ways Copilot interacts with your saved memories:

**Passively** — on startup, recent memories are written into `.github/copilot-instructions.md`. Copilot reads this file automatically, so every session starts with your project context already loaded.

**Actively** — Copilot can call `recall_memory` and `save_memory` tools mid-conversation. When you make a decision worth keeping, it saves it. When you ask about something from a previous session, it searches your memory and pulls up what's relevant.

Memories are scoped per project and stored in VS Code's local extension storage. Nothing gets committed to your repo unless you want it to.

## The `@mem` participant

For full session continuity — not just facts, but actual conversation threads — use `@mem` in Copilot Chat instead of talking to Copilot directly.

```
@mem how should we structure the auth layer?
@mem remember we decided to use JWT with 15-minute expiry
@mem remember this    ← saves your previous message
```

When you reopen VS Code after a `@mem` session, you'll get a prompt to resume where you left off. The last conversation is replayed as context so Copilot can continue naturally.

## Requirements

- VS Code 1.90 or later
- GitHub Copilot (active subscription)

## Commands

| Command | What it does |
|---|---|
| `Copilot Memory: Remember This` | Save a memory manually via a quick input |
| `Copilot Memory: Show Memories` | Browse, copy, or delete saved memories |
| `Copilot Memory: Clear Project Memories` | Wipe all memories for the current project |
| `Copilot Memory: Show Status` | Check whether semantic search is active |
| `Copilot Memory: Setup Ollama` | Run the guided Ollama setup for semantic search |

## Memory categories

When saving, you pick a category. This helps with filtering and auto-detection:

| Category | What goes here |
|---|---|
| `decision` | Architectural choices, design tradeoffs |
| `pattern` | Conventions the codebase follows |
| `context` | Background, constraints, team agreements |
| `bug` | Known issues and workarounds |

## Semantic search (optional)

By default, search is keyword-based. If you want meaning-based search — where "how do we handle authentication?" matches a memory about "JWT token validation" — you can enable it with Ollama running locally.

Toggle it on in settings:

```json
"copilotMemory.semanticSearch.enabled": true
```

The extension will walk you through installing Ollama and pulling the embedding model. Nothing gets sent to the cloud — it all runs on your machine.

The status bar shows what's active at a glance:
- `database Copilot Memory` — keyword search
- `sparkle Copilot Memory` — semantic search via Ollama
- `warning Copilot Memory` — Ollama enabled but not reachable

| Setting | Default | Description |
|---|---|---|
| `copilotMemory.semanticSearch.enabled` | `false` | Enable Ollama semantic search |
| `copilotMemory.semanticSearch.ollamaUrl` | `http://localhost:11434` | Ollama server URL |
| `copilotMemory.semanticSearch.ollamaModel` | `nomic-embed-text` | Embedding model |

## Development

```bash
git clone https://github.com/philippham/copilot-memory
cd copilot-memory
npm install
```

Open in VS Code and press `F5` to launch an Extension Development Host.

```bash
npm test    # run the test suite
```

## Publishing

```bash
npm install -g vsce
vsce package    # builds a .vsix
vsce publish    # pushes to the marketplace
```

Full publishing guide: [code.visualstudio.com/api/working-with-extensions/publishing-extension](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

## License

MIT
