import { describe, expect, it } from "vitest";
import {
  USER_CSV_COLUMNS,
  UserCsvError,
  parseUserCsv,
  validateUserCreateRecord,
} from "./csv.js";

const HEADER = "userPrincipalName,displayName,givenName,surname,usageLocation,licenses,groups";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userPrincipalName: "new.user@example.invalid",
    displayName: "New User",
    givenName: "New",
    surname: "User",
    usageLocation: "US",
    licenses: "sku-1",
    groups: "group-1",
    ...overrides,
  };
}

describe("user CSV schema", () => {
  it("publishes the §11.4 column list", () => {
    expect([...USER_CSV_COLUMNS]).toEqual([
      "userPrincipalName",
      "displayName",
      "givenName",
      "surname",
      "usageLocation",
      "licenses",
      "groups",
    ]);
  });

  it("rejects an empty body", () => {
    expect(() => parseUserCsv("  \n ")).toThrowError(UserCsvError);
  });

  it("rejects an unknown column", () => {
    expect(() => parseUserCsv(`${HEADER},nickname\n${"a@example.invalid,b,c,d,US,sku-1,g-1,x"}`)).toThrowError(
      expect.objectContaining({ code: "users.csv_invalid" }),
    );
  });

  it("rejects a header missing a required column", () => {
    expect(() => parseUserCsv("displayName,usageLocation\nNew User,US")).toThrowError(
      /userPrincipalName/,
    );
  });

  it("rejects an unterminated quoted field", () => {
    expect(() => parseUserCsv(`${HEADER}\n"a@example.invalid,New User`)).toThrowError(UserCsvError);
  });
});

describe("user row validation", () => {
  it("accepts a complete row and splits multi-value lists", () => {
    const { errors, user } = validateUserCreateRecord(
      row({ licenses: "sku-1; sku-2", groups: "g-1;g-2" }),
    );

    expect(errors).toEqual([]);
    expect(user).toMatchObject({
      userPrincipalName: "new.user@example.invalid",
      displayName: "New User",
      givenName: "New",
      surname: "User",
      usageLocation: "US",
      licenses: ["sku-1", "sku-2"],
      groups: ["g-1", "g-2"],
    });
  });

  it("rejects a missing UPN and display name per row", () => {
    const { errors, user } = validateUserCreateRecord(
      row({ userPrincipalName: "", displayName: "  " }),
    );

    expect(user).toBeNull();
    expect(errors).toContain("userPrincipalName is required");
    expect(errors).toContain("displayName is required");
  });

  it("rejects a malformed UPN", () => {
    const { errors, user } = validateUserCreateRecord(row({ userPrincipalName: "not-a-upn" }));

    expect(user).toBeNull();
    expect(errors.some((error) => error.includes("not-a-upn"))).toBe(true);
  });

  it("rejects a missing usage location without a tenant default", () => {
    const { errors, user } = validateUserCreateRecord(row({ usageLocation: "" }));

    expect(user).toBeNull();
    expect(errors.some((error) => error.includes("usageLocation"))).toBe(true);
  });

  it("applies the tenant default usage location", () => {
    const { errors, user } = validateUserCreateRecord(row({ usageLocation: "" }), {
      defaultUsageLocation: "GB",
    });

    expect(errors).toEqual([]);
    expect(user?.usageLocation).toBe("GB");
  });

  it("rejects a malformed usage location", () => {
    const { errors } = validateUserCreateRecord(row({ usageLocation: "USA" }));

    expect(errors.some((error) => error.includes("2-letter"))).toBe(true);
  });

  it("rejects a license outside the tenant catalogue", () => {
    const { errors, user } = validateUserCreateRecord(row({ licenses: "sku-9" }), {
      knownLicenses: ["sku-1"],
    });

    expect(user).toBeNull();
    expect(errors.some((error) => error.includes("sku-9"))).toBe(true);
  });

  it("rejects a UPN that already exists in the tenant", () => {
    const { errors, user } = validateUserCreateRecord(row(), {
      existingUpns: ["NEW.USER@example.invalid"],
    });

    expect(user).toBeNull();
    expect(errors.some((error) => error.includes("already exists"))).toBe(true);
  });
});

describe("bulk CSV parsing", () => {
  it("parses valid rows with 1-based line numbers", () => {
    const result = parseUserCsv(
      `${HEADER}\na.one@example.invalid,Anne One,Anne,One,US,sku-1,g-1\nb.two@example.invalid,Bob Two,Bob,Two,GB,,`,
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ row: 2, status: "valid" });
    expect(result.rows[1]).toMatchObject({ row: 3, status: "valid" });
    expect(result.valid).toHaveLength(2);
    expect(result.valid[1]).toMatchObject({ licenses: [], groups: [] });
  });

  it("reports per-row failures without aborting valid rows", () => {
    const result = parseUserCsv(
      `${HEADER}\ngood@example.invalid,Good,Good,,US,sku-1,\nbad-upn,Bad,Bad,,US,,\n,No Upn,No,,US,,`,
    );

    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]?.status).toBe("valid");
    expect(result.rows[1]?.status).toBe("invalid");
    expect(result.rows[2]?.status).toBe("invalid");
    expect(result.rows[1]?.user).toBeNull();
    expect(result.valid).toHaveLength(1);
  });

  it("flags a UPN duplicated within the file on the later row", () => {
    const result = parseUserCsv(
      `${HEADER}\ndup@example.invalid,First,,,"US",,\ndup@example.invalid,Second,,,"US",,`,
    );

    expect(result.rows[0]?.status).toBe("valid");
    expect(result.rows[1]?.status).toBe("invalid");
    expect(result.rows[1]?.errors.some((error) => error.includes("duplicates row 2"))).toBe(true);
    expect(result.valid).toHaveLength(1);
  });

  it("flags a UPN duplicated against the tenant directory", () => {
    const result = parseUserCsv(`${HEADER}\nexists@example.invalid,Exists,,,US,,`, {
      existingUpns: ["exists@example.invalid"],
    });

    expect(result.rows[0]?.status).toBe("invalid");
    expect(result.rows[0]?.errors.some((error) => error.includes("already exists"))).toBe(true);
    expect(result.valid).toHaveLength(0);
  });

  it("reads quoted fields containing commas", () => {
    const result = parseUserCsv(`${HEADER}\nq@example.invalid,"Last, First",First,Last,US,,`);

    expect(result.rows[0]?.status).toBe("valid");
    expect(result.valid[0]?.displayName).toBe("Last, First");
  });
});
