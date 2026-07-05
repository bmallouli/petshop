import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { App, type Pet, type Stats } from './App.js'

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
})
