#!/usr/bin/env bash
# scripts/status.sh
#
# Shows current project status at a glance:
# - Open PRs
# - Tasks by status
# - What to work on next
#
# Usage:
#   ./scripts/status.sh

echo ""
echo "=========================================="
echo "  Project Status"
echo "=========================================="
echo ""

# Open PRs
echo "── Open PRs ───────────────────────────────"
gh pr list --state open 2>/dev/null || echo "  (no open PRs or gh not configured)"
echo ""

# Task summary
echo "── Tasks ──────────────────────────────────"
TODO=$(grep -rl "status      : todo" docs/tasks/ 2>/dev/null | wc -l | tr -d ' ')
DONE=$(grep -rl "status      : done" docs/tasks/ 2>/dev/null | wc -l | tr -d ' ')
LOCAL_TODO=$(grep -rl "target      : local" docs/tasks/ 2>/dev/null | xargs grep -l "status      : todo" 2>/dev/null | wc -l | tr -d ' ')
CLOUD_TODO=$(grep -rl "target      : cloud" docs/tasks/ 2>/dev/null | xargs grep -l "status      : todo" 2>/dev/null | wc -l | tr -d ' ')

echo "  Todo  : $TODO  (local: $LOCAL_TODO  cloud: $CLOUD_TODO)"
echo "  Done  : $DONE"
echo ""

# Local tasks todo
if [ "$LOCAL_TODO" -gt "0" ]; then
  echo "── Local tasks ready to run ───────────────"
  grep -rl "target      : local" docs/tasks/ 2>/dev/null | \
    xargs grep -l "status      : todo" 2>/dev/null | \
    xargs -I{} basename {} .md | sort
  echo ""
  echo "  Run: python scripts/run_local_tasks.py"
  echo ""
fi

# Cloud tasks todo
if [ "$CLOUD_TODO" -gt "0" ]; then
  echo "── Cloud tasks ready to implement ─────────"
  grep -rl "target      : cloud" docs/tasks/ 2>/dev/null | \
    xargs grep -l "status      : todo" 2>/dev/null | \
    xargs -I{} basename {} .md | sort
  echo ""
fi

# Requirements summary
REQ_COUNT=$(ls docs/requirements/REQ-*.md 2>/dev/null | grep -v "v[0-9]" | wc -l | tr -d ' ')
US_COUNT=$(ls docs/user-stories/US-*.md 2>/dev/null | wc -l | tr -d ' ')
echo "── Docs ───────────────────────────────────"
echo "  Requirements : $REQ_COUNT"
echo "  User Stories : $US_COUNT"
echo ""
echo "=========================================="
echo ""
