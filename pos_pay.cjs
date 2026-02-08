const fs = require("node:fs");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const { ethers } = require("ethers");
const { keccak256, toUtf8Bytes, SigningKey, computeAddress } = require("ethers");

const PORT = process.argv[2] || "/dev/cu.usbserial-A5XK3RJT";
const BAUD = parseInt(process.env.SERIAL_BAUD || "115200", 10);

const RPC = process.env.RPC_URL;
const TOKEN = process.env.TOKEN_ADDR;
const MERCHANT = process.env.MERCHANT_ADDR;
const PRICE = process.env.PRICE || "1.0";
const DECIMALS = Number(process.env.DECIMALS || 6);

const MASTER_PK = process.env.MASTER_PK;
const MASTER_SECRET = process.env.MASTER_SECRET;

const PARENT_NAME = process.env.PARENT_NAME || "emergencycash-try.eth";
const APP_URL = process.env.APP_URL || "";

const REVOKE_FILE = process.env.REVOKE_FILE || "./revoked_uids.json";
const SWEEP_TO_ADDR = process.env.SWEEP_TO_ADDR || MERCHANT;

const ENS_REGISTRY = process.env.ENS_REGISTRY || "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const NAMEWRAPPER = process.env.ENS_NAMEWRAPPER || "0x0635513f179D50A207757E05759CbD106d7dFcE8";
const PUBLIC_RESOLVER = process.env.ENS_PUBLIC_RESOLVER || "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";
const REVERSE_REGISTRAR = process.env.ENS_REVERSE_REGISTRAR || "0xa58E81fe9b61B5c3fE2AFD33CF304c454AbFc7Cb";

const ENS_USE_RUNTIME_RESOLVE = (process.env.ENS_USE_RUNTIME_RESOLVE || "1") === "1";
const ENS_REQUIRE_MATCH = (process.env.ENS_REQUIRE_MATCH || "1") === "1";
const ENABLE_REVERSE = (process.env.ENABLE_REVERSE || "0") === "1";

if (!RPC || !TOKEN || !MERCHANT) {
  console.log("Incomplete env:");
  console.log("RPC_URL=... TOKEN_ADDR=... MERCHANT_ADDR=... MASTER_PK=... MASTER_SECRET=...");
  process.exit(1);
}

if (!MASTER_PK) {
  console.log("Missing MASTER_PK (needed for ENS subname registration)");
  process.exit(1);
}

if (!MASTER_SECRET) {
  console.log("Missing MASTER_SECRET (needed for UID→PK derivation)");
  process.exit(1);
}

if (!ethers.isAddress(SWEEP_TO_ADDR)) {
  console.log("Invalid SWEEP_TO_ADDR");
  process.exit(1);
}

const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 value) returns (bool)",
];

const ensRegistryAbi = ["function owner(bytes32 node) view returns (address)"];

const nameWrapperAbi = [
  "function setSubnodeRecord(bytes32 parentNode, string label, address owner, address resolver, uint64 ttl, uint32 fuses, uint64 expiry)",
  "function getData(uint256 id) view returns (address owner, uint32 fuses, uint64 expiry)",
];

const publicResolverAbi = [
  "function setAddr(bytes32 node, address a)",
  "function addr(bytes32 node) view returns (address)",
  "function setText(bytes32 node, string key, string value)",
  "function text(bytes32 node, string key) view returns (string)",
];

const reverseRegistrarAbi = ["function setName(string name) returns (bytes32)"];

const provider = new ethers.JsonRpcProvider(RPC);
const tokenRO = new ethers.Contract(TOKEN, erc20Abi, provider);

const masterWallet = new ethers.Wallet(MASTER_PK, provider);
const ens = new ethers.Contract(ENS_REGISTRY, ensRegistryAbi, provider);
const wrapper = new ethers.Contract(NAMEWRAPPER, nameWrapperAbi, masterWallet);
const resolver = new ethers.Contract(
  PUBLIC_RESOLVER,
  publicResolverAbi,
  masterWallet
);

function ensureRevokeFile() {
  if (!fs.existsSync(REVOKE_FILE)) {
    fs.writeFileSync(REVOKE_FILE, JSON.stringify({ revoked: [] }, null, 2));
  }
}
function loadRevokedSet() {
  try {
    const j = JSON.parse(fs.readFileSync(REVOKE_FILE, "utf8"));
    return new Set((j.revoked || []).map((x) => String(x).toUpperCase()));
  } catch {
    return new Set();
  }
}
function isRevoked(uid) {
  return loadRevokedSet().has(uid.toUpperCase());
}

// UID -> PK derivation
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

function labelFromUid(uid) {
  return uid.toLowerCase();
}

function ensNameForUid(uid) {
  return `${labelFromUid(uid)}.${PARENT_NAME}`;
}

async function resolveEnsAddr(name) {
  try {
    const a = await provider.resolveName(name);
    return a && ethers.isAddress(a) ? a : null;
  } catch {
    return null;
  }
}

async function setTextIfDifferent(node, key, value) {
  try {
    const cur = await resolver.text(node, key);
    if (String(cur) === String(value)) return false;
  } catch {}
  const tx = await resolver.setText(node, key, value);
  await tx.wait();
  return true;
}

async function ensureEnsSubname(uid, cardAddr) {
  const label = labelFromUid(uid);
  const subname = ensNameForUid(uid);
  const parentNode = ethers.namehash(PARENT_NAME);
  const node = ethers.namehash(subname);

  const parentData = await wrapper.getData(BigInt(parentNode));
  if (!parentData || parentData.expiry === 0n) {
    throw new Error(`Parent not wrapped: ${PARENT_NAME}`);
  }

  const owner = await ens.owner(node);
  if (owner === ethers.ZeroAddress) {
    console.log(`ENS: creating ${subname}`);
    const tx1 = await wrapper.setSubnodeRecord(
      parentNode,
      label,
      await masterWallet.getAddress(),
      PUBLIC_RESOLVER,
      0,
      0,
      parentData.expiry
    );
    console.log("ENS TX:", tx1.hash);
    await tx1.wait();
  }

  const curAddr = await resolver.addr(node).catch(() => ethers.ZeroAddress);
  if (curAddr.toLowerCase() !== cardAddr.toLowerCase()) {
    console.log(`ENS: setAddr ${subname} -> ${cardAddr}`);
    const tx2 = await resolver.setAddr(node, cardAddr);
    console.log("Resolver TX:", tx2.hash);
    await tx2.wait();
  }

  await setTextIfDifferent(node, "uid", uid.toUpperCase());
  await setTextIfDifferent(node, "type", "emergency-cash");
  await setTextIfDifferent(node, "token", "USDC");
  await setTextIfDifferent(node, "chain", "sepolia");
  await setTextIfDifferent(node, "pos/token", TOKEN);
  await setTextIfDifferent(node, "pos/merchant", MERCHANT);
  await setTextIfDifferent(node, "pos/price", String(PRICE));
  await setTextIfDifferent(node, "pos/decimals", String(DECIMALS));
  if (APP_URL) await setTextIfDifferent(node, "url", APP_URL);

  return { subname, node };
}

async function ensureReverse(cardWallet, ensName) {
  if (!ENABLE_REVERSE) {
    console.log("Reverse: disabled");
    return;
  }
  const addr = await cardWallet.getAddress();
  const ethBal = await provider.getBalance(addr);
  const MIN = ethers.parseEther("0.00005");
  if (ethBal < MIN) {
    console.log("Reverse: Skip (no ETH for gas)");
    return;
  }
  const rr = new ethers.Contract(
    REVERSE_REGISTRAR,
    reverseRegistrarAbi,
    cardWallet
  );
  const tx = await rr.setName(ensName);
  console.log("Reverse TX:", tx.hash);
  await tx.wait();
}

async function pay(wallet) {
  const token = tokenRO.connect(wallet);
  const value = ethers.parseUnits(PRICE, DECIMALS);

  const addr = await wallet.getAddress();
  const bal = await tokenRO.balanceOf(addr);

  console.log(`BAL: ${ethers.formatUnits(bal, DECIMALS)} token`);
  if (bal < value) {
    console.log("Insufficient");
    return null;
  }

  console.log(`Sending ${PRICE} to merchant ${MERCHANT}`);
  const tx = await token.transfer(MERCHANT, value);
  console.log("TX:", tx.hash);
  await tx.wait();
  console.log("Paid");
  return tx.hash;
}

(async () => {
  ensureRevokeFile();

  const sym = await tokenRO.symbol().catch(() => "USDC");
  const dec = await tokenRO.decimals().catch(() => DECIMALS);

  console.log(`POS PAY listening on ${PORT} @ ${BAUD}`);
  console.log(`Token: ${sym} ${TOKEN} | Price: ${PRICE} | decimals=${dec}`);
  console.log(`Merchant: ${MERCHANT}`);
  console.log(`ENS parent: ${PARENT_NAME}`);
  console.log(`Blocklist file: ${REVOKE_FILE}`);
  console.log("Scan the card\n");

  const port = new SerialPort({ path: PORT, baudRate: BAUD });
  const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

  let busy = false;

  parser.on("data", async (line) => {
    line = line.trim();
    if (!line.startsWith("UID_RAW:")) return;
    if (busy) return;

    const uid = line.slice("UID_RAW:".length).trim();
    if (!uid) return;

    busy = true;
    try {
      const pk = uidToPrivateKey(uid);
      const sk = new SigningKey(pk);
      const addr = computeAddress(sk.publicKey);
      const ensName = ensNameForUid(uid);

      console.log(`CARD: ${ensName}`);
      console.log(`UID : ${uid}`);
      console.log(`FROM: ${addr}`);

      if (isRevoked(uid)) {
        console.log("Revoked (payment blocked)");
        return;
      }

      const { node } = await ensureEnsSubname(uid, addr);

      if (ENS_USE_RUNTIME_RESOLVE) {
        const resolved = await resolveEnsAddr(ensName);
        if (resolved) {
          console.log(`ENS -> ${resolved}`);
          if (
            ENS_REQUIRE_MATCH &&
            resolved.toLowerCase() !== addr.toLowerCase()
          ) {
            console.log("ENS mismatch (blocked)");
            return;
          }
        }
      }

      const wallet = new ethers.Wallet(pk, provider);
      await ensureReverse(wallet, ensName);

      const txHash = await pay(wallet);
      if (txHash) {
        await setTextIfDifferent(node, "pos/lastTx", txHash);
        await setTextIfDifferent(node, "pos/lastPaidAt", String(Date.now()));
      }
    } catch (e) {
      console.error("Err:", e?.shortMessage || e?.message || e);
    } finally {
      setTimeout(() => (busy = false), 1200);
    }
  });
})();
