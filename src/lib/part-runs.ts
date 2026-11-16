// Turns one message's parts into the chat transcript's render order.
//
// The API delivers parts in the order the model produced them (reasoning,
// text, `shell`, reasoning, `shell`…), but the bubble used to render them
// regrouped: all reasoning first, then all text, then every tool call as its
// own card. A tool-using turn therefore read as "wall of thinking" + "wall of
// cards" instead of the compact timeline the model actually followed.
//
// `groupParts` keeps the order and folds each segment between text parts into
// a single `activity` block: one spoiler row carrying the reasoning and the
// tools of that segment. A step that thinks and runs three commands is one
// collapsed line until the user opens it, which is what keeps a long run from
// pushing the answer off the screen.
import type { Part } from "./sdk"

export type PartItem =
  | { kind: "text"; key: string; part: Part }
  | { kind: "activity"; key: string; reasoning?: Part; tools: Part[] }
  // A delegation draws its own row with a tap into the child session, so it
  // must stay on screen at rest — folding it into the spoiler would undo the
  // subagent timeline this app shows in the feed.
  | { kind: "delegation"; key: string; tool: Part }

// Text, reasoning and tool calls are the only parts the transcript renders;
// step markers, snapshots, patches, subtasks, retries and agents are
// bookkeeping, and file parts are handled separately as image attachments.
//
// Text is a hard boundary: activity before and after an answer stays separate,
// because the answer explains why the next batch started. Reasoning is not —
// the model interleaves "think, run, think, run" between two answers, and
// splitting there is what filled the screen with alternating rows.
export function groupParts(parts: Part[]): PartItem[] {
  const items: PartItem[] = []
  let reasoning: Part | null = null
  let reasoningTexts: string[] = []
  let tools: Part[] = []

  // One segment = the reasoning and tool calls between two text parts.
  const flush = () => {
    if (!reasoning && !tools.length) return
    const mergedReasoning = reasoning
      ? {
          ...reasoning,
          text: reasoningTexts.join("\n\n"),
          // A merged block spans several steps, so the first step's duration
          // would be a lie — drop it and let the row read plain "Thought".
          time: reasoningTexts.length > 1 ? undefined : reasoning.time,
        }
      : undefined
    items.push({
      kind: "activity",
      key: tools[0]?.id ?? reasoning!.id,
      reasoning: mergedReasoning,
      tools,
    })
    reasoning = null
    reasoningTexts = []
    tools = []
  }

  for (const part of parts) {
    if (part.type === "tool") {
      if (isDelegation(part)) {
        // Closes the segment: the row that follows belongs to the delegation,
        // not to the run that launched it.
        flush()
        items.push({ kind: "delegation", key: part.id, tool: part })
        continue
      }
      tools.push(part)
      continue
    }

    if (part.type === "reasoning") {
      // Empty reasoning parts appear while a step is starting — they would
      // render as blank gaps.
      if (!part.text) continue
      if (!reasoning) reasoning = part
      reasoningTexts.push(part.text)
      continue
    }

    if (part.type !== "text") continue
    if (!part.text) continue
    flush()
    items.push({ kind: "text", key: part.id, part })
  }
  flush()
  return items
}

// A subagent launch is not a tool the user hides behind a spoiler: it is the
// only place the child session is reachable from the transcript.
export function isDelegation(tool: Part): boolean {
  return tool.tool === "subagent" || tool.tool === "task"
}

// True when every call in the run is a shell command, which is what makes the
// row read "Ran N commands" instead of "Ran N tools". V2 renamed `bash` to
// `shell`, so both names count.
export function isCommandRun(tools: Part[]): boolean {
  return tools.length > 0 && tools.every((tool) => tool.tool === "bash" || tool.tool === "shell")
}
