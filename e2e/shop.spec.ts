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
  await expect(card.getByText('Adopted')).toBeVisible()
})

test('books a visit from an available pet card', async ({ page }) => {
  await page.goto('/')
  const card = page.locator('.pet', { hasText: 'Biscuit' })
  await expect(card).toBeVisible()

  await card.getByRole('button', { name: 'Book visit' }).click()
  await card.getByLabel('Your name').fill('Ada Lovelace')
  await card.getByLabel('Email').fill('ada@example.com')

  // A minute-unique future slot keeps local reruns from colliding on the same slot.
  const slot = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + Math.floor(Math.random() * 1e6) * 60000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const localValue = `${slot.getFullYear()}-${pad(slot.getMonth() + 1)}-${pad(slot.getDate())}T${pad(slot.getHours())}:${pad(slot.getMinutes())}`
  await card.getByLabel('Slot').fill(localValue)

  await card.getByRole('button', { name: 'Book', exact: true }).click()
  await expect(card.getByText(/Save your cancellation code/)).toBeVisible()
})
