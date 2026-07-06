import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Pet {
  id: number
  name: string
  species: string
  priceCents: number
  status: 'available' | 'adopted' | 'on_hold'
  ownerId: number | null
  adoptedAt: string | null
  createdAt: string
}

export interface Owner {
  id: number
  name: string
  email: string
  accessCode: string
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

/**
 * Demo portal owners. Each owner's `accessCode` is deterministic and documented
 * here so later portal tickets (and manual testing) can log in as a seed owner.
 * The `pets` array holds 1-based indices into SEED_PETS that this owner owns.
 */
const SEED_OWNERS: { name: string; email: string; accessCode: string; pets: number[] }[] = [
  { name: 'Ada Lovelace', email: 'ada@example.com', accessCode: 'OWNER-ADA-0001', pets: [1, 3] },
  { name: 'Grace Hopper', email: 'grace@example.com', accessCode: 'OWNER-GRACE-0002', pets: [2, 5] },
]

/**
 * A deterministic future `booked` visit for one owned pet (Grace owns pet 5),
 * so the portal has an upcoming visit to display after seeding. The date is
 * well in the future to stay "upcoming" for the life of the demo.
 */
const SEED_VISIT = {
  petIndex: 5,
  visitorName: 'Grace Hopper',
  visitorEmail: 'grace@example.com',
  startsAt: '2030-01-15T10:00:00.000Z',
  cancellationCode: 'SEED-VISIT-0001',
}

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
      adopted_at  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS owners (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL,
      access_code TEXT NOT NULL UNIQUE,
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
  // The pets table is created with IF NOT EXISTS, so an already-seeded database
  // won't get owner_id from the CREATE above. Add it via ALTER only when missing
  // so existing data migrates in place without being dropped.
  const petColumns = db.prepare('PRAGMA table_info(pets)').all() as { name: string }[]
  if (!petColumns.some((col) => col.name === 'owner_id')) {
    db.exec('ALTER TABLE pets ADD COLUMN owner_id INTEGER REFERENCES owners(id)')
  }
  // `adopted_at` records when a pet was marked adopted so "adopted recently" lists
  // can be built. Added via ALTER when missing so existing databases migrate in place;
  // pets adopted before this column existed keep a NULL value.
  if (!petColumns.some((col) => col.name === 'adopted_at')) {
    db.exec('ALTER TABLE pets ADD COLUMN adopted_at TEXT')
  }
  return db
}

/** Insert the demo pets, owners, and a future visit if the store is empty. */
export function seed(db: Database.Database): void {
  const { n } = db.prepare('SELECT count(*) AS n FROM pets').get() as { n: number }
  if (n > 0) return

  const insertPet = db.prepare('INSERT INTO pets (name, species, price_cents) VALUES (?, ?, ?)')
  const petIds: number[] = []
  for (const pet of SEED_PETS) petIds.push(Number(insertPet.run(...pet).lastInsertRowid))

  const insertOwner = db.prepare('INSERT INTO owners (name, email, access_code) VALUES (?, ?, ?)')
  const linkPet = db.prepare('UPDATE pets SET owner_id = ? WHERE id = ?')
  for (const owner of SEED_OWNERS) {
    const ownerId = Number(insertOwner.run(owner.name, owner.email, owner.accessCode).lastInsertRowid)
    for (const petIndex of owner.pets) {
      const petId = petIds[petIndex - 1]
      if (petId !== undefined) linkPet.run(ownerId, petId)
    }
  }

  const visitPetId = petIds[SEED_VISIT.petIndex - 1]
  if (visitPetId !== undefined) {
    db.prepare(
      `INSERT INTO visits (pet_id, visitor_name, visitor_email, starts_at, cancellation_code)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      visitPetId,
      SEED_VISIT.visitorName,
      SEED_VISIT.visitorEmail,
      SEED_VISIT.startsAt,
      SEED_VISIT.cancellationCode,
    )
  }
}

interface PetRow {
  id: number
  name: string
  species: string
  price_cents: number
  status: 'available' | 'adopted' | 'on_hold'
  owner_id: number | null
  adopted_at: string | null
  created_at: string
}

export function toPet(row: PetRow): Pet {
  return {
    id: row.id,
    name: row.name,
    species: row.species,
    priceCents: row.price_cents,
    status: row.status,
    ownerId: row.owner_id ?? null,
    adoptedAt: row.adopted_at ?? null,
    createdAt: row.created_at,
  }
}

interface OwnerRow {
  id: number
  name: string
  email: string
  access_code: string
  created_at: string
}

export function toOwner(row: OwnerRow): Owner {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    accessCode: row.access_code,
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
