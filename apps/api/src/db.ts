import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Pet {
  id: number
  name: string
  species: string
  priceCents: number
  status: 'available' | 'adopted'
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
      status      TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'adopted')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
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
  status: 'available' | 'adopted'
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
