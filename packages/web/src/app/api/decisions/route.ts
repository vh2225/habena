import { NextResponse } from "next/server";
import { recentDecisions, dbExists, dbPathForDisplay } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10) || 100, 1000);

  if (!dbExists()) {
    return NextResponse.json(
      {
        ok: false,
        reason: "audit.db not found",
        hint: `Expected at ${dbPathForDisplay()}. Start the proxy once to create it.`,
        rows: [],
      },
      { status: 200 }
    );
  }

  try {
    const rows = recentDecisions(limit);
    return NextResponse.json({ ok: true, rows });
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: (err as Error).message, rows: [] },
      { status: 500 }
    );
  }
}
