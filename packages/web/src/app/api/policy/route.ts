import { NextResponse } from "next/server";
import { readPolicy } from "@/lib/policy.server";
import type { PolicyView } from "@/lib/policy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EMPTY: PolicyView = { configured: false, budget: null, rules: [], extendsPacks: [], approval: null, downstreams: [] };

export async function GET() {
  try {
    return NextResponse.json(readPolicy());
  } catch {
    return NextResponse.json(EMPTY);
  }
}
