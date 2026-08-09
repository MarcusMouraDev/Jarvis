import { SafeCoreServiceError } from "./safe-core-service";

export class InvalidJsonError extends Error {
  constructor() {
    super("invalid_json");
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new InvalidJsonError();
  }
}

export function jsonNoStore(
  value: unknown,
  init: { status?: number } = {},
): Response {
  const response = Response.json(value, { status: init.status ?? 200 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function safeRouteError(error: unknown): Response {
  if (error instanceof InvalidJsonError) {
    return jsonNoStore({ error: error.message }, { status: 400 });
  }
  if (error instanceof SafeCoreServiceError) {
    return jsonNoStore({ error: error.code }, { status: error.status });
  }
  if (error instanceof TypeError) {
    return jsonNoStore({ error: "invalid_request" }, { status: 400 });
  }
  return jsonNoStore({ error: "operation_rejected" }, { status: 409 });
}
