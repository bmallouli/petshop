import { test, expect } from '@playwright/test'

// Deterministic MYP-26 portal seed (see apps/api/src/db.ts):
//   Owner "Grace Hopper" (access code OWNER-GRACE-0002) owns two pets —
//     • Mochi  (cat) — no seeded upcoming visits
//     • Pepper (dog) — one seeded upcoming visit far in the future
// The portal is read-only and never mutates the seed, so these assertions
// hold on a fresh CI `data/e2e.db` and on a reused local rerun alike.
const OWNER_NAME = 'Grace Hopper'
const OWNER_CODE = 'OWNER-GRACE-0002'
const PET_WITH_VISIT = 'Pepper'
const PET_WITHOUT_VISIT = 'Mochi'
// Pepper's seeded visit starts in 2030. The exact rendering goes through
// formatVisitTime (toLocaleString), whose format depends on the browser
// locale/timezone; the year is stable regardless.
const SEEDED_VISIT_YEAR = '2030'

test('portal route shows the access-code login screen before any code is entered', async ({
  page,
}) => {
  await page.goto('/portal')

  // The login screen is visible up front: heading, code field and sign-in button.
  await expect(page.getByRole('heading', { name: /Owner portal/ })).toBeVisible()
  await expect(page.getByLabel('Access code')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

  // No owner data is shown before a code is submitted.
  await expect(page.getByText(/Signed in as/)).toHaveCount(0)
  await expect(page.locator('.portal-pet')).toHaveCount(0)
})

test('owner signs in and sees their pets and upcoming visits, read-only', async ({ page }) => {
  await page.goto('/portal')

  await page.getByLabel('Access code').fill(OWNER_CODE)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByText(`Signed in as ${OWNER_NAME}`)).toBeVisible()

  // Pepper is listed and shows its seeded upcoming visit.
  const withVisit = page.locator('.portal-pet', { hasText: PET_WITH_VISIT })
  await expect(withVisit).toBeVisible()
  await expect(withVisit.getByText('dog')).toBeVisible()
  await expect(withVisit.locator('.visit-time')).toContainText(SEEDED_VISIT_YEAR)

  // Mochi is listed too, and — having no seeded visit — shows the empty state.
  const withoutVisit = page.locator('.portal-pet', { hasText: PET_WITHOUT_VISIT })
  await expect(withoutVisit).toBeVisible()
  await expect(withoutVisit.getByText('cat')).toBeVisible()
  await expect(withoutVisit.getByText('No upcoming visits')).toBeVisible()

  // Read-only: no adopt / hold / book / cancel controls anywhere in the portal.
  await expect(page.getByRole('button', { name: /adopt/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /hold/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /book/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /cancel/i })).toHaveCount(0)
})

test('an unknown access code shows an error and reveals no owner data', async ({ page }) => {
  await page.goto('/portal')

  await page.getByLabel('Access code').fill('NOPE-NOT-A-REAL-CODE')
  await page.getByRole('button', { name: 'Sign in' }).click()

  // The error surfaces and we stay on the login screen.
  await expect(page.getByRole('alert')).toContainText('Invalid access code')
  await expect(page.getByLabel('Access code')).toBeVisible()

  // No owner's pets or visits are revealed.
  await expect(page.getByText(/Signed in as/)).toHaveCount(0)
  await expect(page.locator('.portal-pet')).toHaveCount(0)
  await expect(page.getByText(PET_WITH_VISIT)).toHaveCount(0)
  await expect(page.getByText(PET_WITHOUT_VISIT)).toHaveCount(0)
})
