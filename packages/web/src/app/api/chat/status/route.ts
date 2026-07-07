import { NextResponse } from "next/server";
import { chatStatus, chatRearm } from "@/lib/chat-ipc";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VALID_CHANNELS = new Set(["web", "telegram"]);

export async function GET() {
  try {
    const status = await chatStatus();
    return NextResponse.json(status);
  } catch {
    // Static reason: never pass the IPC layer's rejection text to the client.
    return NextResponse.json({ ok: false, reason: "offline" }, { status: 502 });
  }
}

/** Rearm a disarmed channel. Body: { rearm: "web" | "telegram" } */
export async function POST(request: Request) {
  let body: { rearm?: unknown };
  try {
    body = (await request.json()) as { rearm?: unknown };
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid JSON body" }, { status: 400 });
  }
  const rearm = body.rearm;
  if (typeof rearm !== "string" || !VALID_CHANNELS.has(rearm)) {
    return NextResponse.json(
      { ok: false, reason: 'rearm must be "web" or "telegram"' },
      { status: 400 }
    );
  }
  try {
    const result = await chatRearm(rearm as "web" | "telegram");
    return NextResponse.json(result);
  } catch {
    // Static reason: never pass the IPC layer's rejection text to the client.
    return NextResponse.json({ ok: false, reason: "offline" }, { status: 502 });
  }
}
