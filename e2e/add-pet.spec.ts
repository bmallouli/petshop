import { test, expect } from '@playwright/test'

test('adds a pet from the form and shows it in the list', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Petshop/ })).toBeVisible()

  // A unique name keeps local reruns (which reuse the DB) from colliding.
  const name = `Pumpkin-${Date.now()}`
  const form = page.locator('.add-pet')
  await form.getByLabel('Name').fill(name)
  await form.getByLabel('Species', { exact: true }).fill('hamster')
  await form.getByLabel('Price').fill('42.50')
  await form.getByRole('button', { name: 'Add pet' }).click()

  const card = page.locator('.pet', { hasText: name })
  await expect(card).toBeVisible()
  await expect(card.getByText('$42.50')).toBeVisible()
})
