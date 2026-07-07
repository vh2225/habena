import { chatSubscribe } from "@/lib/chat-ipc";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();
  let close: (() => void) | undefined;
  const stream = new ReadableStream({
    start(controller) {
      close = chatSubscribe(
        (ev) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
          } catch {
            /* stream already cancelled/closed — drop the late event */
          }
        },
        () => {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      );
    },
    cancel() {
      close?.();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
}
