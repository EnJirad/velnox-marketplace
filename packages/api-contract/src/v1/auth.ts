import { z } from "zod";
import {
  emailSchema,
  idSchema,
  loginInputSchema,
  registerInputSchema,
  tokenExchangeInputSchema,
  tokenRefreshInputSchema,
} from "@velnox/validation";
import { createSuccessEnvelope } from "../common/envelope.js";

export const authUserSchema = z.object({
  id: idSchema,
  email: emailSchema,
  name: z.string().nullable(),
  role: z.enum(["customer", "seller", "admin", "owner", "staff"]),
  avatarUrl: z.string().url().nullable().optional(),
  permissions: z.array(z.string()).optional(),
  createdAt: z.number().int().positive(),
});

export const authTokensSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal("Bearer").default("Bearer"),
  expiresIn: z.number().int().positive(),
  refreshToken: z.string().optional(),
});

export const authSessionDataSchema = z.object({
  user: authUserSchema,
  tokens: authTokensSchema,
});

export const loginResponseSchema = createSuccessEnvelope(authSessionDataSchema);
export const registerResponseSchema = createSuccessEnvelope(authSessionDataSchema);
export const tokenRefreshResponseSchema = createSuccessEnvelope(authTokensSchema);
export const tokenExchangeResponseSchema = createSuccessEnvelope(authSessionDataSchema);
export const currentUserResponseSchema = createSuccessEnvelope(authUserSchema);

export {
  loginInputSchema,
  registerInputSchema,
  tokenRefreshInputSchema,
  tokenExchangeInputSchema,
};

export type AuthUser = z.infer<typeof authUserSchema>;
export type AuthTokens = z.infer<typeof authTokensSchema>;
export type AuthSessionData = z.infer<typeof authSessionDataSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type RegisterInput = z.infer<typeof registerInputSchema>;
export type TokenRefreshInput = z.infer<typeof tokenRefreshInputSchema>;
export type TokenExchangeInput = z.infer<typeof tokenExchangeInputSchema>;
