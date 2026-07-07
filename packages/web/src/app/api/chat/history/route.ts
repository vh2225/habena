import { NextResponse } from "next/server";
import { chatHistory } from "@/lib/chat-ipc";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  let limit = parseInt(searchParams.get("limit") ?? "50", 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  limit = Math.min(limit, 500);

  try {
    const events = await chatHistory(limit);
    return NextResponse.json({ events });
  } catch {
    // Static reason: never pass the IPC layer's rejection text to the client.
    return NextResponse.json({ ok: false, reason: "offline", events: [] }, { status: 502 });
  }
}
