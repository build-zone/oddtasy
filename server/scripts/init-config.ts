/**
 * One-time devnet setup: creates (or loads) the resolver keypair, ensures the
 * admin's USDC ATA exists (the treasury), and calls initialize_config.
 *
 *   npx tsx scripts/init-config.ts
 *
 * Admin = the local solana CLI wallet (~/.config/solana/id.json), which pays
 * fees and becomes config.admin. Idempotent: exits cleanly if config exists.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { config } from "../src/config.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
} from "../src/chain/txbuilder.js";

function loadKeypair(file: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")) as number[]),
  );
}

async function main() {
  const rpc = config.solanaRpc;
  const programId = new PublicKey(config.bettingProgramId);
  const usdcMint = new PublicKey(config.usdcMint);
  const conn = new Connection(rpc, "confirmed");

  const admin = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  console.log("admin:", admin.publicKey.toBase58());
  console.log("program:", programId.toBase58());

  // resolver keypair for the settlement worker (server secret)
  const resolverPath = path.resolve(process.cwd(), "resolver-keypair.json");
  let resolver: Keypair;
  if (fs.existsSync(resolverPath)) {
    resolver = loadKeypair(resolverPath);
  } else {
    resolver = Keypair.generate();
    fs.writeFileSync(resolverPath, JSON.stringify([...resolver.secretKey]));
    console.log("generated resolver keypair →", resolverPath);
  }
  console.log("resolver:", resolver.publicKey.toBase58());

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  );
  const existing = await conn.getAccountInfo(configPda);
  if (existing) {
    console.log("config already initialized at", configPda.toBase58(), "— nothing to do");
    return;
  }

  const treasury = associatedTokenAddress(admin.publicKey, usdcMint);
  console.log("treasury (admin USDC ATA):", treasury.toBase58());

  const ataIx = new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: treasury, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: false, isWritable: false },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // CreateIdempotent
  });

  const disc = createHash("sha256")
    .update("global:initialize_config")
    .digest()
    .subarray(0, 8);
  const initIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      disc,
      resolver.publicKey.toBuffer(),
      treasury.toBuffer(),
    ]),
  });

  const sig = await sendAndConfirmTransaction(
    conn,
    new Transaction().add(ataIx, initIx),
    [admin],
    { commitment: "confirmed" },
  );
  console.log("initialize_config confirmed:", sig);
  console.log("config PDA:", configPda.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
