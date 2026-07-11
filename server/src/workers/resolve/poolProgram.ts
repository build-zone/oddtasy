/**
 * poolProgram.ts — the on-chain side of the resolve worker.
 *
 * Wraps the Anchor program with the backend resolver keypair as signer. Two jobs:
 *  1. Count winners authoritatively from on-chain Entry accounts (never the DB).
 *  2. Backend-sign lock / resolve / cancel (Pattern B in the platform spec).
 *
 * Adjust the two imports marked ADJUST to your generated artifacts. `anchor build`
 * writes target/idl/betting_program.json and target/types/betting_program.ts; the
 * exported type is the PascalCase of your program's package name.
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

// ADJUST: path + type name to your generated IDL.
import idl from "../target/idl/betting_program.json";
import type { BettingProgram } from "../target/types/betting_program";

// SPL Token program id, hardcoded so we need no spl-token dependency.
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// Byte offset of `pool_id` inside an Entry account: 8 (discriminator) + 32 (member).
const ENTRY_POOL_ID_OFFSET = 40;

export type ChainStatus = "open" | "locked" | "resolved" | "voided" | "cancelled";

export class PoolProgram {
  readonly program: anchor.Program<BettingProgram>;
  readonly resolver: Keypair;
  private treasuryCache?: PublicKey;

  constructor(connection: Connection, resolver: Keypair) {
    const wallet = new anchor.Wallet(resolver);
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
    // Anchor >= 0.30: program id comes from idl.address.
    this.program = new anchor.Program(idl as anchor.Idl, provider) as anchor.Program<BettingProgram>;
    this.resolver = resolver;
  }

  private pda(seed: string, extra?: Buffer): PublicKey {
    const seeds = extra ? [Buffer.from(seed), extra] : [Buffer.from(seed)];
    return PublicKey.findProgramAddressSync(seeds, this.program.programId)[0];
  }
  configPda() {
    return this.pda("config");
  }
  poolPda(poolId: Buffer) {
    return this.pda("pool", poolId);
  }
  vaultPda(poolId: Buffer) {
    return this.pda("vault", poolId);
  }

  async treasury(): Promise<PublicKey> {
    if (!this.treasuryCache) {
      const config = await this.program.account.config.fetch(this.configPda());
      this.treasuryCache = config.treasury;
    }
    return this.treasuryCache;
  }

  async status(poolId: Buffer): Promise<ChainStatus> {
    const pool = await this.program.account.pool.fetch(this.poolPda(poolId));
    return Object.keys(pool.status)[0] as ChainStatus;
  }

  async shareAmount(poolId: Buffer): Promise<bigint> {
    const pool = await this.program.account.pool.fetch(this.poolPda(poolId));
    return BigInt(pool.shareAmount.toString());
  }

  /**
   * Authoritative winner count, read from on-chain Entry accounts. Immune to any
   * DB lag. Filters entries by pool_id via memcmp, then counts those whose
   * prediction equals the winning outcome. (No entry is `claimed` before resolve,
   * so all fetched entries are live.)
   */
  async countWinners(poolId: Buffer, winningOutcome: number): Promise<{ total: number; winners: number }> {
    const entries = await this.program.account.entry.all([
      { memcmp: { offset: ENTRY_POOL_ID_OFFSET, bytes: bs58.encode(poolId) } },
    ]);
    const winners = entries.filter((e) => e.account.prediction === winningOutcome).length;
    return { total: entries.length, winners };
  }

  async lock(poolId: Buffer): Promise<string> {
    return this.program.methods
      .lockPool([...poolId])
      .accounts({
        resolver: this.resolver.publicKey,
        config: this.configPda(),
        pool: this.poolPda(poolId),
      })
      .rpc();
  }

  async resolve(poolId: Buffer, winningOutcome: number, winnerCount: number): Promise<string> {
    return this.program.methods
      .resolvePool([...poolId], winningOutcome, winnerCount)
      .accounts({
        resolver: this.resolver.publicKey,
        config: this.configPda(),
        pool: this.poolPda(poolId),
        vault: this.vaultPda(poolId),
        treasury: await this.treasury(),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async cancel(poolId: Buffer): Promise<string> {
    return this.program.methods
      .cancelPool([...poolId])
      .accounts({
        authority: this.resolver.publicKey,
        config: this.configPda(),
        pool: this.poolPda(poolId),
      })
      .rpc();
  }
}