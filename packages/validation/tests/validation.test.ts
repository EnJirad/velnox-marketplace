import { describe, expect, it } from "bun:test";
import {
  emailSchema,
  passwordSchema,
  phoneSchema,
  moneyMinorSchema,
  slugSchema,
  paginationQuerySchema,
  addressSchema,
  loginInputSchema,
  registerInputSchema,
  tokenExchangeInputSchema,
} from "../src/index.js";

describe("@velnox/validation primitives", () => {
  it("validates valid email addresses and normalizes case", () => {
    const valid = emailSchema.parse("User.Name@Example.COM ");
    expect(valid).toBe("user.name@example.com");
  });

  it("rejects invalid email addresses", () => {
    expect(() => emailSchema.parse("invalid-email")).toThrow();
    expect(() => emailSchema.parse("@example.com")).toThrow();
    expect(() => emailSchema.parse("user@")).toThrow();
  });

  it("validates password strength rules", () => {
    expect(passwordSchema.parse("ValidPass123")).toBe("ValidPass123");
    // Fails on length < 8
    expect(() => passwordSchema.parse("Sh0rt")).toThrow();
    // Fails on no digits
    expect(() => passwordSchema.parse("NoNumbersHere")).toThrow();
    // Fails on no letters
    expect(() => passwordSchema.parse("1234567890")).toThrow();
  });

  it("validates Thai phone formats", () => {
    expect(phoneSchema.parse("0812345678")).toBe("0812345678");
    expect(phoneSchema.parse("+66812345678")).toBe("+66812345678");
    expect(() => phoneSchema.parse("abc")).toThrow();
    expect(() => phoneSchema.parse("123")).toThrow();
  });

  it("validates money in minor units (non-negative integer)", () => {
    expect(moneyMinorSchema.parse(10000)).toBe(10000);
    expect(moneyMinorSchema.parse(0)).toBe(0);
    expect(() => moneyMinorSchema.parse(-100)).toThrow();
    expect(() => moneyMinorSchema.parse(10.5)).toThrow();
  });

  it("validates slugs", () => {
    expect(slugSchema.parse("electronics-gadgets-2026")).toBe("electronics-gadgets-2026");
    expect(() => slugSchema.parse("invalid slug with spaces")).toThrow();
    expect(() => slugSchema.parse("invalid--slug")).toThrow();
  });

  it("coerces and defaults pagination query parameters", () => {
    const result = paginationQuerySchema.parse({ page: "2", limit: "50" });
    expect(result.page).toBe(2);
    expect(result.limit).toBe(50);

    const defaultResult = paginationQuerySchema.parse({});
    expect(defaultResult.page).toBe(1);
    expect(defaultResult.limit).toBe(20);
  });
});

describe("@velnox/validation schemas", () => {
  it("validates complete shipping address", () => {
    const address = {
      recipientName: "Somchai Jaidee",
      phone: "0891234567",
      addressLine1: "123/45 Sukhumvit Rd.",
      subdistrict: "Khlong Toei",
      district: "Khlong Toei",
      province: "Bangkok",
      postalCode: "10110",
      isDefault: true,
    };
    const parsed = addressSchema.parse(address);
    expect(parsed.recipientName).toBe("Somchai Jaidee");
    expect(parsed.postalCode).toBe("10110");
  });

  it("rejects invalid postal code in address", () => {
    expect(() =>
      addressSchema.parse({
        recipientName: "Somchai",
        phone: "0891234567",
        addressLine1: "123 Road",
        subdistrict: "Sub",
        district: "Dist",
        province: "Prov",
        postalCode: "101", // Invalid length
      }),
    ).toThrow();
  });

  it("validates login and register inputs", () => {
    const login = loginInputSchema.parse({
      email: "test@velnox.live",
      password: "secretPassword",
    });
    expect(login.email).toBe("test@velnox.live");

    const register = registerInputSchema.parse({
      name: "New Seller",
      email: "seller@velnox.live",
      password: "Password123",
      role: "seller",
    });
    expect(register.role).toBe("seller");
  });

  it("validates mobile native token exchange input", () => {
    const exchange = tokenExchangeInputSchema.parse({
      provider: "google",
      idToken: "google-jwt-token-string-xyz-1234567890",
    });
    expect(exchange.provider).toBe("google");
    expect(() =>
      tokenExchangeInputSchema.parse({
        provider: "facebook" as any,
        idToken: "token",
      }),
    ).toThrow();
  });
});
