import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Portal } from './Portal.js'

const VALID_CODE = 'OWNER-ADA-0001'
const OWNER = { id: 1, name: 'Ada Lovelace' }

const visit = (id: number, petId: number, startsAt: string) => ({
  id,
  petId,
  visitorName: 'Ada Lovelace',
  visitorEmail: 'ada@example.com',
  startsAt,
  status: 'booked' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
})

const DEFAULT_PETS = [
  { id: 1, name: 'Biscuit', species: 'dog', priceCents: 89900, status: 'available' as const },
  { id: 3, name: 'Nibbles', species: 'hamster', priceCents: 2400, status: 'adopted' as const },
]

const DEFAULT_VISITS: Record<number, ReturnType<typeof visit>[]> = {
  1: [visit(10, 1, '2030-01-15T10:00:00.000Z')],
  3: [],
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

const unauthorized = () =>
  new Response(JSON.stringify({ error: 'invalid access code' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })

/**
 * A fetch mock for the owner portal. Authenticates only VALID_CODE and serves
 * owner-scoped pets and per-pet visits. Callers can override the pets/visits
 * fixtures to exercise the empty states.
 */
function portalFetch(
  opts: { pets?: typeof DEFAULT_PETS; visits?: Record<number, ReturnType<typeof visit>[]> } = {},
) {
  const pets = opts.pets ?? DEFAULT_PETS
  const visits = opts.visits ?? DEFAULT_VISITS
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const authed = new Headers(init?.headers).get('x-owner-code') === VALID_CODE
    if (url.endsWith('/api/portal/me')) {
      return authed ? json({ owner: OWNER }) : unauthorized()
    }
    if (!authed) return unauthorized()
    if (url.endsWith('/api/portal/pets')) return json(pets)
    const match = url.match(/\/api\/portal\/pets\/(\d+)\/visits$/)
    if (match) return json(visits[Number(match[1])] ?? [])
    throw new Error(`unexpected fetch: ${url}`)
  })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('Portal', () => {
  it('shows the access-code login form with no stored code', async () => {
    vi.stubGlobal('fetch', portalFetch())
    render(<Portal />)
    expect(await screen.findByLabelText('Access code')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDefined()
  })

  it('shows an error and persists nothing when the code is invalid', async () => {
    vi.stubGlobal('fetch', portalFetch())
    render(<Portal />)

    fireEvent.change(await screen.findByLabelText('Access code'), {
      target: { value: 'WRONG-CODE' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Invalid access code')
    expect(localStorage.getItem('petshop.ownerCode')).toBeNull()
    // Still on the login form.
    expect(screen.getByLabelText('Access code')).toBeDefined()
  })

  it('signs in and greets the owner by name on a valid code', async () => {
    vi.stubGlobal('fetch', portalFetch())
    render(<Portal />)

    fireEvent.change(await screen.findByLabelText('Access code'), {
      target: { value: VALID_CODE },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Welcome back, Ada Lovelace')).toBeDefined()
    expect(localStorage.getItem('petshop.ownerCode')).toBe(VALID_CODE)
    expect(screen.queryByLabelText('Access code')).toBeNull()
  })

  it('re-validates a stored code on mount and stays signed in', async () => {
    localStorage.setItem('petshop.ownerCode', VALID_CODE)
    vi.stubGlobal('fetch', portalFetch())
    render(<Portal />)

    expect(await screen.findByText('Welcome back, Ada Lovelace')).toBeDefined()
    expect(screen.queryByLabelText('Access code')).toBeNull()
  })

  it('clears a stored code that is no longer valid and shows the login form', async () => {
    localStorage.setItem('petshop.ownerCode', 'STALE-CODE')
    vi.stubGlobal('fetch', portalFetch())
    render(<Portal />)

    expect(await screen.findByLabelText('Access code')).toBeDefined()
    await waitFor(() => expect(localStorage.getItem('petshop.ownerCode')).toBeNull())
  })

  it('signs out, clearing the stored code and returning to the login form', async () => {
    localStorage.setItem('petshop.ownerCode', VALID_CODE)
    vi.stubGlobal('fetch', portalFetch())
    render(<Portal />)

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByLabelText('Access code')).toBeDefined()
    expect(localStorage.getItem('petshop.ownerCode')).toBeNull()
  })

  it("lists the owner's pets with name, species and price once signed in", async () => {
    localStorage.setItem('petshop.ownerCode', VALID_CODE)
    vi.stubGlobal('fetch', portalFetch())
    render(<Portal />)

    expect(await screen.findByText('Biscuit')).toBeDefined()
    expect(screen.getByText('dog')).toBeDefined()
    expect(screen.getByText('$899.00')).toBeDefined()
    expect(screen.getByText('Nibbles')).toBeDefined()
    expect(screen.getByText('$24.00')).toBeDefined()
  })

  it('shows a pet upcoming visit time and an empty state for a pet with none', async () => {
    localStorage.setItem('petshop.ownerCode', VALID_CODE)
    vi.stubGlobal('fetch', portalFetch())
    render(<Portal />)

    // Biscuit (id 1) has a booked visit; its start time renders via formatVisitTime.
    const expected = new Date('2030-01-15T10:00:00.000Z').toLocaleString()
    expect(await screen.findByText(expected)).toBeDefined()
    // Nibbles (id 3) has no visits and shows the empty-state message.
    expect(await screen.findByText('No upcoming visits')).toBeDefined()
  })

  it('renders no adopt, hold, book or cancel controls anywhere', async () => {
    localStorage.setItem('petshop.ownerCode', VALID_CODE)
    vi.stubGlobal('fetch', portalFetch())
    render(<Portal />)

    await screen.findByText('Biscuit')
    expect(screen.queryByRole('button', { name: /adopt/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /hold/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /book/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull()
  })

  it('shows an empty state when the owner has no pets', async () => {
    localStorage.setItem('petshop.ownerCode', VALID_CODE)
    vi.stubGlobal('fetch', portalFetch({ pets: [], visits: {} }))
    render(<Portal />)

    expect(await screen.findByText("You don't have any pets yet.")).toBeDefined()
  })

  it("greets the owner and shows their pet count once signed in", async () => {
    localStorage.setItem('petshop.ownerCode', VALID_CODE)
    vi.stubGlobal('fetch', portalFetch())
    render(<Portal />)

    expect(await screen.findByText('Welcome back, Ada Lovelace')).toBeDefined()
    // Two pets in the default fixture, pluralized.
    expect(await screen.findByText('2 pets')).toBeDefined()
  })

  it('shows a singular pet count for an owner with one pet', async () => {
    localStorage.setItem('petshop.ownerCode', VALID_CODE)
    vi.stubGlobal(
      'fetch',
      portalFetch({
        pets: [DEFAULT_PETS[0]],
        visits: { 1: [] },
      }),
    )
    render(<Portal />)

    expect(await screen.findByText('1 pet')).toBeDefined()
  })

  it('shows a zero pet count for an owner with no pets', async () => {
    localStorage.setItem('petshop.ownerCode', VALID_CODE)
    vi.stubGlobal('fetch', portalFetch({ pets: [], visits: {} }))
    render(<Portal />)

    expect(await screen.findByText('0 pets')).toBeDefined()
  })

  it('shows a footer with the demo notice on the login page', async () => {
    vi.stubGlobal('fetch', portalFetch())
    render(<Portal />)

    await screen.findByLabelText('Access code')
    const footer = screen.getByText('petshop — Fleet demo')
    expect(footer).toBeDefined()
    expect(footer.tagName).toBe('FOOTER')
  })

  it('shows a footer with the demo notice on the signed-in page', async () => {
    localStorage.setItem('petshop.ownerCode', VALID_CODE)
    vi.stubGlobal('fetch', portalFetch())
    render(<Portal />)

    await screen.findByText('Biscuit')
    const footer = screen.getByText('petshop — Fleet demo')
    expect(footer).toBeDefined()
    expect(footer.tagName).toBe('FOOTER')
  })
})
