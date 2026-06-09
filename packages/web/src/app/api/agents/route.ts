import { NextResponse } from "next/server";
import { readRegistry } from "@/lib/agents-registry.server";
import { agentActivity } from "@/lib/audit";
import { mergeAgents } from "@/lib/agents";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json({ agents: mergeAgents(readRegistry(), agentActivity()) });
  } catch {
    return NextResponse.json({ agents: [] });
  }
}
