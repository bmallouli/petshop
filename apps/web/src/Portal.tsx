import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { formatPrice, formatVisitTime, type Pet, type Visit } from './App.js'

/** localStorage key under which the validated access code is persisted across reloads. */
const CODE_STORAGE_KEY = 'petshop.ownerCode'

export interface Owner {
  id: number
  name: string
}

type PortalState =
  | { status: 'loading' }
  | { status: 'login' }
  | { status: 'signedIn'; owner: Owner; code: string }

/**
 * Validate an access code against GET /api/portal/me.
 * Resolves to the owner on success, or null on a 401 (invalid code).
 * Throws on network/other errors so callers can surface them.
 */
async function validateCode(code: string): Promise<Owner | null> {
  const res = await fetch('/api/portal/me', { headers: { 'x-owner-code': code } })
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`API returned ${res.status}`)
  const data = (await res.json()) as { owner: Owner }
  return data.owner
}

type VisitsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; visits: Visit[] }

/**
 * A single owned pet, read-only: name, species, price and status, plus its
 * upcoming (booked) visits fetched from the owner-scoped endpoint. No adopt,
 * hold, book or cancel controls are rendered here — the portal is view-only.
 */
function PortalPet({ pet, code }: { pet: Pet; code: string }) {
  const [visits, setVisits] = useState<VisitsState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/portal/pets/${pet.id}/visits`, {
          headers: { 'x-owner-code': code },
        })
        if (!res.ok) throw new Error(`API returned ${res.status}`)
        const data = (await res.json()) as Visit[]
        if (!cancelled) setVisits({ status: 'loaded', visits: data })
      } catch (err) {
        if (!cancelled) {
          setVisits({ status: 'error', message: err instanceof Error ? err.message : String(err) })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pet.id, code])

  return (
    <li className={`portal-pet ${pet.status}`}>
      <span className="name">{pet.name}</span>
      <span className="species">{pet.species}</span>
      <span className="price">{formatPrice(pet.priceCents)}</span>
      <span className="status">{pet.status}</span>
      <div className="visits">
        {visits.status === 'loading' && <p>Loading visits…</p>}
        {visits.status === 'error' && (
          <p className="error">Could not load visits: {visits.message}</p>
        )}
        {visits.status === 'loaded' &&
          (visits.visits.length === 0 ? (
            <p className="no-visits">No upcoming visits</p>
          ) : (
            <ul className="visit-list">
              {visits.visits.map((visit) => (
                <li key={visit.id} className="visit">
                  <span className="visit-time">{formatVisitTime(visit.startsAt)}</span>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </li>
  )
}

/** The signed-in portal view: lists the owner's pets and their upcoming visits, read-only. */
function SignedIn({
  owner,
  code,
  onSignOut,
}: {
  owner: Owner
  code: string
  onSignOut: () => void
}) {
  const [pets, setPets] = useState<Pet[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/portal/pets', { headers: { 'x-owner-code': code } })
        if (!res.ok) throw new Error(`API returned ${res.status}`)
        const data = (await res.json()) as Pet[]
        if (!cancelled) setPets(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code])

  return (
    <main className="portal">
      <header className="header">
        <h1>🐾 Owner portal</h1>
      </header>
      <p className="portal-greeting">Signed in as {owner.name}</p>
      <button className="portal-signout" onClick={onSignOut}>
        Sign out
      </button>
      {error && (
        <p className="error portal-error" role="alert">
          Could not load your pets: {error}
        </p>
      )}
      {!error && pets === null && <p>Loading your pets…</p>}
      {!error &&
        pets !== null &&
        (pets.length === 0 ? (
          <p className="portal-empty">You don't have any pets yet.</p>
        ) : (
          <ul className="portal-pets">
            {pets.map((pet) => (
              <PortalPet key={pet.id} pet={pet} code={code} />
            ))}
          </ul>
        ))}
    </main>
  )
}

export function Portal() {
  const [state, setState] = useState<PortalState>({ status: 'loading' })
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // On mount, re-validate any stored code so a reload keeps the owner signed in.
  useEffect(() => {
    const stored = localStorage.getItem(CODE_STORAGE_KEY)
    if (!stored) {
      setState({ status: 'login' })
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const owner = await validateCode(stored)
        if (cancelled) return
        if (owner) {
          setState({ status: 'signedIn', owner, code: stored })
        } else {
          localStorage.removeItem(CODE_STORAGE_KEY)
          setState({ status: 'login' })
        }
      } catch {
        // A transient error must not silently discard a possibly-valid code;
        // fall back to the login view but leave the stored code in place.
        if (!cancelled) setState({ status: 'login' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = code.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const owner = await validateCode(trimmed)
      if (owner) {
        localStorage.setItem(CODE_STORAGE_KEY, trimmed)
        setState({ status: 'signedIn', owner, code: trimmed })
        setCode('')
      } else {
        setError('Invalid access code.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const signOut = useCallback(() => {
    localStorage.removeItem(CODE_STORAGE_KEY)
    setCode('')
    setError(null)
    setState({ status: 'login' })
  }, [])

  if (state.status === 'loading') {
    return (
      <main className="portal">
        <p>Loading…</p>
      </main>
    )
  }

  if (state.status === 'signedIn') {
    return <SignedIn owner={state.owner} code={state.code} onSignOut={signOut} />
  }

  return (
    <main className="portal">
      <header className="header">
        <h1>🐾 Owner portal</h1>
      </header>
      <form className="portal-login" onSubmit={(e) => void submit(e)}>
        <label>
          Access code
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
          />
        </label>
        {error && (
          <p className="error portal-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting || !code.trim()}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
