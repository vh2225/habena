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
    // 200 (not 500): /approvals is polled ~1s; the UI reads `ok` from the
    // envelope and never the HTTP status, so a transient socket error should
    // degrade to an empty list rather than a fetch error.
    return NextResponse.json(
      { ok: false, reason: err instanceof Error ? err.message : String(err), pending: [] },
      { status: 200 }
    );
  }
}
