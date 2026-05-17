#!/usr/bin/env python3
"""
scripts/agent_runner.py
Central dispatcher — routes prompts to the correct LLM provider.

Providers : claude | codex | copilot | gemini | opencode | opencode-ollama
Provider routing:
  PS → Design   : default=claude,  fallback=codex
  Implementation: default=codex,   fallback=opencode → opencode-ollama
  Local LLMs    : hard cap = 15k tokens before sending
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# ── SDLC System Prompt ────────────────────────────────────────────────────────
PROJECT_SYSTEM_PROMPT = """
You are an AI agent embedded in a structured SDLC automation pipeline for app/mobile development.
The pipeline covers these phases (in order):
  Phase 0 — PS      : Extract requirements from Problem Statement
  Phase 1 — BA      : Write User Stories from requirements
  Phase 2 — Advisor : Review LLM routing, risk, and strategy
  Phase 3 — Planning: Technical design, task breakdown
  Phase 4 — Design  : UI/UX specs and screen briefs
  Phase 5 — Implementation: Write code, implement user stories
  Phase 6 — Local Tasks: Run low-complexity automated tasks
  Phase 7 — QA      : Tests, validation, bug reports
  Phase 8 — DevOps  : CI/CD, PR creation, deployment
  Scrum    — Scrum Master: Sprint planning, retrospectives, velocity tracking

PIPELINE RULES — NON-NEGOTIABLE:
- You are running inside an automated pipeline. NEVER ask questions.
- NEVER ask "Would you like me to continue?" or for confirmation.
- Complete your assigned task, write your summary block, then STOP.
- The next phase starts automatically.
- Always follow the spec.md as the highest-priority source of truth.
- Always update docs/traceability.md after structural changes.
""".strip()


# ── Config loader ─────────────────────────────────────────────────────────────
def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


# ── Prompt helpers ────────────────────────────────────────────────────────────
def read_file(path: Path) -> str:
    return path.read_text(errors="ignore") if path.exists() else ""


def read_agent_def(role: str) -> str:
    candidates = [
        ROOT / ".agent" / "agents" / f"{role}.md",
        ROOT / ".agent" / "agents" / f"{role}_agent.md",
        ROOT / ".agent" / "agents" / f"{role}-agent.md",
        ROOT / "CLAUDE.md",
    ]
    for p in candidates:
        if p.exists():
            return p.read_text(errors="ignore")
    return f"You are the {role} agent for this project."


ROLE_ALIASES = {
    "implement": "implementation",
    "impl": "implementation",
    "dev": "implementation",
    "developer": "implementation",
    "frontend": "implementation",
    "architect": "planning",   # renamed: architect → planning
    "arch": "planning",
    "scrum_master": "scrum",
    "sprint": "scrum",
}
IMPLEMENTATION_ROLES = {"implementation"}

# Phases that use claude-first routing
THINKING_PHASES = {"ps", "ba", "advisor", "planning", "architect", "design"}


def normalize_role(role: str) -> str:
    normalized = role.strip().lower()
    return ROLE_ALIASES.get(normalized, normalized)


def is_implementation_role(role: str) -> bool:
    return normalize_role(role) in IMPLEMENTATION_ROLES


def _safe_relative(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def _read_first_chars(path: Path, limit: int = 2000) -> str:
    content = path.read_text(errors="ignore").strip()
    if len(content) <= limit:
        return content
    return content[:limit] + "\n...[truncated for prompt size]"


def extract_req_id(user_prompt: str) -> str:
    match = re.search(r"\bREQ-\d+\b", user_prompt, re.IGNORECASE)
    return match.group(0).upper() if match else ""


def resolve_feature_name_to_req(feature_name: str) -> str:
    req_dir = ROOT / "docs" / "requirements"
    if not req_dir.exists():
        return ""
    stop_words = {"a", "an", "the", "and", "or", "for", "with", "in", "of", "to", "is", "that"}
    feature_words = set(re.sub(r"[^a-z0-9 ]", " ", feature_name.lower()).split()) - stop_words
    best_req, best_score = "", 0
    for req_file in sorted(req_dir.glob("REQ-*.md")):
        content = req_file.read_text(errors="ignore")
        title_match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
        id_match = re.search(r"^id\s*:\s*(REQ-\d+)", content, re.MULTILINE | re.IGNORECASE)
        if not id_match:
            continue
        req_id = id_match.group(1).upper()
        title = title_match.group(1) if title_match else ""
        title = re.sub(r"REQ-\d+\s*[—\-]\s*", "", title, flags=re.IGNORECASE).strip()
        title_words = set(re.sub(r"[^a-z0-9 ]", " ", title.lower()).split()) - stop_words
        overlap = len(feature_words & title_words)
        if overlap > best_score:
            best_score, best_req = overlap, req_id
    return best_req if best_score >= 2 else ""


def check_req_implementation_status(req_id: str, us_ids: list) -> dict:
    if not req_id or not us_ids:
        return {"implemented": False, "coverage": [], "missing": us_ids, "recommendation": "implement"}
    routes_dir, src_dir = ROOT / "app" / "routes", ROOT / "src"
    coverage, missing = [], []
    req_file = ROOT / "docs" / "requirements" / f"{req_id}.md"
    req_content = req_file.read_text(errors="ignore") if req_file.exists() else ""
    ac_count = len(re.findall(r"^AC-", req_content, re.MULTILINE))
    for us_id in us_ids:
        us_file = ROOT / "docs" / "user-stories" / f"{us_id}.md"
        if not us_file.exists():
            missing.append(us_id)
            continue
        us_content = us_file.read_text(errors="ignore")
        status_match = re.search(r"^status\s*:\s*(\w+)", us_content, re.MULTILINE)
        us_status = status_match.group(1).lower() if status_match else "pending"
        keywords = list(set(
            k.lower() for k in re.findall(
                r"\b(auth|blog|album|forum|profile|register|login|post|translate|locale)\b",
                us_content, re.IGNORECASE,
            )
        ))
        found_files = []
        for kw in keywords:
            if routes_dir.exists():
                found_files += [str(f.relative_to(ROOT)) for f in routes_dir.glob(f"*{kw}*.tsx")]
            if src_dir.exists():
                found_files += [str(f.relative_to(ROOT)) for f in src_dir.rglob(f"*{kw}*.tsx")]
        if found_files or us_status == "done":
            coverage.append({"us": us_id, "status": us_status, "files": list(set(found_files[:3]))})
        else:
            missing.append(us_id)
    total, covered = len(us_ids), len(coverage)
    return {
        "implemented": covered == total,
        "coverage": coverage,
        "missing": missing,
        "recommendation": "enhance" if covered == total and total > 0 else "implement",
        "ac_count": ac_count,
    }


def extract_us_id_from_path(path: Path) -> str:
    match = re.search(r"\bUS-\d+\b", path.stem, re.IGNORECASE)
    return match.group(0).upper() if match else path.stem.upper()


def story_traces_to_requirement(content: str, req_id: str) -> bool:
    return re.search(rf"(?im)^\s*traces_to\s*:\s*{re.escape(req_id)}\s*$", content) is not None


def load_user_stories_for_requirement(req_id: str) -> tuple[str, list[str]]:
    base = ROOT / "docs" / "user-stories"
    if not base.exists():
        return "No docs/user-stories directory found.", []
    parts, us_ids = [], []
    for path in sorted(base.glob("US-*.md")):
        content = path.read_text(errors="ignore")
        if story_traces_to_requirement(content, req_id):
            us_id = extract_us_id_from_path(path)
            us_ids.append(us_id)
            parts.append(f"[USER STORY {us_id}] File: {_safe_relative(path)}\n{_read_first_chars(path)}")
    if not parts:
        return f"No user stories found with `traces_to : {req_id}`.", []
    return "\n\n---\n\n".join(parts), us_ids


def load_specs_for_user_stories(us_ids: list[str]) -> str:
    if not us_ids:
        return "No user story IDs discovered, so no spec.md files were loaded."
    parts = []
    for us_id in us_ids:
        candidates = [
            ROOT / "docs" / "design" / "screens" / us_id / "spec.md",
            ROOT / "docs" / "design" / "screens" / us_id.lower() / "spec.md",
            ROOT / "docs" / "design" / "screens" / f"{us_id}.md",
        ]
        found = False
        for path in candidates:
            if path.exists():
                parts.append(f"[SPEC {us_id}] File: {_safe_relative(path)}\n{_read_first_chars(path, 2000)}")
                found = True
                break
        if not found:
            parts.append(f"[SPEC {us_id}] No spec.md found under docs/design/screens/{us_id}/spec.md")
    return "\n\n---\n\n".join(parts)


def load_design_context(role: str) -> str:
    if not is_implementation_role(role):
        return ""
    candidates = [
        ROOT / "docs" / "design" / "screens" / "design-link.txt",
        ROOT / "docs" / "design" / "design-link.txt",
        ROOT / "design-link.txt",
    ]
    existing = [p for p in candidates if p.exists()]
    if not existing:
        return "No design-link.txt found."
    parts = []
    for path in existing:
        content = path.read_text(errors="ignore").strip()
        parts.append(f"File: {path.relative_to(ROOT)}\n{content}" if content else
                     f"File: {path.relative_to(ROOT)} exists but is empty.")
    return "\n\n".join(parts)


def load_requirement_context(user_prompt: str) -> str:
    req_id = extract_req_id(user_prompt)
    if not req_id:
        req_id = resolve_feature_name_to_req(user_prompt)
        if req_id:
            resolution_note = (
                f"NOTE: No explicit REQ-id. Resolved '{user_prompt}' → {req_id} by title matching. "
                "Verify before proceeding."
            )
        else:
            return (
                f"No REQ-* id detected and '{user_prompt}' could not be matched to any requirement. "
                "Search docs/requirements/ and docs/user-stories/ manually before coding."
            )
    else:
        resolution_note = f"REQ-id explicitly provided: {req_id}"

    stories_context, us_ids = load_user_stories_for_requirement(req_id)
    specs_context = load_specs_for_user_stories(us_ids)
    status = check_req_implementation_status(req_id, us_ids)

    if status["implemented"]:
        impl_status_block = (
            f"IMPLEMENTATION STATUS: ALREADY IMPLEMENTED\n"
            f"All {len(us_ids)} user stories for {req_id} appear covered.\n"
            f"Covered: {[c['us'] for c in status['coverage']]}\n"
            "RECOMMENDATION: Do NOT rewrite. Enhance gaps only."
        )
    elif status["missing"]:
        impl_status_block = (
            f"IMPLEMENTATION STATUS: PARTIALLY IMPLEMENTED\n"
            f"Covered: {[c['us'] for c in status['coverage']]}\n"
            f"Missing (implement these): {status['missing']}\n"
            "RECOMMENDATION: Implement ONLY the missing user stories."
        )
    else:
        impl_status_block = (
            f"IMPLEMENTATION STATUS: NOT YET IMPLEMENTED\n"
            f"No existing routes/code found for {req_id}.\n"
            "RECOMMENDATION: Implement all user stories from scratch."
        )

    return f"""
{resolution_note}

Requirement: {req_id}

{impl_status_block}

User stories discovered by `traces_to : {req_id}`:
{stories_context}

User story specs loaded from docs/design/screens/<US-ID>/spec.md:
{specs_context}
""".strip()


def build_implementation_execution_block(role: str, user_prompt: str) -> str:
    if not is_implementation_role(role):
        return ""
    requirement_context = load_requirement_context(user_prompt)
    return f"""
=== IMPLEMENTATION EXECUTION RULES — MANDATORY ===
Input request:
{user_prompt}

Preloaded requirement/user-story/spec context:
{requirement_context}

Execution contract:
- FIRST scan docs/user-stories/*.md for `traces_to : <REQ-id>`.
- For EACH discovered user story, load docs/design/screens/<US-ID>/spec.md.
- spec.md is HIGHEST PRIORITY. design-link.txt is secondary visual reference only.
- Implement ALL discovered user stories sequentially. Do NOT skip.
- Use the existing Remix structure under app/. Do NOT create src/ unless it exists.
- Run or update the most relevant checks/tests when available.
- Do NOT ask questions. Best-effort implementation from repo context.

Required final summary format:
IMPLEMENTATION SUMMARY
- Requirement:
- User stories discovered from traces_to:
- Specs used:
- Stories/tasks completed:
- Design links used:
- Files changed:
- Tests/checks run:
- Blockers or follow-ups:
""".strip()


def build_design_instruction_block(role: str) -> str:
    design_context = load_design_context(role)
    if not design_context:
        return ""
    return f"""
=== DESIGN INPUT — SECONDARY UI REFERENCE ===
{design_context}

Design rules:
- design-link.txt is secondary visual guidance only.
- Do NOT override spec.md with design-link.txt.
- If design link is inaccessible, continue using spec.md.
""".strip()


def load_skills(role: str, project_type: str, platform: str) -> str:
    skills_dir = ROOT / ".agent" / "skills"
    parts: list[str] = []

    def add(path: Path) -> None:
        if path.exists():
            parts.append(path.read_text(errors="ignore"))

    def join_parts() -> str:
        return "\n\n---\n\n".join(p for p in parts if p.strip())

    # Traceability is universal — every agent creates or updates artefacts
    add(skills_dir / "core" / "traceability.md")

    # ── Design: design-only skills, no implementation/backend noise ─────────
    if role == "design":
        add(skills_dir / "core" / "design-system.md")
        if platform == "web":
            add(skills_dir / "design" / "web.md")
            add(skills_dir / "web" / "accessibility.md")
        elif platform == "ios":
            add(skills_dir / "design" / "ios.md")
        elif platform == "android":
            add(skills_dir / "design" / "android.md")
        elif platform == "tool":
            add(skills_dir / "design" / "tool.md")
        return join_parts()

    # ── PS / BA / Advisor: document-only agents, just traceability ──────────
    if role in ("ps", "ba", "advisor"):
        return join_parts()

    # ── Planning (formerly architect): technical planning skills ────────────
    if role in ("planning", "architect"):
        add(skills_dir / "core" / "git.md")
        add(skills_dir / "core" / "implementation-workflow.md")
        if platform == "web":
            add(skills_dir / "web" / "remix.md")
            add(skills_dir / "web" / "auth-session.md")
            add(skills_dir / "web" / "zod-validation.md")
        if "backend" in project_type:
            add(skills_dir / "backend" / "postgres.md")
            if "web" in project_type:
                add(skills_dir / "backend" / "remix-sql.md")
        return join_parts()

    # ── QA / SystemTest: testing skills only ────────────────────────────────
    if role in ("qa", "systemtest"):
        add(skills_dir / "web" / "playwright.md")
        add(skills_dir / "web" / "vitest.md")
        add(skills_dir / "web" / "accessibility.md")
        add(skills_dir / "web" / "page-object-model.md")
        add(skills_dir / "systemtest" / "bug-reporting.md")
        return join_parts()

    # ── DevOps: CI/CD and PR skills only ────────────────────────────────────
    if role == "devops":
        add(skills_dir / "core" / "git.md")
        add(skills_dir / "core" / "pr.md")
        add(skills_dir / "core" / "ci-github-actions.md")
        return join_parts()

    # ── Implementation: full stack web skills ───────────────────────────────
    if role in IMPLEMENTATION_ROLES:
        add(skills_dir / "core" / "git.md")
        add(skills_dir / "core" / "pr.md")
        add(skills_dir / "core" / "design-system.md")
        add(skills_dir / "core" / "implementation-workflow.md")
        if platform == "web":
            add(skills_dir / "web" / "remix.md")
            add(skills_dir / "design" / "web.md")
            add(skills_dir / "web" / "accessibility.md")
            add(skills_dir / "web" / "zod-validation.md")
            add(skills_dir / "web" / "seo-meta.md")
            add(skills_dir / "web" / "vitest.md")
            add(skills_dir / "web" / "auth-session.md")
        elif platform == "ios":
            add(skills_dir / "ios" / "swiftui.md")
            add(skills_dir / "ios" / "payment.md")
            add(skills_dir / "design" / "ios.md")
        elif platform == "android":
            add(skills_dir / "android" / "compose.md")
            add(skills_dir / "design" / "android.md")
        elif platform == "tool":
            add(skills_dir / "design" / "tool.md")
        elif platform == "embedded":
            add(skills_dir / "embedded" / "c-conventions.md")
            add(skills_dir / "embedded" / "rtos.md")
        if "backend" in project_type:
            if platform in ("ios", "android", "embedded"):
                add(skills_dir / "backend" / "fastapi.md")
                add(skills_dir / "backend" / "postgres.md")
            if "web" in project_type:
                add(skills_dir / "backend" / "remix-sql.md")
                add(skills_dir / "backend" / "postgres.md")
        return join_parts()

    # ── Scrum Master: sprint planning and retrospective skills ──────────────
    if role == "scrum":
        add(skills_dir / "core" / "scrum.md")
        return join_parts()

    # ── Generic fallback (review, etc.): core skills ─────────────────────────
    for name in ["git", "pr", "design-system", "implementation-workflow"]:
        add(skills_dir / "core" / f"{name}.md")
    return join_parts()


def build_prompt(role: str, user_prompt: str) -> str:
    role = normalize_role(role)
    agent_def = read_agent_def(role)
    platform = os.environ.get("PLATFORM", "web")
    project_type = os.environ.get("PROJECT_TYPE", "web+backend")
    skills = load_skills(role, project_type, platform)
    implementation_block = build_implementation_execution_block(role, user_prompt)
    design_block = build_design_instruction_block(role)

    return f"""=== SYSTEM ===
{PROJECT_SYSTEM_PROMPT}

=== AGENT DEFINITION ===
{agent_def}

=== SKILLS ===
{skills if skills else "(no skills loaded)"}

=== ROLE ===
{role}

=== PLATFORM / PROJECT ===
Platform     : {platform}
Project type : {project_type}

{implementation_block + chr(10) + chr(10) if implementation_block else ""}{design_block + chr(10) + chr(10) if design_block else ""}=== TASK ===
{user_prompt}
""".strip()


# ── Token cap for LM Studio ───────────────────────────────────────────────────
LM_STUDIO_PROVIDERS = {"opencode", "opencode-ollama"}   # providers that route through local LLMs
MAX_PROMPT_TOKENS_DEFAULT = 15000
CHARS_PER_TOKEN = 4


def truncate_for_lm_studio(prompt: str, max_tokens: int) -> str:
    limit = max_tokens * CHARS_PER_TOKEN
    if len(prompt) <= limit:
        return prompt
    notice = f"\n\n[TRUNCATED: prompt reduced to ~{max_tokens} tokens for LM Studio]\n"
    print(
        f"[agent_runner] ⚠ Prompt truncated from {len(prompt)} to ~{limit} chars "
        f"(~{max_tokens} tokens)",
        file=sys.stderr,
    )
    return prompt[:limit] + notice


# ── Git auto-commit ───────────────────────────────────────────────────────────
def auto_commit(role: str) -> None:
    if os.environ.get("AUTO_COMMIT", "false").lower() != "true":
        return
    try:
        status = subprocess.check_output(
            ["git", "status", "--porcelain"], cwd=str(ROOT), text=True
        ).strip()
        if not status:
            print("[git] nothing to commit")
            return
        subprocess.run(["git", "add", "."], cwd=str(ROOT), check=False)
        subprocess.run(
            ["git", "commit", "-m", f"ai({role}): automated phase update"],
            cwd=str(ROOT), check=False,
        )
        print("[git] committed")
    except Exception as exc:
        print(f"[git] auto-commit failed: {exc}")


# ── Provider runners ──────────────────────────────────────────────────────────
def run_cmd(cmd: list[str], input_text: str | None = None) -> int:
    try:
        result = subprocess.run(cmd, input=input_text, text=True, cwd=str(ROOT), check=False)
        return result.returncode
    except FileNotFoundError:
        print(f"[agent_runner] command not found: {cmd[0]}", file=sys.stderr)
        return 127


def run_claude(prompt: str) -> int:
    tools = os.environ.get("CLAUDE_ALLOW_TOOLS", "Read,Write,Edit,MultiEdit,Bash,Glob,Grep")
    cmd = ["claude", "-p", prompt, "--allowedTools", tools]
    if os.environ.get("CLAUDE_SKIP_PERMISSION", "true").lower() == "true":
        cmd.append("--dangerously-skip-permissions")
    return run_cmd(cmd)


def run_codex(prompt: str) -> int:
    """Run OpenAI Codex CLI (codex [options] exec prompt)."""
    import shutil
    if not shutil.which("codex"):
        print("[agent_runner] codex not found.", file=sys.stderr)
        print("[agent_runner] Install: npm install -g @openai/codex", file=sys.stderr)
        return 127

    # Global options must come BEFORE the 'exec' subcommand
    # Approval mode from config (default: full-auto) — no human prompts in pipeline
    # '-s workspace-write' allows file writes in the repo workspace
    # Valid values: never | on-request | on-failure | untrusted
    # Use 'never' for fully automated pipeline (no human approval prompts)
    approval = os.environ.get("CODEX_APPROVAL_MODE", "never")
    cmd = ["codex", "-a", approval, "-s", "workspace-write"]
    
    model = os.environ.get("CODEX_MODEL", "")
    if model:
        cmd.extend(["-m", model])
    
    cmd.extend(["exec", prompt])
    return run_cmd(cmd)


def run_copilot(prompt: str) -> int:
    cli = os.environ.get("COPILOT_CLI_COMMAND", "")
    if cli:
        return run_cmd(cli.split() + [prompt])
    return run_cmd(["copilot", "-p", "--allow-all-tools", prompt])


def run_gemini(prompt: str) -> int:
    cli = os.environ.get("GEMINI_CLI_COMMAND", "")
    if cli:
        return run_cmd(cli.split() + [prompt])
    print("[agent_runner] GEMINI_CLI_COMMAND not configured.", file=sys.stderr)
    print(prompt)
    return 0


def run_opencode(prompt: str, role: str) -> int:
    import io
    import shutil
    from pathlib import Path

    if not shutil.which("opencode"):
        print("[agent_runner] opencode not found.", file=sys.stderr)
        print("[agent_runner] Install: npm install -g opencode-ai", file=sys.stderr)
        return 127

    # Pre-emptively create directories that opencode-ai often fails on (EEXIST)
    for p in [
        Path.home() / ".local" / "share" / "opencode",
        Path.home() / ".local" / "share" / "opencode" / "log",
        Path.home() / ".local" / "state" / "opencode",
        Path.home() / ".opencode",
    ]:
        try:
            p.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass

    env = os.environ.copy()
    project_opencode_config = ROOT / ".opencode" / "config.json"
    if project_opencode_config.exists():
        env["OPENCODE_CONFIG"] = str(project_opencode_config)

    lmstudio_model = (
        os.environ.get("LMSTUDIO_MODEL")
        or os.environ.get("LOCAL_MODEL")
        or "gemma-4"
    )

    proc = subprocess.Popen(
        ["opencode", "run", "-", "-m", f"lmstudio/{lmstudio_model}"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=str(ROOT),
        env=env,
    )

    captured = io.StringIO()
    try:
        assert proc.stdin is not None
        proc.stdin.write(prompt)
        proc.stdin.close()
        assert proc.stdout is not None
        for line in proc.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            captured.write(line)
    finally:
        if proc.stdout:
            proc.stdout.close()

    rc = proc.wait()
    output = captured.getvalue()

    fail_patterns = (
        "context size has been exceeded",
        "context length exceeded",
        "context window",
        "token limit",
        "prompt is too long",
        "no models loaded",
        "please load a model",
        "model not found",
        "failed to load model",
    )
    soft_fail = any(p in output.lower() for p in fail_patterns)

    if rc != 0 or soft_fail:
        reason = f"rc={rc}" if rc != 0 else "context size exceeded"
        print(f"\n[opencode] failed ({reason}) — no further fallback for implementation phase.")

    return rc


def run_opencode_ollama(prompt: str, role: str) -> int:
    """Run opencode against Ollama (OpenAI-compatible API on port 11434)."""
    import io
    import shutil
    from pathlib import Path

    if not shutil.which("opencode"):
        print("[agent_runner] opencode not found.", file=sys.stderr)
        print("[agent_runner] Install: npm install -g opencode-ai", file=sys.stderr)
        return 127

    for p in [
        Path.home() / ".local" / "share" / "opencode",
        Path.home() / ".local" / "share" / "opencode" / "log",
        Path.home() / ".local" / "state" / "opencode",
        Path.home() / ".opencode",
    ]:
        try:
            p.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass

    # Override opencode config to point at Ollama instead of LM Studio
    ollama_url = os.environ.get("OLLAMA_API_URL", "http://localhost:11434/v1")
    ollama_model = os.environ.get("OLLAMA_MODEL", "qwen3:8b")

    # Write a temporary opencode config for Ollama
    ollama_config_dir = ROOT / ".opencode-ollama"
    ollama_config_dir.mkdir(exist_ok=True)
    ollama_config = ollama_config_dir / "config.json"
    ollama_config.write_text(
        f'{{"$schema":"https://opencode.ai/config.json",'
        f'"model":"ollama/{ollama_model}",'
        f'"provider":{{"ollama":{{'
        f'"npm":"@ai-sdk/openai-compatible",'
        f'"name":"Ollama (local)",'
        f'"options":{{"baseURL":"{ollama_url}"}},'
        f'"models":{{"{ollama_model}":{{"name":"{ollama_model}"}}}}'
        f"}}}}}}\n"
    )

    env = os.environ.copy()
    env["OPENCODE_CONFIG"] = str(ollama_config)

    proc = subprocess.Popen(
        ["opencode", "run", "-", "-m", f"ollama/{ollama_model}"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=str(ROOT),
        env=env,
    )

    captured = io.StringIO()
    try:
        assert proc.stdin is not None
        proc.stdin.write(prompt)
        proc.stdin.close()
        assert proc.stdout is not None
        for line in proc.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            captured.write(line)
    finally:
        if proc.stdout:
            proc.stdout.close()

    rc = proc.wait()
    output = captured.getvalue()

    fail_patterns = (
        "context size has been exceeded",
        "context length exceeded",
        "context window",
        "token limit",
        "prompt is too long",
        "no models loaded",
        "please load a model",
        "model not found",
        "failed to load model",
    )
    soft_fail = any(p in output.lower() for p in fail_patterns)

    if rc != 0 or soft_fail:
        reason = f"rc={rc}" if rc != 0 else "context size exceeded"
        print(f"\n[opencode-ollama] failed ({reason}) — no further fallback.")

    return rc


# ── Fallback dispatcher ───────────────────────────────────────────────────────
def dispatch(provider: str, prompt: str, role: str) -> int:
    """
    Routing table with broad fallback support:
      - Any phase: claude  -> fallback codex
      - Any phase: codex   -> fallback opencode
    """
    normalized_role = normalize_role(role)

    if provider == "claude":
        rc = run_claude(prompt)
        if rc != 0:
            fallback = os.environ.get("CLAUDE_FALLBACK", "codex")
            if fallback and fallback != "none":
                print(f"\n[claude] failed (rc={rc}) — falling back to: {fallback}")
                return dispatch(fallback, prompt, role)
        return rc

    if provider == "codex":
        rc = run_codex(prompt)
        if rc != 0:
            fallback = os.environ.get("CODEX_FALLBACK", "opencode")
            if fallback and fallback != "none":
                print(f"\n[codex] failed (rc={rc}) — falling back to: {fallback}")
                return dispatch(fallback, prompt, role)
        return rc

    if provider == "copilot":
        return run_copilot(prompt)

    if provider == "gemini":
        return run_gemini(prompt)

    if provider == "opencode":
        rc = run_opencode(prompt, role)
        if rc != 0:
            fallback = os.environ.get("OPENCODE_FALLBACK", "opencode-ollama")
            if fallback and fallback != "none":
                print(f"\n[opencode] failed (rc={rc}) — falling back to: {fallback}")
                return dispatch(fallback, prompt, role)
        return rc

    if provider == "opencode-ollama":
        return run_opencode_ollama(prompt, role)

    print(f"[agent_runner] unknown provider: {provider}", file=sys.stderr)
    return 1


# ── Provider resolver ─────────────────────────────────────────────────────────
def resolve_provider(provider_arg: str, mode_arg: str, role: str) -> str:
    if provider_arg:
        return provider_arg.strip().lower()

    normalized = normalize_role(role)
    role_override = os.environ.get(f"{normalized.upper()}_PROVIDER", "").strip()
    if role_override:
        return role_override.lower()

    mode = mode_arg.strip().lower() if mode_arg else os.environ.get("AI_PROFILE", "balanced")

    # Thinking phases default
    if normalized in THINKING_PHASES:
        if mode == "premium":
            return os.environ.get("PREMIUM_PROVIDER", "claude")
        return os.environ.get("BALANCED_PROVIDER", "claude")

    # Implementation phase default
    if normalized in IMPLEMENTATION_ROLES:
        return os.environ.get("IMPLEMENT_PROVIDER", "codex")

    # Generic fallback
    if mode == "premium":
        return os.environ.get("PREMIUM_PROVIDER", "claude")
    if mode == "balanced":
        return os.environ.get("BALANCED_PROVIDER", "claude")
    return os.environ.get("DEFAULT_PROVIDER", "codex")


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(description="SDLC Agent Runner")
    parser.add_argument("--role", required=True, help="Agent role (ba, architect, design, implementation, etc.)")
    parser.add_argument("--provider", default="", help="Provider override")
    parser.add_argument("--prompt", default="", help="Inline prompt text")
    parser.add_argument("--prompt-file", default="", help="Path to prompt file")
    parser.add_argument("--mode", default="", help="AI profile mode")
    parser.add_argument("--allowed-tools", default="", help="(unused, for Claude Code compat)")
    args = parser.parse_args()

    load_env(ROOT / ".agent" / "config" / "agent.config")

    role = normalize_role(args.role)
    provider = resolve_provider(args.provider, args.mode, role)

    if args.prompt_file:
        raw = Path(args.prompt_file).read_text(errors="ignore") if Path(args.prompt_file).exists() else args.prompt
    else:
        raw = args.prompt

    prompt = build_prompt(role, raw)

    # ── Token cap for LM Studio providers ────────────────────────────────────
    max_tokens = int(os.environ.get("LOCAL_MAX_PROMPT_TOKENS", str(MAX_PROMPT_TOKENS_DEFAULT)))
    if provider in LM_STUDIO_PROVIDERS:
        prompt = truncate_for_lm_studio(prompt, max_tokens)

    # ── Legacy char-based cap (backward compat) ───────────────────────────────
    max_chars = int(os.environ.get("LOCAL_MAX_PROMPT_CHARS", "0"))
    if max_chars > 0 and provider in LM_STUDIO_PROVIDERS and len(prompt) > max_chars:
        print(f"[agent_runner] char cap: {len(prompt)} → {max_chars}")
        prompt = prompt[:max_chars] + "\n\n[TRUNCATED: char limit]\n"

    print()
    print("─" * 60)
    print(f"  Role     : {role}")
    print(f"  Provider : {provider}")
    if provider in LM_STUDIO_PROVIDERS:
        print(f"  Token cap: ~{max_tokens} tokens (LM Studio guardrail active)")
    print("─" * 60)
    print()

    rc = dispatch(provider, prompt, role)

    if rc == 0:
        auto_commit(role)

    return rc


if __name__ == "__main__":
    raise SystemExit(main())