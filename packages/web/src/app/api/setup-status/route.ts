import { NextResponse } from "next/server";
import { readSetupStatus, type SetupStatus } from "@/lib/setup-status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EMPTY: SetupStatus = {
  configExists: false, downstreams: [], agents: [],
  telegramConfigured: false, proxyRunning: false, decisionCount: 0,
};

export async function GET() {
  try {
    return NextResponse.json(readSetupStatus());
  } catch {
    // Never let the wizard's poller error out — degrade to "nothing set up yet".
    return NextResponse.json(EMPTY);
  }
}
