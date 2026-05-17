#!/usr/bin/env bash
# scripts/setup_opencode_ollama.sh
# Setup for OpenCode + Ollama integration.
# Run this once, then use provider "opencode-ollama" in agent.config
#
# Usage: bash scripts/setup_opencode_ollama.sh

set +e

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
info() { echo -e "${BLUE}  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
err()  { echo -e "${RED}✗ $1${NC}"; }

echo ""
echo -e "${BLUE}══ OpenCode + Ollama Setup ══${NC}"
echo ""

# ── 1. Check OpenCode ────────────────────────────────────────
if command -v opencode &>/dev/null; then
  VER=$(opencode --version 2>/dev/null || echo "unknown")
  ok "OpenCode already installed ($VER)"
else
  info "Installing OpenCode..."
  if command -v npm &>/dev/null; then
    npm install -g opencode-ai
    ok "OpenCode installed via npm"
  elif command -v brew &>/dev/null; then
    brew install anomalyco/tap/opencode
    ok "OpenCode installed via brew"
  else
    info "Trying universal installer..."
    curl -fsSL https://opencode.ai/install | bash
    ok "OpenCode installed"
  fi
fi

# ── 2. Check Ollama is running ───────────────────────────────
source .agent/config/agent.config 2>/dev/null || true
OLLAMA_URL="${OLLAMA_API_URL:-http://localhost:11434/v1}"
OLLAMA_BASE=$(echo "$OLLAMA_URL" | sed 's|/v1$||')

info "Checking Ollama at $OLLAMA_BASE..."
if curl -s "$OLLAMA_BASE/api/tags" | grep -q '"name"'; then
  MODELS=$(curl -s "$OLLAMA_BASE/api/tags" | python3 -c "
import json,sys
data=json.load(sys.stdin)
for m in data.get('models',[]):
    print(' ', m.get('name',''))
" 2>/dev/null)
  ok "Ollama running"
  echo ""
  echo "  Available models:"
  echo "$MODELS"
  echo ""

  FIRST_MODEL=$(curl -s "$OLLAMA_BASE/api/tags" | python3 -c "
import json,sys
data=json.load(sys.stdin)
models=data.get('models',[])
print(models[0]['name'].split(':')[0] + ':' + models[0]['name'].split(':')[-1] if models else '')
" 2>/dev/null)
else
  warn "Ollama not running at $OLLAMA_BASE"
  echo "  Install: https://ollama.com"
  echo "  Start:   ollama serve"
  echo "  Pull:    ollama pull qwen3:8b"
  echo ""
  FIRST_MODEL="${OLLAMA_MODEL:-qwen3:8b}"
fi

MODEL_ID="${OLLAMA_MODEL:-$FIRST_MODEL}"
MODEL_ID="${MODEL_ID:-qwen3:8b}"

# ── 3. Write opencode-ollama config ──────────────────────────
OPENCODE_CONFIG=".opencode-ollama/config.json"
mkdir -p .opencode-ollama

cat > "$OPENCODE_CONFIG" << JSONEOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "ollama/$MODEL_ID",
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (local)",
      "options": {
        "baseURL": "$OLLAMA_URL"
      },
      "models": {
        "$MODEL_ID": {
          "name": "$MODEL_ID"
        }
      }
    }
  }
}
JSONEOF
ok "Written: $OPENCODE_CONFIG"
info "Model: $MODEL_ID @ $OLLAMA_URL"

# ── 4. Update agent.config with detected model ──────────────
CONFIG=".agent/config/agent.config"
if [ -f "$CONFIG" ]; then
  python3 -c "
with open('$CONFIG') as f:
    c = f.read()
if '$FIRST_MODEL' and 'OLLAMA_MODEL=' in c:
    import re
    c = re.sub(r'OLLAMA_MODEL=.*', 'OLLAMA_MODEL=$MODEL_ID', c)
with open('$CONFIG', 'w') as f:
    f.write(c)
print('Updated OLLAMA_MODEL in agent.config')
" 2>/dev/null && ok "agent.config updated"
fi

# ── 5. Test opencode with Ollama ─────────────────────────────
echo ""
info "Testing OpenCode with Ollama..."
if command -v opencode &>/dev/null; then
  export OPENCODE_CONFIG="$(pwd)/$OPENCODE_CONFIG"
  RESULT=$(opencode run "say 'OpenCode Ollama OK' and nothing else" 2>/dev/null | tail -3)
  if [ -n "$RESULT" ]; then
    ok "OpenCode + Ollama working!"
    echo "  Response: $RESULT"
  else
    warn "OpenCode ran but got no output — check Ollama has a model loaded"
  fi
else
  warn "opencode command not found — restart terminal and try again"
fi

# ── 6. Summary ───────────────────────────────────────────────
echo ""
echo -e "${GREEN}══ Setup complete ══${NC}"
echo ""
echo "  Ollama is now available as provider 'opencode-ollama'."
echo ""
echo "  Fallback chain: codex → opencode (LM Studio) → opencode-ollama (Ollama)"
echo ""
echo "  To use Ollama directly for implementation:"
echo "    IMPLEMENT_PROVIDER=opencode-ollama"
echo ""
echo "  To use for run_local_tasks.py:"
echo "    LOCAL_BACKEND=ollama python3 scripts/run_local_tasks.py"
echo ""
echo "  To update model, edit: $OPENCODE_CONFIG"
echo "  To re-run setup:       bash scripts/setup_opencode_ollama.sh"
echo ""
