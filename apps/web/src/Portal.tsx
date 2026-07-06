import { useCallback, useEffect, useState, type FormEvent } from 'react'

/** localStorage key under which the validated access code is persisted across reloads. */
const CODE_STORAGE_KEY = 'petshop.ownerCode'

export interface Owner {
  id: number
  name: string
}

type PortalState =
  | { status: 'loading' }
  | { status: 'login' }
  | { status: 'signedIn'; owner: Owner }

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
          setState({ status: 'signedIn', owner })
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
        setState({ status: 'signedIn', owner })
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
    return (
      <main className="portal">
        <header className="header">
          <h1>🐾 Owner portal</h1>
        </header>
        <p className="portal-greeting">Signed in as {state.owner.name}</p>
        <button className="portal-signout" onClick={signOut}>
          Sign out
        </button>
      </main>
    )
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
