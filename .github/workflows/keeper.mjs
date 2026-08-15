// keeper.mjs — Drain automático de colas (processPendingQueue público, sin admin)
// Diseño: un tiro por cron cada 1 min. Wallet dedicada solo puede drenar.
import { ethers } from "ethers";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ────────────────────────────────────────────────────────
const RPC = process.env.BASE_RPC || "https://mainnet.base.org";
const PROXY = "0x8af722f18063cAB9Dc94c4E6d23f201b3E5CcAF6";
const MAX_COUNT = 27;
const WORK_THRESHOLD = 100_000n; // procesa incluso colas de 1-2 items (PLACE_ROOT descartado ~111K)
const GAS_CAP = 12_000_000n;

const ABI = ["function processPendingQueue(uint256)"];

// ─── Cargar PK ─────────────────────────────────────────────────────
let KEEPER_PK = process.env.KEEPER_PRIVATE_KEY || "";
if (!KEEPER_PK) {
  try {
    const envPath = resolve(__dirname, "..", ".env");
    const env = readFileSync(envPath, "utf8");
    const m = env.match(/KEEPER_PRIVATE_KEY\s*=\s*(\S+)/);
    if (m) KEEPER_PK = m[1];
  } catch (_) {}
}
if (!KEEPER_PK || KEEPER_PK.length < 64) {
  console.error("[keeper] ERROR: KEEPER_PRIVATE_KEY no definida. Pone KEEPER_PRIVATE_KEY=0x... en .env");
  process.exit(1);
}

// ─── Lógica ────────────────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(KEEPER_PK, provider);
const c = new ethers.Contract(PROXY, ABI, wallet);

try {
  const data = c.interface.encodeFunctionData("processPendingQueue", [MAX_COUNT]);

  // 1) Detectar trabajo sin mandar tx
  const est = await provider.estimateGas({ to: PROXY, data, from: wallet.address });
  if (est < WORK_THRESHOLD) {
    console.log(`[keeper] colas vacías (est=${est})`);
    process.exit(0);
  }

  // 2) Drenar con gas acotado
  const gasLimit = (est * 13n / 10n) < GAS_CAP ? (est * 13n / 10n) : GAS_CAP;
  const tx = await c.processPendingQueue(MAX_COUNT, { gasLimit });
  const r = await tx.wait();

  console.log(`[keeper] drain ok | gas=${r.gasUsed} | tx=${tx.hash} | est=${est}`);
} catch (e) {
  // paused / lock / sin fondos
  const msg = e.shortMessage || e.message || e;
  if (msg.includes("paused") || msg.includes("lock") || msg.includes("reentrant")) {
    console.log(`[keeper] sin acción: ${msg}`);
    process.exit(0);
  }
  console.error(`[keeper] ERROR: ${msg}`);
  process.exit(1);
}
