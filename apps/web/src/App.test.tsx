import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { App, formatVisitTime, type Pet, type Stats } from './App.js'

const PETS: Pet[] = [
  { id: 1, name: 'Biscuit', species: 'dog', priceCents: 89900, status: 'available' },
  { id: 2, name: 'Mochi', species: 'cat', priceCents: 64900, status: 'adopted' },
]

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

function statsFor(pets: Pet[]): Stats {
  const adopted = pets.filter((pet) => pet.status === 'adopted').length
  return { total: pets.length, adopted, available: pets.length - adopted }
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/stats')) return json(statsFor(PETS))
      return json(PETS)
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('renders the pet list', async () => {
    render(<App />)
    expect(await screen.findByText('Biscuit')).toBeDefined()
    expect(screen.getByText('Mochi')).toBeDefined()
  })

  it('shows an Adopt button only for available pets', async () => {
    render(<App />)
    await screen.findByText('Biscuit')
    expect(screen.getAllByRole('button', { name: 'Adopt' }).length).toBe(1)
    expect(screen.getByText('adopted')).toBeDefined()
  })

  it('filters the pet list by species and resets on "all"', async () => {
    render(<App />)
    await screen.findByText('Biscuit')

    const select = screen.getByRole('combobox', { name: 'Species' })
    fireEvent.change(select, { target: { value: 'dog' } })

    expect(screen.getByText('Biscuit')).toBeDefined()
    expect(screen.queryByText('Mochi')).toBeNull()

    fireEvent.change(select, { target: { value: 'all' } })

    expect(screen.getByText('Biscuit')).toBeDefined()
    expect(screen.getByText('Mochi')).toBeDefined()
  })

  it('shows an empty state when a reload leaves no pets of the selected species', async () => {
    let dogAdopted = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/adopt')) {
        dogAdopted = true
        return new Response(null, { status: 200 })
      }
      const remaining = dogAdopted ? PETS.filter((pet) => pet.species !== 'dog') : PETS
      if (url.endsWith('/api/stats')) return json(statsFor(remaining))
      return json(remaining)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await screen.findByText('Biscuit')

    const select = screen.getByRole('combobox', { name: 'Species' })
    fireEvent.change(select, { target: { value: 'dog' } })
    expect(screen.getByText('Biscuit')).toBeDefined()

    // Adopting the only dog triggers a reload; the selected filter persists but no longer matches anything.
    fireEvent.click(screen.getByRole('button', { name: 'Adopt' }))

    await screen.findByText('No pets match this species.')
    expect(screen.queryByText('Biscuit')).toBeNull()
  })

  it('shows the available count in the header from /api/stats', async () => {
    render(<App />)
    await screen.findByText('Biscuit')
    expect(screen.getByText('1 available')).toBeDefined()
  })

  it('updates the header available count after an adoption', async () => {
    const pets: Pet[] = [
      { id: 1, name: 'Biscuit', species: 'dog', priceCents: 89900, status: 'available' },
      { id: 2, name: 'Mochi', species: 'cat', priceCents: 64900, status: 'available' },
    ]
    let mochiAdopted = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/pets/2/adopt')) {
        mochiAdopted = true
        return new Response(null, { status: 200 })
      }
      const current = pets.map((pet) =>
        mochiAdopted && pet.id === 2 ? { ...pet, status: 'adopted' as const } : pet,
      )
      if (url.endsWith('/api/stats')) return json(statsFor(current))
      return json(current)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await screen.findByText('Biscuit')
    expect(screen.getByText('2 available')).toBeDefined()

    const mochiRow = screen.getByText('Mochi').closest('li') as HTMLElement
    fireEvent.click(within(mochiRow).getByRole('button', { name: 'Adopt' }))

    expect(await screen.findByText('1 available')).toBeDefined()
  })

  it('formats prices as dollars with two decimals', async () => {
    render(<App />)
    await screen.findByText('Biscuit')
    expect(screen.getByText('$899.00')).toBeDefined()
    expect(screen.getByText('$649.00')).toBeDefined()
  })

  it('shows a pet\'s upcoming visits with start time and visitor name (no cancellation code)', async () => {
    const startsAt = '2026-08-01T15:00:00.000Z'
    const visits = [
      {
        id: 10,
        petId: 1,
        visitorName: 'Ada Lovelace',
        visitorEmail: 'ada@example.com',
        startsAt,
        status: 'booked' as const,
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ]
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/pets/1/visits')) return json(visits)
      if (url.endsWith('/api/stats')) return json(statsFor(PETS))
      return json(PETS)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await screen.findByText('Biscuit')

    const biscuitRow = screen.getByText('Biscuit').closest('li') as HTMLElement
    fireEvent.click(within(biscuitRow).getByRole('button', { name: 'View visits' }))

    expect(await within(biscuitRow).findByText('Ada Lovelace')).toBeDefined()
    expect(within(biscuitRow).getByText(formatVisitTime(startsAt))).toBeDefined()
    // Cancellation codes must never surface in the visits list.
    expect(biscuitRow.textContent).not.toContain('cancellation')
  })

  it('shows an explicit empty state for a pet with no upcoming visits', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/pets/1/visits')) return json([])
      if (url.endsWith('/api/stats')) return json(statsFor(PETS))
      return json(PETS)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await screen.findByText('Biscuit')

    const biscuitRow = screen.getByText('Biscuit').closest('li') as HTMLElement
    fireEvent.click(within(biscuitRow).getByRole('button', { name: 'View visits' }))

    expect(await within(biscuitRow).findByText('No upcoming visits.')).toBeDefined()
  })

  it('refetches visits each time the list is reopened so new bookings appear', async () => {
    let bookedExtra = false
    const base = {
      id: 10,
      petId: 1,
      visitorName: 'Ada Lovelace',
      visitorEmail: 'ada@example.com',
      startsAt: '2026-08-01T15:00:00.000Z',
      status: 'booked' as const,
      createdAt: '2026-07-06T00:00:00.000Z',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/pets/1/visits')) {
        const list = bookedExtra
          ? [base, { ...base, id: 11, visitorName: 'Grace Hopper' }]
          : [base]
        bookedExtra = true
        return json(list)
      }
      if (url.endsWith('/api/stats')) return json(statsFor(PETS))
      return json(PETS)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await screen.findByText('Biscuit')
    const biscuitRow = screen.getByText('Biscuit').closest('li') as HTMLElement

    // First open: only Ada.
    fireEvent.click(within(biscuitRow).getByRole('button', { name: 'View visits' }))
    await within(biscuitRow).findByText('Ada Lovelace')
    expect(within(biscuitRow).queryByText('Grace Hopper')).toBeNull()

    // Close, then reopen: the newly booked visit is now fetched and shown.
    fireEvent.click(within(biscuitRow).getByRole('button', { name: 'Hide visits' }))
    fireEvent.click(within(biscuitRow).getByRole('button', { name: 'View visits' }))
    expect(await within(biscuitRow).findByText('Grace Hopper')).toBeDefined()
  })

  it('offers a booking control only on available pet cards', async () => {
    render(<App />)
    await screen.findByText('Biscuit')
    expect(screen.getAllByRole('button', { name: 'Book visit' }).length).toBe(1)

    const mochiRow = screen.getByText('Mochi').closest('li') as HTMLElement
    expect(within(mochiRow).queryByRole('button', { name: 'Book visit' })).toBeNull()
  })

  it('books a visit and shows the returned cancellation code', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/pets/1/visits')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        expect(body.visitorName).toBe('Ada Lovelace')
        expect(body.visitorEmail).toBe('ada@example.com')
        expect(typeof body.startsAt).toBe('string')
        expect((body.startsAt as string).length).toBeGreaterThan(0)
        return json({
          id: 7,
          petId: 1,
          visitorName: 'Ada Lovelace',
          visitorEmail: 'ada@example.com',
          startsAt: body.startsAt,
          status: 'booked',
          cancellationCode: 'sekret-code-123',
          createdAt: '2026-07-06T00:00:00.000Z',
        })
      }
      if (url.endsWith('/api/stats')) return json(statsFor(PETS))
      return json(PETS)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await screen.findByText('Biscuit')

    const biscuitRow = screen.getByText('Biscuit').closest('li') as HTMLElement
    fireEvent.click(within(biscuitRow).getByRole('button', { name: 'Book visit' }))

    fireEvent.change(within(biscuitRow).getByLabelText('Your name'), {
      target: { value: 'Ada Lovelace' },
    })
    fireEvent.change(within(biscuitRow).getByLabelText('Email'), {
      target: { value: 'ada@example.com' },
    })
    fireEvent.change(within(biscuitRow).getByLabelText('Slot'), {
      target: { value: '2026-08-01T15:30' },
    })
    fireEvent.click(within(biscuitRow).getByRole('button', { name: 'Book' }))

    expect(await within(biscuitRow).findByText('sekret-code-123')).toBeDefined()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pets/1/visits',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('keeps entered values and shows the error message when the slot is taken', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/pets/1/visits')) {
        return new Response(JSON.stringify({ error: 'slot already booked' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.endsWith('/api/stats')) return json(statsFor(PETS))
      return json(PETS)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await screen.findByText('Biscuit')

    const biscuitRow = screen.getByText('Biscuit').closest('li') as HTMLElement
    fireEvent.click(within(biscuitRow).getByRole('button', { name: 'Book visit' }))

    const nameInput = within(biscuitRow).getByLabelText('Your name') as HTMLInputElement
    const emailInput = within(biscuitRow).getByLabelText('Email') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Grace Hopper' } })
    fireEvent.change(emailInput, { target: { value: 'grace@example.com' } })
    fireEvent.change(within(biscuitRow).getByLabelText('Slot'), {
      target: { value: '2026-08-01T15:30' },
    })
    fireEvent.click(within(biscuitRow).getByRole('button', { name: 'Book' }))

    expect(await within(biscuitRow).findByText('slot already booked')).toBeDefined()
    // Values are preserved so the visitor can retry a different slot.
    expect(nameInput.value).toBe('Grace Hopper')
    expect(emailInput.value).toBe('grace@example.com')
    expect(within(biscuitRow).queryByText(/Save your cancellation code/)).toBeNull()
  })

  it('cancels a visit by code and refreshes the affected pet’s upcoming visits', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/stats')) return json(statsFor(PETS))
      if (url.endsWith('/api/visits/7/cancel')) {
        return json({
          id: 7,
          petId: 1,
          visitorName: 'Ada',
          startsAt: '2026-08-01T10:00:00.000Z',
          status: 'cancelled',
        })
      }
      if (url.endsWith('/api/pets/1/visits')) return json([])
      return json(PETS)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await screen.findByText('Biscuit')

    const button = screen.getByRole('button', { name: 'Cancel visit' })
    expect((button as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Visit id' }), {
      target: { value: '7' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Cancellation code' }), {
      target: { value: 'secret-code' },
    })
    expect((button as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(button)

    expect(await screen.findByText('Visit #7 cancelled.')).toBeDefined()
    expect(screen.getByText('No upcoming visits.')).toBeDefined()

    const cancelCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith('/api/visits/7/cancel'),
    )
    expect(cancelCall).toBeDefined()
    const init = cancelCall?.[1] as RequestInit | undefined
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ cancellationCode: 'secret-code' })
  })

  it('surfaces the API error when the cancellation code is rejected', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/stats')) return json(statsFor(PETS))
      if (url.endsWith('/api/visits/7/cancel')) {
        return new Response(JSON.stringify({ error: 'invalid cancellation code' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        })
      }
      return json(PETS)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await screen.findByText('Biscuit')

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Visit id' }), {
      target: { value: '7' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Cancellation code' }), {
      target: { value: 'wrong' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel visit' }))

    expect(await screen.findByText('invalid cancellation code')).toBeDefined()
    // The page still works — the pet list is intact and no success message appears.
    expect(screen.getByText('Biscuit')).toBeDefined()
    expect(screen.queryByText(/cancelled\./)).toBeNull()
  })
})
