import type { Action } from "../../validation";
import type { RunnerContext } from "../context";
import { click } from "./click";
import { fill } from "./fill";
import { open_page } from "./open-page";
import { select } from "./select";
import { verify_text } from "./verify-text";
import { verify_url } from "./verify-url";
import { wait_for } from "./wait-for";

export async function executeAction(ctx: RunnerContext, action: Action): Promise<void> {
  switch (action.keyword) {
    case "open_page":
      return open_page(ctx, action);
    case "click":
      return click(ctx, { target: action.target });
    case "fill":
      return fill(ctx, { target: action.target, value: action.value });
    case "select":
      return select(ctx, { target: action.target, value: action.value });
    case "verify_text":
      return verify_text(ctx, { target: action.target, text: action.text });
    case "verify_url":
      return verify_url(ctx, { pattern: action.pattern });
    case "wait_for":
      return wait_for(ctx, { target: action.target });
  }
}

export const KEYWORDS = [
  "open_page",
  "click",
  "fill",
  "select",
  "verify_text",
  "verify_url",
  "wait_for",
] as const;
