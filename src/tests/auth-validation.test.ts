import { describe, expect, it } from "vitest";

import {
  emailSchema,
  PASSWORD_MIN_LENGTH,
  registrationSchema,
  signInSchema,
} from "@/lib/validation/auth";

/**
 * The shared validation schemas.
 *
 * These are the contract between the browser form and the server: the form renders the
 * same error strings, and the Server Action re-parses with the same rules. A regression
 * here would either let a malformed value reach the database or reject a legitimate one.
 */

describe("auth validation: email", () => {
  it("trims and lower-cases, so two spellings are one identity", () => {
    const parsed = emailSchema.parse("  Ada@Example.TEST  ");

    expect(parsed).toBe("ada@example.test");
  });

  it("accepts a normal address and a plus tag", () => {
    expect(emailSchema.safeParse("ada+orders@example.test").success).toBe(true);
    expect(emailSchema.safeParse("ada.lovelace@example.co.uk").success).toBe(true);
  });

  it("rejects a malformed address", () => {
    for (const value of ["not-an-email", "@example.test", "ada@", "ada@example", "", "a b@c.test"]) {
      expect(emailSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it("rejects an over-long address rather than truncating it", () => {
    const tooLong = `${"a".repeat(250)}@example.test`;

    expect(emailSchema.safeParse(tooLong).success).toBe(false);
  });

  it("does not apply provider-specific dot/plus folding", () => {
    // Phase 0 forbids Gmail-style reshaping: only case is normalized.
    expect(emailSchema.parse("a.da@gmail.com")).toBe("a.da@gmail.com");
    expect(emailSchema.parse("ada+sales@gmail.com")).toBe("ada+sales@gmail.com");
  });
});

describe("auth validation: password policy", () => {
  it("requires at least the stated length", () => {
    expect(registrationSchema.safeParse({
      email: "ada@example.test",
      password: "a1".repeat(3),
    }).success).toBe(false);

    expect(
      registrationSchema.safeParse({
        email: "ada@example.test",
        password: `a1${"x".repeat(PASSWORD_MIN_LENGTH)}`,
      }).success,
    ).toBe(true);
  });

  it("requires a letter and a number", () => {
    expect(
      registrationSchema.safeParse({ email: "ada@example.test", password: "onlyletters" }).success,
    ).toBe(false);
    expect(
      registrationSchema.safeParse({ email: "ada@example.test", password: "1234567890" }).success,
    ).toBe(false);
  });

  it("borrows no strength from the email address", () => {
    expect(
      registrationSchema.safeParse({ email: "ada@example.test", password: "adaadaada1" }).success,
    ).toBe(true);
  });

  it("rejects an oversized password", () => {
    expect(
      registrationSchema.safeParse({
        email: "ada@example.test",
        password: `a1${"x".repeat(500)}`,
      }).success,
    ).toBe(false);
  });
});

describe("auth validation: registration shape", () => {
  it("accepts a minimal registration and treats empty names as absent", () => {
    const parsed = registrationSchema.parse({
      email: "ada@example.test",
      password: "CorrectHorse42!",
      firstName: "",
      lastName: "   ",
    });

    expect(parsed.firstName).toBeUndefined();
    expect(parsed.lastName).toBeUndefined();
    expect(parsed.email).toBe("ada@example.test");
  });

  it("keeps provided names and trims them", () => {
    const parsed = registrationSchema.parse({
      email: "ada@example.test",
      password: "CorrectHorse42!",
      firstName: "  Ada  ",
      lastName: "Lovelace",
    });

    expect(parsed.firstName).toBe("Ada");
    expect(parsed.lastName).toBe("Lovelace");
  });

  it("rejects a name that is only whitespace plus content past the limit", () => {
    expect(
      registrationSchema.safeParse({
        email: "ada@example.test",
        password: "CorrectHorse42!",
        firstName: "n".repeat(81),
      }).success,
    ).toBe(false);
  });

  it("rejects a non-string field", () => {
    expect(
      registrationSchema.safeParse({
        email: 42,
        password: "CorrectHorse42!",
      }).success,
    ).toBe(false);
  });
});

describe("auth validation: sign-in shape", () => {
  it("normalizes the email but does not police the password", () => {
    // Sign-in must not apply the registration policy: a stored password may predate it,
    // and a policy error here would be a second, different failure message.
    const parsed = signInSchema.parse({ email: "  Ada@Example.TEST ", password: "x" });

    expect(parsed.email).toBe("ada@example.test");
    expect(parsed.password).toBe("x");
  });

  it("rejects an empty password", () => {
    expect(signInSchema.safeParse({ email: "ada@example.test", password: "" }).success).toBe(false);
  });

  it("rejects a missing password and a malformed email", () => {
    expect(signInSchema.safeParse({ email: "ada@example.test" }).success).toBe(false);
    expect(signInSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
  });
});