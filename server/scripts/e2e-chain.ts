/**
 * End-to-end proof of the money rails on devnet:
 *  1. POST /pools → server returns an unsigned create_pool transaction
 *  2. sign with the admin keypair, send, confirm → the pool PDA exists on-chain
 *  3. build an enter_pool tx for the user's real embedded wallet and SIMULATE it
 *     (proves encoding + their USDC balance would clear, without their key)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { config } from "../src/config.js";
import { buildEnterPoolTx } from "../src/chain/txbuilder.js";

const API = "http://localhost:4100";
const USER_WALLET = "hGgi9NKs92t44DGvVHLYgMEpAkwhjYhuPGZCcqMZUiM";

const admin = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"),
    ) as number[],
  ),
);
const conn = new Connection(config.solanaRpc, "confirmed");

async function main() {
  // 1. create a pool via the API (France v Spain, kickoff Jul 14 12:00 UTC-ish)
  const createRes = await fetch(`${API}/pools`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hostWallet: admin.publicKey.toBase58(),
      fixtureId: 18237038,
      fixtureLabel: "France vs Spain",
      marketType: 0,
      marketKey: "match_result",
      marketParam: 0,
      outcomeCount: 3,
      optionLabel: "Home",
      stakeUsdc: 1,
      maxEntries: 50,
      deadline: Math.floor(Date.now() / 1000) + 6 * 3600,
    }),
  });
  const created = (await createRes.json()) as {
    pool: { id: string };
    transaction?: string;
    chain: { pool: string };
    error?: string;
  };
  if (!createRes.ok) throw new Error(`create failed: ${created.error}`);
  console.log("pool id:", created.pool.id);
  console.log("server returned transaction:", Boolean(created.transaction));
  if (!created.transaction) throw new Error("no transaction in response");

  // 2. sign + send as the host
  const tx = VersionedTransaction.deserialize(Buffer.from(created.transaction, "base64"));
  tx.sign([admin]);
  const sig = await conn.sendTransaction(tx, { maxRetries: 5 });
  console.log("create_pool sent:", sig);
  const bh = await conn.getLatestBlockhash("confirmed");
  await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  console.log("confirmed ✓");

  await fetch(`${API}/pools/${created.pool.id}/tx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "create", signature: sig }),
  });

  const poolAccount = await conn.getAccountInfo(new PublicKey(created.chain.pool));
  console.log(
    "on-chain pool account:",
    poolAccount ? `${poolAccount.data.length} bytes, owner ${poolAccount.owner.toBase58()}` : "MISSING",
  );

  // 3. simulate enter_pool for the user's real wallet (no key needed)
  const built = await buildEnterPoolTx(created.pool.id, USER_WALLET, 0);
  if (!built) throw new Error("enter tx build failed");
  const enterTx = VersionedTransaction.deserialize(Buffer.from(built.transaction, "base64"));
  const sim = await conn.simulateTransaction(enterTx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  console.log("enter_pool simulation error:", sim.value.err ?? "none ✓");
  if (sim.value.err) console.log((sim.value.logs ?? []).slice(-6).join("\n"));

  console.log(`explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
