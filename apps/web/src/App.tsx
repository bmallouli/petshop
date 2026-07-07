import { useCallback, useEffect, useState, type FormEvent } from 'react'

export interface Pet {
  id: number
  name: string
  species: string
  priceCents: number
  status: 'available' | 'adopted' | 'on_hold'
  adoptedAt?: string | null
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

/** Emoji shown before a pet's name, keyed by species; unknown species fall back to 🐾. */
const SPECIES_EMOJI: Record<string, string> = {
  dog: '🐶',
  cat: '🐱',
  hamster: '🐹',
  fish: '🐟',
  parrot: '🦜',
  rabbit: '🐰',
}

/** The emoji for a species (case-insensitive), or the 🐾 fallback for anything unmapped. */
export function speciesEmoji(species: string): string {
  return SPECIES_EMOJI[species.trim().toLowerCase()] ?? '🐾'
}

/**
 * Order pets for display so every available pet comes before every non-available
 * (adopted) one, preserving the original relative order within each group. The
 * decorate-sort-undo keeps this stable regardless of the engine's sort stability.
 */
export function sortAvailableFirst(pets: Pet[]): Pet[] {
  return pets
    .map((pet, index) => ({ pet, index }))
    .sort((a, b) => {
      const rank = (pet: Pet) => (pet.status === 'available' ? 0 : 1)
      return rank(a.pet) - rank(b.pet) || a.index - b.index
    })
    .map((entry) => entry.pet)
}

/** Footer summary of how many pets are currently on screen, pluralised ("1 pet shown" / "8 pets shown"). */
export function petsShownLabel(count: number): string {
  return `${count} ${count === 1 ? 'pet' : 'pets'} shown`
}

/**
 * Summary line with the combined price of the given (visible) pets, formatted
 * like the individual prices ("Total value: $1,234.00"). An empty list yields
 * "Total value: $0.00".
 */
export function totalValueLabel(pets: Pet[]): string {
  const totalCents = pets.reduce((sum, pet) => sum + pet.priceCents, 0)
  return `Total value: ${formatPrice(totalCents)}`
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

/**
 * Format an ISO datetime for human-readable display; falls back to the raw
 * string if unparseable. Visits that fall on the current or next calendar day
 * (local time) are prefixed with `Today, ` or `Tomorrow, ` respectively.
 */
export function formatVisitTime(startsAt: string): string {
  const date = new Date(startsAt)
  if (Number.isNaN(date.getTime())) return startsAt

  const formatted = date.toLocaleString()

  const now = new Date()
  const dayDiff = calendarDayDiff(now, date)
  if (dayDiff === 0) return `Today, ${formatted}`
  if (dayDiff === 1) return `Tomorrow, ${formatted}`
  return formatted
}

/** Whole calendar days (local time) from `from` to `to`, ignoring the time of day. */
function calendarDayDiff(from: Date, to: Date): number {
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((toMidnight.getTime() - fromMidnight.getTime()) / 86_400_000)
}

/**
 * Human-readable adoption date. The API stores `adopted_at` as SQLite's
 * `YYYY-MM-DD HH:MM:SS` (UTC); we show the date part, falling back to the raw
 * value if it cannot be parsed and an empty string when there is no date.
 */
export function formatAdoptedAt(adoptedAt: string | null | undefined): string {
  if (!adoptedAt) return ''
  const date = new Date(adoptedAt.replace(' ', 'T') + 'Z')
  return Number.isNaN(date.getTime()) ? adoptedAt : date.toLocaleDateString()
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

/** Which add-a-pet field an error belongs to; `form` is the fallback when no field can be determined. */
export type AddPetErrors = {
  name?: string
  species?: string
  price?: string
  form?: string
}

/**
 * Client-side validation mirroring the API's `createPetSchema` (name 1-80 chars,
 * species 1-40 chars, price that converts to a positive integer number of cents).
 * Returns a per-field error map; an empty object means the input is valid.
 */
export function validateAddPet(name: string, species: string, price: string): AddPetErrors {
  const errors: AddPetErrors = {}

  const trimmedName = name.trim()
  if (!trimmedName) errors.name = 'Name is required.'
  else if (trimmedName.length > 80) errors.name = 'Name must be 80 characters or fewer.'

  const trimmedSpecies = species.trim()
  if (!trimmedSpecies) errors.species = 'Species is required.'
  else if (trimmedSpecies.length > 40) errors.species = 'Species must be 40 characters or fewer.'

  const trimmedPrice = price.trim()
  const dollars = Number(trimmedPrice)
  const cents = Math.round(dollars * 100)
  if (!trimmedPrice) errors.price = 'Price is required.'
  else if (!Number.isFinite(dollars)) errors.price = 'Price must be a number.'
  else if (!Number.isInteger(cents) || cents <= 0)
    errors.price = 'Price must be greater than zero.'

  return errors
}

/**
 * Best-effort mapping of a server error message to the add-a-pet field it concerns.
 * The API returns a single zod message with no field path, so we key off keywords;
 * returns null when no field can be determined (caller shows a form-level message).
 */
export function fieldForAddPetError(message: string): keyof AddPetErrors | null {
  const lower = message.toLowerCase()
  if (lower.includes('name')) return 'name'
  if (lower.includes('species')) return 'species'
  if (lower.includes('price') || lower.includes('cent')) return 'price'
  return null
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
      <span className="species-emoji" aria-hidden="true">
        {speciesEmoji(pet.species)}
      </span>
      <span className="name">{pet.name}</span>
      <span className="species">{pet.species}</span>
      <span className="price">{formatPrice(pet.priceCents)}</span>
      {pet.status === 'adopted' && <span className="adopted-badge">Adopted</span>}
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

/** Site-wide footer shown on every page, carrying the demo notice. */
export function SiteFooter() {
  return <footer className="site-footer">petshop — Fleet demo</footer>
}

export function App() {
  const [pets, setPets] = useState<Pet[] | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [species, setSpecies] = useState('all')
  const [nameQuery, setNameQuery] = useState('')
  const [visits, setVisits] = useState<Record<number, VisitsState | undefined>>({})
  const [showOnHold, setShowOnHold] = useState(false)
  const [onHoldPets, setOnHoldPets] = useState<Pet[] | null>(null)
  const [showAdopted, setShowAdopted] = useState(false)
  const [adoptedPets, setAdoptedPets] = useState<Pet[] | null>(null)

  const [addName, setAddName] = useState('')
  const [addSpecies, setAddSpecies] = useState('')
  const [addPrice, setAddPrice] = useState('')
  const [addPending, setAddPending] = useState(false)
  const [addErrors, setAddErrors] = useState<AddPetErrors>({})

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

  const loadAdopted = useCallback(async () => {
    const res = await fetch('/api/pets/adopted-recently')
    if (res.ok) setAdoptedPets((await res.json()) as Pet[])
  }, [])

  async function adopt(id: number) {
    await fetch(`/api/pets/${id}/adopt`, { method: 'POST' })
    await load()
    if (showAdopted) await loadAdopted()
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

  async function toggleAdopted() {
    if (showAdopted) {
      setShowAdopted(false)
      setAdoptedPets(null)
    } else {
      setShowAdopted(true)
      await loadAdopted()
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

  async function addPet(event: FormEvent) {
    event.preventDefault()
    if (addPending) return

    // Validate client-side first, mirroring the API constraints, so invalid input is
    // flagged on the offending field(s) without a wasted round-trip.
    const validationErrors = validateAddPet(addName, addSpecies, addPrice)
    if (Object.keys(validationErrors).length > 0) {
      setAddErrors(validationErrors)
      return
    }

    const name = addName.trim()
    const species = addSpecies.trim()
    const priceCents = Math.round(Number(addPrice) * 100)

    setAddPending(true)
    setAddErrors({})
    try {
      const res = await fetch('/api/pets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, species, priceCents }),
      })
      const data = (await res.json()) as Pet | { error?: string }
      if (!res.ok) {
        const message = ('error' in data && data.error) || `API returned ${res.status}`
        // The API sends a single message with no field path, so map it to a field when
        // we can; otherwise fall back to a form-level message.
        const field = fieldForAddPetError(message)
        setAddErrors(field ? { [field]: message } : { form: message })
        return
      }
      // Prepend the created pet so it appears without a full reload; keep the form's
      // typed values only on failure, so clear them here on success.
      setPets((prev) => (prev ? [data as Pet, ...prev] : [data as Pet]))
      setAddName('')
      setAddSpecies('')
      setAddPrice('')
    } catch (err) {
      setAddErrors({ form: err instanceof Error ? err.message : String(err) })
    } finally {
      setAddPending(false)
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

  if (error)
    return (
      <>
        <p className="error">Could not load pets: {error}</p>
        <SiteFooter />
      </>
    )
  if (!pets)
    return (
      <>
        <p>Loading pets…</p>
        <SiteFooter />
      </>
    )

  const allSpecies = [...new Set(pets.map((pet) => pet.species))].sort()
  // The footer counts what is on screen, so both the species filter and the
  // case-insensitive name search narrow the list (and thus the count) together.
  const query = nameQuery.trim().toLowerCase()
  const visiblePets = sortAvailableFirst(
    pets.filter(
      (pet) =>
        (species === 'all' || pet.species === species) &&
        (query === '' || pet.name.toLowerCase().includes(query)),
    ),
  )

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
      <label>
        Search
        <input
          type="search"
          className="pet-search"
          placeholder="Search by name"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
        />
      </label>
      <h2 className="pets-heading">Pets ({visiblePets.length})</h2>
      {visiblePets.length === 0 ? (
        <p>{query === '' ? 'No pets match this species.' : 'No pets match your search.'}</p>
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
      <footer className="pets-footer">{petsShownLabel(visiblePets.length)}</footer>
      <p className="total-value">{totalValueLabel(visiblePets)}</p>
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
      <section className="adopted-recently">
        <button className="show-adopted" onClick={() => void toggleAdopted()}>
          {showAdopted ? 'Hide recently adopted' : 'Show adopted this month'}
        </button>
        {showAdopted &&
          adoptedPets &&
          (adoptedPets.length === 0 ? (
            <p className="no-adopted">No pets have been adopted in the last month.</p>
          ) : (
            <ul className="pets adopted-list">
              {adoptedPets.map((pet) => (
                <li key={pet.id} className="pet adopted">
                  <span className="species-emoji" aria-hidden="true">
                    {speciesEmoji(pet.species)}
                  </span>
                  <span className="name">{pet.name}</span>
                  <span className="species">{pet.species}</span>
                  <span className="price">{formatPrice(pet.priceCents)}</span>
                  {pet.adoptedAt && (
                    <span className="adopted-at">adopted {formatAdoptedAt(pet.adoptedAt)}</span>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </section>
      <section className="add-pet">
        <h2>Add a pet</h2>
        <p className="hint">Register a new pet to list it for adoption.</p>
        <form onSubmit={(e) => void addPet(e)}>
          <label>
            Name
            <input
              type="text"
              value={addName}
              onChange={(e) => {
                setAddName(e.target.value)
                if (addErrors.name) setAddErrors((prev) => ({ ...prev, name: undefined }))
              }}
              aria-invalid={addErrors.name ? true : undefined}
              aria-describedby={addErrors.name ? 'add-name-error' : undefined}
              className={addErrors.name ? 'invalid' : undefined}
            />
            {addErrors.name && (
              <span id="add-name-error" className="error field-error" role="alert">
                {addErrors.name}
              </span>
            )}
          </label>
          <label>
            Species
            <input
              type="text"
              value={addSpecies}
              onChange={(e) => {
                setAddSpecies(e.target.value)
                if (addErrors.species) setAddErrors((prev) => ({ ...prev, species: undefined }))
              }}
              aria-invalid={addErrors.species ? true : undefined}
              aria-describedby={addErrors.species ? 'add-species-error' : undefined}
              className={addErrors.species ? 'invalid' : undefined}
            />
            {addErrors.species && (
              <span id="add-species-error" className="error field-error" role="alert">
                {addErrors.species}
              </span>
            )}
          </label>
          <label>
            Price
            <input
              type="number"
              min="0"
              step="0.01"
              value={addPrice}
              onChange={(e) => {
                setAddPrice(e.target.value)
                if (addErrors.price) setAddErrors((prev) => ({ ...prev, price: undefined }))
              }}
              aria-invalid={addErrors.price ? true : undefined}
              aria-describedby={addErrors.price ? 'add-price-error' : undefined}
              className={addErrors.price ? 'invalid' : undefined}
            />
            {addErrors.price && (
              <span id="add-price-error" className="error field-error" role="alert">
                {addErrors.price}
              </span>
            )}
          </label>
          <button type="submit" disabled={addPending}>
            {addPending ? 'Adding…' : 'Add pet'}
          </button>
        </form>
        {addErrors.form && (
          <p className="error add-pet-error" role="alert">
            {addErrors.form}
          </p>
        )}
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
      <SiteFooter />
    </main>
  )
}
