import fs from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "../../config.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ENTRY_POOL_ID_OFFSET = 40;

export type ChainStatus = "open" | "locked" | "resolved" | "voided" | "cancelled";

type AnchorProgram = anchor.Program<anchor.Idl>;
type DynamicProgram = AnchorProgram & {
  account: Record<string, { fetch(address: PublicKey): Promise<unknown>; all(filters?: unknown[]): Promise<unknown[]> }>;
  methods: Record<string, (...args: unknown[]) => { accounts(accounts: Record<string, unknown>): { rpc(): Promise<string> } }>;
};

function statusKey(status: unknown): ChainStatus {
  if (!status || typeof status !== "object") return "open";
  const key = Object.keys(status as Record<string, unknown>)[0];
  switch (key) {
    case "locked":
    case "resolved":
    case "voided":
    case "cancelled":
      return key;
    default:
      return "open";
  }
}

function numberish(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  return Number(value);
}

export class PoolProgram {
  readonly program: AnchorProgram;
  readonly resolver: Keypair;
  private treasuryCache?: PublicKey;

  constructor(connection: Connection, resolver: Keypair, idlPath = config.programIdlPath) {
    if (!idlPath) {
      throw new Error("ODDTASY_PROGRAM_IDL is required for resolver mode");
    }
    if (!fs.existsSync(idlPath)) {
      throw new Error(`ODDTASY_PROGRAM_IDL not found: ${idlPath}`);
    }

    const idl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as anchor.Idl & { address?: string };
    if (!idl.address && config.bettingProgramId) {
      idl.address = config.bettingProgramId;
    }
    if (!idl.address) {
      throw new Error("IDL has no address; set ODDTASY_BETTING_PROGRAM_ID");
    }

    const wallet = new anchor.Wallet(resolver);
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
    this.program = new anchor.Program(idl, provider);
    this.resolver = resolver;
  }

  private pda(seed: string, extra?: Buffer): PublicKey {
    const seeds = extra ? [Buffer.from(seed), extra] : [Buffer.from(seed)];
    return PublicKey.findProgramAddressSync(seeds, this.program.programId)[0];
  }

  configPda(): PublicKey {
    return this.pda("config");
  }

  poolPda(poolId: Buffer): PublicKey {
    return this.pda("pool", poolId);
  }

  vaultPda(poolId: Buffer): PublicKey {
    return this.pda("vault", poolId);
  }

  async treasury(): Promise<PublicKey> {
    if (!this.treasuryCache) {
      const configAccount = (await (this.program as DynamicProgram).account["config"]!.fetch(this.configPda())) as {
        treasury: PublicKey;
      };
      this.treasuryCache = configAccount.treasury;
    }
    return this.treasuryCache;
  }

  async status(poolId: Buffer): Promise<ChainStatus> {
    const pool = (await (this.program as DynamicProgram).account["pool"]!.fetch(this.poolPda(poolId))) as {
      status: unknown;
    };
    return statusKey(pool.status);
  }

  async shareAmount(poolId: Buffer): Promise<bigint> {
    const pool = (await (this.program as DynamicProgram).account["pool"]!.fetch(this.poolPda(poolId))) as {
      shareAmount: unknown;
    };
    return BigInt(numberish(pool.shareAmount));
  }

  async countWinners(poolId: Buffer, winningOutcome: number): Promise<{ total: number; winners: number }> {
    const entryAccounts = (await (this.program as DynamicProgram).account["entry"]!.all([
      { memcmp: { offset: ENTRY_POOL_ID_OFFSET, bytes: bs58.encode(poolId) } },
    ])) as Array<{ account: { prediction: unknown } }>;
    const winners = entryAccounts.filter((entry) => {
      const account = entry.account as { prediction: unknown };
      return numberish(account.prediction) === winningOutcome;
    }).length;
    return { total: entryAccounts.length, winners };
  }

  async lock(poolId: Buffer): Promise<string> {
    return (this.program as DynamicProgram).methods["lockPool"]!([...poolId])
      .accounts({
        resolver: this.resolver.publicKey,
        config: this.configPda(),
        pool: this.poolPda(poolId),
      })
      .rpc();
  }

  async resolve(poolId: Buffer, winningOutcome: number, winnerCount: number): Promise<string> {
    return (this.program as DynamicProgram).methods["resolvePool"]!([...poolId], winningOutcome, winnerCount)
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
    return (this.program as DynamicProgram).methods["cancelPool"]!([...poolId])
      .accounts({
        authority: this.resolver.publicKey,
        config: this.configPda(),
        pool: this.poolPda(poolId),
      })
      .rpc();
  }
}
