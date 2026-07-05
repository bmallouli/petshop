import Fastify, { type FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { toPet } from './db.js'

const createPetSchema = z.object({
  name: z.string().min(1).max(80),
  species: z.string().min(1).max(40),
  priceCents: z.number().int().positive(),
})

const listQuerySchema = z.object({
  species: z.string().min(1).optional(),
  status: z.enum(['available', 'adopted']).optional(),
})

export function buildApp(db: Database.Database): FastifyInstance {
  const app = Fastify({ logger: false })

  app.get('/health', async () => {
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM pets').get() as { count: number }
    return { status: 'ok', petCount: count }
  })

  app.get('/api/pets', async (req, reply) => {
    const query = listQuerySchema.safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.issues[0]?.message ?? 'bad query' })
    const { species, status } = query.data

    const where: string[] = []
    const params: string[] = []
    if (species) {
      where.push('species = ?')
      params.push(species)
    }
    if (status) {
      where.push('status = ?')
      params.push(status)
    }
    const sql = `SELECT * FROM pets ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`
    const rows = db.prepare(sql).all(...params)
    return rows.map((row) => toPet(row as never))
  })

  app.get('/api/pets/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id must be an integer' })
    const row = db.prepare('SELECT * FROM pets WHERE id = ?').get(id)
    if (!row) return reply.code(404).send({ error: `pet ${id} not found` })
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
    db.prepare(`UPDATE pets SET status = 'adopted' WHERE id = ?`).run(id)
    const updated = db.prepare('SELECT * FROM pets WHERE id = ?').get(id)
    return toPet(updated as never)
  })

  return app
}
