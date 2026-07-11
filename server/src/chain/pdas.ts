import { PublicKey } from "@solana/web3.js";
import { config } from "../config.js";

export function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error("pool id must be a UUID");
  }
  return Buffer.from(hex, "hex");
}

export function programId(): PublicKey | null {
  if (!config.bettingProgramId) return null;
  return new PublicKey(config.bettingProgramId);
}

function pda(seed: string, program: PublicKey, extra?: Buffer): string {
  const seeds = extra ? [Buffer.from(seed), extra] : [Buffer.from(seed)];
  return PublicKey.findProgramAddressSync(seeds, program)[0].toBase58();
}

export function poolPdas(poolId: string, memberWallet?: string) {
  const program = programId();
  if (!program) return null;
  const poolIdBytes = uuidToBytes(poolId);
  const out: {
    programId: string;
    poolIdBytesHex: string;
    config: string;
    pool: string;
    vault: string;
    entry?: string;
  } = {
    programId: program.toBase58(),
    poolIdBytesHex: poolIdBytes.toString("hex"),
    config: pda("config", program),
    pool: pda("pool", program, poolIdBytes),
    vault: pda("vault", program, poolIdBytes),
  };
  if (memberWallet) {
    const member = new PublicKey(memberWallet);
    out.entry = PublicKey.findProgramAddressSync(
      [Buffer.from("entry"), poolIdBytes, member.toBuffer()],
      program,
    )[0].toBase58();
  }
  return out;
}
