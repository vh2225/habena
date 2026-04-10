/**
 * Timeout handling for approval requests.
 * Parses duration strings ("5m", "1h", "30s") and manages auto-deny.
 */

export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h)$/);
  if (!match) throw new Error(`Invalid duration: ${duration}`);

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "s": return value * 1000;
    case "m": return value * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    default: throw new Error(`Unknown time unit: ${unit}`);
  }
}
