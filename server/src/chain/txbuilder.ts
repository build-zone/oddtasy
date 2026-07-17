import { createHash } from "node:crypto";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { config } from "../config.js";
import { programId, uuidToBytes } from "./pdas.js";

/**
 * Builds unsigned transactions for the user-signed (Pattern A) instructions:
 * create_pool, enter_pool, claim_winnings, claim_refund.
 *
 * Instructions are hand-encoded — Anchor discriminator (sha256("global:<name>")[0..8])
 * plus borsh args — with account orders mirrored from the Rust #[derive(Accounts)]
 * structs in betting-program/programs/betting-program/src/instructions/. If a
 * handler's args or account order changes there, it MUST change here.
 */

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

function discriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function u16le(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}
function i64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(n);
  return b;
}

function pda(seeds: (Buffer | Uint8Array)[], program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, program)[0];
}

export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return pda(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

/** Idempotent ATA create — a no-op when the account already exists, so fresh
 * embedded wallets work without a separate setup step. */
export function createAtaIdempotentIx(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // CreateIdempotent
  });
}

type ChainContext = {
  program: PublicKey;
  usdcMint: PublicKey;
  configPda: PublicKey;
  poolPda: PublicKey;
  vaultPda: PublicKey;
  poolIdBytes: Buffer;
};

function chainContext(poolId: string): ChainContext | null {
  const program = programId();
  if (!program || !config.usdcMint) return null;
  const poolIdBytes = uuidToBytes(poolId);
  return {
    program,
    usdcMint: new PublicKey(config.usdcMint),
    configPda: pda([Buffer.from("config")], program),
    poolPda: pda([Buffer.from("pool"), poolIdBytes], program),
    vaultPda: pda([Buffer.from("vault"), poolIdBytes], program),
    poolIdBytes,
  };
}

/* ---- instruction builders (account order = Rust context order) ---- */

function createPoolIx(
  ctx: ChainContext,
  host: PublicKey,
  args: {
    marketType: number;
    marketParam: number;
    outcomeCount: number;
    stakeAmount: bigint;
    rakeBps: number;
    maxEntries: number;
    deadline: number;
  },
): TransactionInstruction {
  const data = Buffer.concat([
    discriminator("create_pool"),
    ctx.poolIdBytes,
    Buffer.from([args.marketType]),
    u16le(args.marketParam),
    u16le(args.outcomeCount),
    u64le(args.stakeAmount),
    u16le(args.rakeBps),
    u32le(args.maxEntries),
    i64le(BigInt(args.deadline)),
  ]);
  return new TransactionInstruction({
    programId: ctx.program,
    keys: [
      { pubkey: host, isSigner: true, isWritable: true },
      { pubkey: ctx.configPda, isSigner: false, isWritable: false },
      { pubkey: ctx.poolPda, isSigner: false, isWritable: true },
      { pubkey: ctx.vaultPda, isSigner: false, isWritable: true },
      { pubkey: ctx.usdcMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function enterPoolIx(
  ctx: ChainContext,
  member: PublicKey,
  prediction: number,
): TransactionInstruction {
  const entryPda = pda(
    [Buffer.from("entry"), ctx.poolIdBytes, member.toBuffer()],
    ctx.program,
  );
  const data = Buffer.concat([
    discriminator("enter_pool"),
    ctx.poolIdBytes,
    u16le(prediction),
  ]);
  return new TransactionInstruction({
    programId: ctx.program,
    keys: [
      { pubkey: member, isSigner: true, isWritable: true },
      { pubkey: ctx.poolPda, isSigner: false, isWritable: true },
      { pubkey: ctx.vaultPda, isSigner: false, isWritable: true },
      { pubkey: entryPda, isSigner: false, isWritable: true },
      { pubkey: associatedTokenAddress(member, ctx.usdcMint), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/** claim_winnings and claim_refund share the same account shape. */
function claimIx(
  ctx: ChainContext,
  member: PublicKey,
  name: "claim_winnings" | "claim_refund",
): TransactionInstruction {
  const entryPda = pda(
    [Buffer.from("entry"), ctx.poolIdBytes, member.toBuffer()],
    ctx.program,
  );
  const data = Buffer.concat([discriminator(name), ctx.poolIdBytes]);
  return new TransactionInstruction({
    programId: ctx.program,
    keys: [
      { pubkey: member, isSigner: true, isWritable: true },
      { pubkey: ctx.poolPda, isSigner: false, isWritable: true },
      { pubkey: ctx.vaultPda, isSigner: false, isWritable: true },
      { pubkey: entryPda, isSigner: false, isWritable: true },
      { pubkey: associatedTokenAddress(member, ctx.usdcMint), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/* ---- transaction assembly ---- */

let connection: Connection | null = null;
function conn(): Connection {
  if (!connection) connection = new Connection(config.solanaRpc, "confirmed");
  return connection;
}

async function toBase64Tx(
  payer: PublicKey,
  instructions: TransactionInstruction[],
): Promise<{ transaction: string; expiresAt: string }> {
  const { blockhash } = await conn().getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  return {
    transaction: Buffer.from(tx.serialize()).toString("base64"),
    // blockhashes live ~60–90s; clients should re-request after this
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

/** Null when the chain side isn't configured or reachable — callers fall back
 * to record-only mode rather than failing the request. */
async function tryBuild(
  payer: PublicKey,
  instructions: TransactionInstruction[],
): Promise<{ transaction: string; expiresAt: string } | null> {
  try {
    return await toBase64Tx(payer, instructions);
  } catch (err) {
    console.warn("[txbuilder] failed to build transaction:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function buildCreatePoolTx(pool: {
  id: string;
  hostWallet: string;
  marketType: number;
  marketParam: number;
  outcomeCount: number;
  stakeAmount: number;
  rakeBps: number;
  maxEntries: number;
  deadline: number;
}): Promise<{ transaction: string; expiresAt: string } | null> {
  const ctx = chainContext(pool.id);
  if (!ctx) return null;
  const host = new PublicKey(pool.hostWallet);
  return tryBuild(host, [
    createPoolIx(ctx, host, {
      marketType: pool.marketType,
      marketParam: pool.marketParam,
      outcomeCount: pool.outcomeCount,
      stakeAmount: BigInt(pool.stakeAmount),
      rakeBps: pool.rakeBps,
      maxEntries: pool.maxEntries,
      deadline: pool.deadline,
    }),
  ]);
}

/** One approval: create the pool on-chain AND stake the host's own bet. */
export async function buildCreateWithEntryTx(
  pool: {
    id: string;
    hostWallet: string;
    marketType: number;
    marketParam: number;
    outcomeCount: number;
    stakeAmount: number;
    rakeBps: number;
    maxEntries: number;
    deadline: number;
  },
  prediction: number,
): Promise<{ transaction: string; expiresAt: string } | null> {
  const ctx = chainContext(pool.id);
  if (!ctx) return null;
  const host = new PublicKey(pool.hostWallet);
  return tryBuild(host, [
    createPoolIx(ctx, host, {
      marketType: pool.marketType,
      marketParam: pool.marketParam,
      outcomeCount: pool.outcomeCount,
      stakeAmount: BigInt(pool.stakeAmount),
      rakeBps: pool.rakeBps,
      maxEntries: pool.maxEntries,
      deadline: pool.deadline,
    }),
    createAtaIdempotentIx(host, host, ctx.usdcMint),
    enterPoolIx(ctx, host, prediction),
  ]);
}

export async function buildEnterPoolTx(
  poolId: string,
  wallet: string,
  prediction: number,
): Promise<{ transaction: string; expiresAt: string } | null> {
  const ctx = chainContext(poolId);
  if (!ctx) return null;
  const member = new PublicKey(wallet);
  return tryBuild(member, [
    createAtaIdempotentIx(member, member, ctx.usdcMint),
    enterPoolIx(ctx, member, prediction),
  ]);
}

export async function buildClaimTx(
  poolId: string,
  wallet: string,
  kind: "winnings" | "refund",
): Promise<{ transaction: string; expiresAt: string } | null> {
  const ctx = chainContext(poolId);
  if (!ctx) return null;
  const member = new PublicKey(wallet);
  return tryBuild(member, [
    createAtaIdempotentIx(member, member, ctx.usdcMint),
    claimIx(ctx, member, kind === "winnings" ? "claim_winnings" : "claim_refund"),
  ]);
}
