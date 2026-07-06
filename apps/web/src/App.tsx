import { useCallback, useEffect, useState, type FormEvent } from 'react'

export interface Pet {
  id: number
  name: string
  species: string
  priceCents: number
  status: 'available' | 'adopted' | 'on_hold'
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

function PetCard({
  pet,
  onAdopt,
  onHold,
  onRelease,
  visitsState,
  onToggleVisits,
}: {
  pet: Pet
  onAdopt: (id: number) => void
  onHold: (id: number) => void
  onRelease: (id: number) => void
  visitsState: VisitsState | undefined
  onToggleVisits: () => void
}) {
  const [open, setOpen] = useState(false)
  const [visitorName, setVisitorName] = useState('')
  const [visitorEmail, setVisitorEmail] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [confirmation, setConfirmation] = useState<Visit | null>(null)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function book(event: FormEvent) {
    event.preventDefault()
    setBookingError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/pets/${pet.id}/visits`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          visitorName,
          visitorEmail,
          startsAt: new Date(startsAt).toISOString(),
        }),
      })
      const data = (await res.json()) as Visit | { error?: string }
      if (!res.ok) {
        setBookingError(('error' in data && data.error) || `API returned ${res.status}`)
        return
      }
      setConfirmation(data as Visit)
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <li className={`pet ${pet.status}`}>
      <span className="name">{pet.name}</span>
      <span className="species">{pet.species}</span>
      <span className="price">{formatPrice(pet.priceCents)}</span>
      {pet.status === 'adopted' && <span className="adopted-badge">adopted</span>}
      {pet.status === 'on_hold' && (
        <>
          <span className="on-hold-badge">on hold</span>
          <button onClick={() => onRelease(pet.id)}>Release</button>
        </>
      )}
      {pet.status === 'available' && (
        <>
          <button onClick={() => onAdopt(pet.id)}>Adopt</button>
          <button onClick={() => onHold(pet.id)}>Hold</button>
          <button onClick={() => setOpen((prev) => !prev)}>Book visit</button>
        </>
      )}

      {pet.status === 'available' && open && !confirmation && (
        <form className="booking" onSubmit={(e) => void book(e)}>
          <label>
            Your name
            <input
              value={visitorName}
              onChange={(e) => setVisitorName(e.target.value)}
              required
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={visitorEmail}
              onChange={(e) => setVisitorEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Slot
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              required
            />
          </label>
          {bookingError && (
            <p className="error booking-error" role="alert">
              {bookingError}
            </p>
          )}
          <button type="submit" disabled={submitting}>
            Book
          </button>
        </form>
      )}

      {confirmation && (
        <p className="booking-confirmation" role="status">
          Visit booked! Save your cancellation code: <code>{confirmation.cancellationCode}</code>
        </p>
      )}

      <button
        className="visits-toggle"
        aria-expanded={visitsState !== undefined}
        onClick={onToggleVisits}
      >
        {visitsState ? 'Hide visits' : 'View visits'}
      </button>
      {visitsState && (
        <div className="visits">
          {visitsState.status === 'loading' && <p>Loading visits…</p>}
          {visitsState.status === 'error' && (
            <p className="error">Could not load visits: {visitsState.message}</p>
          )}
          {visitsState.status === 'loaded' &&
            (visitsState.visits.length === 0 ? (
              <p className="no-visits">No upcoming visits.</p>
            ) : (
              <ul className="visit-list">
                {visitsState.visits.map((visit) => (
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
}

export function App() {
  const [pets, setPets] = useState<Pet[] | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [species, setSpecies] = useState('all')
  const [visits, setVisits] = useState<Record<number, VisitsState | undefined>>({})
  const [showOnHold, setShowOnHold] = useState(false)
  const [onHoldPets, setOnHoldPets] = useState<Pet[] | null>(null)

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

  const loadOnHold = useCallback(async () => {
    const res = await fetch('/api/pets?status=on_hold')
    if (res.ok) setOnHoldPets((await res.json()) as Pet[])
  }, [])

  async function adopt(id: number) {
    await fetch(`/api/pets/${id}/adopt`, { method: 'POST' })
    await load()
  }

  async function hold(id: number) {
    await fetch(`/api/pets/${id}/hold`, { method: 'POST' })
    await load()
    if (showOnHold) await loadOnHold()
  }

  async function release(id: number) {
    await fetch(`/api/pets/${id}/release`, { method: 'POST' })
    await load()
    if (showOnHold) await loadOnHold()
  }

  async function toggleOnHold() {
    if (showOnHold) {
      setShowOnHold(false)
      setOnHoldPets(null)
    } else {
      setShowOnHold(true)
      await loadOnHold()
    }
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
          {visiblePets.map((pet) => (
            <PetCard
              key={pet.id}
              pet={pet}
              onAdopt={(id) => void adopt(id)}
              onHold={(id) => void hold(id)}
              onRelease={(id) => void release(id)}
              visitsState={visits[pet.id]}
              onToggleVisits={() => toggleVisits(pet.id)}
            />
          ))}
        </ul>
      )}
      <section className="on-hold">
        <button className="show-on-hold" onClick={() => void toggleOnHold()}>
          {showOnHold ? 'Hide pets on hold' : 'Show pets on hold'}
        </button>
        {showOnHold &&
          onHoldPets &&
          (onHoldPets.length === 0 ? (
            <p className="no-on-hold">No pets are on hold.</p>
          ) : (
            <ul className="pets on-hold-list">
              {onHoldPets.map((pet) => (
                <PetCard
                  key={pet.id}
                  pet={pet}
                  onAdopt={(id) => void adopt(id)}
                  onHold={(id) => void hold(id)}
                  onRelease={(id) => void release(id)}
                  visitsState={visits[pet.id]}
                  onToggleVisits={() => toggleVisits(pet.id)}
                />
              ))}
            </ul>
          ))}
      </section>
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
