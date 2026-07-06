import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Portal } from './Portal.js'

const VALID_CODE = 'OWNER-ADA-0001'
const OWNER = { id: 1, name: 'Ada Lovelace' }

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

const unauthorized = () =>
  new Response(JSON.stringify({ error: 'invalid access code' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })

/** A fetch mock for /api/portal/me that authenticates only VALID_CODE. */
function portalFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/portal/me')) {
      const headers = new Headers(init?.headers)
      return headers.get('x-owner-code') === VALID_CODE ? json({ owner: OWNER }) : unauthorized()
    }
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

    expect(await screen.findByText('Signed in as Ada Lovelace')).toBeDefined()
    expect(localStorage.getItem('petshop.ownerCode')).toBe(VALID_CODE)
    expect(screen.queryByLabelText('Access code')).toBeNull()
  })

  it('re-validates a stored code on mount and stays signed in', async () => {
    localStorage.setItem('petshop.ownerCode', VALID_CODE)
    vi.stubGlobal('fetch', portalFetch())
    render(<Portal />)

    expect(await screen.findByText('Signed in as Ada Lovelace')).toBeDefined()
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
})
