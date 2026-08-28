import { devices, expect, test } from "@playwright/test";

const iphone = devices["iPhone 13"];
test.use({
  userAgent: iphone.userAgent,
  viewport: iphone.viewport,
  deviceScaleFactor: iphone.deviceScaleFactor,
  isMobile: iphone.isMobile,
  hasTouch: iphone.hasTouch,
});

test.describe("Jarvis PWA mobile", () => {
  test("navega, envia arquivo retomável e mostra origem", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Arquivos" }).click();
    const picker = page.locator('input[type="file"]');
    await expect(picker).toBeAttached();
    await picker.setInputFiles({
      name: "iphone.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("arquivo móvel\n"),
    });
    await expect(page.getByText("Inbox/iphone.txt")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/iphone · v1/)).toBeVisible();
  });

  test("mantém navegação utilizável em zoom 200% e comunica offline", async ({ page, context }) => {
    await page.goto("/");
    await page.addStyleTag({ content: "html { zoom: 2; }" });
    await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();
    await page.getByRole("button", { name: "Dispositivos" }).click();
    await expect(page.getByRole("heading", { name: "Dispositivos" })).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText(/Offline — conversa e documentos/)).toBeVisible();
    await context.setOffline(false);
  });
});
