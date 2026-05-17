import { z } from "zod";
import { Locator } from "./locator";

export const PageElement = z.object({
  id: z.string().min(1),
  tag: z.string().min(1),
  type: z.string().optional(),
  locator: Locator,
  accessibleName: z.string().optional(),
  isRequired: z.boolean().default(false),
  isVisible: z.boolean().default(true),
  isDisabled: z.boolean().default(false),
  isSensitive: z.boolean().default(false),
  attributes: z.record(z.string()).optional(),
});
export type PageElement = z.infer<typeof PageElement>;

export const PageForm = z.object({
  name: z.string().optional(),
  fields: z.array(z.string()),
});
export type PageForm = z.infer<typeof PageForm>;

export const NavLink = z.object({
  name: z.string(),
  href: z.string(),
});
export type NavLink = z.infer<typeof NavLink>;

export const PageAnalysis = z.object({
  url: z.string().url(),
  finalUrl: z.string().url(),
  title: z.string(),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  capturedAt: z.string().datetime({ offset: true }),
  screenshotPath: z.string(),
  elements: z.array(PageElement),
  forms: z.array(PageForm).default([]),
  navigation: z.array(NavLink).default([]),
  consoleErrors: z.array(z.string()).default([]),
});
export type PageAnalysis = z.infer<typeof PageAnalysis>;
