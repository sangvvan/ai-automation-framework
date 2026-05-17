#!/usr/bin/env python3
"""
scripts/gemini_design_runner.py

Design Agent powered by Gemini.
Reads User Stories, generates structured design specs,
saves to docs/design/screens/{US-id}/spec.md

System prompt: "Design like a senior iOS product designer at Apple.
Be concrete and structured."

Usage:
  python3 scripts/gemini_design_runner.py
  python3 scripts/gemini_design_runner.py --us US-001
  python3 scripts/gemini_design_runner.py --feature "Browse products"
"""

import argparse
import os
import sys
import glob
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SYSTEM_PROMPT = """Design like a senior iOS product designer at Apple.
Be concrete and structured.

You produce design specifications that are immediately implementable
by an iOS engineer without any clarifying questions.

Rules:
- Every value must be exact: pt for iOS, dp for Android, rem for web
- Every color must reference a token name, never a hex value
- Every component must specify all states: default, loading, empty, error
- Every interaction must specify haptic feedback type
- Every text element must specify Dynamic Type behavior
- Accessibility is mandatory, not optional
- Never use vague adjectives: "nice", "clean", "modern", "sleek"
- If you don't know an exact value, use the 8pt grid and explain why"""

DESIGN_PROMPT_TEMPLATE = """You are designing for:

Platform    : {platform}
Feature     : {feature}
User Story  : {us_id}

{us_content}

Design tokens available (from docs/design/system/tokens.md):
{tokens}

Produce a complete design spec following your agent definition exactly.
Include all 9 sections: purpose, layout, components, typography,
spacing, interactions, accessibility, edge cases, implementation notes.

Output as markdown. Start with:
# Design Spec: {us_id}
## Screen: {screen_name}
"""


def load_config() -> dict:
    config = {}
    config_path = ROOT / ".agent" / "config" / "agent.config"
    if config_path.exists():
        for line in config_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            config[k.strip()] = v.strip().strip('"').strip("'")
    return config


def load_tokens() -> str:
    tokens_path = ROOT / "docs" / "design" / "system" / "tokens.md"
    if tokens_path.exists():
        content = tokens_path.read_text()
        # Return first 3000 chars to avoid token overload
        return content[:3000] + ("..." if len(content) > 3000 else "")
    return "(no tokens.md found — use generic iOS HIG values)"


def load_us_files(us_filter: str = "") -> list[dict]:
    us_dir = ROOT / "docs" / "user-stories"
    stories = []
    pattern = str(us_dir / "US-*.md")
    for path in sorted(glob.glob(pattern)):
        us_id = Path(path).stem
        if us_filter and us_filter.upper() != us_id.upper():
            continue
        content = Path(path).read_text(errors="ignore")
        # Only design US with UI (skip backend-only stories)
        if any(kw in content.lower() for kw in [
            "view", "screen", "display", "show", "ui", "button",
            "list", "grid", "detail", "form", "browse", "see"
        ]):
            stories.append({"id": us_id, "content": content, "path": path})
    return stories


def extract_screen_name(us_content: str, us_id: str) -> str:
    for line in us_content.splitlines():
        if line.startswith("# "):
            return line.replace("# ", "").strip()
    return us_id


def run_gemini(prompt: str, config: dict) -> str:
    """Call Gemini API directly via google-generativeai or via CLI."""

    # Option A: google-generativeai SDK
    try:
        import google.generativeai as genai
        api_key = config.get("GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not set")
        genai.configure(api_key=api_key)
        model_name = config.get("GEMINI_DESIGN_MODEL", "gemini-2.0-flash")
        model = genai.GenerativeModel(
            model_name=model_name,
            system_instruction=SYSTEM_PROMPT
        )
        response = model.generate_content(prompt)
        return response.text
    except ImportError:
        pass
    except Exception as e:
        print(f"[gemini] SDK error: {e}", file=sys.stderr)

    # Option B: Gemini via OpenAI-compatible endpoint
    try:
        from openai import OpenAI
        api_key = config.get("GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY", "")
        endpoint = config.get(
            "GEMINI_ENDPOINT",
            "https://generativelanguage.googleapis.com/v1beta/openai/"
        )
        model_name = config.get("GEMINI_DESIGN_MODEL", "gemini-2.0-flash")
        client = OpenAI(base_url=endpoint, api_key=api_key)
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": prompt},
            ],
            temperature=0.3,
            max_tokens=4096,
        )
        return response.choices[0].message.content or ""
    except ImportError:
        pass
    except Exception as e:
        print(f"[gemini] OpenAI-compat error: {e}", file=sys.stderr)

    # Option C: CLI fallback
    cli = config.get("GEMINI_CLI_COMMAND", "")
    if cli:
        import subprocess, tempfile
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write(prompt)
            tmp = f.name
        result = subprocess.run(cli.split() + [tmp], capture_output=True, text=True)
        Path(tmp).unlink(missing_ok=True)
        if result.returncode == 0:
            return result.stdout
        print(f"[gemini] CLI error: {result.stderr}", file=sys.stderr)

    raise RuntimeError(
        "Gemini not configured. Set GEMINI_API_KEY in .agent/config/agent.config\n"
        "or install: pip3 install google-generativeai"
    )


def save_spec(us_id: str, content: str) -> Path:
    out_dir = ROOT / "docs" / "design" / "screens" / us_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "spec.md"
    out_file.write_text(content, encoding="utf-8")
    return out_file


def main() -> int:
    parser = argparse.ArgumentParser(description="Gemini Design Agent")
    parser.add_argument("--us",      default="", help="Specific US-id (e.g. US-001)")
    parser.add_argument("--feature", default="", help="Feature description filter")
    args = parser.parse_args()

    config = load_config()
    platform = config.get("PLATFORM", "ios")
    tokens   = load_tokens()

    # Load user stories
    stories = load_us_files(args.us)
    if not stories:
        msg = f"No UI user stories found"
        if args.us:
            msg += f" matching {args.us}"
        print(f"[design] {msg}")
        return 0

    print("=" * 60)
    print("  Gemini Design Agent")
    print(f"  Platform  : {platform}")
    print(f"  Stories   : {len(stories)}")
    print(f"  Model     : {config.get('GEMINI_DESIGN_MODEL', 'gemini-2.0-flash')}")
    print("=" * 60)

    errors = []
    for story in stories:
        us_id       = story["id"]
        us_content  = story["content"]
        screen_name = extract_screen_name(us_content, us_id)
        feature     = args.feature or screen_name

        print(f"\n  Designing {us_id}: {screen_name}...")

        prompt = DESIGN_PROMPT_TEMPLATE.format(
            platform=platform,
            feature=feature,
            us_id=us_id,
            us_content=us_content,
            tokens=tokens,
            screen_name=screen_name,
        )

        try:
            result = run_gemini(prompt, config)
            out_file = save_spec(us_id, result)
            print(f"  Saved → {out_file.relative_to(ROOT)}")
        except Exception as exc:
            print(f"  ERROR: {exc}", file=sys.stderr)
            errors.append(us_id)

    print()
    if errors:
        print(f"  Failed: {', '.join(errors)}")
        return 1

    print(f"  Done — {len(stories) - len(errors)}/{len(stories)} specs generated")
    print(f"  Specs in: docs/design/screens/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
