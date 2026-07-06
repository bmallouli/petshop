import { test, expect } from '@playwright/test'

// Seeded owner Grace Hopper (see apps/api/src/db.ts): owns Mochi and Pepper,
// and Pepper has one seeded upcoming visit far in the future.
const OWNER_CODE = 'OWNER-GRACE-0002'
const SEEDED_PET = 'Pepper'
// The visit start renders via formatVisitTime (toLocaleString), whose exact
// format depends on the browser locale/timezone; the year is stable regardless.
const SEEDED_VISIT_YEAR = '2030'

test('owner signs in and sees their pets and upcoming visits, read-only', async ({ page }) => {
  await page.goto('/portal')

  await page.getByLabel('Access code').fill(OWNER_CODE)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByText('Signed in as Grace Hopper')).toBeVisible()

  // The owner's seeded pet is listed with its details.
  const card = page.locator('.portal-pet', { hasText: SEEDED_PET })
  await expect(card).toBeVisible()
  await expect(card.getByText('dog')).toBeVisible()

  // Pepper's seeded upcoming visit start time is shown.
  await expect(card.locator('.visit-time')).toContainText(SEEDED_VISIT_YEAR)

  // Read-only: no adopt / hold / book / cancel controls anywhere in the portal.
  await expect(page.getByRole('button', { name: /adopt/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /hold/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /book/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /cancel/i })).toHaveCount(0)
})
