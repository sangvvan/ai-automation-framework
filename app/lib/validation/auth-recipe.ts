import { z } from "zod";
import { Locator } from "./locator";

export const AuthField = z.object({
  locator: Locator,
  value: z.string().min(1),
});
export type AuthField = z.infer<typeof AuthField>;

export const PostLoginCondition = z.object({
  waitFor: z.array(Locator).default([]),
  urlContains: z.string().optional(),
  textContains: z.string().optional(),
});
export type PostLoginCondition = z.infer<typeof PostLoginCondition>;

export const AuthRecipe = z.object({
  id: z.string().min(1),
  loginUrl: z.string().url(),
  fields: z.object({
    username: AuthField,
    password: AuthField,
    /** Optional extra fields (e.g. tenant, MFA stub). */
    extras: z.array(AuthField).default([]),
  }),
  submit: z.object({ locator: Locator }),
  postLogin: PostLoginCondition.default({}),
  expectsCaptcha: z.boolean().default(false),
  sessionLifetimeMinutes: z.number().int().positive().optional(),
});
export type AuthRecipe = z.infer<typeof AuthRecipe>;
