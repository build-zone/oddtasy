import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { config } from "../config.js";
import { loadFaucetKeypair } from "./keypair.js";
import {
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  createAtaIdempotentIx,
} from "./txbuilder.js";

/**
 * The demo faucet: a server-signed transfer that drips test USDC (and a little
 * SOL for fees) from a funding wallet to a freshly-created embedded wallet, so
 * a user who just logged in can bet without hunting for a public faucet.
 *
 * The USDC mint is Circle's devnet token — we don't hold mint authority — so
 * this MOVES balance from the faucet wallet rather than minting. Keep the
 * faucet topped up from https://faucet.circle.com (Solana devnet).
 */

let connection: Connection | null = null;
function conn(): Connection {
  if (!connection) connection = new Connection(config.solanaRpc, "confirmed");
  return connection;
}

/** SPL Token `Transfer` (instruction 3): source ATA → dest ATA, signed by owner. */
function tokenTransferIx(
  source: PublicKey,
  dest: PublicKey,
  owner: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0);
  data.writeBigUInt64LE(amount, 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

export type FaucetResult = { signature: string; usdc: number; sol: number };

export function faucetConfigured(): boolean {
  try {
    return Boolean(loadFaucetKeypair()) && Boolean(config.usdcMint);
  } catch {
    return false;
  }
}

export function faucetAddress(): string | null {
  try {
    return loadFaucetKeypair()?.publicKey.toBase58() ?? null;
  } catch {
    return null;
  }
}

/**
 * Sends the funding transfer to `recipient` and returns the confirmed
 * signature. Throws with a human-readable message when the faucet isn't
 * configured, the recipient is malformed, or the transfer fails to confirm.
 */
export async function sendFaucetFunds(recipient: string): Promise<FaucetResult> {
  const faucet = loadFaucetKeypair();
  if (!faucet || !config.usdcMint) {
    throw new Error("Faucet is not configured on this server");
  }

  let user: PublicKey;
  try {
    user = new PublicKey(recipient);
  } catch {
    throw new Error("Invalid recipient wallet");
  }

  const mint = new PublicKey(config.usdcMint);
  const faucetAta = associatedTokenAddress(faucet.publicKey, mint);
  const userAta = associatedTokenAddress(user, mint);
  const usdcBaseUnits = BigInt(Math.round(config.faucetUsdc * 1_000_000));
  const lamports = Math.round(config.faucetSol * 1_000_000_000);

  const instructions: TransactionInstruction[] = [];
  if (lamports > 0) {
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: faucet.publicKey,
        toPubkey: user,
        lamports,
      }),
    );
  }
  // faucet pays the ATA rent so the user needs nothing to receive
  instructions.push(createAtaIdempotentIx(faucet.publicKey, user, mint));
  if (usdcBaseUnits > 0n) {
    instructions.push(tokenTransferIx(faucetAta, userAta, faucet.publicKey, usdcBaseUnits));
  }

  const client = conn();
  const { blockhash, lastValidBlockHeight } = await client.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: faucet.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([faucet]);

  const signature = await client.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });
  const result = await client.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (result.value.err) {
    throw new Error(`Faucet transfer failed to confirm: ${JSON.stringify(result.value.err)}`);
  }

  return { signature, usdc: config.faucetUsdc, sol: config.faucetSol };
}
