import { createHash } from "node:crypto";
import { launchBrowser } from "../browser/launcher";
import type { PageAnalysis, PageElement, NavLink, PageForm, Locator } from "../validation";

export interface AnalyzeOptions {
  url: string;
  viewport?: { width: number; height: number };
  screenshotPath: string;
  headless?: boolean;
  navigationTimeoutMs?: number;
}

/** Heuristic: sensitive input types & name keywords */
const SENSITIVE_TYPE = new Set(["password"]);
const SENSITIVE_NAME_RE = /pass|secret|token|ssn|card|cvv|otp/i;

interface RawElement {
  tag: string;
  type?: string;
  role?: string;
  name?: string;
  label?: string;
  text?: string;
  testId?: string;
  href?: string;
  isRequired: boolean;
  isVisible: boolean;
  isDisabled: boolean;
  attrName?: string;
  attrId?: string;
}

export async function analyzePage(opts: AnalyzeOptions): Promise<PageAnalysis> {
  const session = await launchBrowser({
    headless: opts.headless,
    viewport: opts.viewport,
    navigationTimeoutMs: opts.navigationTimeoutMs,
  });

  try {
    // Shim esbuild's __name helper in the browser context (tsx injects it via keepNames:true
    // but it doesn't exist when Playwright serializes functions for page.evaluate).
    await session.page.addInitScript(`if(typeof __name==='undefined'){window.__name=(fn,_)=>fn}`);

    const response = await session.page.goto(opts.url, { waitUntil: "domcontentloaded" });
    if (!response || !response.ok()) {
      throw new Error(`HTTP ${response?.status() ?? "?"} for ${opts.url}`);
    }

    const finalUrl = session.page.url();
    const title = await session.page.title();
    await session.page.screenshot({ path: opts.screenshotPath, fullPage: false });

    const raw = await session.page.evaluate(() => {
      const visible = (el: Element): boolean => {
        const e = el as HTMLElement;
        if (!e.getClientRects().length) return false;
        const style = window.getComputedStyle(e);
        return style.visibility !== "hidden" && style.display !== "none";
      };
      const accName = (el: Element): string => {
        const e = el as HTMLElement;
        const aria = e.getAttribute("aria-label");
        if (aria) return aria.trim();
        const labelledBy = e.getAttribute("aria-labelledby");
        if (labelledBy) {
          const ref = document.getElementById(labelledBy);
          if (ref) return ref.textContent?.trim() ?? "";
        }
        if (e.id) {
          const lab = document.querySelector(`label[for="${CSS.escape(e.id)}"]`);
          if (lab?.textContent) return lab.textContent.trim();
        }
        const wrappingLabel = e.closest("label");
        if (wrappingLabel) return (wrappingLabel.textContent ?? "").trim();
        return (e.textContent ?? "").trim();
      };

      const out: RawElement[] = [];
      const selectors =
        "button, a[href], input, select, textarea, [role='button'], [role='link'], [role='dialog'], [role='checkbox'], [role='radio'], [role='combobox']";
      for (const el of Array.from(document.querySelectorAll(selectors))) {
        const tag = el.tagName.toLowerCase();
        const e = el as HTMLElement;
        const type = (e.getAttribute("type") ?? undefined)?.toLowerCase();
        const role = e.getAttribute("role") ?? undefined;
        const name = accName(el);
        const isRequired =
          e.hasAttribute("required") || e.getAttribute("aria-required") === "true";
        const isDisabled =
          (e as HTMLInputElement).disabled || e.getAttribute("aria-disabled") === "true";
        out.push({
          tag,
          type,
          role,
          name,
          label: name,
          text: (e.textContent ?? "").trim().slice(0, 200),
          testId: e.getAttribute("data-testid") ?? undefined,
          href: e.getAttribute("href") ?? undefined,
          isRequired,
          isVisible: visible(el),
          isDisabled,
          attrName: e.getAttribute("name") ?? undefined,
          attrId: e.id || undefined,
        });
      }
      return out;
    });

    const elements: PageElement[] = [];
    const forms: PageForm[] = [];
    const navigation: NavLink[] = [];

    for (const r of raw) {
      const locator = deriveLocator(r);
      const idHash = createHash("sha1")
        .update(`${r.tag}|${r.type ?? ""}|${JSON.stringify(locator)}`)
        .digest("hex")
        .slice(0, 10);
      const sensitive =
        (r.type !== undefined && SENSITIVE_TYPE.has(r.type)) ||
        (r.attrName !== undefined && SENSITIVE_NAME_RE.test(r.attrName)) ||
        (r.name !== undefined && SENSITIVE_NAME_RE.test(r.name));
      elements.push({
        id: idHash,
        tag: r.tag,
        type: r.type,
        locator,
        accessibleName: r.name || undefined,
        isRequired: r.isRequired,
        isVisible: r.isVisible,
        isDisabled: r.isDisabled,
        isSensitive: sensitive,
        attributes: r.testId ? { "data-testid": r.testId } : undefined,
      });

      if (r.tag === "a" && r.href && r.name) {
        navigation.push({ name: r.name, href: r.href });
      }
    }

    // Forms: collect by reading <form> regions
    const formData = await session.page.evaluate(() => {
      return Array.from(document.querySelectorAll("form")).map((f) => ({
        name: f.getAttribute("name") ?? f.getAttribute("id") ?? undefined,
        fields: Array.from(f.querySelectorAll("input, select, textarea"))
          .map((el) => (el as HTMLElement).getAttribute("name") ?? "")
          .filter(Boolean),
      }));
    });
    for (const f of formData) forms.push({ name: f.name ?? undefined, fields: f.fields });

    return {
      url: opts.url,
      finalUrl,
      title,
      viewport: opts.viewport ?? { width: 1280, height: 800 },
      capturedAt: new Date().toISOString(),
      screenshotPath: opts.screenshotPath,
      elements,
      forms,
      navigation,
      consoleErrors: session.consoleErrors.slice(),
    };
  } finally {
    await session.close();
  }
}

function deriveLocator(r: RawElement): Locator {
  // testId is strongest stable
  if (r.testId) return { kind: "testId", value: r.testId };
  // role+name
  const role = inferRole(r);
  if (role && r.name) {
    return { kind: "role", role, name: r.name };
  }
  if (r.label) return { kind: "label", text: r.label };
  if (r.text) return { kind: "text", text: r.text };
  if (role) return { kind: "role", role };
  return { kind: "text", text: r.tag };
}

function inferRole(r: RawElement): import("../validation").AriaRole | undefined {
  const explicit = r.role;
  if (explicit) return narrowRole(explicit);
  if (r.tag === "button") return "button";
  if (r.tag === "a") return "link";
  if (r.tag === "select") return "combobox";
  if (r.tag === "textarea") return "textbox";
  if (r.tag === "input") {
    const t = r.type ?? "text";
    if (t === "checkbox") return "checkbox";
    if (t === "radio") return "radio";
    if (t === "submit" || t === "button") return "button";
    if (t === "search") return "searchbox";
    return "textbox";
  }
  return undefined;
}

function narrowRole(s: string): import("../validation").AriaRole | undefined {
  const allowed = new Set([
    "alert","alertdialog","button","checkbox","combobox","dialog","form","grid",
    "heading","img","link","list","listbox","listitem","menu","menubar","menuitem",
    "navigation","option","progressbar","radio","radiogroup","region","row","search",
    "searchbox","spinbutton","status","switch","tab","table","tabpanel","textbox","tooltip",
  ]);
  return allowed.has(s) ? (s as import("../validation").AriaRole) : undefined;
}
