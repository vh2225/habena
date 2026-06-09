import { NextResponse } from "next/server";
import { proxyRunning, listPending, socketPath } from "@/lib/approval-ipc";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  if (!proxyRunning()) {
    return NextResponse.json({
      ok: false,
      reason: "proxy not running",
      hint: `No approval socket at ${socketPath()}. Start the proxy: habena start`,
      pending: [],
    });
  }
  try {
    const pending = await listPending();
    return NextResponse.json({ ok: true, pending });
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: (err as Error).message, pending: [] },
      { status: 200 }
    );
  }
}
