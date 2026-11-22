import { z } from "zod";
import { phoneSchema } from "./primitives.js";

export const postalCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{5}$/, "Postal code must be a 5-digit number");

export const addressSchema = z.object({
  recipientName: z.string().trim().min(1, "Recipient name is required").max(100),
  phone: phoneSchema,
  addressLine1: z.string().trim().min(1, "Address line 1 is required").max(255),
  addressLine2: z.string().trim().max(255).optional(),
  subdistrict: z.string().trim().min(1, "Subdistrict (Tambon) is required").max(100),
  district: z.string().trim().min(1, "District (Amphoe) is required").max(100),
  province: z.string().trim().min(1, "Province (Changwat) is required").max(100),
  postalCode: postalCodeSchema,
  isDefault: z.boolean().default(false),
});

export type AddressInput = z.infer<typeof addressSchema>;
