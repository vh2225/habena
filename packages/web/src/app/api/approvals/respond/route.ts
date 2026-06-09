import { NextResponse } from "next/server";
import { respond } from "@/lib/approval-ipc";
import type { ApprovalChoice } from "@/lib/approval-protocol";

export const dynamic = "force-dynamic";

const VALID: ReadonlySet<ApprovalChoice> = new Set(["allow_once", "allow_session", "deny"]);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ ok: false, reason: "body must be a JSON object" }, { status: 400 });
  }
  const { id: rawId, choice: rawChoice } = body as { id?: unknown; choice?: unknown };
  const id = typeof rawId === "string" ? rawId : "";
  const choice = typeof rawChoice === "string" ? (rawChoice as ApprovalChoice) : ("" as ApprovalChoice);
  if (!id || !VALID.has(choice)) {
    return NextResponse.json(
      { ok: false, reason: "id (string) and choice (allow_once|allow_session|deny) required" },
      { status: 400 }
    );
  }
  try {
    const result = await respond(id, choice);
    // ok:false here means the id was stale/expired/unknown — that's a conflict, not a 500.
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
