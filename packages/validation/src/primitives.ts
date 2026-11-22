import { z } from "zod";

export const uuidSchema = z
  .string()
  .uuid("Must be a valid UUID");

export const idSchema = z
  .string()
  .trim()
  .min(1, "Identifier cannot be empty")
  .max(128, "Identifier exceeds maximum length");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(255, "Email address is too long")
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/, "Must be a valid email address");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password cannot exceed 128 characters")
  .regex(/^(?=.*[A-Za-z])(?=.*\d)/, "Password must contain at least one letter and one number");

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+?[0-9]{8,15}|0[0-9]{8,10})$/, "Must be a valid phone number (e.g. 0812345678 or +66812345678)");

export const moneyMinorSchema = z
  .number()
  .int("Money amount in minor units must be an integer (e.g. satang/cents)")
  .nonnegative("Money amount cannot be negative");

export const moneyDecimalSchema = z
  .number()
  .nonnegative("Money amount cannot be negative");

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(3, "Currency code must be a 3-letter ISO code (e.g. THB)");

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Slug cannot be empty")
  .max(100, "Slug cannot exceed 100 characters")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must contain lowercase alphanumeric characters and single hyphens");

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const sortOrderSchema = z
  .enum(["asc", "desc"])
  .default("desc");
