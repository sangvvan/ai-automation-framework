import { z } from "zod";

export const AriaRole = z.enum([
  "alert",
  "alertdialog",
  "button",
  "checkbox",
  "combobox",
  "dialog",
  "form",
  "grid",
  "heading",
  "img",
  "link",
  "list",
  "listbox",
  "listitem",
  "menu",
  "menubar",
  "menuitem",
  "navigation",
  "option",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "search",
  "searchbox",
  "spinbutton",
  "status",
  "switch",
  "tab",
  "table",
  "tabpanel",
  "textbox",
  "tooltip",
]);
export type AriaRole = z.infer<typeof AriaRole>;

export const Locator = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("role"),
    role: AriaRole,
    name: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal("label"), text: z.string().min(1) }),
  z.object({ kind: z.literal("text"), text: z.string().min(1) }),
  z.object({ kind: z.literal("testId"), value: z.string().min(1) }),
]);
export type Locator = z.infer<typeof Locator>;

export function locatorKey(loc: Locator): string {
  switch (loc.kind) {
    case "role":
      return `role:${loc.role}:${loc.name ?? ""}`;
    case "label":
      return `label:${loc.text}`;
    case "text":
      return `text:${loc.text}`;
    case "testId":
      return `testId:${loc.value}`;
  }
}
