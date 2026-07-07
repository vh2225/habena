import { NextResponse } from "next/server";
import { chatSend } from "@/lib/chat-ipc";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { text?: unknown };
  try {
    body = (await request.json()) as { text?: unknown };
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid JSON body" }, { status: 400 });
  }
  const text = body.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ ok: false, reason: "text (non-empty string) required" }, { status: 400 });
  }
  try {
    const result = await chatSend(text);
    return NextResponse.json(result);
  } catch {
    // The IPC call rejects when the proxy/bridge is down — report "offline" rather
    // than leaking the raw socket error (mirrors the fail-closed discipline in chat-ipc).
    return NextResponse.json({ ok: false, reason: "offline" }, { status: 502 });
  }
}
