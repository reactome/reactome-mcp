import { MAX_TOOL_RESPONSE_CHARS } from "./config.js";

/**
 * Truncate a tool response that would otherwise eat the caller's context.
 *
 * The cut is announced in the text rather than made silently: a model that
 * cannot see it was truncated will report the partial answer as the whole one,
 * which is the same class of quiet wrongness as a formatter reading the wrong
 * field. The note names the tool so the model can narrow the request.
 */
export function capToolText(text: string, toolName: string, max = MAX_TOOL_RESPONSE_CHARS): string {
  if (text.length <= max) return text;

  const notice =
    `\n\n---\n` +
    `*Truncated: ${toolName} returned ${text.length.toLocaleString()} characters, ` +
    `over the ${max.toLocaleString()}-character limit. ` +
    `${(text.length - max).toLocaleString()} characters were dropped. ` +
    `Narrow the request — ask about a specific pathway or entity rather than a whole species or top-level pathway.*`;

  // Cut at a line boundary where one is close by, so the visible text does not
  // end mid-token and read as corrupt.
  const head = text.slice(0, Math.max(0, max - notice.length));
  const lastNewline = head.lastIndexOf("\n");
  const body =
    lastNewline > head.length - 500 && lastNewline > 0 ? head.slice(0, lastNewline) : head;

  return body + notice;
}

/** Apply the cap to an MCP tool result, leaving non-text content untouched. */
export function capToolResult(result: unknown, toolName: string): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(r.content)) return result;

  // Cap on the total across blocks: two 30 KB blocks cost the caller the same
  // as one 60 KB block.
  let budget = MAX_TOOL_RESPONSE_CHARS;
  const total = r.content.reduce((n, b) => n + (typeof b.text === "string" ? b.text.length : 0), 0);
  if (total <= budget) return result;

  const content = r.content.map(block => {
    if (typeof block.text !== "string") return block;
    if (budget <= 0) return { ...block, text: "" };
    const text = capToolText(block.text, toolName, budget);
    budget -= text.length;
    return { ...block, text };
  });

  return { ...r, content: content.filter(b => b.text !== "") };
}
