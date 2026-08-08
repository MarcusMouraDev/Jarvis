import type { PrivacyClass } from "./types";

const SECRET_PATTERN =
  /(api[_-]?key|token|password|secret|bearer\s+\S+)/gi;

export function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, "[REDACTADO]");
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
