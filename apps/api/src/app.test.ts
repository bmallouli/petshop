import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { openDb, seed, type Pet, type Visit } from './db.js'
import * as notifier from './notifier.js'

let app: FastifyInstance
let db: ReturnType<typeof openDb>

beforeEach(() => {
  db = openDb(':memory:')
  seed(db)
  app = buildApp(db)
})

describe('GET /health', () => {
  it('reports ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', petCount: 8 })
  })

  it('reports petCount matching the pets table row count', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    const pets = await app.inject({ method: 'GET', url: '/api/pets' })
    expect(res.json()).toMatchObject({ petCount: (pets.json() as Pet[]).length })
  })
})

describe('GET /version', () => {
  it('reports the version from package.json', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string
    }
    const res = await app.inject({ method: 'GET', url: '/version' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ version: pkg.version })
  })

  it('reports a non-negative uptimeSeconds that grows over time', async () => {
    const first = await app.inject({ method: 'GET', url: '/version' })
    expect(first.statusCode).toBe(200)
    const firstUptime = (first.json() as { uptimeSeconds: number }).uptimeSeconds
    expect(typeof firstUptime).toBe('number')
    expect(firstUptime).toBeGreaterThanOrEqual(0)

    await new Promise((resolve) => setTimeout(resolve, 20))

    const second = await app.inject({ method: 'GET', url: '/version' })
    const secondUptime = (second.json() as { uptimeSeconds: number }).uptimeSeconds
    expect(secondUptime).toBeGreaterThan(firstUptime)
  })
})

describe('GET /api/stats', () => {
  it('returns zeroed counts for an empty store', async () => {
    const emptyApp = buildApp(openDb(':memory:'))
    const res = await emptyApp.inject({ method: 'GET', url: '/api/stats' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ total: 0, adopted: 0, available: 0, bySpecies: {} })
  })

  it('reports counts for a mix of adopted and available pets', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/3/adopt' })
    await app.inject({ method: 'POST', url: '/api/pets/5/adopt' })

    const res = await app.inject({ method: 'GET', url: '/api/stats' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ total: 8, adopted: 2, available: 6 })
  })

  it('keeps total equal to adopted plus available and consistent with the pets table', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/1/adopt' })
    const res = await app.inject({ method: 'GET', url: '/api/stats' })
    const stats = res.json() as { total: number; adopted: number; available: number }
    expect(stats.adopted + stats.available).toBe(stats.total)

    const pets = (await app.inject({ method: 'GET', url: '/api/pets' })).json() as Pet[]
    expect(stats.total).toBe(pets.length)
    expect(stats.adopted).toBe(pets.filter((p) => p.status === 'adopted').length)
    expect(stats.available).toBe(pets.filter((p) => p.status === 'available').length)
  })

  it('breaks down totals and availability by species', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/1/adopt' })

    const res = await app.inject({ method: 'GET', url: '/api/stats' })
    expect(res.statusCode).toBe(200)
    const stats = res.json() as {
      bySpecies: Record<string, { total: number; available: number }>
    }

    const pets = (await app.inject({ method: 'GET', url: '/api/pets' })).json() as Pet[]
    const expected: Record<string, { total: number; available: number }> = {}
    for (const pet of pets) {
      const entry = (expected[pet.species] ??= { total: 0, available: 0 })
      entry.total += 1
      if (pet.status === 'available') entry.available += 1
    }

    expect(stats.bySpecies).toEqual(expected)
    // Biscuit (dog) was adopted, so dogs have one fewer available than total.
    expect(stats.bySpecies.dog).toEqual({ total: 2, available: 1 })
    expect(stats.bySpecies.cat).toEqual({ total: 2, available: 2 })
  })
})

describe('GET /api/pets', () => {
  it('lists the seeded pets', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets' })
    expect(res.statusCode).toBe(200)
    const pets = res.json() as Pet[]
    expect(pets.length).toBe(8)
    expect(pets[0]).toMatchObject({ name: 'Biscuit', species: 'dog', status: 'available' })
  })

  it('filters by species', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets?species=cat' })
    const pets = res.json() as Pet[]
    expect(pets.length).toBe(2)
    expect(pets.every((p) => p.species === 'cat')).toBe(true)
  })

  it('rejects an unknown status value', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets?status=eaten' })
    expect(res.statusCode).toBe(400)
  })

  it('filters by name substring', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets?q=bis' })
    const pets = res.json() as Pet[]
    expect(pets.length).toBe(1)
    expect(pets[0]?.name).toBe('Biscuit')
  })

  it('filters by name substring case-insensitively', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets?q=BIS' })
    const pets = res.json() as Pet[]
    expect(pets.length).toBe(1)
    expect(pets[0]?.name).toBe('Biscuit')
  })

  it('returns no pets when the name substring does not match', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets?q=zzz' })
    const pets = res.json() as Pet[]
    expect(pets.length).toBe(0)
  })

  it('combines q with species', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets?q=och&species=cat' })
    const pets = res.json() as Pet[]
    expect(pets.length).toBe(1)
    expect(pets[0]).toMatchObject({ name: 'Mochi', species: 'cat' })
  })

  it('treats an empty q as no filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets?q=' })
    const pets = res.json() as Pet[]
    expect(pets.length).toBe(8)
  })

  it('treats % and _ in q as literal characters, not SQL LIKE wildcards', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets?q=%25' })
    const pets = res.json() as Pet[]
    expect(pets.length).toBe(0)
  })
})

describe('GET /api/pets/:id', () => {
  it('returns one pet', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets/1' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: 1, name: 'Biscuit', species: 'dog', status: 'available' })
  })

  it('404s on a missing pet', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets/999' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })
})

describe('POST /api/pets', () => {
  it('creates a pet', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pets',
      payload: { name: 'Waffle', species: 'dog', priceCents: 45000 },
    })
    expect(res.statusCode).toBe(201)
    const pet = res.json() as Pet
    expect(pet).toMatchObject({ name: 'Waffle', species: 'dog', priceCents: 45000, status: 'available' })
  })

  it('rejects an invalid body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/pets', payload: { name: '', priceCents: -5 } })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/pets/:id/adopt', () => {
  it('marks a pet adopted', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/pets/3/adopt' })
    expect(res.statusCode).toBe(200)
    expect((res.json() as Pet).status).toBe('adopted')
  })

  it('sends a pet-adopted notification on a successful adoption', async () => {
    const spy = vi.spyOn(notifier, 'sendNotification').mockImplementation(() => {})
    const res = await app.inject({ method: 'POST', url: '/api/pets/3/adopt' })
    expect(res.statusCode).toBe(200)
    expect(spy).toHaveBeenCalledWith('pet-adopted', { petId: 3 })
    spy.mockRestore()
  })

  it('does not notify when the pet is already adopted', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/3/adopt' })
    const spy = vi.spyOn(notifier, 'sendNotification').mockImplementation(() => {})
    const res = await app.inject({ method: 'POST', url: '/api/pets/3/adopt' })
    expect(res.statusCode).toBe(409)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('404s on a missing pet', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/pets/999/adopt' })
    expect(res.statusCode).toBe(404)
  })

  it('rejects adopting an already-adopted pet', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/pets/3/adopt' })
    expect(first.statusCode).toBe(200)

    const res = await app.inject({ method: 'POST', url: '/api/pets/3/adopt' })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'pet 3 is already adopted' })

    const check = await app.inject({ method: 'GET', url: '/api/pets/3' })
    expect((check.json() as Pet).status).toBe('adopted')
  })
})

describe('POST /api/pets/:id/visits', () => {
  const validBody = {
    visitorName: 'Ada Lovelace',
    visitorEmail: 'ada@example.com',
    startsAt: '2026-08-01T10:00:00.000Z',
  }

  it('books a visit and returns 201 with a cancellation code', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/pets/1/visits', payload: validBody })
    expect(res.statusCode).toBe(201)
    const visit = res.json() as Visit
    expect(visit).toMatchObject({
      petId: 1,
      visitorName: 'Ada Lovelace',
      visitorEmail: 'ada@example.com',
      startsAt: '2026-08-01T10:00:00.000Z',
      status: 'booked',
    })
    expect(typeof visit.id).toBe('number')
    expect(visit.cancellationCode).toBeTruthy()
    expect(visit.cancellationCode.length).toBeGreaterThan(0)
  })

  it('rejects a second booking for the same pet at the same slot', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/pets/1/visits', payload: validBody })
    expect(first.statusCode).toBe(201)

    const second = await app.inject({ method: 'POST', url: '/api/pets/1/visits', payload: validBody })
    expect(second.statusCode).toBe(409)
    expect(second.json()).toEqual({ error: 'slot already booked' })
  })

  it('allows a different slot for the same pet', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/1/visits', payload: validBody })
    const res = await app.inject({
      method: 'POST',
      url: '/api/pets/1/visits',
      payload: { ...validBody, startsAt: '2026-08-01T10:30:00.000Z' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('allows the same slot for a different pet', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/1/visits', payload: validBody })
    const res = await app.inject({ method: 'POST', url: '/api/pets/2/visits', payload: validBody })
    expect(res.statusCode).toBe(201)
  })

  it('rejects booking a visit for an adopted pet', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/3/adopt' })
    const res = await app.inject({ method: 'POST', url: '/api/pets/3/visits', payload: validBody })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'pet 3 is not available for visits' })
  })

  it('404s on a missing pet', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/pets/999/visits', payload: validBody })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'pet 999 not found' })
  })

  it('rejects a non-integer id', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/pets/abc/visits', payload: validBody })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an empty visitor name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pets/1/visits',
      payload: { ...validBody, visitorName: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an invalid email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pets/1/visits',
      payload: { ...validBody, visitorEmail: 'not-an-email' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a non-ISO startsAt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pets/1/visits',
      payload: { ...validBody, startsAt: 'tomorrow' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns distinct cancellation codes for separate bookings', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/pets/1/visits', payload: validBody })
    const second = await app.inject({
      method: 'POST',
      url: '/api/pets/2/visits',
      payload: validBody,
    })
    expect((first.json() as Visit).cancellationCode).not.toBe((second.json() as Visit).cancellationCode)
  })

  it('lets a slot freed by a cancelled visit be rebooked', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/pets/1/visits', payload: validBody })
    expect(first.statusCode).toBe(201)
    const visitId = (first.json() as Visit).id

    // Simulate a cancellation directly at the DB layer (no cancel endpoint yet).
    db.prepare(`UPDATE visits SET status = 'cancelled' WHERE id = ?`).run(visitId)

    const rebook = await app.inject({ method: 'POST', url: '/api/pets/1/visits', payload: validBody })
    expect(rebook.statusCode).toBe(201)
  })
})

describe('GET /api/pets/:id/visits', () => {
  const validBody = {
    visitorName: 'Ada Lovelace',
    visitorEmail: 'ada@example.com',
    startsAt: '2026-08-01T10:00:00.000Z',
  }

  it('lists a pet booked visits ordered by startsAt ascending', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/pets/1/visits',
      payload: { ...validBody, startsAt: '2026-08-02T10:00:00.000Z' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/pets/1/visits',
      payload: { ...validBody, startsAt: '2026-08-01T09:00:00.000Z' },
    })

    const res = await app.inject({ method: 'GET', url: '/api/pets/1/visits' })
    expect(res.statusCode).toBe(200)
    const visits = res.json() as Visit[]
    expect(visits.length).toBe(2)
    expect(visits.map((v) => v.startsAt)).toEqual([
      '2026-08-01T09:00:00.000Z',
      '2026-08-02T10:00:00.000Z',
    ])
    expect(visits[0]).toMatchObject({
      petId: 1,
      visitorName: 'Ada Lovelace',
      visitorEmail: 'ada@example.com',
      status: 'booked',
    })
  })

  it('never exposes the cancellationCode', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/1/visits', payload: validBody })
    const res = await app.inject({ method: 'GET', url: '/api/pets/1/visits' })
    const visits = res.json() as Record<string, unknown>[]
    expect(visits.length).toBe(1)
    for (const visit of visits) expect(visit).not.toHaveProperty('cancellationCode')
  })

  it('returns an empty array for a pet with no visits', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets/2/visits' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  describe('POST /api/visits/:id/cancel', () => {
    const validBody = {
      visitorName: 'Ada Lovelace',
      visitorEmail: 'ada@example.com',
      startsAt: '2026-08-01T15:00:00.000Z',
    }

    async function book(): Promise<Visit> {
      const res = await app.inject({ method: 'POST', url: '/api/pets/1/visits', payload: validBody })
      expect(res.statusCode).toBe(201)
      return res.json() as Visit
    }

    it('cancels a visit with the correct code and returns 200', async () => {
      const visit = await book()
      const res = await app.inject({
        method: 'POST',
        url: `/api/visits/${visit.id}/cancel`,
        payload: { cancellationCode: visit.cancellationCode },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ id: visit.id, status: 'cancelled' })
    })

    it('rejects a wrong cancellation code with 403 and leaves the visit booked', async () => {
      const visit = await book()
      const res = await app.inject({
        method: 'POST',
        url: `/api/visits/${visit.id}/cancel`,
        payload: { cancellationCode: 'not-the-code' },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toEqual({ error: 'invalid cancellation code' })

      const row = db.prepare('SELECT status FROM visits WHERE id = ?').get(visit.id) as { status: string }
      expect(row.status).toBe('booked')
    })

    it('404s on a nonexistent visit id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/visits/999/cancel',
        payload: { cancellationCode: 'anything' },
      })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'visit 999 not found' })
    })

    it('409s when the visit is already cancelled', async () => {
      const visit = await book()
      const first = await app.inject({
        method: 'POST',
        url: `/api/visits/${visit.id}/cancel`,
        payload: { cancellationCode: visit.cancellationCode },
      })
      expect(first.statusCode).toBe(200)

      const second = await app.inject({
        method: 'POST',
        url: `/api/visits/${visit.id}/cancel`,
        payload: { cancellationCode: visit.cancellationCode },
      })
      expect(second.statusCode).toBe(409)
      expect(second.json()).toEqual({ error: `visit ${visit.id} is already cancelled` })
    })

    it('rejects a missing cancellationCode with 400', async () => {
      const visit = await book()
      const res = await app.inject({
        method: 'POST',
        url: `/api/visits/${visit.id}/cancel`,
        payload: {},
      })
      expect(res.statusCode).toBe(400)
    })

    it('rejects an empty cancellationCode with 400', async () => {
      const visit = await book()
      const res = await app.inject({
        method: 'POST',
        url: `/api/visits/${visit.id}/cancel`,
        payload: { cancellationCode: '' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('rejects a non-integer id with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/visits/abc/cancel',
        payload: { cancellationCode: 'anything' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('frees the slot so the same pet+startsAt can be rebooked with 201', async () => {
      const visit = await book()
      const cancelled = await app.inject({
        method: 'POST',
        url: `/api/visits/${visit.id}/cancel`,
        payload: { cancellationCode: visit.cancellationCode },
      })
      expect(cancelled.statusCode).toBe(200)

      const rebook = await app.inject({ method: 'POST', url: '/api/pets/1/visits', payload: validBody })
      expect(rebook.statusCode).toBe(201)
    })
  })

  it('404s on a missing pet', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets/999/visits' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'pet 999 not found' })
  })

  it('rejects a non-integer id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets/abc/visits' })
    expect(res.statusCode).toBe(400)
  })

  it('omits cancelled visits', async () => {
    const booked = await app.inject({ method: 'POST', url: '/api/pets/1/visits', payload: validBody })
    const cancelledRes = await app.inject({
      method: 'POST',
      url: '/api/pets/1/visits',
      payload: { ...validBody, startsAt: '2026-08-03T10:00:00.000Z' },
    })
    const cancelledId = (cancelledRes.json() as Visit).id
    db.prepare(`UPDATE visits SET status = 'cancelled' WHERE id = ?`).run(cancelledId)

    const res = await app.inject({ method: 'GET', url: '/api/pets/1/visits' })
    const visits = res.json() as Visit[]
    expect(visits.length).toBe(1)
    expect(visits[0]?.id).toBe((booked.json() as Visit).id)
  })
})
