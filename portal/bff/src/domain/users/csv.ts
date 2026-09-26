// User-create CSV schema and validation (EPIC-011 SPEC.md §4.1 US-2, §11.4; T-0202).
//
// §11.4 resolves the CSV question here: this module owns the accepted column
// schema (UPN, display name, given/surname, usage location, licenses, groups),
// the required-field and format rules, duplicate detection (within the file and
// against the tenant directory), and the row-level result model. Single creates
// reuse `validateUserCreateRecord` so one rule implementation backs both the
// form path and the bulk path. Validation failures are reported per row; the
// caller (route/worker) must not apply a row that failed validation.
//
// Pure module: no Graph client, no queue, no tenant write.

export const USER_CSV_COLUMNS = [
  "userPrincipalName",
  "displayName",
  "givenName",
  "surname",
  "usageLocation",
  "licenses",
  "groups",
] as const;

export type UserCsvColumn = (typeof USER_CSV_COLUMNS)[number];

export interface ParsedUserCreate {
  readonly userPrincipalName: string;
  readonly displayName: string;
  readonly givenName: string | null;
  readonly surname: string | null;
  readonly usageLocation: string;
  readonly licenses: readonly string[];
  readonly groups: readonly string[];
}

export type UserCsvRowStatus = "valid" | "invalid";

export interface UserCsvRowResult {
  /** 1-based line number of the data row in the source text (header is line 1). */
  readonly row: number;
  readonly status: UserCsvRowStatus;
  readonly errors: readonly string[];
  readonly user: ParsedUserCreate | null;
  /** Raw UPN cell for the row ("" when absent); keys per-row results. */
  readonly userPrincipalName: string;
}

export interface UserCsvParseOptions {
  /** Tenant default applied when a row omits usageLocation. */
  readonly defaultUsageLocation?: string;
  /** Catalogue of assignable license SKUs; unknown entries fail the row. */
  readonly knownLicenses?: readonly string[];
  /** UPNs already present in the tenant (case-insensitive); collisions fail the row. */
  readonly existingUpns?: readonly string[];
}

export interface UserCsvParseResult {
  readonly rows: readonly UserCsvRowResult[];
  readonly valid: readonly ParsedUserCreate[];
}

export class UserCsvError extends Error {
  readonly code = "users.csv_invalid";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "UserCsvError";
  }
}

const UPN_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USAGE_LOCATION_PATTERN = /^[A-Za-z]{2}$/;

function fail(message: string): UserCsvError {
  return new UserCsvError(message);
}

function splitList(value: string): string[] {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

// Minimal RFC-4180 reader: quoted fields, doubled-quote escapes, CRLF.
// Throws UserCsvError on an unterminated quoted field.
function readCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let inQuotes = false;
  let hasContent = false;
  let index = 0;

  const endField = (): void => {
    record.push(quoted ? field : field.trim());
    field = "";
    quoted = false;
  };

  while (index < text.length) {
    const char = text[index]!;
    hasContent = true;
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      if (field.length === 0) {
        quoted = true;
        inQuotes = true;
      } else {
        field += char;
      }
      index += 1;
      continue;
    }
    if (char === ",") {
      endField();
      index += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      endField();
      records.push(record);
      record = [];
      if (char === "\r" && text[index + 1] === "\n") {
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    field += char;
    index += 1;
  }
  if (inQuotes) {
    throw fail("CSV has an unterminated quoted field");
  }
  if (hasContent) {
    endField();
    records.push(record);
  }
  // Drop the trailing empty record produced by a final newline.
  while (
    records.length > 0 &&
    records[records.length - 1]!.every((cell) => cell.length === 0)
  ) {
    records.pop();
  }
  return records;
}

function normalizeUpn(value: string): string {
  return value.trim().toLowerCase();
}

export function validateUserCreateRecord(
  record: Record<string, unknown>,
  options: UserCsvParseOptions = {},
): { errors: string[]; user: ParsedUserCreate | null } {
  const errors: string[] = [];
  const text = (value: unknown): string =>
    typeof value === "string" ? value.trim() : "";

  const userPrincipalName = text(record["userPrincipalName"]);
  const displayName = text(record["displayName"]);
  const givenName = text(record["givenName"]);
  const surname = text(record["surname"]);
  let usageLocation = text(record["usageLocation"]);
  if (usageLocation.length === 0 && options.defaultUsageLocation !== undefined) {
    usageLocation = options.defaultUsageLocation.trim();
  }

  if (userPrincipalName.length === 0) {
    errors.push("userPrincipalName is required");
  } else if (!UPN_PATTERN.test(userPrincipalName)) {
    errors.push(`userPrincipalName '${userPrincipalName}' is not a valid UPN`);
  }
  if (displayName.length === 0) {
    errors.push("displayName is required");
  }
  if (usageLocation.length === 0) {
    errors.push("usageLocation is required (no tenant default applies)");
  } else if (!USAGE_LOCATION_PATTERN.test(usageLocation)) {
    errors.push(`usageLocation '${usageLocation}' must be a 2-letter country code`);
  }

  const licenses = splitList(text(record["licenses"]));
  const groups = splitList(text(record["groups"]));
  if (options.knownLicenses !== undefined) {
    const known = new Set(options.knownLicenses.map((sku) => sku.toLowerCase()));
    for (const sku of licenses) {
      if (!known.has(sku.toLowerCase())) {
        errors.push(`license '${sku}' is not in the tenant catalogue`);
      }
    }
  }
  if (
    userPrincipalName.length > 0 &&
    options.existingUpns !== undefined &&
    options.existingUpns.some((upn) => normalizeUpn(upn) === normalizeUpn(userPrincipalName))
  ) {
    errors.push(`userPrincipalName '${userPrincipalName}' already exists in the tenant`);
  }

  if (errors.length > 0) {
    return { errors, user: null };
  }
  return {
    errors,
    user: {
      userPrincipalName,
      displayName,
      givenName: givenName.length > 0 ? givenName : null,
      surname: surname.length > 0 ? surname : null,
      usageLocation,
      licenses,
      groups,
    },
  };
}

export function parseUserCsv(
  text: string,
  options: UserCsvParseOptions = {},
): UserCsvParseResult {
  if (text.trim().length === 0) {
    throw fail("CSV body is empty");
  }
  const records = readCsvRecords(text);
  if (records.length === 0) {
    throw fail("CSV body is empty");
  }
  const header = (records[0] ?? []).map((cell) => cell.trim());
  const allowed = new Set<string>(USER_CSV_COLUMNS);
  for (const column of header) {
    if (!allowed.has(column)) {
      throw fail(
        `unknown CSV column '${column}'; accepted columns: ${USER_CSV_COLUMNS.join(", ")}`,
      );
    }
  }
  for (const required of ["userPrincipalName", "displayName"] as const) {
    if (!header.includes(required)) {
      throw fail(`CSV header is missing required column '${required}'`);
    }
  }

  const rows: UserCsvRowResult[] = [];
  const valid: ParsedUserCreate[] = [];
  const seen = new Map<string, number>();
  records.slice(1).forEach((cells, offset) => {
    const line = offset + 2;
    if (cells.every((cell) => cell.length === 0)) {
      return;
    }
    const record: Record<string, unknown> = {};
    header.forEach((column, position) => {
      record[column] = cells[position] ?? "";
    });
    const { errors, user } = validateUserCreateRecord(record, {
      ...options,
      existingUpns: undefined,
    });
    const rowErrors = [...errors];
    const rawUpn = record["userPrincipalName"];
    const upnCell = typeof rawUpn === "string" ? rawUpn.trim() : "";
    if (upnCell.length > 0 && UPN_PATTERN.test(upnCell)) {
      const key = normalizeUpn(upnCell);
      const first = seen.get(key);
      if (first !== undefined) {
        rowErrors.push(`userPrincipalName '${upnCell}' duplicates row ${first}`);
      } else {
        seen.set(key, line);
      }
      if (
        options.existingUpns !== undefined &&
        options.existingUpns.some((existing) => normalizeUpn(existing) === key)
      ) {
        rowErrors.push(`userPrincipalName '${upnCell}' already exists in the tenant`);
      }
    }
    if (rowErrors.length > 0) {
      rows.push({ row: line, status: "invalid", errors: rowErrors, user: null, userPrincipalName: upnCell });
      return;
    }
    rows.push({ row: line, status: "valid", errors: [], user, userPrincipalName: user?.userPrincipalName ?? upnCell });
    if (user !== null) {
      valid.push(user);
    }
  });
  return { rows, valid };
}
