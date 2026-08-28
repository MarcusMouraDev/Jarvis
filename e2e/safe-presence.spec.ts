import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "320", width: 320, height: 640 },
  { name: "375", width: 375, height: 812 },
  { name: "414", width: 414, height: 896 },
  { name: "768", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

test.describe("HUD cinematografico do safe core", () => {
  test("mostra rotulo de estado e anel de telemetria", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("state-label")).toBeVisible();
    await expect(page.locator(".telemetry-ring")).toBeVisible();
    await expect(page.locator(".hud-readouts")).toBeVisible();
  });

  test("readouts nunca mostram valor inventado quando offline", async ({
    page,
  }) => {
    await page.goto("/");
    const readouts = page.locator(".hud-readouts");
    const offline = await readouts.getAttribute("data-online");
    if (offline === "false") {
      await expect(readouts).toContainText("—");
    }
  });

  test("reduced motion nao anima a varredura", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByTestId("state-label")).toBeVisible();
    const animation = await page
      .locator(".hud-scan")
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe("none");
  });

  test("HUD sobrevive nas larguras-chave", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await expect(page.getByTestId("state-label")).toBeVisible();
      await expect(page.locator(".telemetry-ring")).toBeVisible();
    }
  });
});
