import { ethers } from "ethers";

const RPC = process.env.BASE_RPC || "https://mainnet.base.org";
const PK = process.env.KEEPER_PRIVATE_KEY || "";
const PROXY = "0x685E3757a65a49a88E192E7F0B32984eE01808e6";
const ABI = ["function processPendingQueue(uint256)"];
const MAX = 27, WORK = 300000n, CAP = 12000000n;

if (!PK) { console.log("[keeper] KEEPER_PRIVATE_KEY no definida"); process.exit(1); }

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);
const c = new ethers.Contract(PROXY, ABI, wallet);
const data = c.interface.encodeFunctionData("processPendingQueue", [MAX]);

try {
  const est = await provider.estimateGas({ to: PROXY, data, from: wallet.address });
  if (est < WORK) { console.log("[keeper] colas vacias est=" + est); process.exit(0); }
  const gas = (est * 13n / 10n) < CAP ? (est * 13n / 10n) : CAP;
  const tx = await c.processPendingQueue(MAX, { gasLimit: gas });
  const r = await tx.wait();
  console.log("[keeper] drain ok gas=" + r.gasUsed + " tx=" + tx.hash);
} catch (e) {
  console.log("[keeper] sin accion: " + (e.shortMessage || e.message));
}
