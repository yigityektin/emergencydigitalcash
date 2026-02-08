import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { ethers } from "ethers";
import { keccak256, toUtf8Bytes, SigningKey, computeAddress } from "ethers";

const PORT = process.argv[2] || "/dev/cu.usbserial-A5XK3RJT";
const BAUD = 115200;

const MASTER_SECRET = process.env.MASTER_SECRET;
if (!MASTER_SECRET) {
  console.log("Incomplete env: MASTER_SECRET");
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
  const material = ethers.concat([secretBytes(), uidBytes]);
  return keccak256(material);
}

const port = new SerialPort({ path: PORT, baudRate: BAUD });
const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

parser.on("data", (line) => {
  line = line.trim();
  if (!line.startsWith("UID_RAW:")) return;

  const uid = line.slice("UID_RAW:".length).trim();
  const pk = uidToPrivateKey(uid);

  const sk = new SigningKey(pk);
  const addr = computeAddress(sk.publicKey);

  console.log(`\nUID: ${uid}`);
  console.log(`PK : ${pk}`);
  console.log(`ADR: ${addr}\n`);
});

port.on("open", () => {
  console.log(`Listening on ${PORT} @ ${BAUD}`);
});
