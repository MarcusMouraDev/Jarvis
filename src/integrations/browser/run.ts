import {
  getApproval,
  requestApproval,
} from "@/core/run-ledger";
import {
  isBrowserEnabled,
  isBrowserMockMode,
} from "@/integrations/flags";
import {
  DEFAULT_BROWSER_TIMEOUT_MS,
  isDomainAllowed,
  MAX_BROWSER_STEPS,
} from "./allowlist";
import type { BrowserRunInput, BrowserRunOutput } from "./types";
import {
  browserRunInputSchema,
  MUTATING_ACTIONS,
  SENSITIVE_PATTERNS,
} from "./types";
import { assertNever } from "@/core/assert-never";
import type { BrowserType } from "playwright";

export type BrowserRunResult =
  | { status: "ok"; output: BrowserRunOutput }
  | { status: "needs_approval"; approvalId: string; plan: string[] }
  | { status: "denied"; reason: string };

function buildPlan(input: BrowserRunInput): string[] {
  return [
    `Navegar para ${input.url}`,
    ...input.steps.map((s, i) => `${i + 1}. ${s.action}${"selector" in s ? ` → ${s.selector}` : ""}`),
  ];
}

function stepNeedsApproval(
  step: BrowserRunInput["steps"][number],
  url: string,
): boolean {
  if (MUTATING_ACTIONS.has(step.action)) return true;
  const hay = [
    url,
    "selector" in step ? step.selector : "",
    "value" in step ? step.value : "",
  ].join(" ");
  return SENSITIVE_PATTERNS.test(hay);
}

export function classifyBrowserRun(input: BrowserRunInput): {
  needsApproval: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (!input.planAcknowledged) reasons.push("plan_not_acknowledged");
  for (const step of input.steps) {
    if (stepNeedsApproval(step, input.url)) {
      reasons.push(`mutating_or_sensitive:${step.action}`);
    }
  }
  return { needsApproval: reasons.length > 0, reasons };
}

async function runMockBrowser(
  input: BrowserRunInput,
): Promise<BrowserRunOutput> {
  const plan = buildPlan(input);
  const results: BrowserRunOutput["results"] = [
    { step: 0, action: "goto", ok: true, detail: `mock:${input.url}` },
  ];
  for (let i = 0; i < input.steps.length; i++) {
    const step = input.steps[i];
    results.push({
      step: i + 1,
      action: step.action,
      ok: true,
      detail: `mock:${step.action}`,
      screenshotBase64:
        step.action === "screenshot" ? "mock-screenshot-base64" : undefined,
    });
  }
  return { plan, results, mock: true };
}

async function runPlaywrightBrowser(
  input: BrowserRunInput,
  timeoutMs: number,
): Promise<BrowserRunOutput> {
  const plan = buildPlan(input);
  const results: BrowserRunOutput["results"] = [];

  let chromium: BrowserType;
  try {
    // Intentional runtime import: browser automation is an optional heavyweight capability.
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("playwright_not_installed");
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.goto(input.url, { waitUntil: "domcontentloaded" });
    results.push({ step: 0, action: "goto", ok: true, detail: input.url });

    for (let i = 0; i < input.steps.length; i++) {
      const step = input.steps[i];
      try {
        switch (step.action) {
          case "goto":
            await page.goto(step.url, { waitUntil: "domcontentloaded" });
            results.push({ step: i + 1, action: step.action, ok: true });
            break;
          case "click":
            await page.click(step.selector);
            results.push({ step: i + 1, action: step.action, ok: true });
            break;
          case "fill":
            await page.fill(step.selector, step.value);
            results.push({ step: i + 1, action: step.action, ok: true });
            break;
          case "screenshot": {
            const buf = await page.screenshot({ type: "png" });
            results.push({
              step: i + 1,
              action: step.action,
              ok: true,
              screenshotBase64: buf.toString("base64"),
            });
            break;
          }
          case "extract": {
            const text = step.selector
              ? await page.locator(step.selector).innerText()
              : await page.innerText("body");
            results.push({
              step: i + 1,
              action: step.action,
              ok: true,
              detail: text.slice(0, 5000),
            });
            break;
          }
          default:
            assertNever(step);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "step_failed";
        results.push({
          step: i + 1,
          action: step.action,
          ok: false,
          detail: message,
        });
        break;
      }
    }

    await context.close();
  } finally {
    await browser.close();
  }

  return { plan, results };
}

export async function runBrowser(
  raw: unknown,
  options?: { runId?: string },
): Promise<BrowserRunResult> {
  if (!isBrowserEnabled()) {
    return { status: "denied", reason: "browser_disabled" };
  }

  const input = browserRunInputSchema.parse(raw);

  if (!isDomainAllowed(input.url)) {
    return { status: "denied", reason: "domain_not_allowlisted" };
  }

  if (input.steps.length > MAX_BROWSER_STEPS) {
    return { status: "denied", reason: "step_limit_exceeded" };
  }

  for (const step of input.steps) {
    if (step.action === "goto" && !isDomainAllowed(step.url)) {
      return { status: "denied", reason: "domain_not_allowlisted" };
    }
  }

  const plan = buildPlan(input);
  const classification = classifyBrowserRun(input);

  if (classification.needsApproval) {
    if (!input.approvalId) {
      if (!options?.runId) {
        return { status: "denied", reason: "run_id_required_for_approval" };
      }
      const approval = requestApproval({
        runId: options.runId,
        action: "browser.run",
        scope: input.url,
        reasons: classification.reasons,
      });
      return {
        status: "needs_approval",
        approvalId: approval.id,
        plan,
      };
    }

    const approval = getApproval(input.approvalId);
    if (!approval || approval.decision !== "approved") {
      return { status: "denied", reason: "approval_denied" };
    }

    const hasScreenshot = input.steps.some((s) => s.action === "screenshot");
    if (!hasScreenshot && !input.screenshotBeforeApproval) {
      return { status: "denied", reason: "screenshot_required_before_approval" };
    }
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_BROWSER_TIMEOUT_MS;

  try {
    const output = isBrowserMockMode()
      ? await runMockBrowser(input)
      : await runPlaywrightBrowser(input, timeoutMs);
    return { status: "ok", output };
  } catch (err) {
    const message = err instanceof Error ? err.message : "browser_error";
    return { status: "denied", reason: message };
  }
}
