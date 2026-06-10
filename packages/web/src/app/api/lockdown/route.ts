import { NextResponse } from "next/server";
import { setLockdown, proxyRunning } from "@/lib/approval-ipc";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Toggle the proxy-wide lockdown. Body: { on: boolean } */
export async function POST(request: Request) {
  if (!proxyRunning()) {
    return NextResponse.json({ ok: false, reason: "proxy not running" }, { status: 502 });
  }
  let body: { on?: unknown };
  try {
    body = (await request.json()) as { on?: unknown };
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.on !== "boolean") {
    return NextResponse.json({ ok: false, reason: "body must be { on: boolean }" }, { status: 400 });
  }
  try {
    const on = await setLockdown(body.on);
    return NextResponse.json({ ok: true, lockdown: on });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: (err as Error).message }, { status: 502 });
  }
}
