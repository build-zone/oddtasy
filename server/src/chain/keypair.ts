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

/** Loads a keypair from an inline env value (base58 / JSON array) or a file
 * path env, returning null when neither is set. Shared by the resolver signer
 * and the demo faucet. */
function loadEnvKeypair(inlineName: string, pathName: string): Keypair | null {
  const inline = process.env[inlineName]?.trim();
  if (inline) return keypairFromInline(inline, inlineName);

  const keypairPath = process.env[pathName]?.trim();
  if (!keypairPath) return null;
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`${pathName} not found: ${keypairPath}`);
  }

  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function loadResolverKeypair(): Keypair | null {
  return loadEnvKeypair("ODDTASY_RESOLVER_KEY", "ODDTASY_RESOLVER_KEYPAIR");
}

/** The wallet that funds new users with test USDC + a little SOL on first
 * login. On devnet this is just a keypair holding Circle test USDC. */
export function loadFaucetKeypair(): Keypair | null {
  return loadEnvKeypair("ODDTASY_FAUCET_KEY", "ODDTASY_FAUCET_KEYPAIR");
}
