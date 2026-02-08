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
const PARENT_NAME = process.env.PARENT_NAME || "emergencycash-try.eth";
const APP_URL = process.env.APP_URL || "https://github.com/you/emergency-digital-cash";
const REVOKE_FILE = process.env.REVOKE_FILE || "./revoked_uids.json";




const ENS_REGISTRY = process.env.ENS_REGISTRY || "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const NAMEWRAPPER  = process.env.ENS_NAMEWRAPPER || "0x0635513f179D50A207757E05759CbD106d7dFcE8";
const PUBLIC_RESOLVER = process.env.ENS_PUBLIC_RESOLVER || "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";
const REVERSE_REGISTRAR = process.env.ENS_REVERSE_REGISTRAR || "0xa58E81fe9b61B5c3fE2AFD33CF304c454AbFc7Cb";

if (!RPC || !TOKEN || !MERCHANT) {
  console.log("Incomplete env:");
  console.log("RPC_URL=... TOKEN_ADDR=... MERCHANT_ADDR=... MASTER_PK=... PRICE=1.0 DECIMALS=6 node pos_pay.cjs <SERIAL_PORT>");
  process.exit(1);
}
if (!MASTER_PK) {
  console.log("Incomplete env: MASTER_PK (needed for ENS subname registration)");
  process.exit(1);
}

const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 value) returns (bool)"
];

const ensRegistryAbi = [
  "function owner(bytes32 node) view returns (address)",
];

const nameWrapperAbi = [
  "function setSubnodeRecord(bytes32 parentNode, string label, address owner, address resolver, uint64 ttl, uint32 fuses, uint64 expiry)",
  "function getData(uint256 id) view returns (address owner, uint32 fuses, uint64 expiry)"
];

const publicResolverAbi = [
  "function setAddr(bytes32 node, address a)",
  "function addr(bytes32 node) view returns (address)",
  "function setText(bytes32 node, string key, string value)",
  "function text(bytes32 node, string key) view returns (string)"
];

const reverseRegistrarAbi = [
  "function setName(string name) returns (bytes32)"
];

const provider = new ethers.JsonRpcProvider(RPC);
const tokenRO = new ethers.Contract(TOKEN, erc20Abi, provider);

const masterWallet = new ethers.Wallet(MASTER_PK, provider);
const ens = new ethers.Contract(ENS_REGISTRY, ensRegistryAbi, provider);
const wrapper = new ethers.Contract(NAMEWRAPPER, nameWrapperAbi, masterWallet);
const resolver = new ethers.Contract(PUBLIC_RESOLVER, publicResolverAbi, masterWallet);

const ensCache = new Set();
const reverseCache = new Set();

function ensureRevokeFile() {
  try {
    if (!fs.existsSync(REVOKE_FILE)) {
      fs.writeFileSync(REVOKE_FILE, JSON.stringify({ revoked: [] }, null, 2));
    }
  } catch {}
}

function loadRevokedSet() {
  try {
    const j = JSON.parse(fs.readFileSync(REVOKE_FILE, "utf8"));
    return new Set((j.revoked || []).map(x => String(x).toUpperCase()));
  } catch {
    return new Set();
  }
}

function isRevoked(uidHex) {
  return loadRevokedSet().has(uidHex.toUpperCase());
}

// UID -> PK/ADDR
function uidToPrivateKey(uidHex) {
  return keccak256(toUtf8Bytes(uidHex.toLowerCase()));
}

function labelFromUid(uidHex) {
  return uidHex.toLowerCase();
}

function ensNameForUid(uidHex) {
  return `${labelFromUid(uidHex)}.${PARENT_NAME}`;
}

async function setTextIfDifferent(node, key, value) {
  try {
    const cur = await resolver.text(node, key);
    if (String(cur) === String(value)) return false;
  } catch {
  }
  const tx = await resolver.setText(node, key, value);
  await tx.wait();
  return true;
}

async function ensureEnsSubname(uid, cardAddr) {
  const label = labelFromUid(uid);
  const subname = ensNameForUid(uid);
  const parentNode = ethers.namehash(PARENT_NAME);
  const node = ethers.namehash(subname);

  const parentData = await wrapper.getData(BigInt(parentNode)).catch(() => null);
  if (!parentData || parentData.expiry === 0n) {
    throw new Error(`Parent not wrapped: ${PARENT_NAME}`);
  }

  if (!ensCache.has(label)) {
    const currentOwner = await ens.owner(node);
    if (currentOwner === ethers.ZeroAddress) {
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
    ensCache.add(label);
  }

  const currentAddr = await resolver.addr(node).catch(() => ethers.ZeroAddress);
  if (String(currentAddr).toLowerCase() !== cardAddr.toLowerCase()) {
    console.log(`ENS: setAddr ${subname} -> ${cardAddr}`);
    const tx2 = await resolver.setAddr(node, cardAddr);
    console.log("Resolver TX:", tx2.hash);
    await tx2.wait();
  }

  let wroteAny = false;
  wroteAny = (await setTextIfDifferent(node, "uid", uid.toUpperCase())) || wroteAny;
  wroteAny = (await setTextIfDifferent(node, "type", "emergency-cash")) || wroteAny;
  wroteAny = (await setTextIfDifferent(node, "token", "USDC")) || wroteAny;
  wroteAny = (await setTextIfDifferent(node, "chain", "sepolia")) || wroteAny;

  if (APP_URL) {
    wroteAny = (await setTextIfDifferent(node, "url", APP_URL)) || wroteAny;
  }

  if (wroteAny) console.log(`ENS: records updated for ${subname}`);
  else console.log(`ENS: records already OK for ${subname}`);

  return { subname, node };
}

async function ensureReverseRecord(cardWallet, ensName) {
  const cardAddr = await cardWallet.getAddress();
  if (reverseCache.has(cardAddr.toLowerCase())) return;

  const cur = await provider.lookupAddress(cardAddr).catch(() => null);
  if (cur && cur.toLowerCase() === ensName.toLowerCase()) {
    console.log(`Reverse: already OK (${cur})`);
    reverseCache.add(cardAddr.toLowerCase());
    return;
  }

  console.log(`Reverse: setting ${cardAddr} -> ${ensName}`);
  const rr = new ethers.Contract(REVERSE_REGISTRAR, reverseRegistrarAbi, cardWallet);
  const tx = await rr.setName(ensName);
  console.log("Reverse TX:", tx.hash);
  await tx.wait();

  console.log("Reverse: setName OK");
  reverseCache.add(cardAddr.toLowerCase());
}

async function pay(fromWallet) {
  const token = tokenRO.connect(fromWallet);
  const value = ethers.parseUnits(PRICE, DECIMALS);

  const addr = await fromWallet.getAddress();
  const bal = await tokenRO.balanceOf(addr);

  console.log(`BAL: ${ethers.formatUnits(bal, DECIMALS)} USDC`);
  if (bal < value) {
    console.log(`Insufficient (need ${PRICE} USDC)`);
    console.log("----");
    return;
  }

  console.log(`Sending ${PRICE} USDC to merchant ${MERCHANT} ...`);
  const tx = await token.transfer(MERCHANT, value);
  console.log("TX:", tx.hash);
  console.log("waiting confirm...");
  await tx.wait();
  console.log("Paid");
  console.log("----");
}

(async () => {
  ensureRevokeFile();

  const sym = await tokenRO.symbol().catch(() => "USDC");
  const dec = await tokenRO.decimals().catch(() => DECIMALS);

  console.log(`POS PAY listening on ${PORT} @ ${BAUD}`);
  console.log(`Token: ${sym} ${TOKEN} | Price: ${PRICE} | decimals=${dec}`);
  console.log(`Merchant: ${MERCHANT}`);
  console.log(`ENS parent: ${PARENT_NAME}`);
  console.log(`ENS NameWrapper: ${NAMEWRAPPER}`);
  console.log(`ENS PublicResolver: ${PUBLIC_RESOLVER}`);
  console.log(`ENS ReverseRegistrar: ${REVERSE_REGISTRAR}`);
  console.log(`Blocklist file: ${REVOKE_FILE}`);
  if (APP_URL) console.log(`ENS url: ${APP_URL}`);
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

    const ensName = ensNameForUid(uid);

    if (isRevoked(uid)) {
      console.log(`CARD: ${ensName}`);
      console.log(`UID : ${uid}`);
      console.log("Revoked Card");
      console.log("----");
      return;
    }

    busy = true;
    try {
      const pk = uidToPrivateKey(uid);
      const sk = new SigningKey(pk);
      const addr = computeAddress(sk.publicKey);

      console.log(`CARD: ${ensName}`);
      console.log(`UID : ${uid}`);
      console.log(`FROM: ${addr}`);

      await ensureEnsSubname(uid, addr);

      const cardWallet = new ethers.Wallet(pk, provider);
      await ensureReverseRecord(cardWallet, ensName);

      await pay(cardWallet);
    } catch (e) {
      console.error("Err:", e?.shortMessage || e?.message || e);
      console.log("----");
    } finally {
      setTimeout(() => (busy = false), 1200);
    }
  });
})();
