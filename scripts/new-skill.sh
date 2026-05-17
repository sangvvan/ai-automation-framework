#!/usr/bin/env bash
# scripts/new-skill.sh
#
# Create a new custom skill file with the correct template.
# After creating, agents will automatically load it based on PROJECT_TYPE.
#
# Usage:
#   ./run.sh /skill embedded/can-bus       "CAN bus communication patterns"
#   ./run.sh /skill backend/redis          "Redis caching patterns"
#   ./run.sh /skill ios/accessibility      "iOS accessibility conventions"
#   ./run.sh /skill core/security          "Cross-cutting security rules"

set +e
SKILL_PATH="${1:-}"
DESCRIPTION="${2:-}"

if [ -z "$SKILL_PATH" ]; then
  echo ""
  echo "Usage: ./run.sh /skill <category/name> \"description\""
  echo ""
  echo "Categories:"
  echo "  core/        → applies to all project types"
  echo "  ios/         → iOS SwiftUI skills"
  echo "  backend/     → FastAPI / Python skills"
  echo "  embedded/    → firmware / C skills for your department"
  echo "  qa/          → testing patterns"
  echo "  devops/      → CI/CD, Docker, infra"
  echo ""
  echo "Examples:"
  echo "  ./run.sh /skill embedded/can-bus \"CAN bus communication\""
  echo "  ./run.sh /skill backend/redis    \"Redis caching patterns\""
  echo ""
  exit 0
fi

SKILLS_DIR=".agent/skills"
CATEGORY=$(dirname "$SKILL_PATH")
NAME=$(basename "$SKILL_PATH")
FILE="$SKILLS_DIR/$SKILL_PATH.md"

mkdir -p "$SKILLS_DIR/$CATEGORY"

if [ -f "$FILE" ]; then
  echo "Skill already exists: $FILE"
  echo "Edit it directly or delete it to recreate."
  exit 1
fi

cat > "$FILE" << TEMPLATE
# Skill: $SKILL_PATH

## Purpose
${DESCRIPTION:-Describe what this skill teaches agents to do.}

## When this skill is loaded
Loaded for agents working on: $CATEGORY tasks
Project type: (set in .agent/config/agent.config)

## Conventions
(Add your conventions here)

## Patterns
(Add reusable code patterns, templates, or examples)

## LLM routing guidance
(Optional — any specific local/cloud routing rules for tasks using this skill)
\`\`\`
target: local  → (describe task types suitable for local LLM)
target: cloud  → (describe task types that need cloud LLM)
\`\`\`

## Self-review checklist for agents using this skill
- [ ] (Add checklist items)
TEMPLATE

echo ""
echo "Created: $FILE"
echo ""
echo "Next steps:"
echo "  1. Edit $FILE and fill in your conventions"
echo "  2. Add '$SKILL_PATH' to load_skills() in scripts/load-skills.sh"
echo "     under the correct role case (e.g., 'embedded' or 'backend')"
echo "  3. Agents will load it automatically on next run"
echo ""

# Show the relevant section in load-skills.sh to edit
echo "── Section to edit in scripts/load-skills.sh ──"
echo ""
grep -n "$CATEGORY)" scripts/load-skills.sh | head -3 || \
  echo "  Add a new case for '$CATEGORY' in the load_skills() function"
echo ""
