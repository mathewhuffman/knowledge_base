import { test, expect } from '@playwright/test';

test('@smoke shell launches', async ({ page }) => {
  await page.goto('about:blank');
  await expect(page).toHaveURL('about:blank');
});
