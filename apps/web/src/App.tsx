import { useCallback, useEffect, useState, type FormEvent } from 'react'

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

export interface Stats {
  total: number
  adopted: number
  available: number
}

export interface Visit {
  id: number
  petId: number
  visitorName: string
  startsAt: string
  status: 'booked' | 'cancelled'
}

export function App() {
  const [pets, setPets] = useState<Pet[] | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [species, setSpecies] = useState('all')

  const [cancelVisitId, setCancelVisitId] = useState('')
  const [cancelCode, setCancelCode] = useState('')
  const [cancelPending, setCancelPending] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [cancelMessage, setCancelMessage] = useState<string | null>(null)
  const [affectedVisits, setAffectedVisits] = useState<{ petId: number; visits: Visit[] } | null>(
    null,
  )

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

  async function cancelVisit(event: FormEvent) {
    event.preventDefault()
    const id = cancelVisitId.trim()
    const code = cancelCode.trim()
    if (!id || !code || cancelPending) return

    setCancelPending(true)
    setCancelError(null)
    setCancelMessage(null)
    try {
      const res = await fetch(`/api/visits/${id}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cancellationCode: code }),
      })
      const data = (await res.json()) as Partial<Visit> & { error?: string }
      if (!res.ok) {
        setCancelError(data.error ?? `API returned ${res.status}`)
        return
      }

      const visit = data as Visit
      setCancelMessage(`Visit #${visit.id} cancelled.`)
      setCancelVisitId('')
      setCancelCode('')

      // Refresh the affected pet's upcoming visits so the cancelled slot disappears.
      try {
        const visitsRes = await fetch(`/api/pets/${visit.petId}/visits`)
        if (visitsRes.ok) {
          setAffectedVisits({ petId: visit.petId, visits: (await visitsRes.json()) as Visit[] })
        }
      } catch {
        // A failed refresh must not undo the confirmed cancellation.
      }
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : String(err))
    } finally {
      setCancelPending(false)
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
          {visiblePets.map((pet) => (
            <li key={pet.id} className={`pet ${pet.status}`}>
              <span className="name">{pet.name}</span>
              <span className="species">{pet.species}</span>
              <span className="price">{formatPrice(pet.priceCents)}</span>
              {pet.status === 'adopted' ? (
                <span className="adopted-badge">adopted</span>
              ) : (
                <button onClick={() => void adopt(pet.id)}>Adopt</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <section className="cancel-visit">
        <h2>Cancel a visit</h2>
        <p className="hint">
          Holding a booking? Enter the visit id and the cancellation code you received.
        </p>
        <form onSubmit={(e) => void cancelVisit(e)}>
          <label>
            Visit id
            <input
              type="number"
              value={cancelVisitId}
              onChange={(e) => setCancelVisitId(e.target.value)}
            />
          </label>
          <label>
            Cancellation code
            <input
              type="text"
              value={cancelCode}
              onChange={(e) => setCancelCode(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={cancelPending || !cancelVisitId.trim() || !cancelCode.trim()}
          >
            {cancelPending ? 'Cancelling…' : 'Cancel visit'}
          </button>
        </form>
        {cancelError && <p className="error cancel-error">{cancelError}</p>}
        {cancelMessage && <p className="cancel-success">{cancelMessage}</p>}
        {affectedVisits && (
          <div className="affected-visits">
            <h3>Upcoming visits for pet #{affectedVisits.petId}</h3>
            {affectedVisits.visits.length === 0 ? (
              <p>No upcoming visits.</p>
            ) : (
              <ul>
                {affectedVisits.visits.map((visit) => (
                  <li key={visit.id}>
                    #{visit.id} — {visit.startsAt}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
