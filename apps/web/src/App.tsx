import { useCallback, useEffect, useState } from 'react'

export interface Pet {
  id: number
  name: string
  species: string
  priceCents: number
  status: 'available' | 'adopted'
}

export function App() {
  const [pets, setPets] = useState<Pet[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [species, setSpecies] = useState('all')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/pets')
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      setPets((await res.json()) as Pet[])
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

  if (error) return <p className="error">Could not load pets: {error}</p>
  if (!pets) return <p>Loading pets…</p>

  const allSpecies = [...new Set(pets.map((pet) => pet.species))].sort()
  const visiblePets = species === 'all' ? pets : pets.filter((pet) => pet.species === species)

  return (
    <main>
      <h1>🐾 Petshop</h1>
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
      <ul className="pets">
        {visiblePets.map((pet) => (
          <li key={pet.id} className={`pet ${pet.status}`}>
            <span className="name">{pet.name}</span>
            <span className="species">{pet.species}</span>
            <span className="price">${pet.priceCents}</span>
            {pet.status === 'adopted' ? (
              <span className="adopted-badge">adopted</span>
            ) : (
              <button onClick={() => void adopt(pet.id)}>Adopt</button>
            )}
          </li>
        ))}
      </ul>
    </main>
  )
}
