import type { Action } from "../../validation";
import type { RunnerContext } from "../context";
import { click } from "./click";
import { drag_drop } from "./drag-drop";
import { fill } from "./fill";
import { open_page } from "./open-page";
import { scroll_to } from "./scroll-to";
import { select } from "./select";
import { type_keyboard } from "./type-keyboard";
import { upload_file } from "./upload-file";
import { verify_screenshot, type VerifyScreenshotEnv } from "./verify-screenshot";
import { verify_text } from "./verify-text";
import { verify_url } from "./verify-url";
import { wait_for } from "./wait-for";

export type RunnerContextWithEnv = RunnerContext & { env?: VerifyScreenshotEnv };

export async function executeAction(
  ctx: RunnerContextWithEnv,
  action: Action,
): Promise<void> {
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
      return wait_for(ctx, {
        target: action.target,
        strategy: action.strategy,
        quietMs: action.quietMs,
      });
    case "upload_file":
      return upload_file(ctx, { target: action.target, filePath: action.filePath });
    case "drag_drop":
      return drag_drop(ctx, { source: action.source, target: action.target });
    case "type_keyboard":
      return type_keyboard(ctx, { keys: action.keys });
    case "scroll_to":
      return scroll_to(ctx, { target: action.target });
    case "verify_screenshot": {
      const outcome = await verify_screenshot(ctx, {
        name: action.name,
        threshold: action.threshold,
      });
      if (outcome.status === "failed") {
        throw new Error(outcome.reason ?? "screenshot-diff failed");
      }
      return;
    }
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
  "upload_file",
  "drag_drop",
  "type_keyboard",
  "scroll_to",
  "verify_screenshot",
] as const;
