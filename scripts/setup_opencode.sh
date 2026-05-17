#!/usr/bin/env bash
# scripts/setup_opencode.sh
# One-time setup for OpenCode + LM Studio integration.
# Run this once, then flip IMPLEMENT_PROVIDER=opencode in agent.config
#
# Usage: bash scripts/setup_opencode.sh

set +e

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
info() { echo -e "${BLUE}  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
err()  { echo -e "${RED}✗ $1${NC}"; }

echo ""
echo -e "${BLUE}══ OpenCode Setup ══${NC}"
echo ""

# ── 1. Install OpenCode ────────────────────────────────────────
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

# ── 2. Check LM Studio is running ─────────────────────────────
source .agent/config/agent.config 2>/dev/null || true
LM_URL="${LOCAL_API_URL:-http://localhost:1234/v1}"
LM_PORT=$(echo "$LM_URL" | grep -oE '[0-9]{4,5}' | tail -1)

info "Checking LM Studio at $LM_URL..."
if curl -s "$LM_URL/models" | grep -q '"id"'; then
  MODELS=$(curl -s "$LM_URL/models" | python3 -c "
import json,sys
data=json.load(sys.stdin)
for m in data.get('data',[]):
    print(' ', m.get('id',''))
" 2>/dev/null)
  ok "LM Studio running"
  echo ""
  echo "  Available models:"
  echo "$MODELS"
  echo ""

  # Auto-detect first model
  FIRST_MODEL=$(curl -s "$LM_URL/models" | python3 -c "
import json,sys
data=json.load(sys.stdin)
models=data.get('data',[])
print(models[0]['id'] if models else '')
" 2>/dev/null)
else
  warn "LM Studio not running at $LM_URL"
  echo "  Start LM Studio → load a model → Start Server"
  echo "  Default port: 1234"
  echo ""
  FIRST_MODEL="${LOCAL_MODEL:-gemma-4}"
fi

MODEL_ID="${LOCAL_MODEL:-$FIRST_MODEL}"
MODEL_ID="${MODEL_ID:-gemma-4}"

# ── 3. Write opencode.json (project level) ────────────────────
OPENCODE_CONFIG=".opencode/config.json"
mkdir -p .opencode

cat > "$OPENCODE_CONFIG" << JSONEOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "lmstudio/$MODEL_ID",
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio (local)",
      "options": {
        "baseURL": "$LM_URL"
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
info "Model: $MODEL_ID @ $LM_URL"

# ── 4. Also write global config as fallback ───────────────────
GLOBAL_DIR="$HOME/.config/opencode"
mkdir -p "$GLOBAL_DIR"
if [ ! -f "$GLOBAL_DIR/config.json" ]; then
  cp "$OPENCODE_CONFIG" "$GLOBAL_DIR/config.json"
  ok "Written global config: $GLOBAL_DIR/config.json"
else
  info "Global config already exists — not overwriting"
  info "To update: cp $OPENCODE_CONFIG $GLOBAL_DIR/config.json"
fi

# ── 5. Update .agent/config/agent.config ─────────────────────
CONFIG=".agent/config/agent.config"
if [ -f "$CONFIG" ]; then
  # Update model ID in config
  python3 -c "
with open('$CONFIG') as f:
    c = f.read()
# Update LOCAL_MODEL if detected
if '$FIRST_MODEL' and 'LOCAL_MODEL=' in c:
    import re
    c = re.sub(r'LOCAL_MODEL=.*', 'LOCAL_MODEL=$MODEL_ID', c)
with open('$CONFIG', 'w') as f:
    f.write(c)
print('Updated LOCAL_MODEL in agent.config')
" 2>/dev/null && ok "agent.config updated"
fi

# ── 6. Test opencode ──────────────────────────────────────────
echo ""
info "Testing OpenCode with LM Studio..."
if command -v opencode &>/dev/null; then
  RESULT=$(opencode run "say 'OpenCode LM Studio OK' and nothing else" 2>/dev/null | tail -3)
  if [ -n "$RESULT" ]; then
    ok "OpenCode + LM Studio working!"
    echo "  Response: $RESULT"
  else
    warn "OpenCode ran but got no output — check LM Studio is loaded"
  fi
else
  warn "opencode command not found — restart terminal and try again"
fi

# ── 7. Summary ────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══ Setup complete ══${NC}"
echo ""
echo "  To use OpenCode for implementation phases, set in agent.config:"
echo ""
echo "    IMPLEMENT_PROVIDER=opencode"
echo "    QA_PROVIDER=opencode"
echo "    DEVOPS_PROVIDER=opencode"
echo ""
echo "  Claude stays for thinking phases (BA, Architect, Advisor)."
echo ""
echo "  To update model, edit: $OPENCODE_CONFIG"
echo "  To re-run setup:       bash scripts/setup_opencode.sh"
echo ""
