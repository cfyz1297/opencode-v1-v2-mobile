// How a tool row decides what to say. Kept out of the component so the blank-row
// cases are testable: the V2 API streams a tool in four steps and any of them can
// leave the row with nothing to display.
export interface ToolLike {
  tool?: string
  state?: { input?: unknown; output?: unknown; title?: string }
}

// The 2.x server names the terminal tool `shell`; 1.x and the v1 SDK call it
// `bash`. Both describe a command, and only `bash` used to be recognised, so a
// `shell` row showed the bare tool name and fell through to a JSON dump.
export function isShellTool(name?: string): boolean {
  return name === "bash" || name === "shell"
}

export function toolCommand(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined
  const command = (input as Record<string, unknown>).command
  return typeof command === "string" && command.length > 0 ? command : undefined
}

/** Header text: the command for a terminal tool, else the server's progress
 *  title, else the tool name. The progress title is the only thing that says
 *  what a long-running tool is doing, so it must win over the name. */
export function toolTitle(tool: ToolLike, fallback: string): string {
  return (
    (isShellTool(tool.tool) ? toolCommand(tool.state?.input) : undefined) ||
    tool.state?.title ||
    // A delegation's own name is what the reader needs ("Ping task"), and the
    // server leaves it in the input rather than in a progress title.
    delegatedDescription(tool) ||
    tool.tool ||
    fallback
  )
}

/** Description of the delegated task, if this tool launches a subagent. */
export function delegatedDescription(tool: ToolLike): string | undefined {
  if (tool.tool !== "subagent" && tool.tool !== "task") return undefined
  const input = tool.state?.input
  if (typeof input !== "object" || input === null) return undefined
  const description = (input as Record<string, unknown>).description
  return typeof description === "string" && description.length > 0 ? description : undefined
}

/** Delegated agent name ("general", "explore"), when the tool reports one. */
export function delegatedAgent(tool: ToolLike): string | undefined {
  if (tool.tool !== "subagent" && tool.tool !== "task") return undefined
  const input = tool.state?.input
  if (typeof input !== "object" || input === null) return undefined
  const agent = (input as Record<string, unknown>).agent
  return typeof agent === "string" && agent.length > 0 ? agent : undefined
}

function nonEmptyJson(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === "string") return value.length > 0 ? value : undefined
  try {
    const text = JSON.stringify(value, null, 2)
    // an empty object/array is what a started-but-not-yet-filled tool sends
    return text && text !== "{}" && text !== "[]" ? text : undefined
  } catch {
    return undefined
  }
}

/** Detail text for tools without a bespoke renderer. Output first, but an empty
 *  output string must not hide the input: `session.tool.success` sends `""` for
 *  a tool that produced no text, and the expanded row used to render nothing. */
export function toolDetailText(input: unknown, output: unknown): string | undefined {
  if (typeof output === "string") return output.length > 0 ? output : nonEmptyJson(input)
  return nonEmptyJson(output) ?? nonEmptyJson(input)
}
