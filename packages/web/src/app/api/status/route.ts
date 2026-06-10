import { NextResponse } from "next/server";
import { listPending, getOperatorStatus, proxyRunning } from "@/lib/approval-ipc";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** One poll for the status bar: proxy reachability, pending count, lockdown. */
export async function GET() {
  if (!proxyRunning()) {
    return NextResponse.json({ ok: false, reason: "proxy not running", pending: 0, lockdown: false });
  }
  try {
    const [pending, op] = await Promise.all([listPending(), getOperatorStatus()]);
    return NextResponse.json({
      ok: true,
      pending: pending.length,
      lockdown: op.lockdown,
      overrides: op.overrides.length,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: (err as Error).message, pending: 0, lockdown: false });
  }
}
