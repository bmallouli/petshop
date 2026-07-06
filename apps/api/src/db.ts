import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Pet {
  id: number
  name: string
  species: string
  priceCents: number
  status: 'available' | 'adopted' | 'on_hold'
  createdAt: string
}

export interface Visit {
  id: number
  petId: number
  visitorName: string
  visitorEmail: string
  startsAt: string
  status: 'booked' | 'cancelled'
  cancellationCode: string
  createdAt: string
}

const SEED_PETS: [string, string, number][] = [
  ['Biscuit', 'dog', 89900],
  ['Mochi', 'cat', 64900],
  ['Nibbles', 'hamster', 2400],
  ['Kai', 'fish', 1200],
  ['Pepper', 'dog', 102500],
  ['Clementine', 'cat', 57500],
  ['Ziggy', 'parrot', 149900],
  ['Sprout', 'rabbit', 8900],
]

/** Open (and migrate) the pets database. Pass ':memory:' in tests. */
export function openDb(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS pets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      species     TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      status      TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'adopted', 'on_hold')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS visits (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      pet_id            INTEGER NOT NULL REFERENCES pets(id),
      visitor_name      TEXT NOT NULL,
      visitor_email     TEXT NOT NULL,
      starts_at         TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled')),
      cancellation_code TEXT NOT NULL,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  return db
}

/** Insert the demo pets if the table is empty. */
export function seed(db: Database.Database): void {
  const { n } = db.prepare('SELECT count(*) AS n FROM pets').get() as { n: number }
  if (n > 0) return
  const insert = db.prepare('INSERT INTO pets (name, species, price_cents) VALUES (?, ?, ?)')
  for (const pet of SEED_PETS) insert.run(...pet)
}

interface PetRow {
  id: number
  name: string
  species: string
  price_cents: number
  status: 'available' | 'adopted' | 'on_hold'
  created_at: string
}

export function toPet(row: PetRow): Pet {
  return {
    id: row.id,
    name: row.name,
    species: row.species,
    priceCents: row.price_cents,
    status: row.status,
    createdAt: row.created_at,
  }
}

interface VisitRow {
  id: number
  pet_id: number
  visitor_name: string
  visitor_email: string
  starts_at: string
  status: 'booked' | 'cancelled'
  cancellation_code: string
  created_at: string
}

export function toVisit(row: VisitRow): Visit {
  return {
    id: row.id,
    petId: row.pet_id,
    visitorName: row.visitor_name,
    visitorEmail: row.visitor_email,
    startsAt: row.starts_at,
    status: row.status,
    cancellationCode: row.cancellation_code,
    createdAt: row.created_at,
  }
}
