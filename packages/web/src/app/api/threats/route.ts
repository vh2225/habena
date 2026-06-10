import { NextResponse } from "next/server";
import { threatSummary, dbExists, dbPathForDisplay } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  if (!dbExists()) {
    return NextResponse.json({
      ok: false,
      reason: "audit.db not found",
      hint: `Expected at ${dbPathForDisplay()}`,
      threats: null,
    });
  }
  try {
    return NextResponse.json({ ok: true, threats: threatSummary() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: (err as Error).message, threats: null },
      { status: 500 }
    );
  }
}
