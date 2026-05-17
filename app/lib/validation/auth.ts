import { z } from "zod";

export const LoginInput = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
  next: z.string().optional(),
});

export const RegisterInput = z.object({
  name: z.string().min(2, "Name too short").max(80, "Name too long"),
  email: z.string().email("Enter a valid email"),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .regex(/\d/, "Password must contain a digit"),
});

export type LoginInput = z.infer<typeof LoginInput>;
export type RegisterInput = z.infer<typeof RegisterInput>;
