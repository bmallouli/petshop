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
    expect(res.json()).toEqual({ status: 'ok' })
  })
})

describe('GET /version', () => {
  it('reports the version from package.json', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string
    }
    const res = await app.inject({ method: 'GET', url: '/version' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ version: pkg.version })
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
})

describe('GET /api/pets/:id', () => {
  it('returns one pet', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets/1' })
    expect(res.statusCode).toBe(200)
    expect((res.json() as Pet).name).toBe('Biscuit')
  })

  it('404s on a missing pet', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pets/999' })
    expect(res.statusCode).toBe(404)
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
})
