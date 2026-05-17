#!/usr/bin/env python3
"""
scripts/systemtest_runner.py
Unified System Test runner with modes:
  - systemtest  : functional + non-functional baseline
  - performance : performance only
  - security    : security only
  - full        : functional + non-functional + performance + security

Uses Playwright for all browser testing (chromium, firefox, webkit).
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT_DIR = ROOT / "docs" / "system-tests"
BUG_DIR = ROOT / "docs" / "bugs"


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def run(cmd: list[str], title: str) -> tuple[int, str]:
    print(f"\n▶ {title}")
    print("$ " + " ".join(cmd))
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(ROOT),
            text=True,
            capture_output=True,
            check=False,
        )
        output = ""
        if proc.stdout:
            print(proc.stdout)
            output += proc.stdout
        if proc.stderr:
            print(proc.stderr, file=sys.stderr)
            output += "\n[stderr]\n" + proc.stderr
        return proc.returncode, output
    except FileNotFoundError as exc:
        msg = f"Command not found: {cmd[0]} ({exc})"
        print(msg, file=sys.stderr)
        return 127, msg


def configured(value: str | None) -> bool:
    return bool(value and value.strip())


def web_test_command() -> list[str] | None:
    custom = os.environ.get("WEB_SYSTEMTEST_COMMAND", "").strip()
    if custom:
        return ["bash", "-lc", custom]

    package = ROOT / "package.json"
    if not package.exists():
        return None

    return ["npx", "playwright", "test", "--config", "playwright.system.config.ts"]


def performance_command() -> list[str] | None:
    custom = os.environ.get("PERFORMANCE_TEST_COMMAND", "").strip()
    if custom:
        return ["bash", "-lc", custom]
    return None


def security_command() -> list[str] | None:
    custom = os.environ.get("SECURITY_TEST_COMMAND", "").strip()
    if custom:
        return ["bash", "-lc", custom]
    return None


def run_functional(target: str) -> list[tuple[str, int, str]]:
    results = []

    web_cmd = web_test_command()
    if web_cmd:
        rc, out = run(web_cmd, f"Functional Web — Playwright ({target})")
        results.append(("functional-web", rc, out))
    else:
        msg = "Skipped: package.json not found or WEB_SYSTEMTEST_COMMAND not configured."
        print(f"[functional-web] {msg}")
        results.append(("functional-web", 0, msg))

    return results


def run_non_functional(target: str) -> list[tuple[str, int, str]]:
    notes = f"""
Non-functional baseline for {target}:
- Accessibility: verify semantic locators, axe-core per route (WCAG 2.1 AA).
- Stability: repeat primary flow, reload, back/forward navigation.
- Reliability: verify loading, empty, error states.
- Usability: verify primary action hierarchy and no dead-end screens.
""".strip()
    print("\n▶ Non-functional baseline")
    print(notes)
    return [("non-functional-baseline", 0, notes)]


def run_performance(target: str) -> list[tuple[str, int, str]]:
    cmd = performance_command()
    if cmd:
        rc, out = run(cmd, f"Performance Test ({target})")
        return [("performance", rc, out)]

    notes = f"""
Performance checks for {target}:
- Configure PERFORMANCE_TEST_COMMAND to run Lighthouse or Playwright performance assertions.
- Suggested metrics: LCP, CLS, TBT, page weight, API latency.
""".strip()
    print("\n▶ Performance checklist")
    print(notes)
    return [("performance-checklist", 0, notes)]


def run_security(target: str) -> list[tuple[str, int, str]]:
    cmd = security_command()
    if cmd:
        rc, out = run(cmd, f"Security Test ({target})")
        return [("security", rc, out)]

    notes = f"""
Security checks for {target}:
- Input validation: empty, invalid, overlong, malformed input.
- Injection: XSS/script payloads in every public input.
- Sensitive data: no secrets in UI, source, logs, local storage.
- Transport: HTTPS-only endpoints; no debug URLs in release config.
- Suggested tools: semgrep, gitleaks, npm audit, OWASP ZAP baseline scan.
""".strip()
    print("\n▶ Security checklist")
    print(notes)
    return [("security-checklist", 0, notes)]


_SEVERITY_MAP = {
    "functional-web": "High",
    "non-functional-baseline": "Medium",
    "performance": "Medium",
    "performance-checklist": "Medium",
    "security": "Critical",
    "security-checklist": "High",
}

_OWNER_MAP = {
    "functional-web": "Phase 5 — Implementation",
    "non-functional-baseline": "Phase 5 — Implementation / Phase 4 — Design",
    "performance": "Phase 5 — Implementation / Phase 8 — DevOps",
    "performance-checklist": "Phase 5 — Implementation / Phase 8 — DevOps",
    "security": "Phase 5 — Implementation",
    "security-checklist": "Phase 5 — Implementation",
}

_CATEGORY_MAP = {
    "functional-web": "functional-web",
    "non-functional-baseline": "non-functional",
    "performance": "performance",
    "performance-checklist": "performance",
    "security": "security",
    "security-checklist": "security",
}

_REPRO_MAP = {
    "functional-web": (
        "1. Ensure the web server is running on the configured local port.\n"
        "2. From the project root, execute:\n"
        "   `{command}`\n"
        "3. Observe the Playwright test output."
    ),
    "performance": (
        "1. Ensure the app is running.\n"
        "2. From the project root, execute:\n"
        "   `{command}`\n"
        "3. Observe performance metrics in the output."
    ),
    "security": (
        "1. From the project root, execute:\n"
        "   `{command}`\n"
        "2. Review the security scan output for reported findings."
    ),
}


def _infer_title(suite: str, rc: int, output: str) -> str:
    first_error = ""
    for line in output.splitlines():
        stripped = line.strip()
        if stripped and any(
            kw in stripped.lower()
            for kw in ("error:", "failed", "fail:", "assert", "exception")
        ):
            first_error = stripped[:120]
            break
    if first_error:
        return f"{suite} failed — {first_error}"
    return f"{suite} failed with exit code {rc}"


def _build_repro(suite: str, command_used: str) -> str:
    template = _REPRO_MAP.get(
        suite,
        "1. From the project root, execute:\n   `{command}`\n2. Observe the output.",
    )
    return template.format(command=command_used or "(see agent.config)")


def write_bug(target: str, mode: str, failures: list[tuple[str, int, str]]) -> list[Path]:
    if not failures:
        return []

    BUG_DIR.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    date_display = dt.datetime.now().strftime("%Y-%m-%d")

    web_cmd_str = os.environ.get("WEB_SYSTEMTEST_COMMAND", "").strip() or "npm run test:system"
    perf_cmd_str = os.environ.get("PERFORMANCE_TEST_COMMAND", "").strip() or "(not configured)"
    sec_cmd_str = os.environ.get("SECURITY_TEST_COMMAND", "").strip() or "(not configured)"

    _cmd_for_suite = {
        "functional-web": web_cmd_str,
        "performance": perf_cmd_str,
        "performance-checklist": perf_cmd_str,
        "security": sec_cmd_str,
        "security-checklist": sec_cmd_str,
        "non-functional-baseline": "(automated checklist)",
    }

    platform = os.environ.get("PLATFORM", "web").lower()
    created_paths: list[Path] = []

    for idx, (suite, rc, output) in enumerate(failures, start=1):
        bug_id = f"BUG-{stamp}-{idx:03d}"
        bug_path = BUG_DIR / f"{bug_id}.md"

        severity = _SEVERITY_MAP.get(suite, "High")
        category = _CATEGORY_MAP.get(suite, suite)
        owner = _OWNER_MAP.get(suite, "Phase 5 — Implementation")
        cmd_used = _cmd_for_suite.get(suite, "(see agent.config)")
        title = _infer_title(suite, rc, output)
        repro = _build_repro(suite, cmd_used)

        env_str = f"{platform.capitalize()} — local environment"

        # Trim output for inline evidence (keep last 3000 chars)
        evidence_output = output[-3000:] if output else "(no output captured)"

        # Extract first error lines for Actual Result
        actual_lines = []
        for line in output.splitlines():
            stripped = line.strip()
            if stripped and any(
                kw in stripped.lower()
                for kw in ("error:", "failed", "fail:", "assert", "exception", "exit code")
            ):
                actual_lines.append(stripped)
            if len(actual_lines) >= 5:
                break
        actual_summary = "\n".join(actual_lines) if actual_lines else f"Exit code {rc} — see evidence below."

        lines = [
            f"# {bug_id} — {title}",
            "",
            "| Field | Value |",
            "|---|---|",
            f"| **BUG ID** | {bug_id} |",
            f"| **Status** | Open |",
            f"| **Severity** | {severity} |",
            f"| **Category** | {category} |",
            f"| **Target** | {target} |",
            f"| **Mode** | {mode} |",
            f"| **Environment** | {env_str} |",
            f"| **Detected By** | SystemTest Agent — {date_display} |",
            f"| **Suggested Owner** | {owner} |",
            "",
            "---",
            "",
            "## Summary",
            "",
            f"The `{suite}` step of the `{mode}` run targeting `{target}` exited with code `{rc}`. "
            f"This indicates a failure in the {category} test suite that must be resolved before "
            f"this target can be considered verified.",
            "",
            "---",
            "",
            "## Steps to Reproduce",
            "",
            repro,
            "",
            "---",
            "",
            "## Actual Result",
            "",
            actual_summary,
            "",
            "```text",
            evidence_output,
            "```",
            "",
            "---",
            "",
            "## Expected Result",
            "",
            f"The `{suite}` suite completes with exit code `0` and all test cases pass.",
            "",
            "---",
            "",
            "## Evidence",
            "",
            "| Type | Detail |",
            "|---|---|",
            f"| Exit code | `{rc}` |",
            f"| Command | `{cmd_used[:200]}` |",
            f"| Full report | `docs/system-tests/systemtest-{stamp}-{mode}.md` |",
            "| Screenshot | N/A |",
            "| Trace | N/A |",
            "",
            "---",
            "",
            "## Root Cause (if known)",
            "",
            "Unknown — requires investigation.",
            "",
            "---",
            "",
            "## Recommended Fix",
            "",
            f"1. Review the evidence output above for the specific error message.",
            f"2. Investigate the `{suite}` test target and the corresponding source code.",
            f"3. Fix the failing assertion or environment issue.",
            f"4. Re-run: `python3 scripts/systemtest_runner.py {target} --mode {mode}`",
            "",
            "---",
            "",
            "## Linked Artefacts",
            "",
            f"- Report: `docs/system-tests/systemtest-{stamp}-{mode}.md`",
            f"- User Story / Task: {target}",
        ]

        bug_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"[bug] {bug_id} ({severity}) → {bug_path.relative_to(ROOT)}")
        created_paths.append(bug_path)

    return created_paths


def write_report(target: str, mode: str, results: list[tuple[str, int, str]]) -> Path:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    report_path = REPORT_DIR / f"systemtest-{stamp}-{mode}.md"

    failures = [(name, rc, out) for name, rc, out in results if rc != 0]
    status = "FAIL" if failures else "PASS"

    lines = [
        f"# System Test Report — {mode}",
        "",
        f"Target: `{target}`",
        f"Status: **{status}**",
        f"Generated: {stamp}",
        "",
        "## Result Summary",
    ]

    for name, rc, output in results:
        lines.append(f"- `{name}`: {'PASS' if rc == 0 else 'FAIL'} (exit={rc})")

    lines.append("\n## Details")
    for name, rc, output in results:
        lines.append(f"\n### {name}")
        lines.append(f"Exit code: {rc}")
        lines.append("```text")
        lines.append(output[-6000:] if output else "(no output)")
        lines.append("```")

    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[report] wrote {report_path.relative_to(ROOT)}")
    return report_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Unified system test runner")
    parser.add_argument("target", nargs="?", default="all", help="US-ID, TASK-ID, or all")
    parser.add_argument("--mode", default="systemtest", choices=["systemtest", "performance", "security", "full"])
    args = parser.parse_args()

    load_env(ROOT / ".agent" / "config" / "agent.config")

    print("=" * 60)
    print("  System Test Runner (Playwright)")
    print(f"  Target : {args.target}")
    print(f"  Mode   : {args.mode}")
    print("=" * 60)

    results: list[tuple[str, int, str]] = []

    if args.mode == "systemtest":
        results.extend(run_functional(args.target))
        results.extend(run_non_functional(args.target))
    elif args.mode == "performance":
        results.extend(run_performance(args.target))
    elif args.mode == "security":
        results.extend(run_security(args.target))
    elif args.mode == "full":
        results.extend(run_functional(args.target))
        results.extend(run_non_functional(args.target))
        results.extend(run_performance(args.target))
        results.extend(run_security(args.target))

    failures = [(name, rc, out) for name, rc, out in results if rc != 0]
    write_report(args.target, args.mode, results)
    write_bug(args.target, args.mode, failures)

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
