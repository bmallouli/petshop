import { useCallback, useEffect, useState } from 'react'

export interface Pet {
  id: number
  name: string
  species: string
  priceCents: number
  status: 'available' | 'adopted'
}

export function formatPrice(priceCents: number): string {
  return `$${(priceCents / 100).toFixed(2)}`
}

/** A pet's upcoming visit as returned by GET /api/pets/:id/visits (no cancellation code). */
export interface Visit {
  id: number
  petId: number
  visitorName: string
  visitorEmail: string
  startsAt: string
  status: 'booked' | 'cancelled'
  createdAt: string
}

/** Format an ISO datetime for human-readable display; falls back to the raw string if unparseable. */
export function formatVisitTime(startsAt: string): string {
  const date = new Date(startsAt)
  return Number.isNaN(date.getTime()) ? startsAt : date.toLocaleString()
}

type VisitsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; visits: Visit[] }

export interface Stats {
  total: number
  adopted: number
  available: number
}

export function App() {
  const [pets, setPets] = useState<Pet[] | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [species, setSpecies] = useState('all')
  const [visits, setVisits] = useState<Record<number, VisitsState | undefined>>({})

  const load = useCallback(async () => {
    try {
      const [petsRes, statsRes] = await Promise.all([fetch('/api/pets'), fetch('/api/stats')])
      if (!petsRes.ok) throw new Error(`API returned ${petsRes.status}`)
      if (!statsRes.ok) throw new Error(`API returned ${statsRes.status}`)
      setPets((await petsRes.json()) as Pet[])
      setStats((await statsRes.json()) as Stats)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function adopt(id: number) {
    await fetch(`/api/pets/${id}/adopt`, { method: 'POST' })
    await load()
  }

  const loadVisits = useCallback(async (id: number) => {
    setVisits((prev) => ({ ...prev, [id]: { status: 'loading' } }))
    try {
      const res = await fetch(`/api/pets/${id}/visits`)
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const data = (await res.json()) as Visit[]
      setVisits((prev) => ({ ...prev, [id]: { status: 'loaded', visits: data } }))
    } catch (err) {
      setVisits((prev) => ({
        ...prev,
        [id]: { status: 'error', message: err instanceof Error ? err.message : String(err) },
      }))
    }
  }, [])

  function toggleVisits(id: number) {
    // Closing when open; (re)fetching fresh data every time the list is opened.
    if (visits[id]) {
      setVisits((prev) => ({ ...prev, [id]: undefined }))
    } else {
      void loadVisits(id)
    }
  }

  if (error) return <p className="error">Could not load pets: {error}</p>
  if (!pets) return <p>Loading pets…</p>

  const allSpecies = [...new Set(pets.map((pet) => pet.species))].sort()
  const visiblePets = species === 'all' ? pets : pets.filter((pet) => pet.species === species)

  return (
    <main>
      <header className="header">
        <h1>🐾 Petshop</h1>
        {stats && <span className="available-count">{stats.available} available</span>}
      </header>
      <label>
        Species
        <select value={species} onChange={(e) => setSpecies(e.target.value)}>
          <option value="all">all</option>
          {allSpecies.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {visiblePets.length === 0 ? (
        <p>No pets match this species.</p>
      ) : (
        <ul className="pets">
          {visiblePets.map((pet) => {
            const petVisits = visits[pet.id]
            return (
              <li key={pet.id} className={`pet ${pet.status}`}>
                <span className="name">{pet.name}</span>
                <span className="species">{pet.species}</span>
                <span className="price">{formatPrice(pet.priceCents)}</span>
                {pet.status === 'adopted' ? (
                  <span className="adopted-badge">adopted</span>
                ) : (
                  <button onClick={() => void adopt(pet.id)}>Adopt</button>
                )}
                <button
                  className="visits-toggle"
                  aria-expanded={petVisits !== undefined}
                  onClick={() => toggleVisits(pet.id)}
                >
                  {petVisits ? 'Hide visits' : 'View visits'}
                </button>
                {petVisits && (
                  <div className="visits">
                    {petVisits.status === 'loading' && <p>Loading visits…</p>}
                    {petVisits.status === 'error' && (
                      <p className="error">Could not load visits: {petVisits.message}</p>
                    )}
                    {petVisits.status === 'loaded' &&
                      (petVisits.visits.length === 0 ? (
                        <p className="no-visits">No upcoming visits.</p>
                      ) : (
                        <ul className="visit-list">
                          {petVisits.visits.map((visit) => (
                            <li key={visit.id} className="visit">
                              <span className="visit-time">{formatVisitTime(visit.startsAt)}</span>
                              <span className="visit-visitor">{visit.visitorName}</span>
                            </li>
                          ))}
                        </ul>
                      ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
