import { expect, test } from "@playwright/test";

test.describe("Safe workbench", () => {
  test("renderiza markdown, prosa à esquerda, mic, orbe e quatro ações de aprovação", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.getByLabel("Microfone")).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const raw = sessionStorage.getItem("jarvis.safe.csrf");
          if (!raw) return "";
          return (JSON.parse(raw) as { csrfToken: string }).csrfToken;
        });
      }, { timeout: 10_000 })
      .toMatch(/.{10,}/);
    await expect(page.getByLabel("Compositor")).toBeVisible();
    const composer = page.getByLabel("Compositor");
    await composer.fill("ping markdown");
    await page.getByRole("button", { name: "Enviar" }).click();
    const transcript = page.locator(".transcript, [aria-label='Transcrição']").first();
    await expect(transcript).toBeVisible({ timeout: 15_000 });
    await expect(transcript).toHaveCSS("text-align", "left");
    const card = page.getByTestId("safe-approval-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole("button", { name: "negar" })).toBeVisible();
    await expect(card.getByRole("button", { name: "uma vez" })).toBeVisible();
    await expect(card.getByRole("button", { name: "nesta sessão" })).toBeVisible();
    await expect(card.getByRole("button", { name: "sempre" })).toBeVisible();
    await expect(page.locator(".transcript strong, .jarvis-markdown strong")).toHaveText(
      /negrito/,
    );
    await expect(page.getByText("**negrito**")).toHaveCount(0);
    const center = page.locator(".workbench-center");
    await center.evaluate((el) => {
      el.scrollTop = 480;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect(page.locator(".orb-stage")).toHaveClass(/is-collapsed/);
  });
});
