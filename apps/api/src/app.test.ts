import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { openDb, seed, toOwner, toPet, type Owner, type Pet, type Visit } from './db.js'
import * as notifier from './notifier.js'

let app: FastifyInstance
let db: ReturnType<typeof openDb>

beforeEach(() => {
  db = openDb(':memory:')
  seed(db)
  app = buildApp(db)
})

describe('seed: owners and pet ownership', () => {
  it('seeds at least two owners, links pets to owners, and adds a future booked visit', () => {
    const freshDb = openDb(':memory:')
    seed(freshDb)

    // At least two owners, each with a unique non-empty access code.
    const owners = (freshDb.prepare('SELECT * FROM owners ORDER BY id').all() as never[]).map(toOwner)
    expect(owners.length).toBeGreaterThanOrEqual(2)
    for (const owner of owners) expect(owner.accessCode.length).toBeGreaterThan(0)
    const codes = owners.map((o: Owner) => o.accessCode)
    expect(new Set(codes).size).toBe(codes.length)

    // At least two pets are linked to a seeded owner.
    const ownerIds = new Set(owners.map((o: Owner) => o.id))
    const ownedPets = (freshDb.prepare('SELECT * FROM pets WHERE owner_id IS NOT NULL').all() as never[])
      .map(toPet)
    expect(ownedPets.length).toBeGreaterThanOrEqual(2)
    for (const pet of ownedPets) expect(ownerIds.has(pet.ownerId as number)).toBe(true)

    // At least one owned pet has an upcoming booked visit.
    const upcomingVisit = freshDb
      .prepare(
        `SELECT v.* FROM visits v
         JOIN pets p ON p.id = v.pet_id
         WHERE v.status = 'booked' AND p.owner_id IS NOT NULL AND v.starts_at > datetime('now')`,
      )
      .get() as { id: number; starts_at: string } | undefined
    expect(upcomingVisit).toBeDefined()
  })

  it('migrates an existing owner_id-less database by adding the column without dropping data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'petshop-migrate-'))
    const path = join(dir, 'pets.db')
    try {
      // Build a legacy database whose pets table predates the owner_id column.
      const legacy = new Database(path)
      legacy.exec(`
        CREATE TABLE pets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          species TEXT NOT NULL,
          price_cents INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'available',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `)
      legacy.prepare('INSERT INTO pets (name, species, price_cents) VALUES (?, ?, ?)').run('Rex', 'dog', 5000)
      legacy.close()

      // Reopening runs the PRAGMA-guarded migration.
      const migrated = openDb(path)
      const columns = (migrated.prepare('PRAGMA table_info(pets)').all() as { name: string }[]).map(
        (c) => c.name,
      )
      expect(columns).toContain('owner_id')
      // Existing row survives, with a NULL owner_id.
      const row = migrated.prepare('SELECT * FROM pets').get() as never
      expect(toPet(row)).toMatchObject({ name: 'Rex', ownerId: null })
      migrated.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('GET /api/portal/me', () => {
  it('401s when the x-owner-code header is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/portal/me' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'invalid access code' })
  })

  it('401s when the x-owner-code header is blank', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/portal/me',
      headers: { 'x-owner-code': '' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'invalid access code' })
  })

  it('401s for an unknown access code', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/portal/me',
      headers: { 'x-owner-code': 'OWNER-NOBODY-9999' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'invalid access code' })
  })

  it('returns the owner id and name for a valid seeded access code, without the access code', async () => {
    const owner = toOwner(db.prepare(`SELECT * FROM owners WHERE access_code = 'OWNER-ADA-0001'`).get() as never)
    const res = await app.inject({
      method: 'GET',
      url: '/api/portal/me',
      headers: { 'x-owner-code': 'OWNER-ADA-0001' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ owner: { id: owner.id, name: 'Ada Lovelace' } })

    const body = res.json() as { owner: Record<string, unknown> }
    expect(body.owner).not.toHaveProperty('accessCode')
    expect(body.owner).not.toHaveProperty('access_code')
    expect(body.owner).not.toHaveProperty('email')
  })
})

describe('GET /api/portal/pets', () => {
  it('401s without an x-owner-code header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/portal/pets' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'invalid access code' })
  })

  it('401s for an unknown access code', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/portal/pets',
      headers: { 'x-owner-code': 'OWNER-NOBODY-9999' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'invalid access code' })
  })

  it('returns only the authenticated owner pets, ordered by id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/portal/pets',
      headers: { 'x-owner-code': 'OWNER-ADA-0001' },
    })
    expect(res.statusCode).toBe(200)
    const pets = res.json() as Pet[]
    // Ada owns pets 1 (Biscuit) and 3 (Nibbles).
    expect(pets.map((p) => p.id)).toEqual([1, 3])
    expect(pets[0]).toMatchObject({ id: 1, name: 'Biscuit', species: 'dog', status: 'available' })
    for (const pet of pets) expect(pet.ownerId).not.toBeNull()
  })

  it('scopes the list per owner: a different code returns a different set', async () => {
    const ada = await app.inject({
      method: 'GET',
      url: '/api/portal/pets',
      headers: { 'x-owner-code': 'OWNER-ADA-0001' },
    })
    const grace = await app.inject({
      method: 'GET',
      url: '/api/portal/pets',
      headers: { 'x-owner-code': 'OWNER-GRACE-0002' },
    })
    // Grace owns pets 2 (Mochi) and 5 (Pepper); disjoint from Ada's set.
    expect((grace.json() as Pet[]).map((p) => p.id)).toEqual([2, 5])
    expect((ada.json() as Pet[]).map((p) => p.id)).toEqual([1, 3])
  })
})

describe('GET /api/portal/pets/:id/visits', () => {
  it('401s without an x-owner-code header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/portal/pets/5/visits' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'invalid access code' })
  })

  it('404s for a pet owned by another owner without leaking it', async () => {
    // Grace owns pet 5; Ada must not see it.
    const res = await app.inject({
      method: 'GET',
      url: '/api/portal/pets/5/visits',
      headers: { 'x-owner-code': 'OWNER-ADA-0001' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'pet 5 not found' })
  })

  it('404s for a nonexistent pet', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/portal/pets/999/visits',
      headers: { 'x-owner-code': 'OWNER-ADA-0001' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'pet 999 not found' })
  })

  it("returns the owner's pet booked visits ordered by startsAt, without cancellationCode", async () => {
    // Grace owns pet 5, which has a seeded future booked visit. Add an earlier one.
    await app.inject({
      method: 'POST',
      url: '/api/pets/5/visits',
      payload: {
        visitorName: 'Grace Hopper',
        visitorEmail: 'grace@example.com',
        startsAt: '2029-06-01T10:00:00.000Z',
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/portal/pets/5/visits',
      headers: { 'x-owner-code': 'OWNER-GRACE-0002' },
    })
    expect(res.statusCode).toBe(200)
    const visits = res.json() as Record<string, unknown>[]
    expect(visits.map((v) => v.startsAt)).toEqual([
      '2029-06-01T10:00:00.000Z',
      '2030-01-15T10:00:00.000Z',
    ])
    for (const visit of visits) {
      expect(visit).not.toHaveProperty('cancellationCode')
      expect(visit).toMatchObject({ petId: 5, status: 'booked' })
    }
  })
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

  it('does not count on-hold pets as available', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/1/hold' })

    const res = await app.inject({ method: 'GET', url: '/api/stats' })
    expect(res.statusCode).toBe(200)
    // Pet 1 is neither available nor adopted while on hold; total still includes it.
    expect(res.json()).toMatchObject({ total: 8, adopted: 0, available: 7 })
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

describe('GET /api/pets/species', () => {
  it('returns an empty array for an empty store', async () => {
    const emptyApp = buildApp(openDb(':memory:'))
    const res = await emptyApp.inject({ method: 'GET', url: '/api/pets/species' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('returns distinct species, deduplicated and alphabetically sorted', async () => {
    // Seed data has several species with duplicates (two dogs, two cats).
    const res = await app.inject({ method: 'GET', url: '/api/pets/species' })
    expect(res.statusCode).toBe(200)
    const species = res.json() as string[]

    // Each species appears exactly once.
    expect(new Set(species).size).toBe(species.length)
    // Sorted alphabetically.
    expect(species).toEqual([...species].sort())
    // Reflects the seeded data.
    const pets = (await app.inject({ method: 'GET', url: '/api/pets?status=available' })).json() as Pet[]
    const adopted = (await app.inject({ method: 'GET', url: '/api/pets?status=adopted' })).json() as Pet[]
    const held = (await app.inject({ method: 'GET', url: '/api/pets?status=on_hold' })).json() as Pet[]
    const expected = [...new Set([...pets, ...adopted, ...held].map((p) => p.species))].sort()
    expect(species).toEqual(expected)
  })

  it('does not match the :id route (static route takes precedence)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets/species' })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json())).toBe(true)
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

describe('GET /api/pets/adopted-recently', () => {
  it('records adoptedAt when a pet is adopted', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/pets/3/adopt' })
    expect(res.statusCode).toBe(200)
    const pet = res.json() as Pet
    expect(pet.adoptedAt).toBeTruthy()
    // Freshly adopted, so it sits within the last month.
    const recent = await app.inject({ method: 'GET', url: '/api/pets/adopted-recently' })
    expect((recent.json() as Pet[]).map((p) => p.id)).toContain(3)
  })

  it('returns an empty array when nothing has been adopted', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets/adopted-recently' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('lists only pets adopted within the last month, most recent first', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/1/adopt' })
    await app.inject({ method: 'POST', url: '/api/pets/2/adopt' })

    // Backdate pet 1 to just under a month ago (recent) and pet 2 to two months ago (excluded).
    db.prepare(`UPDATE pets SET adopted_at = datetime('now', '-29 days') WHERE id = ?`).run(1)
    db.prepare(`UPDATE pets SET adopted_at = datetime('now', '-2 months') WHERE id = ?`).run(2)

    // Pet 5 adopted now — the most recent of the qualifying pets.
    await app.inject({ method: 'POST', url: '/api/pets/5/adopt' })

    const res = await app.inject({ method: 'GET', url: '/api/pets/adopted-recently' })
    expect(res.statusCode).toBe(200)
    const pets = res.json() as Pet[]
    expect(pets.map((p) => p.id)).toEqual([5, 1])
    expect(pets.every((p) => p.status === 'adopted')).toBe(true)
  })

  it('omits adopted pets that have no recorded adoptedAt (legacy rows)', async () => {
    // Simulate a pet adopted before adopted_at was tracked: status adopted, adopted_at NULL.
    db.prepare(`UPDATE pets SET status = 'adopted', adopted_at = NULL WHERE id = ?`).run(4)

    const res = await app.inject({ method: 'GET', url: '/api/pets/adopted-recently' })
    expect((res.json() as Pet[]).map((p) => p.id)).not.toContain(4)
  })
})

describe('POST /api/pets/:id/hold', () => {
  it('marks an available pet on hold', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/pets/1/hold' })
    expect(res.statusCode).toBe(200)
    expect((res.json() as Pet).status).toBe('on_hold')

    const check = await app.inject({ method: 'GET', url: '/api/pets/1' })
    expect((check.json() as Pet).status).toBe('on_hold')
  })

  it('hides an on-hold pet from the default adoption list', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/1/hold' })

    const list = await app.inject({ method: 'GET', url: '/api/pets' })
    const pets = list.json() as Pet[]
    expect(pets.length).toBe(7)
    expect(pets.some((p) => p.id === 1)).toBe(false)
  })

  it('still lists on-hold pets when filtered by status=on_hold', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/1/hold' })

    const res = await app.inject({ method: 'GET', url: '/api/pets?status=on_hold' })
    const pets = res.json() as Pet[]
    expect(pets.length).toBe(1)
    expect(pets[0]).toMatchObject({ id: 1, status: 'on_hold' })
  })

  it('404s on a missing pet', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/pets/999/hold' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'pet 999 not found' })
  })

  it('rejects holding a pet that is already on hold', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/1/hold' })
    const res = await app.inject({ method: 'POST', url: '/api/pets/1/hold' })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'pet 1 is already on hold' })
  })

  it('rejects holding an adopted pet', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/3/adopt' })
    const res = await app.inject({ method: 'POST', url: '/api/pets/3/hold' })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'pet 3 is adopted and cannot be held' })
  })

  it('rejects a non-integer id', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/pets/abc/hold' })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/pets/:id/release', () => {
  it('returns an on-hold pet to available and back onto the adoption list', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/1/hold' })

    const res = await app.inject({ method: 'POST', url: '/api/pets/1/release' })
    expect(res.statusCode).toBe(200)
    expect((res.json() as Pet).status).toBe('available')

    const list = await app.inject({ method: 'GET', url: '/api/pets' })
    const pets = list.json() as Pet[]
    expect(pets.length).toBe(8)
    expect(pets.some((p) => p.id === 1)).toBe(true)
  })

  it('404s on a missing pet', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/pets/999/release' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'pet 999 not found' })
  })

  it('rejects releasing a pet that is not on hold', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/pets/1/release' })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'pet 1 is not on hold' })
  })

  it('rejects a non-integer id', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/pets/abc/release' })
    expect(res.statusCode).toBe(400)
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

  it('rejects booking a visit for an on-hold pet', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/3/hold' })
    const res = await app.inject({ method: 'POST', url: '/api/pets/3/visits', payload: validBody })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'pet 3 is not available for visits' })
  })

  it('allows booking again once an on-hold pet is released', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/3/hold' })
    await app.inject({ method: 'POST', url: '/api/pets/3/release' })
    const res = await app.inject({ method: 'POST', url: '/api/pets/3/visits', payload: validBody })
    expect(res.statusCode).toBe(201)
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

  // Directly insert a booked visit, bypassing the API cap, to simulate pre-existing state.
  function insertBookedVisit(petId: number, startsAt: string): void {
    db.prepare(
      `INSERT INTO visits (pet_id, visitor_name, visitor_email, starts_at, cancellation_code)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(petId, 'Seed Visitor', 'seed@example.com', startsAt, `code-${petId}-${startsAt}`)
  }

  it('allows booking while the pet is below the upcoming-visit cap', async () => {
    // Pet already has 2 upcoming visits (cap is 3); a third distinct slot still succeeds.
    insertBookedVisit(1, '2026-08-01T09:00:00.000Z')
    insertBookedVisit(1, '2026-08-01T10:00:00.000Z')

    const res = await app.inject({
      method: 'POST',
      url: '/api/pets/1/visits',
      payload: { ...validBody, startsAt: '2026-08-01T11:00:00.000Z' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('rejects booking once the pet is at the upcoming-visit cap, naming the cap', async () => {
    insertBookedVisit(1, '2026-08-01T09:00:00.000Z')
    insertBookedVisit(1, '2026-08-01T10:00:00.000Z')
    insertBookedVisit(1, '2026-08-01T11:00:00.000Z')

    const res = await app.inject({
      method: 'POST',
      url: '/api/pets/1/visits',
      payload: { ...validBody, startsAt: '2026-08-01T12:00:00.000Z' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'pet 1 already has the maximum of 3 upcoming visits' })
  })

  it('does not count cancelled visits toward the cap', async () => {
    insertBookedVisit(1, '2026-08-01T09:00:00.000Z')
    insertBookedVisit(1, '2026-08-01T10:00:00.000Z')
    const third = db
      .prepare(
        `INSERT INTO visits (pet_id, visitor_name, visitor_email, starts_at, cancellation_code)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(1, 'Seed', 'seed@example.com', '2026-08-01T11:00:00.000Z', 'code-cancelled')
    db.prepare(`UPDATE visits SET status = 'cancelled' WHERE id = ?`).run(third.lastInsertRowid)

    // Only 2 booked visits remain, so a new booking is still under the cap.
    const res = await app.inject({
      method: 'POST',
      url: '/api/pets/1/visits',
      payload: { ...validBody, startsAt: '2026-08-01T12:00:00.000Z' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('grandfathers pets already over the cap: existing visits stay, new bookings are blocked', async () => {
    // Ship day: this pet already has 4 upcoming visits, above the cap of 3.
    insertBookedVisit(1, '2026-08-01T09:00:00.000Z')
    insertBookedVisit(1, '2026-08-01T10:00:00.000Z')
    insertBookedVisit(1, '2026-08-01T11:00:00.000Z')
    insertBookedVisit(1, '2026-08-01T12:00:00.000Z')

    // Existing visits are untouched — nothing is trimmed.
    const before = await app.inject({ method: 'GET', url: '/api/pets/1/visits' })
    expect((before.json() as Visit[]).length).toBe(4)

    // New bookings are rejected while the pet is over the cap.
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/pets/1/visits',
      payload: { ...validBody, startsAt: '2026-08-01T13:00:00.000Z' },
    })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json()).toEqual({ error: 'pet 1 already has the maximum of 3 upcoming visits' })

    // The existing visits are still all present after the rejected booking.
    const after = await app.inject({ method: 'GET', url: '/api/pets/1/visits' })
    expect((after.json() as Visit[]).length).toBe(4)
  })

  it('lets an over-cap pet book again once cancellations drop it below the cap', async () => {
    insertBookedVisit(1, '2026-08-01T09:00:00.000Z')
    insertBookedVisit(1, '2026-08-01T10:00:00.000Z')
    insertBookedVisit(1, '2026-08-01T11:00:00.000Z')

    // At the cap: still blocked.
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/pets/1/visits',
      payload: { ...validBody, startsAt: '2026-08-01T12:00:00.000Z' },
    })
    expect(blocked.statusCode).toBe(409)

    // Cancel one visit, dropping to 2 upcoming visits.
    const oldest = db
      .prepare(`SELECT id FROM visits WHERE pet_id = 1 ORDER BY starts_at ASC LIMIT 1`)
      .get() as { id: number }
    db.prepare(`UPDATE visits SET status = 'cancelled' WHERE id = ?`).run(oldest.id)

    const res = await app.inject({
      method: 'POST',
      url: '/api/pets/1/visits',
      payload: { ...validBody, startsAt: '2026-08-01T12:00:00.000Z' },
    })
    expect(res.statusCode).toBe(201)
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

describe('GET /api/visits/upcoming', () => {
  const futureBody = {
    visitorName: 'Ada Lovelace',
    visitorEmail: 'ada@example.com',
    startsAt: '2030-08-01T10:00:00.000Z',
  }

  it('returns 200 with a numeric count', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/visits/upcoming' })
    expect(res.statusCode).toBe(200)
    expect(typeof (res.json() as { count: number }).count).toBe('number')
  })

  it('returns 0 when there are no upcoming visits', async () => {
    // The empty store has no pets and therefore no visits at all.
    const emptyApp = buildApp(openDb(':memory:'))
    const res = await emptyApp.inject({ method: 'GET', url: '/api/visits/upcoming' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ count: 0 })
  })

  it('counts the seeded future visit', async () => {
    // The seed inserts one future booked visit (Grace, pet 5, 2030).
    const res = await app.inject({ method: 'GET', url: '/api/visits/upcoming' })
    expect(res.json()).toEqual({ count: 1 })
  })

  it('increases by 1 when a future visit is booked and drops back when it is cancelled', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/visits/upcoming' })).json() as {
      count: number
    }

    const booked = await app.inject({ method: 'POST', url: '/api/pets/1/visits', payload: futureBody })
    expect(booked.statusCode).toBe(201)
    const visit = booked.json() as Visit

    const after = (await app.inject({ method: 'GET', url: '/api/visits/upcoming' })).json() as {
      count: number
    }
    expect(after.count).toBe(before.count + 1)

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/visits/${visit.id}/cancel`,
      payload: { cancellationCode: visit.cancellationCode },
    })
    expect(cancelled.statusCode).toBe(200)

    const restored = (await app.inject({ method: 'GET', url: '/api/visits/upcoming' })).json() as {
      count: number
    }
    expect(restored.count).toBe(before.count)
  })

  it('counts across all pets, not just one', async () => {
    await app.inject({ method: 'POST', url: '/api/pets/1/visits', payload: futureBody })
    await app.inject({ method: 'POST', url: '/api/pets/2/visits', payload: futureBody })

    // Seeded future visit (1) + two new future visits on different pets.
    const res = await app.inject({ method: 'GET', url: '/api/visits/upcoming' })
    expect(res.json()).toEqual({ count: 3 })
  })

  it('does not count past visits', async () => {
    // Insert a booked visit dated in the past directly at the DB layer.
    db.prepare(
      `INSERT INTO visits (pet_id, visitor_name, visitor_email, starts_at, cancellation_code)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(1, 'Past Visitor', 'past@example.com', '2000-01-01T10:00:00.000Z', 'past-code')

    // Only the seeded future visit qualifies; the past one is excluded.
    const res = await app.inject({ method: 'GET', url: '/api/visits/upcoming' })
    expect(res.json()).toEqual({ count: 1 })
  })
})
