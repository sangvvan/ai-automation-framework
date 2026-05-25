/**
 * MCP server entrypoint.
 *
 * Usage (stdio — for Claude Desktop / MCP clients):
 *   node scripts/mcp-server.ts
 *   vite-node scripts/mcp-server.ts
 *
 * Environment variables needed by the AI providers:
 *   CLAUDE_API_KEY       — Anthropic Claude (default provider)
 *   GEMINI_API_KEY       — Google Gemini
 *   CODEX_API_KEY        — OpenAI Codex
 *   OPENCODE_API_URL     — Self-hosted OpenCode / Ollama
 *
 * Optional overrides:
 *   AI_TEST_DEFAULT_PROVIDER=claude|gemini|codex|mock
 *   AI_TEST_HEADLESS=false    (show browser window)
 *   AI_TEST_MAX_SCENARIOS=10
 */

import "dotenv/config";
import { startStdioServer } from "../lib/mcp/server.js";

startStdioServer().catch((err) => {
  process.stderr.write(`MCP server fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
