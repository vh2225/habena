import { NextResponse } from "next/server";
import { chatHistory } from "@/lib/chat-ipc";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 500);

  try {
    const events = await chatHistory(limit);
    return NextResponse.json({ events });
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: err instanceof Error ? err.message : "offline", events: [] },
      { status: 502 }
    );
  }
}
