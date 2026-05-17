#!/usr/bin/env python3
"""
scripts/project_runner.py
Project-level workflow engine.

Entry points:
  run REQ-001            — full pipeline for one requirement
  run all                — full pipeline for every requirement (sequential)
  run all --parallel     — full pipeline for every requirement (parallel)
  retry REQ-001          — re-run only blocked/todo US under a requirement

After every run:
  - orchestrate.sh writes output/run-status/{REQ}.json with phase result
  - Non-done US are marked blocked if a critical phase failed
  - BUG-{n}.md is created for each newly blocked US
  - Blocked + todo US → distributed into sprint files (auto-triage)
  - output/reports/project-status.md is written

The user then picks a sprint:
  ./scripts/run.sh /sprint start SPRINT-001

Usage (via run.sh):
  ./scripts/run.sh /feature REQ-001
  ./scripts/run.sh /feature all
  ./scripts/run.sh /feature all --parallel
  ./scripts/run.sh /feature retry REQ-001
  ./scripts/run.sh /project status
  ./scripts/run.sh /project triage
"""

import argparse
import concurrent.futures
import json
import os
import re
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQ_DIR    = ROOT / "docs" / "requirements"
US_DIR     = ROOT / "docs" / "user-stories"
TASK_DIR   = ROOT / "docs" / "tasks"
BUG_DIR    = ROOT / "docs" / "bugs"
SPRINT_DIR = ROOT / "docs" / "sprints"
REPORT_DIR = ROOT / "output" / "reports"
RUN_STATUS_DIR = ROOT / "output" / "run-status"


# ── Config ────────────────────────────────────────────────────────────────────
def load_env() -> None:
    cfg = ROOT / ".agent" / "config" / "agent.config"
    if not cfg.exists():
        return
    for line in cfg.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.split("#")[0].strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


# ── Frontmatter helpers ───────────────────────────────────────────────────────
def parse_frontmatter(text: str) -> dict:
    result: dict = {}
    in_fm = False
    for i, line in enumerate(text.splitlines()):
        if i == 0 and line.strip() == "---":
            in_fm = True
            continue
        if in_fm:
            if line.strip() == "---":
                break
            m = re.match(r"^(\w[\w_]*):\s*(.*)$", line)
            if m:
                key, val = m.group(1), m.group(2).strip().strip('"').strip("'")
                if val.startswith("[") and val.endswith("]"):
                    inner = val[1:-1].strip()
                    result[key] = [v.strip().strip('"').strip("'") for v in inner.split(",") if v.strip()] if inner else []
                else:
                    result[key] = val
    return result


def read_fm(path: Path) -> dict:
    return parse_frontmatter(path.read_text(errors="ignore")) if path.exists() else {}


def update_fm_field(path: Path, field: str, value: str) -> None:
    if not path.exists():
        return
    text = path.read_text(errors="ignore")
    pattern = re.compile(rf"^({re.escape(field)}\s*:).*$", re.MULTILINE)
    if pattern.search(text):
        path.write_text(pattern.sub(rf"\1 {value}", text), encoding="utf-8")


# ── REQ discovery ─────────────────────────────────────────────────────────────
def list_req_files() -> list[Path]:
    if not REQ_DIR.exists():
        return []
    files = sorted(REQ_DIR.glob("REQ-*.md"))
    # exclude superseded versions
    return [f for f in files if read_fm(f).get("status", "active") != "superseded"]


def req_id(path: Path) -> str:
    return read_fm(path).get("id", path.stem.upper())


def req_title(path: Path) -> str:
    return read_fm(path).get("title", path.stem)


def req_priority(path: Path) -> int:
    p = read_fm(path).get("priority", "medium").lower()
    return {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(p, 2)


# ── US helpers ────────────────────────────────────────────────────────────────
def us_for_req(req_id_str: str) -> list[Path]:
    if not US_DIR.exists():
        return []
    result = []
    for p in sorted(US_DIR.glob("US-*.md")):
        fm = read_fm(p)
        if fm.get("traces_to", "").upper() == req_id_str.upper():
            result.append(p)
    return result


def all_us() -> list[Path]:
    if not US_DIR.exists():
        return []
    return sorted(US_DIR.glob("US-*.md"))


def us_status(path: Path) -> str:
    return read_fm(path).get("status", "todo")


def us_points(path: Path) -> int:
    try:
        return int(read_fm(path).get("points", 3))
    except (ValueError, TypeError):
        return 3


def us_title(path: Path) -> str:
    return read_fm(path).get("title", path.stem)


def us_id(path: Path) -> str:
    return read_fm(path).get("id", path.stem.upper())


def has_tasks(us_id_str: str) -> bool:
    if not TASK_DIR.exists():
        return False
    for t in TASK_DIR.glob("TASK-*.md"):
        if read_fm(t).get("traces_to", "").upper() == us_id_str.upper():
            return True
    return False


# ── Bug helpers ───────────────────────────────────────────────────────────────
def open_bugs() -> list[Path]:
    if not BUG_DIR.exists():
        return []
    return [
        b for b in sorted(BUG_DIR.glob("BUG-*.md"))
        if read_fm(b).get("status", "open").lower() in ("open", "in-progress")
    ]


# ── Sprint helpers ────────────────────────────────────────────────────────────
def list_sprint_files() -> list[Path]:
    if not SPRINT_DIR.exists():
        return []
    return sorted(SPRINT_DIR.glob("SPRINT-*.md"))


def next_sprint_num() -> int:
    files = list_sprint_files()
    if not files:
        return 1
    nums = [int(re.search(r"\d+", f.stem).group()) for f in files if re.search(r"\d+", f.stem)]
    return max(nums) + 1 if nums else 1


def us_in_any_sprint(us_id_str: str) -> bool:
    for sf in list_sprint_files():
        fm = read_fm(sf)
        stories = fm.get("user_stories", [])
        if us_id_str.upper() in [s.upper() for s in stories]:
            return True
    return False


# ── Pipeline runner ───────────────────────────────────────────────────────────
def run_pipeline_for_req(req_id_str: str, skip_phases: str = "", from_phase: str = "", provider_override: str = "") -> int:
    """
    Run full SDLC pipeline for one requirement.
    Streams output to terminal AND captures it to output/run-status/{REQ}.log
    so the Fix Agent can read the error context.
    """
    RUN_STATUS_DIR.mkdir(parents=True, exist_ok=True)
    log_file = RUN_STATUS_DIR / f"{req_id_str}.log"

    cmd = [
        "bash",
        str(ROOT / "scripts" / "orchestrate.sh"),
        "/feature",
        req_id_str,
        provider_override,  # provider override
        "",          # mode
        "",          # only
        from_phase,  # from
        skip_phases,
    ]

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    with open(log_file, "w", encoding="utf-8") as lf:
        for line in proc.stdout:  # type: ignore[union-attr]
            print(line, end="", flush=True)
            lf.write(line)
    proc.wait()
    return proc.returncode


def read_run_log(req_id_str: str, tail_chars: int = 4000) -> str:
    """Return the last tail_chars of the pipeline log for error context."""
    log_file = RUN_STATUS_DIR / f"{req_id_str}.log"
    if not log_file.exists():
        return "(no log captured)"
    text = log_file.read_text(errors="ignore")
    return text[-tail_chars:] if len(text) > tail_chars else text


# ── Run-status reader ─────────────────────────────────────────────────────────
def read_run_status(req_id_str: str) -> dict:
    """Read the JSON status file written by orchestrate.sh for this REQ."""
    status_file = RUN_STATUS_DIR / f"{req_id_str}.json"
    if status_file.exists():
        try:
            return json.loads(status_file.read_text())
        except Exception:
            pass
    return {}


# ── Bug file creation ─────────────────────────────────────────────────────────
def next_bug_id() -> str:
    if not BUG_DIR.exists():
        return "BUG-001"
    existing = sorted(BUG_DIR.glob("BUG-*.md"))
    if not existing:
        return "BUG-001"
    nums = [int(re.search(r"\d+", f.stem).group()) for f in existing if re.search(r"\d+", f.stem)]
    return f"BUG-{max(nums) + 1:03d}"


def create_bug_file(us_id_str: str, failed_phase: str, req_id_str: str) -> str:
    """Create a BUG-{n}.md for a blocked user story. Returns the bug id."""
    BUG_DIR.mkdir(parents=True, exist_ok=True)
    bug_id = next_bug_id()
    us_path = US_DIR / f"{us_id_str}.md"
    us_title_str = read_fm(us_path).get("title", us_id_str) if us_path.exists() else us_id_str

    content = f"""---
id        : {bug_id}
title     : "{us_id_str} blocked at {failed_phase} phase"
status    : open
severity  : high
traces_to : {us_id_str}
req       : {req_id_str}
phase     : {failed_phase}
created_at: {date.today()}
---

# {bug_id} — {us_id_str} blocked at {failed_phase}

## User Story
{us_id_str}: {us_title_str}

## Failure
Phase `{failed_phase}` returned a non-zero exit code during the `/feature {req_id_str}` run.

## What to do
1. Check the terminal output for the `{failed_phase}` phase error above.
2. Fix the root cause (missing file, type error, test failure, etc.).
3. Re-run: `./scripts/run.sh /feature retry {req_id_str}`
   This re-runs only blocked/todo stories starting from `{failed_phase}`.

## Checklist
- [ ] Root cause identified
- [ ] Fix applied
- [ ] Retry succeeded
- [ ] US status updated to: done
- [ ] This BUG file status updated to: resolved
"""
    (BUG_DIR / f"{bug_id}.md").write_text(content, encoding="utf-8")
    return bug_id


# ── Mark blocked US after pipeline failure ────────────────────────────────────
def handle_pipeline_failure(req_id_str: str, rc: int) -> list[str]:
    """
    Called when orchestrate.sh exits non-zero.
    - Reads which phase failed from run-status file
    - Marks all non-done US under this REQ as blocked
    - Creates a BUG file for each newly blocked US
    Returns list of bug ids created.
    """
    status = read_run_status(req_id_str)
    failed_phase = status.get("failed_phase", "unknown")

    bug_ids = []
    for usp in us_for_req(req_id_str):
        st = us_status(usp)
        uid = us_id(usp)
        if st != "done":
            update_fm_field(usp, "status", "blocked")
            bug_id = create_bug_file(uid, failed_phase, req_id_str)
            bug_ids.append(bug_id)
            print(f"  ✗ {uid} → blocked  ({bug_id} created)")
    return bug_ids


# ── Blocker resolution strategies ────────────────────────────────────────────

BLOCKER_MODES = ("autofix", "ignore", "interactive")


def _phase_skip_list(status: dict, failed_phase: str) -> str:
    """Return comma-separated phases that already succeeded (to skip on retry)."""
    phase_results = status.get("phase_results", {})
    return ",".join(
        p for p, rc in phase_results.items()
        if isinstance(rc, int) and rc == 0 and p != failed_phase
    )


def autofix_and_retry(req_id_str: str, max_retries: int = 2, provider_override: str = "") -> bool:
    """
    Run the Fix Agent on the error log, then retry the pipeline from the
    failed phase. Returns True if eventually successful.
    """
    for attempt in range(1, max_retries + 1):
        status = read_run_status(req_id_str)
        failed_phase = status.get("failed_phase", "unknown")
        error_log = read_run_log(req_id_str)

        print(f"\n  {'─'*58}")
        print(f"  Auto-fix attempt {attempt}/{max_retries}  (phase: {failed_phase})")
        print(f"  {'─'*58}")

        # Collect blocked US context
        blocked_us = [us_id(p) for p in us_for_req(req_id_str) if us_status(p) != "done"]
        us_context = ", ".join(blocked_us) if blocked_us else req_id_str

        fix_prompt = f"""You are the Fix Agent operating in automated pipeline recovery mode.

A pipeline failure stopped the {req_id_str} workflow at phase: {failed_phase}
Affected user stories: {us_context}

Error log (last 4000 chars of pipeline output):
---
{error_log}
---

INSTRUCTIONS:
1. Read the error log above and identify the ROOT CAUSE precisely.
2. Read the relevant source files referenced in the error.
3. Apply the MINIMAL targeted fix — do NOT refactor or rewrite unrelated code.
4. If the error is a missing file: create it with the correct content.
5. If the error is a type/lint error: fix only that line.
6. If the error is a failing test: fix the test or the implementation it tests.
7. Commit the fix: fix({failed_phase}): {req_id_str} — <one-line description>

Output this exact block after fixing:
## Auto-fix Summary
- Root cause: (one sentence)
- File(s) changed: (list)
- Fix applied: (what you changed)
- Confidence: high | medium | low
"""
        _run_agent_inline("implementation", fix_prompt)

        # Reset blocked US to todo before retry
        for usp in us_for_req(req_id_str):
            if us_status(usp) == "blocked":
                update_fm_field(usp, "status", "todo")

        # Retry from the failed phase, skipping already-passed phases
        skip = _phase_skip_list(status, failed_phase)
        print(f"\n  Retrying from phase '{failed_phase}'...")
        rc = run_pipeline_for_req(req_id_str, skip_phases=skip, from_phase=failed_phase, provider_override=provider_override)

        if rc == 0:
            print(f"\n  ✓ Auto-fix succeeded on attempt {attempt}!")
            return True

        print(f"\n  ✗ Auto-fix attempt {attempt} did not resolve the issue.")

    print(f"\n  Auto-fix exhausted {max_retries} attempts — marking as blocked.")
    return False


def ask_human_about_blocker(req_id_str: str, failed_phase: str, blocked_us: list[str]) -> str:
    """
    Pause and ask the user what to do with a blocker.
    Returns: 'autofix' | 'ignore' | 'stop'
    """
    print(f"\n  {'═'*58}")
    print(f"  BLOCKER — {req_id_str}  (phase: {failed_phase})")
    print(f"  Affected stories: {', '.join(blocked_us)}")
    print(f"  {'─'*58}")
    print(f"  What would you like to do?")
    print(f"  [A] Auto-fix — run Fix Agent and retry automatically")
    print(f"  [S] Skip     — mark stories as blocked, continue with next requirement")
    print(f"  [Q] Stop     — halt here, keep error for manual investigation")
    print(f"  {'─'*58}")

    while True:
        try:
            choice = input("  Choice [A/S/Q]: ").strip().upper()
        except (EOFError, KeyboardInterrupt):
            print("\n  (no input — defaulting to Skip)")
            choice = "S"

        if choice in ("A", "S", "Q"):
            return {"A": "autofix", "S": "ignore", "Q": "stop"}[choice]
        print("  Please enter A, S, or Q.")


def resolve_blocker(
    req_id_str: str,
    rc: int,
    mode: str,
    max_retries: int = 2,
    provider_override: str = "",
) -> bool:
    """
    Central dispatcher for blocker resolution.
    mode: 'autofix' | 'ignore' | 'interactive'
    Returns True if the requirement is now passing (fixed), False if still blocked.
    """
    status = read_run_status(req_id_str)
    failed_phase = status.get("failed_phase", "unknown")
    blocked_us = [us_id(p) for p in us_for_req(req_id_str) if us_status(p) != "done"]

    if mode == "ignore":
        print(f"\n  --ignore-blocked: marking {', '.join(blocked_us)} as blocked and continuing.")
        handle_pipeline_failure(req_id_str, rc)
        return False

    if mode == "interactive":
        action = ask_human_about_blocker(req_id_str, failed_phase, blocked_us)
        if action == "stop":
            handle_pipeline_failure(req_id_str, rc)
            return False
        if action == "ignore":
            handle_pipeline_failure(req_id_str, rc)
            return False
        # action == "autofix" falls through

    # autofix (either explicit flag or user chose A in interactive)
    fixed = autofix_and_retry(req_id_str, max_retries=max_retries, provider_override=provider_override)
    if not fixed:
        handle_pipeline_failure(req_id_str, rc)
    return fixed


def _run_agent_inline(role: str, prompt: str) -> int:
    """Run agent_runner.py inline (streams to terminal)."""
    import tempfile
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        f.write(prompt)
        pfile = f.name
    rc = subprocess.call([
        "python3",
        str(ROOT / "scripts" / "agent_runner.py"),
        "--role", role,
        "--prompt-file", pfile,
    ])
    Path(pfile).unlink(missing_ok=True)
    return rc


# ── US completion scan ────────────────────────────────────────────────────────
def scan_us_completion(req_id_str: str) -> dict:
    """Return done/todo/blocked counts for US under a REQ."""
    paths = us_for_req(req_id_str)
    done, todo, blocked = [], [], []
    for p in paths:
        st = us_status(p)
        uid = us_id(p)
        if st == "done":
            done.append(uid)
        elif st == "blocked":
            blocked.append(uid)
        else:
            todo.append(uid)
    return {"done": done, "todo": todo, "blocked": blocked, "total": len(paths)}


# ── Auto-triage: pack incomplete US into sprints ──────────────────────────────
def auto_triage() -> list[str]:
    """
    Collect all incomplete US + blocked tasks and distribute into sprint files.
    Skips US already in a sprint. Returns list of sprint ids created/updated.
    """
    capacity = int(os.environ.get("SPRINT_CAPACITY", "20"))
    duration = int(os.environ.get("SPRINT_DURATION_DAYS", "14"))

    # Gather incomplete US, sorted by REQ priority then US id
    incomplete: list[tuple[int, Path]] = []
    for req_path in sorted(list_req_files(), key=req_priority):
        rid = req_id(req_path)
        for usp in us_for_req(rid):
            if us_status(usp) != "done" and not us_in_any_sprint(us_id(usp)):
                incomplete.append((req_priority(req_path), usp))

    if not incomplete:
        return []

    SPRINT_DIR.mkdir(parents=True, exist_ok=True)

    # Bin-pack into sprints
    sprint_groups: list[list[Path]] = []
    current_group: list[Path] = []
    current_pts = 0

    for _, usp in incomplete:
        pts = us_points(usp)
        if current_pts + pts > capacity and current_pts > 0:
            sprint_groups.append(current_group)
            current_group = []
            current_pts = 0
        current_group.append(usp)
        current_pts += pts
    if current_group:
        sprint_groups.append(current_group)

    start_num = next_sprint_num()
    created_sprints: list[str] = []
    today = date.today()

    for i, group in enumerate(sprint_groups):
        sprint_num = start_num + i
        sprint_id = f"SPRINT-{sprint_num:03d}"
        sprint_file = SPRINT_DIR / f"{sprint_id}.md"

        if sprint_file.exists():
            # Append unassigned US to existing planning sprint
            existing_fm = read_fm(sprint_file)
            existing_stories = existing_fm.get("user_stories", [])
            new_stories = [us_id(p) for p in group if us_id(p) not in existing_stories]
            if new_stories:
                all_stories = existing_stories + new_stories
                new_pts = sum(us_points(p) for p in group if us_id(p) in new_stories)
                old_pts = int(existing_fm.get("points_planned", 0))
                update_fm_field(sprint_file, "user_stories", "[" + ", ".join(all_stories) + "]")
                update_fm_field(sprint_file, "points_planned", str(old_pts + new_pts))
            created_sprints.append(sprint_id)
            continue

        # Create new sprint file
        us_ids_list = [us_id(p) for p in group]
        total_pts = sum(us_points(p) for p in group)
        sprint_start = today + timedelta(days=duration * i)
        sprint_end = sprint_start + timedelta(days=duration - 1)
        goal = "Complete " + ", ".join(us_ids_list[:3]) + (" ..." if len(us_ids_list) > 3 else "")

        us_table = "".join(
            f"| {us_id(p)} | {us_title(p)[:45]} | {us_points(p)} | {us_status(p)} |\n"
            for p in group
        )
        us_yaml = "[" + ", ".join(us_ids_list) + "]"

        content = f"""---
id               : {sprint_id}
goal             : "{goal}"
status           : planning
start            : {sprint_start}
end              : {sprint_end}
duration         : {duration} days
points_planned   : {total_pts}
points_completed : 0
user_stories     : {us_yaml}
---

# {sprint_id} — Sprint Plan

## Goal
{goal}

## Duration
{sprint_start} -> {sprint_end} ({duration} days)

## User Stories

| US | Title | Points | Status |
|----|-------|--------|--------|
{us_table}
## Sprint Capacity
- Points planned : {total_pts}
- Stories        : {len(us_ids_list)}

## Phase Log

| Phase | US | Status | Timestamp | Notes |
|-------|----|--------|-----------|-------|

## Definition of Done
- [ ] All US tasks status: done
- [ ] All acceptance criteria have passing Playwright tests
- [ ] traceability.md updated
- [ ] No failing CI jobs
- [ ] Sprint report generated
"""
        sprint_file.write_text(content, encoding="utf-8")
        created_sprints.append(sprint_id)
        print(f"  ✓ {sprint_id}: {', '.join(us_ids_list)} ({total_pts} pts)")

    return created_sprints


# ── Project status report ─────────────────────────────────────────────────────
def write_project_status_report() -> Path:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    today = date.today()

    req_rows = []
    all_done, all_todo, all_blocked = [], [], []

    for rp in sorted(list_req_files(), key=req_priority):
        rid = req_id(rp)
        completion = scan_us_completion(rid)
        all_done += completion["done"]
        all_todo += completion["todo"]
        all_blocked += completion["blocked"]
        total = completion["total"]
        done_n = len(completion["done"])
        status_icon = "✓" if done_n == total and total > 0 else ("⚠" if done_n > 0 else "·")
        req_rows.append(
            f"| {rid} | {req_title(rp)[:50]} | {done_n}/{total} | "
            f"{read_fm(rp).get('priority','?')} | {status_icon} |"
        )

    # Incomplete US table
    incomplete_rows = []
    for usp in all_us():
        st = us_status(usp)
        if st != "done":
            uid = us_id(usp)
            fm = read_fm(usp)
            sprint_assigned = next(
                (read_fm(sf).get("id", sf.stem) for sf in list_sprint_files()
                 if uid in read_fm(sf).get("user_stories", [])),
                "—"
            )
            incomplete_rows.append(
                f"| {uid} | {us_title(usp)[:45]} | {fm.get('traces_to','?')} | "
                f"{st} | {sprint_assigned} |"
            )

    # Bug table
    bug_rows = []
    for bp in open_bugs():
        fm = read_fm(bp)
        bug_rows.append(
            f"| {fm.get('id', bp.stem)} | {fm.get('traces_to','?')} | "
            f"{fm.get('severity','?')} | {fm.get('title', bp.stem)[:50]} |"
        )

    # Sprint table
    sprint_rows = []
    for sf in list_sprint_files():
        fm = read_fm(sf)
        stories = fm.get("user_stories", [])
        pts_done = fm.get("points_completed", 0)
        pts_plan = fm.get("points_planned", "?")
        sprint_rows.append(
            f"| {fm.get('id', sf.stem)} | {', '.join(stories[:4])}{'...' if len(stories) > 4 else ''} "
            f"| {pts_done}/{pts_plan} pts | {fm.get('status','?')} |"
        )

    total_us = len(all_done) + len(all_todo) + len(all_blocked)
    pct = int(len(all_done) / total_us * 100) if total_us else 0

    req_table = "\n".join(req_rows) if req_rows else "| — | No requirements found | — | — | — |"
    incomplete_table = "\n".join(incomplete_rows) if incomplete_rows else "| — | All user stories complete! | — | — | — |"
    bug_table = "\n".join(bug_rows) if bug_rows else "No open bugs."
    sprint_table = "\n".join(sprint_rows) if sprint_rows else "No sprints planned yet."

    next_sprint_cmd = ""
    for sf in list_sprint_files():
        fm = read_fm(sf)
        if fm.get("status") in ("planning", "active"):
            next_sprint_cmd = f"./scripts/run.sh /sprint start {fm.get('id', sf.stem)}"
            break

    report = f"""---
type      : project-status
date      : {today}
us_total  : {total_us}
us_done   : {len(all_done)}
us_todo   : {len(all_todo)}
us_blocked: {len(all_blocked)}
completion: {pct}%
---

# Project Status — {today}

## Summary

| Metric | Value |
|--------|-------|
| Requirements | {len(list_req_files())} |
| User stories total | {total_us} |
| User stories done | {len(all_done)} ({pct}%) |
| User stories todo | {len(all_todo)} |
| User stories blocked | {len(all_blocked)} |
| Open bugs | {len(open_bugs())} |
| Sprints planned | {len(list_sprint_files())} |

## Requirements

| REQ | Title | US done/total | Priority | Status |
|-----|-------|---------------|----------|--------|
{req_table}

## Incomplete User Stories

| US | Title | REQ | Status | Sprint |
|----|-------|-----|--------|--------|
{incomplete_table}

## Open Bugs

| BUG | US | Severity | Title |
|-----|----|----------|-------|
{bug_table}

## Sprints Planned

| Sprint | Stories | Points | Status |
|--------|---------|--------|--------|
{sprint_table}

---

## Next step
{"Run: `" + next_sprint_cmd + "`" if next_sprint_cmd else "All sprints complete or no sprints planned yet."}

*Generated by project_runner.py — {today}*
"""

    out = REPORT_DIR / "project-status.md"
    out.write_text(report, encoding="utf-8")
    return out


# ── Print dashboard to terminal ───────────────────────────────────────────────
def print_dashboard() -> None:
    print(f"\n{'═'*62}")
    print(f"  Project Status — {date.today()}")
    print(f"{'═'*62}")

    all_done_n, all_us_n = 0, 0
    for rp in sorted(list_req_files(), key=req_priority):
        rid = req_id(rp)
        c = scan_us_completion(rid)
        done_n = len(c["done"])
        total = c["total"]
        all_done_n += done_n
        all_us_n += total
        bar = "✓" if done_n == total and total > 0 else f"{done_n}/{total}"
        blocked_hint = f"  [{len(c['blocked'])} blocked]" if c["blocked"] else ""
        print(f"  {rid:<10} [{bar:<5}]  {read_fm(rp).get('priority','?'):<8}  {req_title(rp)[:40]}{blocked_hint}")

    pct = int(all_done_n / all_us_n * 100) if all_us_n else 0
    print(f"\n  Overall: {all_done_n}/{all_us_n} user stories done ({pct}%)")

    bugs = open_bugs()
    if bugs:
        print(f"\n  Open bugs: {len(bugs)}")
        for b in bugs[:5]:
            fm = read_fm(b)
            print(f"    [{fm.get('severity','?')}] {fm.get('id', b.stem)} — {fm.get('title', b.stem)[:50]}")

    sprints = list_sprint_files()
    if sprints:
        print(f"\n  Sprints:")
        for sf in sprints:
            fm = read_fm(sf)
            stories = fm.get("user_stories", [])
            pts_done = fm.get("points_completed", 0)
            pts_plan = fm.get("points_planned", "?")
            print(f"    {fm.get('id', sf.stem):<12} [{fm.get('status','?'):<9}]  "
                  f"{pts_done}/{pts_plan} pts  {len(stories)} stories")
        # Suggest next sprint
        for sf in sprints:
            fm = read_fm(sf)
            if fm.get("status") in ("planning",):
                print(f"\n  Next: ./scripts/run.sh /sprint start {fm.get('id', sf.stem)}")
                break

    report_file = REPORT_DIR / "project-status.md"
    if report_file.exists():
        print(f"\n  Report: {report_file.relative_to(ROOT)}")
    print()


# ── Single requirement run ────────────────────────────────────────────────────
def run_one(
    req_id_str: str,
    skip_phases: str = "",
    from_phase: str = "",
    blocker_mode: str = "interactive",
    max_retries: int = 2,
    provider_override: str = "",
) -> None:
    req_file = REQ_DIR / f"{req_id_str}.md"
    if not req_file.exists():
        matches = [f for f in list_req_files() if req_id(f).upper() == req_id_str.upper()]
        if not matches:
            print(f"REQ file not found: {req_id_str}")
            sys.exit(1)
        req_file = matches[0]
        req_id_str = req_id(req_file)

    print(f"\n{'═'*62}")
    print(f"  Running full pipeline: {req_id_str}")
    print(f"  {req_title(req_file)}")
    blocker_label = {"autofix": "--autofix", "ignore": "--ignore-blocked", "interactive": "interactive"}.get(blocker_mode, blocker_mode)
    print(f"  Blocker mode : {blocker_label}")
    print(f"{'═'*62}")

    rc = run_pipeline_for_req(req_id_str, skip_phases, from_phase=from_phase, provider_override=provider_override)

    print(f"\n{'─'*62}")
    final_rc = rc
    if rc != 0:
        status = read_run_status(req_id_str)
        failed_phase = status.get("failed_phase", "unknown")
        print(f"  {req_id_str} — Pipeline FAILED at phase '{failed_phase}' (exit {rc})")

        fixed = resolve_blocker(req_id_str, rc, blocker_mode, max_retries=max_retries, provider_override=provider_override)
        if fixed:
            print(f"  {req_id_str} — Recovered successfully!")
            final_rc = 0
        else:
            print(f"\n  Manual retry: ./scripts/run.sh /feature retry {req_id_str}")
    else:
        print(f"  {req_id_str} — Run complete")

    completion = scan_us_completion(req_id_str)
    print(f"  Done    : {', '.join(completion['done']) or '—'}")
    print(f"  Todo    : {', '.join(completion['todo']) or '—'}")
    print(f"  Blocked : {', '.join(completion['blocked']) or '—'}")

    if completion["todo"] or completion["blocked"]:
        print(f"\n  Triaging incomplete stories into sprints...")
        created = auto_triage()
        if created:
            print(f"  Sprints created/updated: {', '.join(created)}")

    report = write_project_status_report()
    print(f"  Report  : {report.relative_to(ROOT)}")
    print(f"{'═'*62}\n")

    if final_rc != 0:
        sys.exit(final_rc)


# ── All requirements run ──────────────────────────────────────────────────────
def run_all(parallel: bool = False, skip_phases: str = "", from_phase: str = "", blocker_mode: str = "interactive", max_retries: int = 2, provider_override: str = "") -> None:
    req_files = sorted(list_req_files(), key=req_priority)
    if not req_files:
        print("No REQ files found in docs/requirements/")
        sys.exit(1)

    print(f"\n{'═'*62}")
    print(f"  Running full pipeline: ALL {len(req_files)} requirements")
    mode_label = "parallel" if parallel else "sequential"
    print(f"  Mode: {mode_label}")
    print(f"{'═'*62}")

    # parallel mode forces autofix (can't pause for input on concurrent processes)
    effective_mode = blocker_mode
    if parallel and blocker_mode == "interactive":
        print(f"  Note: parallel mode uses --autofix (interactive not available in parallel)")
        effective_mode = "autofix"

    results: dict[str, int] = {}

    if parallel:
        def _run(rp: Path) -> tuple[str, int]:
            rid = req_id(rp)
            rc = run_pipeline_for_req(rid, skip_phases, from_phase=from_phase, provider_override=provider_override)
            if rc != 0:
                fixed = resolve_blocker(rid, rc, "autofix", max_retries=max_retries, provider_override=provider_override)
                return rid, 0 if fixed else rc
            return rid, rc

        with concurrent.futures.ProcessPoolExecutor() as ex:
            futures = {ex.submit(_run, rp): rp for rp in req_files}
            for future in concurrent.futures.as_completed(futures):
                rid, rc = future.result()
                results[rid] = rc
                icon = "✓" if rc == 0 else "✗"
                print(f"  {icon} {rid} complete (exit {rc})")
    else:
        for rp in req_files:
            rid = req_id(rp)
            print(f"\n  ▶ {rid} — {req_title(rp)}")
            rc = run_pipeline_for_req(rid, skip_phases, from_phase=from_phase, provider_override=provider_override)
            if rc != 0:
                fixed = resolve_blocker(rid, rc, effective_mode, max_retries=max_retries, provider_override=provider_override)
                rc = 0 if fixed else rc
            results[rid] = rc
            icon = "✓" if rc == 0 else "✗"
            print(f"  {icon} {rid} done (exit {rc})")

    # Summarise failures
    print(f"\n{'─'*62}")
    print(f"  Pipeline complete. US status:")
    remaining_failures = []
    for rp in req_files:
        rid = req_id(rp)
        rc_for_req = results.get(rid, 0)
        if rc_for_req != 0:
            remaining_failures.append(rid)
        c = scan_us_completion(rid)
        icon = "✓" if not c["blocked"] and not c["todo"] else ("✗" if c["blocked"] else "·")
        print(f"  {icon} {rid}: done={len(c['done'])} todo={len(c['todo'])} blocked={len(c['blocked'])}")

    if remaining_failures:
        print(f"\n  Still failing (manual retry needed):")
        for rid in remaining_failures:
            print(f"    ./scripts/run.sh /feature retry {rid}")

    # Auto-triage all incomplete US into sprints
    print(f"\n  Triaging all incomplete stories into sprints...")
    created = auto_triage()
    if created:
        print(f"  Sprints created/updated: {', '.join(created)}")
    else:
        print(f"  All stories already assigned to sprints or complete.")

    # Write project report
    report = write_project_status_report()
    print(f"\n  Project report: {report.relative_to(ROOT)}")

    # Print dashboard
    print_dashboard()

    # Suggest next action
    for sf in list_sprint_files():
        fm = read_fm(sf)
        if fm.get("status") == "planning":
            print(f"  Next: ./scripts/run.sh /sprint start {fm.get('id', sf.stem)}\n")
            break

    failed = [rid for rid, rc in results.items() if rc != 0]
    if failed:
        print(f"  WARNING: These requirements had failures: {', '.join(failed)}")
        sys.exit(1)


# ── Retry: re-run only blocked/todo US under a requirement ───────────────────
def retry_one(req_id_str: str, provider_override: str = "") -> None:
    """
    Re-run only the blocked/todo user stories under a requirement.
    Reads the last failed phase from run-status, resumes from there.
    """
    req_file = REQ_DIR / f"{req_id_str}.md"
    if not req_file.exists():
        matches = [f for f in list_req_files() if req_id(f).upper() == req_id_str.upper()]
        if not matches:
            print(f"REQ file not found: {req_id_str}")
            sys.exit(1)
        req_file = matches[0]
        req_id_str = req_id(req_file)

    completion = scan_us_completion(req_id_str)
    retry_targets = completion["blocked"] + completion["todo"]

    if not retry_targets:
        print(f"\n  {req_id_str}: all user stories are done. Nothing to retry.")
        return

    status = read_run_status(req_id_str)
    failed_phase = status.get("failed_phase", "")

    from_flag = f"--from={failed_phase}" if failed_phase else ""

    print(f"\n{'═'*62}")
    print(f"  Retrying {req_id_str} — {len(retry_targets)} stories: {', '.join(retry_targets)}")
    if failed_phase:
        print(f"  Resuming from phase: {failed_phase}")
    print(f"{'═'*62}")

    # Reset blocked US back to todo so the pipeline can process them
    for uid in retry_targets:
        usp = US_DIR / f"{uid}.md"
        if usp.exists() and us_status(usp) == "blocked":
            update_fm_field(usp, "status", "todo")
            print(f"  Reset {uid}: blocked → todo")

    # Close the old BUG files for these US (mark as retrying)
    if BUG_DIR.exists():
        for bp in BUG_DIR.glob("BUG-*.md"):
            fm = read_fm(bp)
            if fm.get("traces_to", "").upper() in [u.upper() for u in retry_targets]:
                if fm.get("status", "open") == "open":
                    update_fm_field(bp, "status", "retrying")

    # Build skip argument: skip phases that already succeeded
    phase_results = status.get("phase_results", {})
    skip_phases = ",".join(
        phase for phase, rc in phase_results.items()
        if isinstance(rc, int) and rc == 0 and phase != failed_phase
    )

    rc = run_pipeline_for_req(req_id_str, skip_phases, provider_override=provider_override)

    print(f"\n{'─'*62}")
    if rc != 0:
        print(f"  {req_id_str} — Retry FAILED again (exit {rc})")
        bugs = handle_pipeline_failure(req_id_str, rc)
        if bugs:
            print(f"  New bug files: {', '.join(bugs)}")
        print(f"\n  Check the error above and retry again:")
        print(f"    ./scripts/run.sh /feature retry {req_id_str}")
    else:
        print(f"  {req_id_str} — Retry succeeded!")
        # Close BUG files that are now resolved
        if BUG_DIR.exists():
            for bp in BUG_DIR.glob("BUG-*.md"):
                fm = read_fm(bp)
                if fm.get("traces_to", "").upper() in [u.upper() for u in retry_targets]:
                    update_fm_field(bp, "status", "resolved")
                    print(f"  Resolved: {fm.get('id', bp.stem)}")

    completion = scan_us_completion(req_id_str)
    print(f"  Done    : {', '.join(completion['done']) or '—'}")
    print(f"  Blocked : {', '.join(completion['blocked']) or '—'}")

    report = write_project_status_report()
    print(f"  Report  : {report.relative_to(ROOT)}")
    print(f"{'═'*62}\n")

    if rc != 0:
        sys.exit(rc)


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    load_env()

    parser = argparse.ArgumentParser(description="Project-level workflow runner")
    parser.add_argument("subcommand", choices=["run", "retry", "status", "triage"])
    parser.add_argument("target", nargs="?", default="",
                        help="REQ id (e.g. REQ-001), 'all', or for retry: REQ id")
    parser.add_argument("--parallel", action="store_true",
                        help="Run requirements in parallel (only for 'all')")
    parser.add_argument("--skip", default="",
                        help="Comma-separated phases to skip (e.g. devops)")
    parser.add_argument("--from", default="", dest="from_phase",
                        help="Resume from this phase (e.g. implement, design)")
    parser.add_argument("--provider", default="",
                        help="Override LLM provider for all phases")

    # Blocker mode flags (mutually exclusive)
    blocker_grp = parser.add_mutually_exclusive_group()
    blocker_grp.add_argument(
        "--autofix", action="store_true",
        help="Automatically run Fix Agent and retry on any blocker (no human input)",
    )
    blocker_grp.add_argument(
        "--ignore-blocked", action="store_true", dest="ignore_blocked",
        help="Skip blocked stories and continue; create BUG files but do not stop",
    )
    # (default is interactive — pause and ask)

    parser.add_argument("--max-retries", type=int, default=2, dest="max_retries",
                        help="Max auto-fix attempts per requirement (default 2)")

    args = parser.parse_args()

    # Resolve blocker mode
    if args.autofix:
        blocker_mode = "autofix"
    elif args.ignore_blocked:
        blocker_mode = "ignore"
    else:
        blocker_mode = "interactive"

    if args.subcommand == "run":
        target = args.target.strip().upper() if args.target else ""
        if not target:
            print("Usage: project_runner.py run REQ-001")
            print("       project_runner.py run all [--parallel]")
            sys.exit(1)
        if target == "ALL":
            run_all(
                parallel=args.parallel,
                skip_phases=args.skip,
                from_phase=args.from_phase,
                blocker_mode=blocker_mode,
                max_retries=args.max_retries,
                provider_override=args.provider,
            )
        else:
            run_one(
                target,
                skip_phases=args.skip,
                from_phase=args.from_phase,
                blocker_mode=blocker_mode,
                max_retries=args.max_retries,
                provider_override=args.provider,
            )

    elif args.subcommand == "retry":
        target = args.target.strip().upper() if args.target else ""
        if not target:
            blocked_reqs = []
            for rp in list_req_files():
                c = scan_us_completion(req_id(rp))
                if c["blocked"] or c["todo"]:
                    blocked_reqs.append(req_id(rp))
            if not blocked_reqs:
                print("Nothing to retry — all user stories are done.")
            else:
                print(f"Retrying: {', '.join(blocked_reqs)}")
                for rid in blocked_reqs:
                    retry_one(rid, provider_override=args.provider)
        else:
            retry_one(target, provider_override=args.provider)

    elif args.subcommand == "status":
        report = write_project_status_report()
        print_dashboard()
        print(f"  Full report: {report.relative_to(ROOT)}")

    elif args.subcommand == "triage":
        print("\n  Triaging incomplete user stories into sprints...")
        created = auto_triage()
        if created:
            print(f"  Sprints created/updated: {', '.join(created)}")
        else:
            print("  Nothing to triage.")
        report = write_project_status_report()
        print_dashboard()
        print(f"  Report: {report.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
