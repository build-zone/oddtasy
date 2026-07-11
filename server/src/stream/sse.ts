export type ParsedSseEvent = {
  id?: string | undefined;
  event?: string | undefined;
  data: string;
};

export function parseSseBlock(block: string): ParsedSseEvent | null {
  const lines = block.split("\n");
  let id: string | undefined;
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("id:")) {
      id = line.slice(3).trim();
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;
  return { id, event, data: dataLines.join("\n") };
}

export async function consumeSseResponse(
  response: Response,
  onEvent: (event: ParsedSseEvent) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error("SSE response has no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const parsed = parseSseBlock(block);
      if (parsed) onEvent(parsed);
      separator = buffer.indexOf("\n\n");
    }
  }
}

export function writeSseEvent(res: import("express").Response, event: ParsedSseEvent): void {
  if (event.id) res.write(`id: ${event.id}\n`);
  if (event.event) res.write(`event: ${event.event}\n`);
  for (const line of event.data.split("\n")) {
    res.write(`data: ${line}\n`);
  }
  res.write("\n");
}
