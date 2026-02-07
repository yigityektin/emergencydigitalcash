import fs from "node:fs";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { ethers, keccak256, toUtf8Bytes, SigningKey, computeAddress } from "ethers";

const PORT = process.argv[2] || "/dev/cu.usbserial-A5XK3RJT";
const BAUD = parseInt(process.env.SERIAL_BAUD || "115200", 10);

const MASTER_PK = process.env.MASTER_PK;
if (!MASTER_PK) {
  console.error("Err: MASTER_PK env missing.");
  process.exit(1);
}

const REVOKE_FILE = process.env.REVOKE_FILE || "./revoked_uids.json";

const RPC = process.env.RPC_URL;
const provider = RPC ? new ethers.JsonRpcProvider(RPC) : null;
const ENS_SUFFIX = process.env.ENS_SUFFIX || "";

function loadRevokedSet() {
  try {
    const j = JSON.parse(fs.readFileSync(REVOKE_FILE, "utf8"));
    return new Set((j.revoked || []).map((x) => String(x).toUpperCase()));
  } catch {
    return new Set();
  }
}

function isRevoked(uidHex) {
  return loadRevokedSet().has(uidHex.toUpperCase());
}

function deriveCardPK(uidHex) {
  // master -> uid -> child pk
  return keccak256(toUtf8Bytes(`EmergencyCash:v1:${MASTER_PK}:${uidHex.toLowerCase()}`));
}

function uidToEnsLabel(uidHex) {
  return uidHex.toLowerCase();
}

async function maybeResolveEnsName(addr, uid) {
  if (ENS_SUFFIX) return `${uidToEnsLabel(uid)}${ENS_SUFFIX}`;
  if (!provider) return null;

  try {
    const name = await provider.lookupAddress(addr);
    return name || null;
  } catch {
    return null;
  }
}

const port = new SerialPort({ path: PORT, baudRate: BAUD });
const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

parser.on("data", async (line) => {
  line = line.trim();
  if (!line.startsWith("UID_RAW:")) return;

  const uid = line.slice("UID_RAW:".length).trim();

  if (isRevoked(uid)) {
    console.log(`\nUID: ${uid}`);
    console.log("Revoked Card\n");
    return;
  }

  const pk = deriveCardPK(uid);
  const sk = new SigningKey(pk);
  const addr = computeAddress(sk.publicKey);

  const ens = await maybeResolveEnsName(addr, uid);

  console.log(`\nUID: ${uid}`);
  if (ens) console.log(`ENS: ${ens}`);
  console.log(`PK : ${pk}`);
  console.log(`ADR: ${addr}\n`);
});

port.on("open", () => {
  console.log(`Listening on ${PORT} @ ${BAUD}`);
  if (RPC) console.log("ENS: enabled (RPC_URL set)");
  if (ENS_SUFFIX) console.log(`ENS_SUFFIX: ${ENS_SUFFIX}`);
});
