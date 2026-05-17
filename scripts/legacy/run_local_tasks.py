#!/usr/bin/env python3
"""
scripts/run_local_tasks.py
Phase 6 — Local Task Runner (LM Studio / opencode).
Runs low-complexity TASK-* items directly against the local model.
Hard cap: LOCAL_MAX_PROMPT_TOKENS (default 15000) before sending.
"""

import os
import re
import sys
from pathlib import Path

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

ROOT = Path(__file__).resolve().parents[1]

# ── Load agent.config ─────────────────────────────────────────────────────────
def _load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

_load_env(ROOT / ".agent" / "config" / "agent.config")

# Backend selection: "lmstudio" (default) or "ollama"
LOCAL_BACKEND = os.getenv("LOCAL_BACKEND", "lmstudio")

if LOCAL_BACKEND == "ollama":
    API_URL    = os.getenv("OLLAMA_API_URL",    "http://localhost:11434/v1")
    API_KEY    = os.getenv("OLLAMA_API_KEY",    "ollama")
    MODEL_ID   = os.getenv("OLLAMA_MODEL",      "qwen3:8b")
    TIMEOUT    = float(os.getenv("OLLAMA_TIMEOUT",      "7200"))
    MAX_TOKENS = int(os.getenv("OLLAMA_MAX_TOKENS",     "8192"))
    TEMPERATURE= float(os.getenv("OLLAMA_TEMPERATURE",  "0.10"))
    MAX_PROMPT_TOKENS = int(os.getenv("OLLAMA_MAX_PROMPT_TOKENS", "15000"))
else:
    API_URL    = os.getenv("LOCAL_API_URL",    "http://localhost:1234/v1")
    API_KEY    = os.getenv("LOCAL_API_KEY",    "lm-studio")
    MODEL_ID   = os.getenv("LOCAL_MODEL",      "local-model")
    TIMEOUT    = float(os.getenv("LOCAL_TIMEOUT",      "7200"))
    MAX_TOKENS = int(os.getenv("LOCAL_MAX_TOKENS",     "8192"))
    TEMPERATURE= float(os.getenv("LOCAL_TEMPERATURE",  "0.10"))
    MAX_PROMPT_TOKENS = int(os.getenv("LOCAL_MAX_PROMPT_TOKENS", "15000"))
CHARS_PER_TOKEN   = 4

SYSTEM_PROMPT = """You are a local coding task worker running inside an automated SDLC pipeline.
Your job: complete the assigned low-complexity task exactly as described.

RULES:
- Do ONLY what the task asks. Do NOT expand scope.
- Write minimal, targeted changes. No refactors.
- Do NOT ask questions. Make best-effort decisions from context.
- Output a short summary: files changed, what was done.
"""

def truncate_content(content: str) -> str:
    """Hard cap content to LOCAL_MAX_PROMPT_TOKENS before sending to LM Studio."""
    limit = MAX_PROMPT_TOKENS * CHARS_PER_TOKEN
    if len(content) <= limit:
        return content
    notice = f"\n\n[TRUNCATED: reduced to ~{MAX_PROMPT_TOKENS} tokens for LM Studio context limit]\n"
    print(
        f"[run_local_tasks] ⚠ Task content truncated "
        f"({len(content)} → ~{limit} chars / ~{MAX_PROMPT_TOKENS} tokens)",
        file=sys.stderr,
    )
    return content[:limit] + notice


def load_tasks() -> list[dict[str, str]]:
    task_files = list((ROOT / "docs").glob("**/*.md")) if (ROOT / "docs").exists() else []
    tasks = []
    pattern = re.compile(r"(TASK-\d+).*?(low|medium|high)?", re.IGNORECASE)
    for path in task_files:
        text = path.read_text(errors="ignore")
        for match in pattern.finditer(text):
            task_id = match.group(1).upper()
            complexity = (match.group(2) or "low").lower()
            if complexity == "low":
                start = max(0, match.start() - 300)
                end = min(len(text), match.end() + 700)
                tasks.append({"id": task_id, "file": str(path), "content": text[start:end]})
    return tasks[:10]


def run_task(client: "OpenAI", task: dict[str, str]) -> str:
    content = truncate_content(task["content"])
    response = client.chat.completions.create(
        model=MODEL_ID,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
        temperature=TEMPERATURE,
        max_tokens=MAX_TOKENS,
        stream=False,
    )
    return response.choices[0].message.content or ""


def main() -> int:
    print("=" * 60)
    print("Phase 6 — Local Task Runner")
    print(f"Backend   : {LOCAL_BACKEND}")
    print(f"Model     : {MODEL_ID}")
    print(f"Endpoint  : {API_URL}")
    print(f"Token cap : ~{MAX_PROMPT_TOKENS} tokens")
    print("=" * 60)

    tasks = load_tasks()
    if not tasks:
        print("No low-complexity tasks found in docs. Skipping.")
        return 0

    print(f"Found {len(tasks)} task(s):")
    for task in tasks:
        print(f" - {task['id']} from {task['file']}")

    if OpenAI is None:
        print("[run_local_tasks] ERROR: 'openai' module is required. Run 'pip install openai'.", file=sys.stderr)
        return 1

    client = OpenAI(base_url=API_URL, api_key=API_KEY, timeout=TIMEOUT)
    output_dir = ROOT / "docs" / "local-task-output"
    output_dir.mkdir(parents=True, exist_ok=True)

    for task in tasks:
        print(f"\nRunning {task['id']}...")
        try:
            result = run_task(client, task)
            out = output_dir / f"{task['id']}.md"
            out.write_text(result, encoding="utf-8")
            print(f"Saved: {out}")
        except Exception as exc:
            print(f"[run_local_tasks] ERROR on {task['id']}: {repr(exc)}", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
