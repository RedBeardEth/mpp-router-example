import { test, expect } from "@playwright/test";
test("wallet → quote → approval → answer; refresh recovers metadata only", async ({
  page,
}) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:5173") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByText(
      "DEMO · simulated wallet, quote, and answer. No funds move.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve & run" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Connect demo wallet" }).click();
  await page.getByRole("button", { name: "Get payment quote" }).click();
  await expect(page.locator(".amount")).toHaveText("0.01pathUSD");
  await expect(page.getByLabel("Prompt", { exact: false })).toBeDisabled();
  await page.getByRole("button", { name: "Approve & run" }).click();
  await expect(page.getByRole("button", { name: "Save answer" })).toBeVisible();
  await expect(page.getByText("0.005 pathUSD", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/answer-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Check your purchase status" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Get payment quote" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Check status" }).click();
  await expect(
    page.getByText("completion_committed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save answer" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "New request" }).click();
  await expect(
    page.getByRole("button", { name: "Get payment quote" }),
  ).toBeEnabled();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
test("expired quotes cannot be approved", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Connect demo wallet" }).click();
  await page.getByRole("button", { name: "Get payment quote" }).click();
  await expect(
    page.getByRole("button", { name: "Approve & run" }),
  ).toBeEnabled();
  await page.clock.fastForward(61000);
  await expect(page.getByText("Expired", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve & run" }),
  ).toBeDisabled();
});
