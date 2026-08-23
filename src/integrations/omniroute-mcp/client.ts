import { isLoopbackBaseUrl } from "./allowlist";

export interface OmnirouteMcpClientOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class OmnirouteMcpClientError extends Error {
  constructor(
    message: string,
    readonly code:
      | "disabled_host"
      | "http_error"
      | "timeout"
      | "invalid_json"
      | "network",
  ) {
    super(message);
    this.name = "OmnirouteMcpClientError";
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function resolveOmnirouteBaseUrl(
  readEnv: (name: string) => string | undefined = (name) => process.env[name],
): string {
  return normalizeBaseUrl(
    readEnv("OMNIROUTE_BASE_URL")?.trim() ||
      readEnv("LOCAL_OPENAI_BASE_URL")?.trim() ||
      "http://127.0.0.1:20128",
  );
}

export class OmnirouteMcpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OmnirouteMcpClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl ?? resolveOmnirouteBaseUrl(),
    );
    this.apiKey = options.apiKey?.trim() || undefined;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async getJson(path: string): Promise<unknown> {
    if (!isLoopbackBaseUrl(this.baseUrl)) {
      throw new OmnirouteMcpClientError(
        "omniroute_host_not_loopback",
        "disabled_host",
      );
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey && this.apiKey !== "not-needed") {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new OmnirouteMcpClientError(
          `omniroute_http_${response.status}`,
          "http_error",
        );
      }
      try {
        return await response.json();
      } catch {
        throw new OmnirouteMcpClientError("omniroute_invalid_json", "invalid_json");
      }
    } catch (error) {
      if (error instanceof OmnirouteMcpClientError) throw error;
      if ((error as Error).name === "AbortError") {
        throw new OmnirouteMcpClientError("omniroute_timeout", "timeout");
      }
      throw new OmnirouteMcpClientError("omniroute_network", "network");
    } finally {
      clearTimeout(timer);
    }
  }
}
