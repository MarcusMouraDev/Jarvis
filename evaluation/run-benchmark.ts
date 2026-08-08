#!/usr/bin/env npx tsx
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { routeTextRequest } from "../src/core/router";
import { getProviderForAlias } from "../src/core/config";
import { isLocalProvider } from "../src/core/routing-score";
import type { PrivacyClass } from "../src/core/types";

interface CanonicalPrompt {
  id: string;
  privacy: PrivacyClass;
  profile?: string;
  alias?: string;
  text: string;
}

interface BenchmarkResult {
  id: string;
  alias: string;
  effectiveAlias: string;
  provider: string;
  privacy: PrivacyClass;
  profile?: string;
  ttftMs: number | null;
  durationMs: number;
  error: string | null;
  costUsd: number;
  privacyKeptLocal: boolean;
  mode: "live" | "mock";
  fallbackUsed: boolean;
}

function loadPrompts(): CanonicalPrompt[] {
  const raw = readFileSync(
    path.join(process.cwd(), "evaluation/prompts/canonical.yaml"),
    "utf8",
  );
  const parsed = parseYaml(raw) as { prompts: CanonicalPrompt[] };
  return parsed.prompts;
}

function parseArgs() {
  const mock = process.argv.includes("--mock");
  const aliasArg = process.argv.find((a) => a.startsWith("--alias="));
  return {
    mock,
    alias: aliasArg?.split("=")[1],
  };
}

async function runPrompt(
  prompt: CanonicalPrompt,
  options: { mock: boolean; defaultAlias?: string },
): Promise<BenchmarkResult> {
  const alias = prompt.alias ?? options.defaultAlias ?? "gemini";
  const started = performance.now();
  let ttftMs: number | null = null;
  let error: string | null = null;
  let costUsd = 0;
  let effectiveAlias = alias;
  let provider = getProviderForAlias(alias);
  let mode: "live" | "mock" = "mock";
  let fallbackUsed = false;

  try {
    const { request, route } = await routeTextRequest(alias, prompt.text, {
      privacyClass: prompt.privacy,
      profileId: prompt.profile,
      forceMock: options.mock,
    });

    if (route.cloudFallbackConsentRequired) {
      return {
        id: prompt.id,
        alias,
        effectiveAlias: route.effectiveAlias,
        provider: getProviderForAlias(route.effectiveAlias),
        privacy: prompt.privacy,
        profile: prompt.profile,
        ttftMs: null,
        durationMs: Math.round(performance.now() - started),
        error: "cloud_fallback_consent_required",
        costUsd: 0,
        privacyKeptLocal: false,
        mode: route.mode,
        fallbackUsed: route.fallbackUsed,
      };
    }

    effectiveAlias = route.effectiveAlias;
    provider = getProviderForAlias(effectiveAlias);
    mode = route.mode;
    fallbackUsed = route.fallbackUsed;

    const gen = route.adapter!.stream(request);
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        const response = value;
        if (!response) throw new Error("empty_stream");
        costUsd = response.usage.estimatedCostUsd;
        break;
      }
      if (ttftMs === null) ttftMs = Math.round(performance.now() - started);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "error";
  }

  const durationMs = Math.round(performance.now() - started);
  const privacyKeptLocal =
    prompt.privacy === "confidential" || prompt.privacy === "secret"
      ? isLocalProvider(provider)
      : true;

  return {
    id: prompt.id,
    alias,
    effectiveAlias,
    provider,
    privacy: prompt.privacy,
    profile: prompt.profile,
    ttftMs,
    durationMs,
    error,
    costUsd,
    privacyKeptLocal,
    mode,
    fallbackUsed,
  };
}

async function main() {
  const args = parseArgs();
  const prompts = loadPrompts();
  const outDir = path.join(process.cwd(), ".jarvis/eval");
  mkdirSync(outDir, { recursive: true });

  const results: BenchmarkResult[] = [];
  for (const prompt of prompts) {
    const result = await runPrompt(prompt, {
      mock: args.mock,
      defaultAlias: args.alias,
    });
    results.push(result);
    const status = result.error ? `ERR ${result.error}` : "OK";
    console.log(
      `[${status}] ${result.id} · ${result.alias}→${result.effectiveAlias} · ttft=${result.ttftMs ?? "-"}ms · ${result.durationMs}ms · $${result.costUsd.toFixed(4)}`,
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(outDir, `benchmark-${stamp}.json`);
  const summary = {
    generatedAt: new Date().toISOString(),
    mock: args.mock,
    smartRouting: process.env.JARVIS_SMART_ROUTING === "1",
    count: results.length,
    errors: results.filter((r) => r.error).length,
    avgTtftMs:
      results.filter((r) => r.ttftMs !== null).reduce((a, r) => a + (r.ttftMs ?? 0), 0) /
        Math.max(1, results.filter((r) => r.ttftMs !== null).length),
    avgDurationMs:
      results.reduce((a, r) => a + r.durationMs, 0) / Math.max(1, results.length),
    totalCostUsd: results.reduce((a, r) => a + r.costUsd, 0),
    results,
  };

  writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  console.log(`\nRelatório: ${reportPath}`);
}

void main();
