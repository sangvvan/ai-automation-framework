#!/usr/bin/env python3
"""
scripts/sprint_runner.py
Scrum Sprint command engine.

Commands:
  plan   <sprint-id|next> [us-ids...]  -- Select US for sprint, create SPRINT-{n}.md
  start  [sprint-id]                   -- Run full SDLC pipeline for every US in sprint
  status [sprint-id]                   -- Print current sprint state
  report [sprint-id]                   -- Generate sprint report (velocity, burndown, tests)
  retro  [sprint-id]                   -- Retrospective via Scrum agent

Usage (via run.sh):
  ./scripts/run.sh /sprint plan SPRINT-001 US-001 US-002 US-003
  ./scripts/run.sh /sprint start
  ./scripts/run.sh /sprint status
  ./scripts/run.sh /sprint report
  ./scripts/run.sh /sprint retro
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
SPRINTS_DIR = ROOT / "docs" / "sprints"
US_DIR = ROOT / "docs" / "user-stories"
TASKS_DIR = ROOT / "docs" / "tasks"


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
        # strip inline comments
        value = value.split("#")[0].strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


# ── YAML-like frontmatter helpers ─────────────────────────────────────────────
def parse_frontmatter(text: str) -> dict:
    """Extract simple YAML frontmatter (key: value pairs only)."""
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
                # parse inline list
                if val.startswith("[") and val.endswith("]"):
                    inner = val[1:-1].strip()
                    result[key] = [v.strip().strip('"').strip("'") for v in inner.split(",") if v.strip()] if inner else []
                else:
                    result[key] = val
    return result


def read_frontmatter(path: Path) -> dict:
    if not path.exists():
        return {}
    return parse_frontmatter(path.read_text(errors="ignore"))


def update_frontmatter_field(path: Path, field: str, value: str) -> None:
    """Update a single frontmatter field in-place."""
    if not path.exists():
        return
    text = path.read_text(errors="ignore")
    pattern = re.compile(rf"^({re.escape(field)}\s*:).*$", re.MULTILINE)
    if pattern.search(text):
        text = pattern.sub(rf"\1 {value}", text)
    path.write_text(text, encoding="utf-8")


# ── Sprint ID helpers ─────────────────────────────────────────────────────────
def list_sprint_files() -> list[Path]:
    if not SPRINTS_DIR.exists():
        return []
    return sorted(SPRINTS_DIR.glob("SPRINT-*.md"))


def next_sprint_id() -> str:
    existing = list_sprint_files()
    if not existing:
        return "SPRINT-001"
    nums = [int(re.search(r"\d+", p.stem).group()) for p in existing if re.search(r"\d+", p.stem)]
    return f"SPRINT-{max(nums) + 1:03d}"


def resolve_sprint_id(arg: Optional[str]) -> str:
    """Return sprint id string. If arg is None/empty, return active or latest sprint."""
    if arg and arg.upper().startswith("SPRINT-"):
        return arg.upper()
    files = list_sprint_files()
    if not files:
        print("No sprint files found. Run: ./scripts/run.sh /sprint plan")
        sys.exit(1)
    # prefer active sprint
    for f in reversed(files):
        fm = read_frontmatter(f)
        if fm.get("status") == "active":
            return fm.get("id", f.stem.upper())
    # fallback: latest
    fm = read_frontmatter(files[-1])
    return fm.get("id", files[-1].stem.upper())


def sprint_path(sprint_id: str) -> Path:
    return SPRINTS_DIR / f"{sprint_id}.md"


# ── US helpers ────────────────────────────────────────────────────────────────
def get_us_points(us_id: str) -> int:
    path = US_DIR / f"{us_id}.md"
    if not path.exists():
        return 0
    fm = read_frontmatter(path)
    try:
        return int(fm.get("points", 0))
    except (ValueError, TypeError):
        return 0


def get_us_status(us_id: str) -> str:
    path = US_DIR / f"{us_id}.md"
    if not path.exists():
        return "unknown"
    return read_frontmatter(path).get("status", "todo")


def get_us_title(us_id: str) -> str:
    path = US_DIR / f"{us_id}.md"
    if not path.exists():
        return us_id
    return read_frontmatter(path).get("title", us_id)


def count_tasks_for_us(us_id: str) -> dict:
    result = {"total": 0, "done": 0, "todo": 0, "blocked": 0}
    if not TASKS_DIR.exists():
        return result
    for tf in TASKS_DIR.glob("TASK-*.md"):
        fm = read_frontmatter(tf)
        if fm.get("traces_to", "").upper() == us_id.upper():
            result["total"] += 1
            st = fm.get("status", "todo")
            if st == "done":
                result["done"] += 1
            elif st == "blocked":
                result["blocked"] += 1
            else:
                result["todo"] += 1
    return result


# ── Agent runner wrapper ───────────────────────────────────────────────────────
def run_agent(role: str, prompt: str, provider: str = "") -> int:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        f.write(prompt)
        pfile = f.name
    cmd = ["python3", str(ROOT / "scripts" / "agent_runner.py"), "--role", role, "--prompt-file", pfile]
    if provider:
        cmd += ["--provider", provider]
    rc = subprocess.call(cmd)
    Path(pfile).unlink(missing_ok=True)
    return rc


# ── Orchestrate one phase for one US ─────────────────────────────────────────
def run_phase_for_us(phase: str, us_id: str, provider_override: str = "") -> int:
    """Delegate to orchestrate.sh for a single phase+US."""
    cmd = [
        "bash",
        str(ROOT / "scripts" / "orchestrate.sh"),
        f"/{phase}",
        us_id,
        provider_override,
        "",   # mode
        "",   # only
        "",   # from
        "",   # skip
    ]
    return subprocess.call(cmd)


# ── PLAN ──────────────────────────────────────────────────────────────────────
def cmd_plan(sprint_id: str, us_ids: list[str], goal: str, duration_days: int) -> None:
    SPRINTS_DIR.mkdir(parents=True, exist_ok=True)

    # If the Planning Agent already created sprint files, just list them
    existing_files = list_sprint_files()
    if existing_files and not us_ids:
        print("\n  Sprint files already created by the Planning Agent:\n")
        for sf in existing_files:
            fm = read_frontmatter(sf)
            stories = fm.get("user_stories", [])
            pts = fm.get("points_planned", "?")
            status = fm.get("status", "planning")
            print(f"  {fm.get('id', sf.stem):<12} [{status:<9}]  {pts} pts  stories: {', '.join(stories)}")
        print(f"\n  To start a sprint:  ./scripts/run.sh /sprint start {existing_files[0].stem}")
        return

    # Validate US files exist
    missing = [u for u in us_ids if not (US_DIR / f"{u}.md").exists()]
    if missing:
        print(f"WARNING: User story files not found: {', '.join(missing)}")
        print("  Create them first with: ./scripts/run.sh /ba \"description\"")

    total_points = sum(get_us_points(u) for u in us_ids)
    start = date.today()
    end = start + timedelta(days=duration_days)

    us_list_yaml = "[" + ", ".join(us_ids) + "]"
    us_table_rows = "".join(
        f"| {u} | {get_us_title(u)} | {get_us_points(u)} | {get_us_status(u)} |\n"
        for u in us_ids
    )
    content = f"""---
id               : {sprint_id}
goal             : "{goal}"
status           : planning
start            : {start}
end              : {end}
duration         : {duration_days} days
points_planned   : {total_points}
points_completed : 0
user_stories     : {us_list_yaml}
---

# {sprint_id} — Sprint Plan

## Goal
{goal}

## Duration
{start} -> {end} ({duration_days} days)

## User Stories

| US | Title | Points | Status |
|----|-------|--------|--------|
{us_table_rows}
## Sprint Capacity
- Points planned : {total_points}
- Stories        : {len(us_ids)}

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

    out = sprint_path(sprint_id)
    out.write_text(content, encoding="utf-8")
    print(f"\n✓ Sprint plan created: {out.relative_to(ROOT)}")
    print(f"  Stories : {', '.join(us_ids)}")
    print(f"  Points  : {total_points}")
    print(f"  Duration: {start} → {end}")
    print(f"\nNext: ./scripts/run.sh /sprint start {sprint_id}")


# ── START / RUN ───────────────────────────────────────────────────────────────
def cmd_start(sprint_id: str, from_phase: str = "", skip_phases: str = "", provider_override: str = "") -> None:
    path = sprint_path(sprint_id)
    if not path.exists():
        # Help the user discover what sprints are available
        files = list_sprint_files()
        if files:
            print(f"\nSprint '{sprint_id}' not found. Available sprints:")
            for sf in files:
                fm = read_frontmatter(sf)
                stories = fm.get("user_stories", [])
                print(f"  {fm.get('id', sf.stem):<12} [{fm.get('status','?'):<9}]  "
                      f"stories: {', '.join(stories)}")
            print(f"\nRun: ./scripts/run.sh /sprint start {files[0].stem}")
        else:
            print("No sprint files found. Run: ./scripts/run.sh /planning \"description\"")
            print("The Planning Agent will create sprint files automatically.")
        sys.exit(1)

    fm = read_frontmatter(path)
    us_ids: list[str] = fm.get("user_stories", [])
    if not us_ids:
        print("No user_stories listed in sprint file.")
        sys.exit(1)

    skip_set = {p.strip() for p in skip_phases.split(",") if p.strip()}
    from_phase = from_phase.strip()

    # Mark sprint active
    update_frontmatter_field(path, "status", "active")
    print(f"\n{'═'*60}")
    print(f"  Starting {sprint_id}  —  {len(us_ids)} user stories")
    print(f"  Provider : {provider_override or 'auto (per-phase config)'}")
    print(f"{'═'*60}")

    pipeline = ["planning", "advisor", "design", "implementation", "qa", "devops"]
    if from_phase:
        try:
            idx = pipeline.index(from_phase)
            pipeline = pipeline[idx:]
        except ValueError:
            print(f"Unknown --from phase: {from_phase}")

    scrum_provider = os.environ.get("SCRUM_PROVIDER", "claude")
    total_us = len(us_ids)

    for i, us_id in enumerate(us_ids, 1):
        print(f"\n{'─'*60}")
        print(f"  Story {i}/{total_us}: {us_id} — {get_us_title(us_id)}")
        print(f"{'─'*60}")

        for phase in pipeline:
            if phase in skip_set:
                print(f"  [SKIP] {phase}")
                _log_phase(path, phase, us_id, "skipped")
                continue

            print(f"\n  ▶ Phase: {phase}")
            phase_provider = provider_override or os.environ.get(f"{phase.upper()}_PROVIDER", scrum_provider)
            rc = run_phase_for_us(
                phase,
                us_id,
                phase_provider,
            )
            status = "done" if rc == 0 else "failed"
            _log_phase(path, phase, us_id, status)

            if rc != 0 and phase in ("implementation", "qa"):
                print(f"\n  ✗ Phase {phase} failed for {us_id} — marking blocked")
                _set_us_status_in_sprint(path, us_id, "blocked")
                break
        else:
            _set_us_status_in_sprint(path, us_id, "done")

    # Update points_completed
    _recalc_points(path)
    print(f"\n{'═'*60}")
    print(f"  {sprint_id} execution complete.")
    print(f"  Run: ./scripts/run.sh /sprint report {sprint_id}")
    print(f"{'═'*60}\n")


def _log_phase(sprint_path: Path, phase: str, us_id: str, status: str) -> None:
    from datetime import datetime
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    row = f"| {phase:<14} | {us_id:<6} | {status:<7} | {ts} | |\n"
    text = sprint_path.read_text(errors="ignore")
    # append after last table row in Phase Log section
    insert_marker = "## Definition of Done"
    text = text.replace(insert_marker, f"{row}{insert_marker}")
    sprint_path.write_text(text, encoding="utf-8")


def _set_us_status_in_sprint(sprint_path: Path, us_id: str, status: str) -> None:
    path = US_DIR / f"{us_id}.md"
    if path.exists():
        update_frontmatter_field(path, "status", status)


def _recalc_points(sprint_path: Path) -> None:
    fm = read_frontmatter(sprint_path)
    us_ids: list[str] = fm.get("user_stories", [])
    completed_pts = sum(
        get_us_points(u) for u in us_ids if get_us_status(u) == "done"
    )
    update_frontmatter_field(sprint_path, "points_completed", str(completed_pts))


# ── STATUS ────────────────────────────────────────────────────────────────────
def cmd_status(sprint_id: str) -> None:
    path = sprint_path(sprint_id)
    if not path.exists():
        print(f"Sprint not found: {sprint_id}")
        sys.exit(1)

    fm = read_frontmatter(path)
    us_ids: list[str] = fm.get("user_stories", [])

    print(f"\n{'═'*60}")
    print(f"  {sprint_id} — {fm.get('goal', '')}")
    print(f"{'═'*60}")
    print(f"  Status  : {fm.get('status', 'unknown')}")
    print(f"  Dates   : {fm.get('start', '?')} → {fm.get('end', '?')}")
    print(f"  Points  : {fm.get('points_completed', 0)} / {fm.get('points_planned', 0)} completed")
    print(f"\n  User Stories:")

    done_count = 0
    for us_id in us_ids:
        st = get_us_status(us_id)
        tasks = count_tasks_for_us(us_id)
        pts = get_us_points(us_id)
        flag = "✓" if st == "done" else ("✗" if st == "blocked" else "·")
        print(f"    {flag} {us_id:<8} [{st:<11}] {pts}pts  tasks:{tasks['done']}/{tasks['total']}  {get_us_title(us_id)[:50]}")
        if st == "done":
            done_count += 1

    pct = int(done_count / len(us_ids) * 100) if us_ids else 0
    print(f"\n  Progress: {done_count}/{len(us_ids)} stories done ({pct}%)")
    print()


# ── REPORT ────────────────────────────────────────────────────────────────────
def cmd_report(sprint_id: str, provider: str = "") -> None:
    path = sprint_path(sprint_id)
    if not path.exists():
        print(f"Sprint not found: {sprint_id}")
        sys.exit(1)

    fm = read_frontmatter(path)
    us_ids: list[str] = fm.get("user_stories", [])
    planned = int(fm.get("points_planned", 0))
    completed = int(fm.get("points_completed", 0))
    velocity_pct = int(completed / planned * 100) if planned else 0

    # Collect test results
    coverage_file = ROOT / "coverage" / "coverage-summary.json"
    coverage_info = ""
    if coverage_file.exists():
        try:
            cov = json.loads(coverage_file.read_text())
            total = cov.get("total", {})
            coverage_info = (
                f"Lines: {total.get('lines', {}).get('pct', '?')}%  "
                f"Branches: {total.get('branches', {}).get('pct', '?')}%  "
                f"Functions: {total.get('functions', {}).get('pct', '?')}%"
            )
        except Exception:
            coverage_info = "Coverage data unreadable"

    # Collect playwright results
    pw_results = _collect_playwright_results()

    # Collect bugs
    bugs = _collect_bugs_for_sprint(us_ids)

    # Build story table
    story_rows = []
    for us_id in us_ids:
        st = get_us_status(us_id)
        tasks = count_tasks_for_us(us_id)
        pts = get_us_points(us_id)
        story_rows.append(
            f"| {us_id} | {get_us_title(us_id)[:45]} | {pts} | {st} | {tasks['done']}/{tasks['total']} |"
        )

    report_content = f"""---
id       : REPORT-{sprint_id}
sprint   : {sprint_id}
type     : sprint-report
date     : {date.today()}
velocity : {velocity_pct}%
---

# Sprint Report — {sprint_id}

**Goal**: {fm.get('goal', '')}
**Period**: {fm.get('start', '?')} → {fm.get('end', '?')}
**Generated**: {date.today()}

---

## Velocity

| Metric | Value |
|--------|-------|
| Points planned   | {planned} |
| Points completed | {completed} |
| Velocity         | {velocity_pct}% |
| Stories planned  | {len(us_ids)} |
| Stories done     | {sum(1 for u in us_ids if get_us_status(u) == 'done')} |
| Stories blocked  | {sum(1 for u in us_ids if get_us_status(u) == 'blocked')} |

## Story Summary

| US | Title | Points | Status | Tasks Done/Total |
|----|-------|--------|--------|------------------|
{chr(10).join(story_rows)}

## Test Results

### Unit / Integration (Vitest)
{coverage_info if coverage_info else "No coverage data found. Run: npm run test -- --coverage"}

### E2E (Playwright)
{pw_results}

## Bugs Found

{bugs if bugs else "No bugs filed during this sprint."}

## Traceability Snapshot

See: docs/traceability.md

---

*Generated by sprint_runner.py — {date.today()}*
"""

    out_dir = ROOT / "output" / "reports"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{sprint_id}-report.md"
    out_file.write_text(report_content, encoding="utf-8")

    # Mark sprint completed
    update_frontmatter_field(path, "status", "completed")

    print(f"\n✓ Sprint report saved: {out_file.relative_to(ROOT)}")
    print(f"  Velocity: {completed}/{planned} points ({velocity_pct}%)")
    print(f"  Stories : {sum(1 for u in us_ids if get_us_status(u) == 'done')}/{len(us_ids)} done")
    if coverage_info:
        print(f"  Coverage: {coverage_info}")


def _collect_playwright_results() -> str:
    result_dir = ROOT / "test-results"
    if not result_dir.exists():
        return "No Playwright results found. Run: npx playwright test"
    json_files = list(result_dir.rglob("*.json"))
    if not json_files:
        return "No Playwright JSON reports found."
    lines = []
    for jf in sorted(json_files)[:5]:
        try:
            data = json.loads(jf.read_text())
            suites = data.get("suites", [])
            total = sum(s.get("specs", [{}]).__len__() for s in suites)
            lines.append(f"- {jf.name}: {total} specs")
        except Exception:
            lines.append(f"- {jf.name}: (parse error)")
    return "\n".join(lines) if lines else "No readable Playwright results."


def _collect_bugs_for_sprint(us_ids: list[str]) -> str:
    bugs_dir = ROOT / "docs" / "bugs"
    if not bugs_dir.exists():
        return ""
    rows = []
    for bf in sorted(bugs_dir.glob("BUG-*.md")):
        fm = read_frontmatter(bf)
        for us_id in us_ids:
            if fm.get("traces_to", "").upper() == us_id.upper():
                rows.append(
                    f"- [{fm.get('id', bf.stem)}] [{fm.get('severity', '?')}] "
                    f"{fm.get('title', bf.stem)} — {us_id}"
                )
    return "\n".join(rows) if rows else ""


# ── RETRO ─────────────────────────────────────────────────────────────────────
def cmd_retro(sprint_id: str, provider: str = "") -> None:
    path = sprint_path(sprint_id)
    fm = read_frontmatter(path) if path.exists() else {}
    us_ids: list[str] = fm.get("user_stories", [])
    planned = fm.get("points_planned", "?")
    completed = fm.get("points_completed", "?")

    report_file = ROOT / "output" / "reports" / f"{sprint_id}-report.md"
    report_context = ""
    if report_file.exists():
        report_context = report_file.read_text(errors="ignore")[:3000]

    prompt = f"""You are the Scrum Master agent. Generate a sprint retrospective.

Sprint: {sprint_id}
Goal  : {fm.get('goal', 'Not set')}
Period: {fm.get('start', '?')} → {fm.get('end', '?')}
Points: {completed} / {planned} completed
Stories in sprint: {', '.join(us_ids)}

Sprint report excerpt:
{report_context}

Read docs/traceability.md for phase completion data.
Read output/reports/ for any available test results.

Generate the retrospective using this exact format:

---
id     : RETRO-{sprint_id}
sprint : {sprint_id}
date   : {date.today()}
---

# Retrospective — {sprint_id}

## What went well
- (at least 3 bullet points from evidence in phase logs and test results)

## What could be improved
- (at least 3 specific, actionable items)

## Action items for next sprint
| # | Action | Owner | Priority |
|---|--------|-------|----------|
| 1 | ... | Team | high |

## Velocity analysis
- Points planned vs completed
- Trend vs previous sprints (if data available)
- Blocking patterns

## Recommendations
(2-3 sentences on process improvements)

Save the retrospective to: output/reports/retro-{sprint_id}.md

Then STOP.
"""
    effective_provider = provider or os.environ.get("SCRUM_PROVIDER", "claude")
    rc = run_agent("scrum", prompt, effective_provider)
    if rc == 0:
        print(f"\n✓ Retrospective generated: output/reports/retro-{sprint_id}.md")
    else:
        print(f"\n✗ Retrospective agent returned code {rc}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    load_env()

    parser = argparse.ArgumentParser(description="Sprint runner for SDLC Scrum")
    parser.add_argument("subcommand", choices=["plan", "start", "run", "status", "report", "retro"])
    parser.add_argument("args", nargs="*", help="Sprint ID and/or US IDs")
    parser.add_argument("--goal", default="", help="Sprint goal (for plan)")
    parser.add_argument("--duration", type=int, default=14, help="Sprint duration in days (default 14)")
    parser.add_argument("--from", dest="from_phase", default="", help="Start pipeline from this phase")
    parser.add_argument("--skip", default="", help="Comma-separated phases to skip")
    parser.add_argument("--provider", default="", help="Override LLM provider")
    args = parser.parse_args()

    sub = args.subcommand
    positional = [a for a in args.args]

    if sub == "plan":
        # usage: plan [sprint-id] [US-001 US-002 ...]
        sprint_id = next_sprint_id()
        us_ids: list[str] = []
        for a in positional:
            if a.upper().startswith("SPRINT-"):
                sprint_id = a.upper()
            elif re.match(r"US-\d+", a, re.IGNORECASE):
                us_ids.append(a.upper())
        if not us_ids:
            # Try reading backlog
            backlog = SPRINTS_DIR / "backlog.md"
            if backlog.exists():
                text = backlog.read_text(errors="ignore")
                us_ids = re.findall(r"\bUS-\d+\b", text)
                us_ids = list(dict.fromkeys(us_ids))  # deduplicate, preserve order
            if not us_ids:
                print("Usage: ./scripts/run.sh /sprint plan [SPRINT-id] US-001 US-002 ...")
                print("       Or populate docs/sprints/backlog.md with US IDs")
                sys.exit(1)
        goal = args.goal or f"Complete {', '.join(us_ids[:3])}" + (" ..." if len(us_ids) > 3 else "")
        cmd_plan(sprint_id, us_ids, goal, args.duration)

    elif sub in ("start", "run"):
        sprint_id = resolve_sprint_id(positional[0] if positional else None)
        cmd_start(sprint_id, args.from_phase, args.skip, args.provider)

    elif sub == "status":
        sprint_id = resolve_sprint_id(positional[0] if positional else None)
        cmd_status(sprint_id)

    elif sub == "report":
        sprint_id = resolve_sprint_id(positional[0] if positional else None)
        cmd_report(sprint_id, args.provider)

    elif sub == "retro":
        sprint_id = resolve_sprint_id(positional[0] if positional else None)
        cmd_retro(sprint_id, args.provider)


if __name__ == "__main__":
    main()
