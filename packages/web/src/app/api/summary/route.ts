import { NextResponse } from "next/server";
import { summary, dbExists, dbPathForDisplay } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  if (!dbExists()) {
    return NextResponse.json({
      ok: false,
      reason: "audit.db not found",
      hint: `Expected at ${dbPathForDisplay()}`,
      summary: null,
    });
  }
  try {
    return NextResponse.json({ ok: true, summary: summary() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: (err as Error).message, summary: null },
      { status: 500 }
    );
  }
}
