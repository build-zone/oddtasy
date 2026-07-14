/** Formatting utilities — the single place money, odds and time get rendered. */

/** Money display from a whole-USDC number (server's stakeUsdc). USDC is
 * dollar-pegged, so fans read plain dollars; fine print says "devnet USDC". */
export function usdc(amount: number): string {
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/** USDC display from integer base units (6 decimals), given as number or string. */
export function usdcFromBase(base: number | string): string {
  const n = typeof base === "string" ? Number(base) : base;
  if (!Number.isFinite(n)) return "—";
  return usdc(n / 1_000_000);
}

export function pct(p: number | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(0)}%`;
}

export function odds(o: number | undefined): string {
  if (o == null || !Number.isFinite(o)) return "—";
  return o.toFixed(2);
}

export function kickoffLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** Countdown to a unix-seconds deadline, e.g. "2h 14m" / "closed". */
export function countdown(deadlineSec: number, now = Date.now()): string {
  const ms = deadlineSec * 1000 - now;
  if (ms <= 0) return "closed";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}

export function shortWallet(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Minimal base58 encoder (enough for tx signatures — avoids a bs58 dep). */
export function toBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      const x = digits[i] * 256 + carry;
      digits[i] = x % 58;
      carry = Math.floor(x / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "";
  for (const byte of bytes) {
    if (byte === 0) out += B58_ALPHABET[0];
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
