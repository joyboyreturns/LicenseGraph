import { z } from "zod";
import { AccessError } from "../../auth/identity";
import type { Operation } from "../../storage/jobs";

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const uuid = z.uuid();
export const publicOperation = (job: Operation) => ({
  id: job.id,
  runId: job.runId,
  kind: job.kind,
  status: job.status,
  stage: job.stage,
  ...(job.errorCode ? { code: job.errorCode } : {}),
});

export async function readJson(request: Request): Promise<unknown> {
  const maximum = 500_000;
  if (Number(request.headers.get("content-length")) > maximum) throw new AccessError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) return {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await Promise.race([
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          void reader.cancel();
          reject(new AccessError("Request body timed out.", 408));
        }, 10_000);
      }),
      (async () => {
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.length;
          if (length > maximum) {
            await reader.cancel();
            throw new AccessError("Request is too large.", 413);
          }
          chunks.push(chunk.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      })(),
    ]);
    return body;
  } catch (error) {
    if (error instanceof SyntaxError) throw new AccessError("Send valid JSON.", 400);
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

/** Decodes each row, leaving out any that cannot be read and reporting how many, so one bad record cannot hide the rest. */
export function readable<Row, Out>(list: string, rows: Row[], decode: (row: Row) => Out): Out[] {
  const out: Out[] = [];
  let unreadable = 0;
  for (const row of rows) {
    try {
      out.push(decode(row));
    } catch {
      unreadable += 1;
    }
  }
  if (unreadable) console.error(JSON.stringify({ event: "unreadable_records", list, count: unreadable }));
  return out;
}
