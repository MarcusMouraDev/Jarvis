import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

async function bootstrapSession(request: APIRequestContext) {
  const response = await request.get("/api/session/bootstrap");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    csrfToken: string;
    defaultAgentId: string;
  };
  expect(body.defaultAgentId).toBe("Hermes");
  expect(body.csrfToken.length).toBeGreaterThan(10);
  return body;
}

async function csrfFromPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem("jarvis.safe.csrf");
    if (!raw) throw new Error("missing_csrf");
    return (JSON.parse(raw) as { csrfToken: string }).csrfToken;
  });
}

test.describe("Safe Agent Core UI", () => {
  test("shell seguro sobe com Hermes e sem executor legado", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("Hermes").first()).toBeVisible();
    await expect(page.getByTestId("state-label")).toBeVisible();
    await expect(page.getByRole("banner")).toContainText(/Hermes|internal/i);
    await page.keyboard.press("Meta+K");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
  });

  test("bootstrap de sessão e CSRF protegem APIs", async ({ request }) => {
    const session = await bootstrapSession(request);
    const denied = await request.get("/api/agents", {
      headers: { "X-Jarvis-CSRF": "wrong" },
    });
    expect(denied.status()).toBeGreaterThanOrEqual(401);

    const agents = await request.get("/api/agents", {
      headers: { "X-Jarvis-CSRF": session.csrfToken },
    });
    expect(agents.ok()).toBeTruthy();
    const body = (await agents.json()) as { agents: Array<{ id: string }> };
    expect(body.agents.some((agent) => agent.id === "Hermes")).toBeTruthy();
  });

  test("UI grava CSRF em sessionStorage após montar", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Hermes").first()).toBeVisible();
    await expect
      .poll(async () => csrfFromPage(page).catch(() => ""), { timeout: 10_000 })
      .toMatch(/.{10,}/);
  });

  test("criar run atualiza presença e permite cancel", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Compositor")).toBeVisible();
    await expect
      .poll(async () => csrfFromPage(page).catch(() => ""), { timeout: 10_000 })
      .toMatch(/.{10,}/);
    const input = page.getByLabel("Compositor");
    await input.fill("ping seguro");
    await page.getByRole("button", { name: "Enviar" }).click();

    await expect(page.getByRole("button", { name: "cancel" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Hermes").first()).toBeVisible();

    await page.getByRole("button", { name: "cancel" }).click();
    await expect(page.getByText("Hermes").first()) .toBeVisible({
      timeout: 15_000,
    });
  });

  test("recarrega e reconstrói estado a partir do snapshot", async ({
    page,
  }) => {
    await page.goto("/");
    const input = page.getByLabel("Compositor");
    await input.fill("estado para reload");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(
      page.getByLabel("Transcrição").getByText("você"),
    ).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.getByText("Hermes").first()).toBeVisible();
    await expect(page.getByTestId("state-label")).toBeVisible();
  });

  test("agente único Hermes, sem seletor durante run ativo", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("combobox", { name: /agente/i })).toHaveCount(0);
    await expect(page.getByText("Hermes").first()).toBeVisible();
    await expect
      .poll(async () => csrfFromPage(page).catch(() => ""), { timeout: 10_000 })
      .toMatch(/.{10,}/);
    await page.getByLabel("Compositor").fill("bloquear seletor");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByRole("button", { name: "cancel" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("combobox", { name: /agente/i })).toHaveCount(0);
    await expect(page.getByText("Hermes").first()).toBeVisible();
  });
});
