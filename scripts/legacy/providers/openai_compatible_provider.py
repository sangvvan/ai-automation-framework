#!/usr/bin/env python3
"""
scripts/providers/openai_compatible_provider.py
OpenAI-compatible provider (LM Studio). Hard cap: 15k tokens before sending.
"""

import argparse
import os
import sys
from openai import OpenAI, APIConnectionError, APIStatusError

CHARS_PER_TOKEN = 4  # ~4 chars per token


def truncate_prompt(text: str, max_tokens: int) -> tuple[str, bool]:
    limit = max_tokens * CHARS_PER_TOKEN
    if len(text) <= limit:
        return text, False
    notice = f"\n\n---\n[TRUNCATED: prompt reduced to ~{max_tokens} tokens for LM Studio context limit]\n"
    return text[:limit] + notice, True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt-file", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--api-key", default="lm-studio")
    parser.add_argument("--system", default=(
        "You are a precise software engineering agent in an automated SDLC pipeline. "
        "Follow instructions exactly. Do NOT ask questions. Complete your task then STOP."
    ))
    parser.add_argument("--temperature", type=float, default=0.10)
    parser.add_argument("--timeout", type=float, default=7200)
    parser.add_argument("--max-tokens", type=int, default=8192)
    parser.add_argument(
        "--max-prompt-tokens", type=int,
        default=int(os.environ.get("LOCAL_MAX_PROMPT_TOKENS", "15000")),
    )
    args = parser.parse_args()

    try:
        prompt = open(args.prompt_file, encoding="utf-8").read()
    except OSError as e:
        print(f"[lm_studio] ERROR: {e}", file=sys.stderr)
        return 1

    prompt, truncated = truncate_prompt(prompt, args.max_prompt_tokens)
    if truncated:
        print(f"[lm_studio] ⚠ Prompt truncated to ~{args.max_prompt_tokens} tokens", file=sys.stderr)

    client = OpenAI(base_url=args.endpoint, api_key=args.api_key, timeout=args.timeout)
    msgs = [
        {"role": "system", "content": args.system},
        {"role": "user", "content": prompt},
    ]

    try:
        with client.chat.completions.create(
            model=args.model, messages=msgs,
            temperature=args.temperature, max_tokens=args.max_tokens, stream=True,
        ) as stream:
            for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else None
                if delta:
                    sys.stdout.write(delta)
                    sys.stdout.flush()
        print()
        return 0
    except APIConnectionError as e:
        print(f"\n[lm_studio] Connection error — is LM Studio running at {args.endpoint}?\n{e}", file=sys.stderr)
        return 1
    except APIStatusError as e:
        msg = str(e).lower()
        if any(p in msg for p in ("context", "token limit", "too long")):
            print(f"\n[lm_studio] Context exceeded: {e}", file=sys.stderr)
            return 2  # rc=2 → context overflow signal
        if any(p in msg for p in ("no models", "model not found", "lms load")):
            print(f"\n[lm_studio] No model loaded in LM Studio: {e}", file=sys.stderr)
            return 3
        print(f"\n[lm_studio] API error: {e}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"\n[lm_studio] Unexpected: {repr(exc)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
