import { test, expect } from '@playwright/test'

const API = 'http://localhost:4000'

test('booking a visit then cancelling it by code removes the slot', async ({ page, request }) => {
  // Find an available pet to book a visit for.
  const petsRes = await request.get(`${API}/api/pets?status=available`)
  expect(petsRes.ok()).toBeTruthy()
  const pets = (await petsRes.json()) as { id: number }[]
  expect(pets.length).toBeGreaterThan(0)
  const petId = pets[0].id

  // Book a visit (MYP-18) to obtain a real cancellation code.
  const startsAt = '2099-01-01T10:00:00.000Z'
  const bookRes = await request.post(`${API}/api/pets/${petId}/visits`, {
    data: { visitorName: 'E2E Tester', visitorEmail: 'e2e@example.com', startsAt },
  })
  expect(bookRes.ok()).toBeTruthy()
  const visit = (await bookRes.json()) as { id: number; cancellationCode: string }

  await page.goto('/')

  // A wrong code surfaces the API error and leaves the visit intact.
  await page.getByRole('spinbutton', { name: 'Visit id' }).fill(String(visit.id))
  await page.getByRole('textbox', { name: 'Cancellation code' }).fill('definitely-wrong')
  await page.getByRole('button', { name: 'Cancel visit' }).click()
  await expect(page.locator('.cancel-error')).toBeVisible()

  // The correct code cancels the visit and shows the confirmation.
  await page.getByRole('textbox', { name: 'Cancellation code' }).fill(visit.cancellationCode)
  await page.getByRole('button', { name: 'Cancel visit' }).click()
  await expect(page.getByText(`Visit #${visit.id} cancelled.`)).toBeVisible()

  // The cancelled slot no longer appears in the pet's upcoming visits.
  await expect(page.locator('.affected-visits')).toBeVisible()
  await expect(page.getByText(`#${visit.id} — ${startsAt}`)).toHaveCount(0)

  // The API confirms the visit is gone from the booked list too.
  const visitsRes = await request.get(`${API}/api/pets/${petId}/visits`)
  const remaining = (await visitsRes.json()) as { id: number }[]
  expect(remaining.some((v) => v.id === visit.id)).toBeFalsy()
})
