import { z } from "zod"

// ── Add your env vars here as the project grows ─────────────────────────
// This is the ONLY file in the codebase that reads process.env.
// All other files import getEnv() from here.
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  BASE_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  // Add more env vars below as needed:
  // GOOGLE_CLIENT_ID: z.string().optional(),
  // S3_BUCKET: z.string().optional(),
})

let _env: z.infer<typeof EnvSchema> | null = null

export function getEnv(): z.infer<typeof EnvSchema> {
  if (_env) return _env
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables:\n${JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)}`
    )
  }
  _env = parsed.data
  return _env
}
