// Tokens and money for a whole run, not for its last step.
//
// Every step is its own assistant message and carries only its own usage, so
// the footer used to report the cost of the final roundtrip — a ten-step run
// looked like it cost a fraction of what it did. The newest step of a run
// (array is newest-first) gets the sum over every assistant
// message back to the previous user turn; all other indices get nothing.
export interface RunTotals {
  tokens: number
  cost: number
}

export interface RunTokens {
  input: number
  output: number
  reasoning?: number
  cache?: { read: number; write: number }
}

export interface Usage {
  role?: string
  tokens?: RunTokens
  cost?: number
  providerID?: string
  modelID?: string
}

/** Per-million prices from the model catalog (see catalog ProviderModel.cost). */
export interface Price {
  input: number
  output: number
  cache?: { read?: number; write?: number }
}

/**
 * Catalog prices for a message's model. V2.2.5 reports `cost: 0` for every
 * step even on paid models (the provider's reported amount wins server-side,
 * and opencode-go reports zero), so the footer has nothing to show unless the
 * catalog price is applied client-side.
 */
export type PriceLookup = (message: Usage) => Price | undefined

const ZERO_PRICE: Price = { input: 0, output: 0 }

export function estimateCost(price: Price, usage: RunTokens): number {
  const cache = price.cache
  return (
    (usage.input * price.input +
      (usage.output + (usage.reasoning ?? 0)) * price.output +
      (usage.cache?.read ?? 0) * (cache?.read ?? price.input) +
      (usage.cache?.write ?? 0) * (cache?.write ?? price.input)) /
    1_000_000
  )
}

export function runTotals(messages: Usage[], priceOf?: PriceLookup): Array<RunTotals | undefined> {
  return messages.map((message, i) => {
    if (message.role !== "assistant") return undefined
    // Not the newest step of the run — the footer belongs to the last one.
    if (messages[i - 1]?.role === "assistant") return undefined

    let tokens = 0
    let cost = 0
    let seen = false
    for (let j = i; j < messages.length && messages[j].role === "assistant"; j++) {
      const usage = messages[j].tokens
      const reported = messages[j].cost ?? 0
      if (usage) {
        tokens += usage.input + usage.output
        seen = true
      }
      if (reported > 0) {
        cost += reported
        seen = true
      } else if (usage) {
        // A reported zero is not a price: fall back to the catalog.
        cost += estimateCost(priceOf?.(messages[j]) ?? ZERO_PRICE, usage)
      }
    }
    return seen ? { tokens, cost } : undefined
  })
}
