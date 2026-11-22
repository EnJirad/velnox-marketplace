import { z } from "zod";
import { emailSchema, passwordSchema, phoneSchema } from "./primitives.js";

export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional(),
});

export const registerInputSchema = z.object({
  name: z.string().trim().min(1, "Full name is required").max(100),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional(),
  role: z.enum(["customer", "seller"]).default("customer"),
});

export const tokenRefreshInputSchema = z.object({
  refreshToken: z.string().min(10, "Refresh token is required"),
});

export const tokenExchangeInputSchema = z.object({
  provider: z.enum(["google", "line"]),
  idToken: z.string().min(10, "Identity token is required"),
  nonce: z.string().optional(),
});

export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: passwordSchema,
});

export type LoginInput = z.infer<typeof loginInputSchema>;
export type RegisterInput = z.infer<typeof registerInputSchema>;
export type TokenRefreshInput = z.infer<typeof tokenRefreshInputSchema>;
export type TokenExchangeInput = z.infer<typeof tokenExchangeInputSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;
