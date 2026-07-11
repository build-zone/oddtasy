import fs from "node:fs";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

function keypairFromInline(inline: string, envName: string): Keypair {
  if (inline.startsWith("[")) {
    const secret = JSON.parse(inline) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }

  const decoded = bs58.decode(inline);
  if (decoded.length === 64) {
    return Keypair.fromSecretKey(decoded);
  }
  if (decoded.length === 32) {
    return Keypair.fromSeed(decoded);
  }

  throw new Error(`${envName} must be base58 (32 or 64 bytes) or a JSON byte array`);
}

export function loadResolverKeypair(): Keypair | null {
  const inline = process.env.ODDTASY_RESOLVER_KEY?.trim();
  if (inline) return keypairFromInline(inline, "ODDTASY_RESOLVER_KEY");

  const keypairPath = process.env.ODDTASY_RESOLVER_KEYPAIR?.trim();
  if (!keypairPath) return null;
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`ODDTASY_RESOLVER_KEYPAIR not found: ${keypairPath}`);
  }

  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}
