import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendNotification } from './notifier.js'

// The notifier's only observable side effect is a formatted console.log line, so
// every assertion drives sendNotification and inspects what it logged.
afterEach(() => {
  vi.restoreAllMocks()
})

function spyConsole(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, 'log').mockImplementation(() => {})
}

describe('sendNotification', () => {
  it('logs a single line in the "[notify] <event> <json>" shape for a pet-adopted event', () => {
    const spy = spyConsole()

    sendNotification('pet-adopted', { petId: 3 })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('[notify] pet-adopted {"petId":3}')
  })

  it('returns undefined (its contract is the side effect, not a value)', () => {
    spyConsole()
    expect(sendNotification('pet-adopted', { petId: 1 })).toBeUndefined()
  })

  it('serializes the payload with JSON.stringify, preserving nested structure', () => {
    const spy = spyConsole()
    const payload = { petId: 7, owner: { id: 2, name: 'Ada' }, tags: ['dog', 'good'] }

    sendNotification('pet-adopted', payload)

    expect(spy).toHaveBeenCalledWith(`[notify] pet-adopted ${JSON.stringify(payload)}`)
  })

  it('renders an empty payload as an empty JSON object', () => {
    const spy = spyConsole()

    sendNotification('pet-adopted', {})

    expect(spy).toHaveBeenCalledWith('[notify] pet-adopted {}')
  })

  it('drops undefined-valued keys, matching JSON.stringify semantics', () => {
    const spy = spyConsole()

    sendNotification('pet-adopted', { petId: 5, note: undefined })

    // JSON.stringify omits keys whose value is undefined.
    expect(spy).toHaveBeenCalledWith('[notify] pet-adopted {"petId":5}')
  })

  it('does not throw and emits exactly one line per call', () => {
    const spy = spyConsole()

    expect(() => sendNotification('pet-adopted', { petId: 1 })).not.toThrow()
    sendNotification('pet-adopted', { petId: 2 })

    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[0]).toEqual(['[notify] pet-adopted {"petId":1}'])
    expect(spy.mock.calls[1]).toEqual(['[notify] pet-adopted {"petId":2}'])
  })
})
