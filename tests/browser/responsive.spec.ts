import { expect, test } from "@playwright/test";

// Fake browser responses only: no production account, auth bypass or provider writes.
const title = "example/" + "VeryLongRepository_NameWithoutSpaces_".repeat(8);
const member = { id: "layout-test", username: "layout_tester", display_name: "Layout tester", role: "admin", active: true };
const article = {
  id: "layout-article", title, url: "https://github.com/example/project",
  source: "GitHub", author: "A long author name for a responsive layout check",
  kind: "Repository", topic: "Inference", tags: ["vllm", "kv-cache", "a_long_tag_".repeat(12)],
  published_at: new Date().toISOString(), discovered_at: new Date().toISOString(),
  summary: "Technical context with an unbroken_identifier_".repeat(16),
  reason: "Relevant to distributed inference and model serving.",
  evidence: "https://example.com/" + "path_without_breaks_".repeat(16),
  score: 85, read: true, saved: true, likes: 3, comments: 24,
  reference_meta: { repository: "example/project", license: "Apache-2.0", discovery_lane: "repository_search", stars: 100 },
};
const viewports = [
  { width: 320, height: 568 }, { width: 360, height: 740 },
  { width: 390, height: 844 }, { width: 430, height: 932 },
  { width: 667, height: 375 }, { width: 768, height: 1024 },
  { width: 1366, height: 768 },
];

for (const viewport of viewports) {
  test(`long titles and usable details at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let json: unknown;
      if (path === "/api/status") json = { configured: true, preview_enabled: false };
      else if (path === "/api/me") json = { member, mfa_required: false, must_change_password: false };
      else if (path === "/api/action") {
        const { action } = route.request().postDataJSON();
        if (action === "feed" || action === "library") json = { items: [article], total: 1 };
        else if (action === "stats") json = { week: 1, saved: 1, sources: 0 };
        else if (action === "notes") json = Array.from({ length: 24 }, (_, i) => ({
          id: `note-${i}`, article_id: article.id, body: "Long note content and an_unbroken_token_".repeat(12),
          username: member.username, user_id: member.id, visibility: "team", created_at: article.discovered_at,
        }));
        else if (["folders", "sources", "trash"].includes(action)) json = [];
        else json = {};
      } else throw new Error(`Unexpected API request: ${path}`);
      await route.fulfill({ json });
    });
    await page.goto("/");
    const trigger = page.getByRole("button", { name: title, exact: true });
    await expect(trigger).toBeVisible();
    const documentFits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    await expect.poll(documentFits).toBe(true);
    const heading = trigger.locator("h2");
    expect(await heading.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await trigger.click();
    const panel = page.getByRole("dialog", { name: "Signal details" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: title, exact: true })).toBeVisible();
    // Visibility begins before the slide animation has settled.
    await expect.poll(async () => {
      const b = await panel.boundingBox();
      return !!b && b.x >= -1 && b.x + b.width <= viewport.width + 1;
    }).toBe(true);
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
    if (viewport.width <= 767) expect(bounds!.width).toBeCloseTo(viewport.width, 0);
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await panel.getByRole("button", { name: "Add note", exact: true }).scrollIntoViewIfNeeded();
    await expect(panel.getByRole("button", { name: "Add note", exact: true })).toBeVisible();
    const close = panel.getByRole("button", { name: "Close", exact: true });
    await expect(close).toBeVisible();
    const closeBounds = await close.boundingBox();
    expect(closeBounds!.width).toBeGreaterThanOrEqual(44);
    expect(closeBounds!.height).toBeGreaterThanOrEqual(44);
    await close.click();
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect.poll(documentFits).toBe(true);
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });
}
