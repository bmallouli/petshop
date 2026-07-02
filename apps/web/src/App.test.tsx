import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { App, type Pet } from './App.js'

const PETS: Pet[] = [
  { id: 1, name: 'Biscuit', species: 'dog', priceCents: 89900, status: 'available' },
  { id: 2, name: 'Mochi', species: 'cat', priceCents: 64900, status: 'adopted' },
]

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(PETS), { headers: { 'content-type': 'application/json' } })),
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
})
