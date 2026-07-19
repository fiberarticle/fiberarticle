"use client";

import { getApiToken, apiUrl } from "@/lib/api";
import type { ChatMessage, ChatStep } from "@/lib/types";

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

/** One assistant exchange over SSE: agent steps arrive live, the final
 * message list arrives in the done event. Closing the handle aborts the
 * request, which stops the agent server-side (the stop button). */
export function streamChatMessage(
  conversationId: string,
  body: { content: string; search_library_first: boolean },
  handlers: {
    onStep: (step: ChatStep) => void;
    onDone: (messages: ChatMessage[]) => void;
    onError: (message: string) => void;
    /** Called when the stream was closed by the user, not by a failure. */
    onAbort: () => void;
  }
): SseHandle {
  const controller = new AbortController();

  (async () => {
    try {
      const token = await getApiToken();
      const res = await fetch(
        apiUrl(`/v1/chats/${conversationId}/messages/stream`),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );
      if (!res.ok || !res.body) {
        let message = `The message failed to send (${res.status}).`;
        try {
          const data = await res.json();
          if (typeof data.detail === "string") message = data.detail;
        } catch {
          // keep default message
        }
        throw new Error(message);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const lines = part.split("\n");
          const event =
            lines
              .find((line) => line.startsWith("event:"))
              ?.slice(6)
              .trim() ?? "message";
          const data = lines
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          try {
            const payload = JSON.parse(data);
            if (event === "step") {
              handlers.onStep(payload as ChatStep);
            } else if (event === "done") {
              finished = true;
              handlers.onDone(payload.messages as ChatMessage[]);
            } else if (event === "error") {
              finished = true;
              handlers.onError(
                typeof payload.detail === "string"
                  ? payload.detail
                  : "The assistant failed."
              );
            }
          } catch {
            // ignore malformed frames
          }
        }
      }
      if (!finished && !controller.signal.aborted) {
        handlers.onError("The connection dropped before the answer arrived.");
      }
    } catch (err) {
      if (controller.signal.aborted) {
        handlers.onAbort();
      } else {
        handlers.onError(
          err instanceof Error ? err.message : "The message failed to send."
        );
      }
    }
  })();

  return { close: () => controller.abort() };
}
