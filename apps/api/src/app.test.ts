import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { openDb, seed, type Pet } from './db.js'

let app: FastifyInstance

beforeEach(() => {
  const db = openDb(':memory:')
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
