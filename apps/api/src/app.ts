import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { toPet, toVisit } from './db.js'
import { sendNotification } from './notifier.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
}

const createPetSchema = z.object({
  name: z.string().min(1).max(80),
  species: z.string().min(1).max(40),
  priceCents: z.number().int().positive(),
})

/** Maximum number of UPCOMING (booked) visits allowed per pet before scheduling is rejected. */
const MAX_UPCOMING_VISITS = 3

const createVisitSchema = z.object({
  visitorName: z.string().min(1).max(80),
  visitorEmail: z.string().email(),
  startsAt: z.string().datetime(),
})

const cancelVisitSchema = z.object({
  cancellationCode: z.string().min(1),
})

const listQuerySchema = z.object({
  species: z.string().min(1).optional(),
  status: z.enum(['available', 'adopted', 'on_hold']).optional(),
  q: z.string().optional(),
})

export function buildApp(db: Database.Database): FastifyInstance {
  const app = Fastify({ logger: false })

  app.get('/health', async () => {
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM pets').get() as { count: number }
    return { status: 'ok', petCount: count }
  })

  app.get('/version', async () => ({ version: pkg.version, uptimeSeconds: process.uptime() }))

  app.get('/api/stats', async () => {
    const { total, adopted, available } = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'adopted' THEN 1 ELSE 0 END) AS adopted,
                SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available
         FROM pets`,
      )
      .get() as { total: number; adopted: number | null; available: number | null }
    const adoptedCount = adopted ?? 0
    const availableCount = available ?? 0

    const speciesRows = db
      .prepare(
        `SELECT species,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available
         FROM pets
         GROUP BY species
         ORDER BY species`,
      )
      .all() as { species: string; total: number; available: number | null }[]

    const bySpecies: Record<string, { total: number; available: number }> = {}
    for (const row of speciesRows) {
      bySpecies[row.species] = { total: row.total, available: row.available ?? 0 }
    }

    return { total, adopted: adoptedCount, available: availableCount, bySpecies }
  })

  app.get('/api/pets', async (req, reply) => {
    const query = listQuerySchema.safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.issues[0]?.message ?? 'bad query' })
    const { species, status, q } = query.data

    const where: string[] = []
    const params: string[] = []
    if (species) {
      where.push('species = ?')
      params.push(species)
    }
    if (status) {
      where.push('status = ?')
      params.push(status)
    } else {
      // On-hold pets are temporarily hidden from the adoption list unless explicitly requested.
      where.push("status != 'on_hold'")
    }
    if (q) {
      const escaped = q.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)
      where.push("LOWER(name) LIKE ? ESCAPE '\\'")
      params.push(`%${escaped}%`)
    }
    const sql = `SELECT * FROM pets ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`
    const rows = db.prepare(sql).all(...params)
    return rows.map((row) => toPet(row as never))
  })

  app.get('/api/pets/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id must be an integer' })
    const row = db.prepare('SELECT * FROM pets WHERE id = ?').get(id)
    if (!row) return reply.code(404).send({ error: 'not found' })
    return toPet(row as never)
  })

  app.post('/api/pets', async (req, reply) => {
    const body = createPetSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'bad body' })
    const { name, species, priceCents } = body.data
    const result = db
      .prepare('INSERT INTO pets (name, species, price_cents) VALUES (?, ?, ?)')
      .run(name, species, priceCents)
    const row = db.prepare('SELECT * FROM pets WHERE id = ?').get(result.lastInsertRowid)
    return reply.code(201).send(toPet(row as never))
  })

  app.post('/api/pets/:id/adopt', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id must be an integer' })
    const row = db.prepare('SELECT * FROM pets WHERE id = ?').get(id)
    if (!row) return reply.code(404).send({ error: `pet ${id} not found` })
    if (toPet(row as never).status === 'adopted') {
      return reply.code(409).send({ error: `pet ${id} is already adopted` })
    }
    db.prepare(`UPDATE pets SET status = 'adopted' WHERE id = ?`).run(id)
    const updated = db.prepare('SELECT * FROM pets WHERE id = ?').get(id)
    sendNotification('pet-adopted', { petId: id })
    return toPet(updated as never)
  })

  app.post('/api/pets/:id/hold', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id must be an integer' })
    const row = db.prepare('SELECT * FROM pets WHERE id = ?').get(id)
    if (!row) return reply.code(404).send({ error: `pet ${id} not found` })
    const status = toPet(row as never).status
    if (status === 'adopted') {
      return reply.code(409).send({ error: `pet ${id} is adopted and cannot be held` })
    }
    if (status === 'on_hold') {
      return reply.code(409).send({ error: `pet ${id} is already on hold` })
    }
    db.prepare(`UPDATE pets SET status = 'on_hold' WHERE id = ?`).run(id)
    const updated = db.prepare('SELECT * FROM pets WHERE id = ?').get(id)
    return toPet(updated as never)
  })

  app.post('/api/pets/:id/release', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id must be an integer' })
    const row = db.prepare('SELECT * FROM pets WHERE id = ?').get(id)
    if (!row) return reply.code(404).send({ error: `pet ${id} not found` })
    if (toPet(row as never).status !== 'on_hold') {
      return reply.code(409).send({ error: `pet ${id} is not on hold` })
    }
    db.prepare(`UPDATE pets SET status = 'available' WHERE id = ?`).run(id)
    const updated = db.prepare('SELECT * FROM pets WHERE id = ?').get(id)
    return toPet(updated as never)
  })

  app.get('/api/pets/:id/visits', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id must be an integer' })

    const petRow = db.prepare('SELECT * FROM pets WHERE id = ?').get(id)
    if (!petRow) return reply.code(404).send({ error: `pet ${id} not found` })

    const rows = db
      .prepare(`SELECT * FROM visits WHERE pet_id = ? AND status = 'booked' ORDER BY starts_at ASC`)
      .all(id)
    return rows.map((row) => {
      const { cancellationCode: _cancellationCode, ...visit } = toVisit(row as never)
      return visit
    })
  })

  app.post('/api/pets/:id/visits', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id must be an integer' })

    const body = createVisitSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'bad body' })

    const petRow = db.prepare('SELECT * FROM pets WHERE id = ?').get(id)
    if (!petRow) return reply.code(404).send({ error: `pet ${id} not found` })
    // Only available pets accept visits — adopted and on-hold pets are blocked alike.
    if (toPet(petRow as never).status !== 'available') {
      return reply.code(409).send({ error: `pet ${id} is not available for visits` })
    }

    const { visitorName, visitorEmail, startsAt } = body.data

    // Cap the number of UPCOMING (booked) visits per pet. Pets already over the cap keep
    // their existing visits (grandfathered) but cannot add new ones until they drop below it.
    const { count: upcomingCount } = db
      .prepare(`SELECT COUNT(*) AS count FROM visits WHERE pet_id = ? AND status = 'booked'`)
      .get(id) as { count: number }
    if (upcomingCount >= MAX_UPCOMING_VISITS) {
      return reply.code(409).send({
        error: `pet ${id} already has the maximum of ${MAX_UPCOMING_VISITS} upcoming visits`,
      })
    }

    const existing = db
      .prepare(`SELECT id FROM visits WHERE pet_id = ? AND starts_at = ? AND status = 'booked'`)
      .get(id, startsAt)
    if (existing) return reply.code(409).send({ error: 'slot already booked' })

    const cancellationCode = randomBytes(16).toString('hex')
    const result = db
      .prepare(
        `INSERT INTO visits (pet_id, visitor_name, visitor_email, starts_at, cancellation_code)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, visitorName, visitorEmail, startsAt, cancellationCode)
    const row = db.prepare('SELECT * FROM visits WHERE id = ?').get(result.lastInsertRowid)
    return reply.code(201).send(toVisit(row as never))
  })

  app.post('/api/visits/:id/cancel', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id must be an integer' })

    const body = cancelVisitSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'bad body' })

    const row = db.prepare('SELECT * FROM visits WHERE id = ?').get(id)
    if (!row) return reply.code(404).send({ error: `visit ${id} not found` })

    const visit = toVisit(row as never)
    if (visit.cancellationCode !== body.data.cancellationCode) {
      return reply.code(403).send({ error: 'invalid cancellation code' })
    }
    if (visit.status === 'cancelled') {
      return reply.code(409).send({ error: `visit ${id} is already cancelled` })
    }

    db.prepare(`UPDATE visits SET status = 'cancelled' WHERE id = ?`).run(id)
    const updated = db.prepare('SELECT * FROM visits WHERE id = ?').get(id)
    return toVisit(updated as never)
  })

  return app
}
