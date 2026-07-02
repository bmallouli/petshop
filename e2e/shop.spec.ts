import { test, expect } from '@playwright/test'

test('shows the seeded pets', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Petshop/ })).toBeVisible()
  await expect(page.getByText('Biscuit')).toBeVisible()
  await expect(page.getByText('Ziggy')).toBeVisible()
})

test('adopting a pet updates its card', async ({ page }) => {
  await page.goto('/')
  const card = page.locator('.pet', { hasText: 'Nibbles' })
  await expect(card).toBeVisible()
  // The e2e DB is recreated per CI run, but locally a rerun may find Nibbles
  // already adopted — both paths must end with the adopted badge visible.
  const adopt = card.getByRole('button', { name: 'Adopt' })
  if (await adopt.isVisible()) await adopt.click()
  await expect(card.getByText('adopted')).toBeVisible()
})
