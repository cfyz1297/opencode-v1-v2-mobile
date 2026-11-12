// Answered questions stay in the transcript.
//
// V2's form is a one-shot request: once answered, the server drops it and the
// `question.asked` entry is removed from the pending list. The prompt card used
// to vanish with it (a 2.5 s echo was the only reminder), so the user could no
// longer check what they had answered a minute later. Keeping the request and
// the chosen answers in the store lets the card stay where the question was.
export interface AnsweredQuestionRequest {
  id: string
  questions: Array<{ header: string; question: string }>
  /** V2 form metadata: the message and tool call that opened the form, so the
   *  card can be rendered where the question was asked instead of above the
   *  composer. V1's question events carry no such reference. */
  tool?: { messageID: string; callID?: string }
}

export interface AnsweredQuestion<R extends AnsweredQuestionRequest = AnsweredQuestionRequest> {
  request: R
  answers: string[][]
}

/**
 * Append an answered question to its session's list. Answering the same
 * request twice (retry after a failed reply) replaces the older entry instead
 * of duplicating the card.
 */
export function recordAnswered<R extends AnsweredQuestionRequest>(
  list: readonly AnsweredQuestion<R>[],
  request: R,
  answers: string[][],
): AnsweredQuestion<R>[] {
  const next = list.filter((item) => item.request.id !== request.id)
  next.push({ request, answers: answers.map((entry) => [...entry]) })
  return next
}

/** One-line "Option A · Option B" summary of a multi-question answer. */
export function formatAnswer(answers: readonly string[][]): string {
  return answers
    .flat()
    .map((answer) => answer.trim())
    .filter(Boolean)
    .join(" · ")
}

/**
 * Group answered questions by the message that asked them. The chat renders
 * each group right after that message's bubble, which is where the question
 * appeared; entries without a tool reference (V1) stay unplaced and are drawn
 * above the composer as before.
 */
export function splitAnswered<R extends AnsweredQuestionRequest>(
  list: readonly AnsweredQuestion<R>[],
): { byMessage: Map<string, Array<AnsweredQuestion<R>>>; unplaced: Array<AnsweredQuestion<R>> } {
  const byMessage = new Map<string, Array<AnsweredQuestion<R>>>()
  const unplaced: Array<AnsweredQuestion<R>> = []
  for (const item of list) {
    const messageID = item.request.tool?.messageID
    if (!messageID) {
      unplaced.push(item)
      continue
    }
    const group = byMessage.get(messageID)
    if (group) group.push(item)
    else byMessage.set(messageID, [item])
  }
  return { byMessage, unplaced }
}
