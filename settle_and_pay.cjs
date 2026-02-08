const { ethers } = require("ethers");
const { keccak256, toUtf8Bytes, SigningKey, computeAddress } = require("ethers");

const RPC = process.env.RPC_URL;
const MASTER_SECRET = process.env.MASTER_SECRET;
const DECIMALS = Number(process.env.DECIMALS || 6);

if (!RPC || !MASTER_SECRET) {
  console.log("Missing env: RPC_URL, MASTER_SECRET (and optional DECIMALS=6)");
  process.exit(1);
}

function die(msg) {
  console.log(msg);
  process.exit(1);
}

function secretBytes() {
  if (MASTER_SECRET.startsWith("0x") && MASTER_SECRET.length === 66) {
    return ethers.getBytes(MASTER_SECRET);
  }
  return toUtf8Bytes(MASTER_SECRET);
}

function uidToPrivateKey(uidHex) {
  const uidBytes = toUtf8Bytes(uidHex.toLowerCase());
  return keccak256(ethers.concat([secretBytes(), uidBytes]));
}

function intentHash(intent) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "address", "uint256", "uint256", "uint256"],
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
  if (!raw) die("Usage: node settle_and_pay.cjs '<INTENT_JSON>'");

  let intent;
  try {
    intent = JSON.parse(raw);
  } catch {
    die("Bad JSON");
  }

  const provider = new ethers.JsonRpcProvider(RPC);

  const uid = String(intent.uid || "").trim().toUpperCase();
  const card = ethers.getAddress(intent.card);
  const merchant = ethers.getAddress(intent.merchant);
  const tokenAddr = ethers.getAddress(intent.token);

  const amount = BigInt(intent.amount);
  const nonce = BigInt(intent.nonce);
  const expiry = BigInt(intent.expiry);
  const signature = String(intent.signature);

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (expiry < now) die("Expired");

  const h = intentHash({ card, merchant, token: tokenAddr, amount, nonce, expiry });
  const recovered = ethers.recoverAddress(h, signature);

  console.log("Hash:", h);
  console.log("Recovered:", recovered);
  console.log("Expected:", card);

  if (recovered.toLowerCase() !== card.toLowerCase()) die("Invalid Sig");

  console.log("Sig OK");

  if (!uid) die("Missing uid field in JSON");
  const pk = uidToPrivateKey(uid);
  const sk = new SigningKey(pk);
  const derivedAddr = computeAddress(sk.publicKey);

  if (derivedAddr.toLowerCase() !== card.toLowerCase()) {
    die(`UID-derived address mismatch\nDerived: ${derivedAddr}\nCard   : ${card}`);
  }
  console.log("UID->ADDR matches card");

  const token = new ethers.Contract(tokenAddr, erc20Abi, provider);
  const sym = await token.symbol().catch(() => "TOKEN");
  const dec = await token.decimals().catch(() => DECIMALS);

  const bal = await token.balanceOf(card);
  console.log(`BAL: ${ethers.formatUnits(bal, dec)} ${sym}`);
  const humanAmt = ethers.formatUnits(amount, dec);

  if (bal < amount) die(`Insufficient balance (need ${humanAmt} ${sym})`);

  const cardWallet = new ethers.Wallet(pk, provider);

  const ethBal = await provider.getBalance(card);
  console.log(`Card ETH: ${ethers.formatEther(ethBal)} ETH`);
  if (ethBal === 0n) {
    console.log("Card has 0 ETH. Fund it with a little Sepolia ETH to pay gas, then retry.");
    die("No gas");
  }

  console.log(`Settling: sending ${humanAmt} ${sym} to merchant ${merchant}`);
  const withSigner = token.connect(cardWallet);
  const tx = await withSigner.transfer(merchant, amount);
  console.log("TX:", tx.hash);
  console.log("waiting confirm");
  await tx.wait();
  console.log("Settled/Paid");
})();
