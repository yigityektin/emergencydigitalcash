const { ethers } = require("ethers");
const { keccak256, toUtf8Bytes, SigningKey, computeAddress } = require("ethers");

const uid = (process.argv[2] || "").trim();
const merchant = (process.argv[3] || "").trim();
const amountHuman = (process.argv[4] || "1.0").trim();
const nonce = BigInt(process.argv[5] || "1");
const expirySecFromNow = Number(process.argv[6] || "3600");

const RPC = process.env.RPC_URL;
const TOKEN = process.env.TOKEN_ADDR;
const MASTER_SECRET = process.env.MASTER_SECRET;
const DECIMALS = Number(process.env.DECIMALS || 6);

if (!uid || !merchant) {
  console.log("Usage:");
  console.log("node pos_intent_sign.cjs <UID_HEX> <MERCHANT_ADDR> [AMOUNT=1.0] [NONCE=1] [EXPIRY_SEC=3600]");
  process.exit(1);
}

if (!RPC || !TOKEN || !MASTER_SECRET) {
  console.log("Missing env: RPC_URL, TOKEN_ADDR, MASTER_SECRET");
  process.exit(1);
}

if (!ethers.isAddress(merchant)) {
  console.log("Bad merchant address");
  process.exit(1);
}

// UID -> PK
function secretBytes() {
  if (MASTER_SECRET.startsWith("0x") && MASTER_SECRET.length === 66) {
    return ethers.getBytes(MASTER_SECRET);
  }
  return toUtf8Bytes(MASTER_SECRET);
}

function uidToPrivateKey(uidHex) {
  const uidBytes = toUtf8Bytes(uidHex.toLowerCase());
  const material = ethers.concat([secretBytes(), uidBytes]);
  return keccak256(material);
}

// ====== Intent hash (EIP-191 personal_sign style) ======
// We'll sign a typed payload hash so it is easy to verify later.
function intentHash(intent) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address","address","address","uint256","uint256","uint256"],
      [intent.card, intent.merchant, intent.token, intent.amount, intent.nonce, intent.expiry]
    )
  );
}

(async () => {
  const pk = uidToPrivateKey(uid);
  const sk = new SigningKey(pk);
  const cardAddr = computeAddress(sk.publicKey);

  const now = Math.floor(Date.now() / 1000);
  const expiry = BigInt(now + expirySecFromNow);

  const amount = ethers.parseUnits(amountHuman, DECIMALS);

  const intent = {
    card: cardAddr,
    merchant,
    token: TOKEN,
    amount,
    nonce,
    expiry
  };

  const h = intentHash(intent);

  // signDigest = signingKey.sign(h) gives {r,s,v}
  const sig = sk.sign(h);
  const signature = ethers.Signature.from(sig).serialized;

  console.log("Offline Payment Intent");
  console.log("UID:", uid.toUpperCase());
  console.log("CARD:", cardAddr);
  console.log("MERCHANT:", merchant);
  console.log("TOKEN:", TOKEN);
  console.log("AMOUNT:", amount.toString(), `(=${amountHuman})`);
  console.log("NONCE:", nonce.toString());
  console.log("EXPIRY:", expiry.toString(), `(unix, now+${expirySecFromNow}s)`);
  console.log("HASH:", h);
  console.log("SIG:", signature);
  console.log("");

  const out = {
    uid: uid.toUpperCase(),
    card: cardAddr,
    merchant,
    token: TOKEN,
    amount: amount.toString(),
    nonce: nonce.toString(),
    expiry: expiry.toString(),
    hash: h,
    signature
  };
  console.log("INTENT_JSON:", JSON.stringify(out));
})();
