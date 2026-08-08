import type { PrivacyClass } from "./types";

const SECRET_VALUE = String.raw`(?:"[^"]*"|'[^']*'|[^\s,;]+)`;
const AUTHORIZATION_ASSIGNMENT = new RegExp(
  String.raw`\b(authorization)\b(["']?\s*[=:]\s*)(?:(?:bearer|basic)\s+)?${SECRET_VALUE}`,
  "gi",
);
const SECRET_ASSIGNMENT = new RegExp(
  String.raw`\b(api[_-]?key|token|password|secret)\b(["']?\s*[=:]\s*)${SECRET_VALUE}`,
  "gi",
);
const BEARER_VALUE = /"bearer\s+[^"]*"|'bearer\s+[^']*'|\bbearer\s+[^\s,;}\]]+/gi;
const SECRET_WORD = /\b(?:api[_-]?key|token|password|secret)\b/gi;

export function redactSecrets(text: string): string {
  return text
    .replace(
      AUTHORIZATION_ASSIGNMENT,
      (_match, key: string, separator: string) =>
        `${key}${separator}"[REDACTADO]"`,
    )
    .replace(BEARER_VALUE, (match) => {
      const quote = match[0] === '"' || match[0] === "'" ? match[0] : "";
      return quote ? `${quote}[REDACTADO]${quote}` : "[REDACTADO]";
    })
    .replace(
      SECRET_ASSIGNMENT,
      (_match, key: string, separator: string) =>
        `${key}${separator}"[REDACTADO]"`,
    )
    .replace(SECRET_WORD, "[REDACTADO]");
}

export function canSendToProvider(
  privacyClass: PrivacyClass,
  provider: string,
): boolean {
  if (privacyClass === "secret") return false;
  if (privacyClass === "confidential" && provider === "unknown") return false;
  return true;
}

export function requiresConfirmation(command: string): boolean {
  const risky = [
    /rm\s+-rf/,
    /delete/i,
    /curl\s+/,
    /wget\s+/,
    /npm\s+install/,
    /git\s+push/,
  ];
  return risky.some((r) => r.test(command));
}

export class BudgetTracker {
  constructor(private readonly maxUsd: number) {}

  private spent = 0;

  charge(amount: number) {
    this.spent += amount;
    if (this.spent > this.maxUsd) {
      throw new Error("budget_exceeded");
    }
  }

  get remaining(): number {
    return Math.max(0, this.maxUsd - this.spent);
  }

  get totalSpent(): number {
    return this.spent;
  }
}
