# Gobot Changelog

## v2.1.0 — 2026-02-12

**Smart Routing + Streaming Progress + Agent SDK**

- **Tiered model routing** — Messages auto-classified by complexity: Haiku (simple, fast, cheap), Sonnet (medium), Opus (complex, powerful). ~60% of messages route to Haiku, saving 50-60% on VPS API costs.
- **Streaming progress updates (Mac)** — Complex tasks show real-time progress in Telegram: which tools are being used, Claude's initial plan. Progress updates in-place and disappears when done. Simple messages respond instantly.
- **Agent SDK on VPS (optional)** — Full Claude Code capabilities for Sonnet/Opus VPS requests. Loads your MCP servers, skills, hooks, and CLAUDE.md. Enable with `USE_AGENT_SDK=true`.
- **Human-in-the-loop everywhere** — Inline button confirmations work consistently across Mac (subprocess resume), VPS direct API (messages snapshot), and VPS Agent SDK (session resume).
- **Daily budget tracking (VPS)** — Set `DAILY_API_BUDGET` to cap daily spend. Auto-downgrades Opus→Sonnet when budget runs low.

### New Files
- `src/lib/model-router.ts` — Complexity classifier + tiered model selection
- `src/lib/agent-session.ts` — Agent SDK wrapper for VPS mode

### Updated
- `src/lib/claude.ts` — Added `callClaudeStreaming()` with JSONL parsing and progress callbacks
- `src/bot.ts` — Streaming progress for complex messages, model tier routing
- `src/vps-gateway.ts` — Tiered routing: Haiku→direct API, Sonnet/Opus→Agent SDK
- `src/lib/anthropic-processor.ts` — Accepts optional model parameter
- `.env.example` — Added `USE_AGENT_SDK`, `DAILY_API_BUDGET`
- `CLAUDE.md` — Documented tiered routing, Agent SDK, streaming progress

### Compatibility
- Fully backward compatible. No config changes required.
- Local-only: `git pull && bun install` — new features work automatically.
- VPS: model routing active immediately. Agent SDK is opt-in.

---

## v2.0.0 — 2026-02-09

**VPS Gateway + Hybrid Mode**

- VPS gateway mode (`bun run vps`) — Anthropic Messages API with built-in tools
- Hybrid mode — VPS forwards to local machine when awake, processes directly when offline
- Human-in-the-loop tools: ask user confirmation, phone calls
- Human-in-the-loop — Claude asks confirmation via inline Telegram buttons before acting
- Voice on VPS — transcription, TTS replies, and outbound phone calls
- Auto-deploy via GitHub webhook
- Local machine health checking with heartbeat failover

### New Files
- `src/vps-gateway.ts` — VPS entry point (webhook mode)
- `src/lib/anthropic-processor.ts` — Anthropic API with tool definitions
- `src/lib/mac-health.ts` — Local machine health checking
- `src/lib/task-queue.ts` — Human-in-the-loop task management
- `deploy.sh` — Auto-deploy script

### Updated
- `src/lib/voice.ts` — Added transcript summarization + voice agent context
- `src/lib/transcribe.ts` — Added buffer-based transcription for VPS
- `src/lib/supabase.ts` — Added async tasks + node heartbeat functions
- `db/schema.sql` — Added async_tasks + node_heartbeat tables
- `.env.example` — Full VPS/hybrid mode documentation

---

## v1.0.0 — 2026-01-15

**Core Relay + Multi-Agent System**

- Telegram relay with Claude Code CLI subprocess
- 6 specialized AI agents (General, Research, Content, Finance, Strategy, Critic)
- Forum topic routing for multi-agent system
- Persistent memory via Supabase (facts, goals, conversation history)
- Smart check-ins with context-aware decision making
- Morning briefings with goals and MCP server context
- Always-on services via launchd (macOS) / PM2 (Windows/Linux)
- Fallback LLM chain: Claude → OpenRouter → Ollama
- Voice replies (ElevenLabs TTS)
- Phone calls (ElevenLabs + Twilio)
- Audio transcription (Gemini)
- Cross-platform support (macOS, Windows, Linux)
