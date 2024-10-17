"use client";

import { getApiToken, apiUrl } from "@/lib/api";

export interface SseHandle {
  close: () => void;
}

// EventSource cannot send Authorization headers, so we stream SSE over fetch.
export function streamRunEvents(
  runId: string,
  onEvent: (event: MessageEvent<string>) => void,
  onDone: () => void,
  onError: (err: unknown) => void
): SseHandle {
  const controller = new AbortController();

  (async () => {
    try {
      const token = await getApiToken();
      const res = await fetch(apiUrl(`/v1/runs/${runId}/events`), {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`Event stream failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLines = part
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart());
          if (dataLines.length > 0) {
            onEvent(
              new MessageEvent("message", { data: dataLines.join("\n") })
            );
          }
        }
      }
      onDone();
    } catch (err) {
      if (!controller.signal.aborted) {
        onError(err);
      }
    }
  })();

  return { close: () => controller.abort() };
}
