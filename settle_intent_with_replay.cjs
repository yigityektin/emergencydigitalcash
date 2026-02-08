const fs = require("node:fs");
const { ethers } = require("ethers");
const { keccak256, toUtf8Bytes, SigningKey, computeAddress } = require("ethers");

const RPC = process.env.RPC_URL;
const MASTER_SECRET = process.env.MASTER_SECRET;
const NONCE_DB = process.env.NONCE_DB || "./used_nonces.json";

if (!RPC || !MASTER_SECRET) {
  console.log("Missing env: RPC_URL, MASTER_SECRET (optional NONCE_DB=./used_nonces.json)");
  process.exit(1);
}

function die(msg) { console.log(msg); process.exit(1); }

function loadNonceDB() {
  try {
    const j = JSON.parse(fs.readFileSync(NONCE_DB, "utf8"));
    return new Set((j.used || []).map(String));
  } catch {
    return new Set();
  }
}

function saveNonceDB(set) {
  const arr = Array.from(set);
  fs.writeFileSync(NONCE_DB, JSON.stringify({ used: arr }, null, 2));
}

function secretBytes() {
  if (MASTER_SECRET.startsWith("0x") && MASTER_SECRET.length === 66) return ethers.getBytes(MASTER_SECRET);
  return toUtf8Bytes(MASTER_SECRET);
}

function uidToPrivateKey(uidHex) {
  const uidBytes = toUtf8Bytes(uidHex.toLowerCase());
  return keccak256(ethers.concat([secretBytes(), uidBytes]));
}

function intentHash(intent) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address","address","address","uint256","uint256","uint256"],
      [intent.card, intent.merchant, intent.token, intent.amount, intent.nonce, intent.expiry]
    )
  );
}

const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 value) returns (bool)"
];

(async () => {
  const raw = process.argv[2];
  if (!raw) die("Usage: node settle_intent_with_replay.cjs '<INTENT_JSON>'");

  let intent;
  try { intent = JSON.parse(raw); } catch { die("Bad JSON"); }

  const provider = new ethers.JsonRpcProvider(RPC);

  const uid = String(intent.uid || "").trim().toUpperCase();
  const card = ethers.getAddress(intent.card);
  const merchant = ethers.getAddress(intent.merchant);
  const tokenAddr = ethers.getAddress(intent.token);

  const amount = BigInt(intent.amount);
  const nonce = BigInt(intent.nonce);
  const expiry = BigInt(intent.expiry);
  const signature = String(intent.signature);

  const replayKey = `${card.toLowerCase()}:${nonce.toString()}`;
  const used = loadNonceDB();
  if (used.has(replayKey)) die("Replay detected (nonce already used)");

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (expiry < now) die("Expired");

  const h = intentHash({ card, merchant, token: tokenAddr, amount, nonce, expiry });
  const recovered = ethers.recoverAddress(h, signature);

  if (recovered.toLowerCase() !== card.toLowerCase()) die("Invalid sig");
  console.log("Sig OK");

  if (!uid) die("Missing uid in JSON");
  const pk = uidToPrivateKey(uid);
  const sk = new SigningKey(pk);
  const derivedAddr = computeAddress(sk.publicKey);

  if (derivedAddr.toLowerCase() !== card.toLowerCase()) die("UID-derived mismatch");
  console.log("UID->ADDR OK");

  const token = new ethers.Contract(tokenAddr, erc20Abi, provider);
  const sym = await token.symbol().catch(() => "TOKEN");
  const dec = await token.decimals().catch(() => 18);

  const bal = await token.balanceOf(card);
  console.log(`BAL: ${ethers.formatUnits(bal, dec)} ${sym}`);
  if (bal < amount) die("Insufficient balance");

  const ethBal = await provider.getBalance(card);
  console.log(`Card ETH: ${ethers.formatEther(ethBal)} ETH`);
  if (ethBal === 0n) die("No gas");

  console.log(`Settling ${ethers.formatUnits(amount, dec)} ${sym} -> ${merchant}`);
  const cardWallet = new ethers.Wallet(pk, provider);
  const withSigner = token.connect(cardWallet);

  const tx = await withSigner.transfer(merchant, amount);
  console.log("TX:", tx.hash);
  await tx.wait();
  console.log("Settled");

  used.add(replayKey);
  saveNonceDB(used);
  console.log("Nonce marked used:", replayKey);
})();
