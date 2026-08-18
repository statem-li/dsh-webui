/**
 * Lightweight access to the shared activity drawer bus (`__dshActivityDrawerStore__`).
 *
 * The bus itself is created and fully owned by dsh-tool-summary; this plugin
 * only reads it defensively. Rendering happens long after both plugins apply,
 * so by the time an entry chip is mounted the bus exists; if it does not
 * (tool-summary disabled), the chip simply opens nothing.
 */

export interface ActivityReasoningItem {
  readonly text: string
  readonly running: boolean
}

interface BusStore {
  setReasoning(turn: number, items: readonly ActivityReasoningItem[]): void
  open(turn: number, mode: 'reasoning' | 'tools'): void
}

const STORE_KEY = '__dshActivityDrawerStore__'

/** Read the shared bus, or undefined when dsh-tool-summary has not mounted it. */
export function activityBus(): BusStore | undefined {
  return (globalThis as Record<string, unknown>)[STORE_KEY] as BusStore | undefined
}