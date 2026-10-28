/**
 * Reading a JSON object out of a model's reply. Small models wrap the answer in prose, code fences or a
 * thinking block, put an example before it, or add a closing remark with braces. Slicing from the first
 * "{" to the last "}" breaks on all of those; this reads each balanced object on its own.
 */

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Every top-level {...} in a reply, skipping braces inside strings and any <think> block. */
export function jsonObjects(raw: string): string[] {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, " ");
  const found: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        found.push(text.slice(i, j + 1));
        i = j;
        break;
      }
    }
  }
  return found;
}

/**
 * The answer in a reply: the last object that has one of `answerKeys`, otherwise the last object that
 * parses. Throws "no JSON object in model reply" when there is none, or the JSON error when none parse.
 */
export function readJsonObject(raw: string, answerKeys: readonly string[]): unknown {
  const objects = jsonObjects(raw);
  if (!objects.length) throw new Error("no JSON object in model reply");
  const parsed: unknown[] = [];
  let failure: unknown;
  for (const o of objects) {
    try {
      parsed.push(JSON.parse(o));
    } catch (e) {
      failure = e;
    }
  }
  if (!parsed.length) throw failure;
  // Examples and thinking come first; the answer comes last.
  return [...parsed].reverse().find((o) => isObject(o) && answerKeys.some((k) => k in o)) ?? parsed.at(-1);
}
