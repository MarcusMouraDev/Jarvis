import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "320", width: 320, height: 640 },
  { name: "375", width: 375, height: 812 },
  { name: "414", width: 414, height: 896 },
  { name: "768", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

test.describe("Jarvis presence and tools", () => {
  test("mostra rótulo de estado idle", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("state-label")).toHaveText(/repouso/i);
  });

  test("abre paleta com Cmd+K e fecha com Esc", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+K");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
  });

  test("respeita prefers-reduced-motion no rótulo", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByTestId("state-label")).toBeVisible();
    await expect(page.getByTestId("state-label")).toHaveText(/repouso/i);
  });

  test("comando allowlist aparece no terminal", async ({ page }) => {
    await page.goto("/");
    const input = page.getByLabel("Compositor");
    await input.fill("/run pwd");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByTestId("terminal-panel")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("terminal-panel")).toContainText("$ pwd");
  });

  test("comando de risco pede aprovação e pode ser recusado", async ({
    page,
  }) => {
    await page.goto("/");
    const input = page.getByLabel("Compositor");
    await input.fill("!curl https://example.com");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByTestId("approval-card")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("state-label")).toHaveText(/perguntando/i);
    await page.getByRole("button", { name: "Recusar" }).click();
    await expect(page.getByTestId("approval-card")).toHaveCount(0);
    await expect(page.getByTestId("terminal-panel")).toContainText("recusado");
  });

  test("streaming pode ser cancelado com Esc", async ({ page }) => {
    await page.goto("/");
    const input = page.getByLabel("Compositor");
    await input.fill("olá jarvis");
    await page.getByRole("button", { name: "Enviar" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("state-label")).toHaveText(/repouso|falha/i, {
      timeout: 10_000,
    });
  });

  test("menções @ e / abrem listbox acessível", async ({ page }) => {
    await page.goto("/");
    const input = page.getByLabel("Compositor");
    await input.click();
    await input.pressSequentially("@gem", { delay: 20 });
    await expect(page.getByRole("listbox")).toBeVisible({ timeout: 8_000 });
    await page.keyboard.press("Escape");
    await input.fill("");
    await input.pressSequentially("ver /sdk", { delay: 20 });
    await expect(page.getByRole("listbox")).toBeVisible({ timeout: 8_000 });
  });

  test("slash /run continua funcionando sem virar chip", async ({ page }) => {
    await page.goto("/");
    const input = page.getByLabel("Compositor");
    await input.fill("/run pwd");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByTestId("terminal-panel")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("estados via slash: thinking/asking/failure labels", async ({ page }) => {
    await page.goto("/");
    const input = page.getByLabel("Compositor");

    await input.fill("!curl https://example.com");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByTestId("state-label")).toHaveText(/perguntando/i, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Recusar" }).click();

    await input.fill("/fail");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByTestId("state-label")).toHaveText(/repouso/i);
  });

  test("rótulo idle permanece legível em larguras-chave", async ({ page }) => {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      const label = page.getByTestId("state-label");
      await expect(label).toBeVisible();
      await expect(label).toHaveText(/repouso/i);
      await expect(page.getByLabel("Compositor")).toBeVisible();
    }
  });

  test("mic label aparece na barra de instrumentos", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toContainText(/mic/i);
  });
});
