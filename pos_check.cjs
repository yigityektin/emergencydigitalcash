const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const { ethers } = require("ethers");
const { keccak256, toUtf8Bytes, SigningKey, computeAddress } = require("ethers");

const PORT = process.argv[2] || "/dev/cu.usbserial-A5XK3RJT";
const BAUD = 115200;

const RPC = process.env.RPC_URL;
const USDC = process.env.TOKEN_ADDR;
const PRICE = "1.0";
const DECIMALS = 6;

if (!RPC || !USDC) {
  console.log("Incomplete env:");
  console.log("RPC_URL=... TOKEN_ADDR=... PRICE=1.0 node pos_check.cjs <SERIAL_PORT>");
  process.exit(1);
}

const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

const provider = new ethers.JsonRpcProvider(RPC);
const token = new ethers.Contract(USDC, erc20Abi, provider);

function uidToPrivateKey(uidHex) {
  return keccak256(toUtf8Bytes(uidHex.toLowerCase()));
}

async function check(addr) {
  const bal = await token.balanceOf(addr);
  const need = ethers.parseUnits(PRICE, DECIMALS);
  const ok = bal >= need;

  const human = ethers.formatUnits(bal, DECIMALS);
  console.log(`ADR: ${addr}`);
  console.log(`BAL: ${human} USDC`);
  console.log(ok ? `Payment ok (price=${PRICE})` : `Insufficient (price=${PRICE})`);
  console.log("----");
}

(async () => {
  const sym = await token.symbol().catch(() => "TOKEN");
  const dec = await token.decimals().catch(() => DECIMALS);
  if (dec !== DECIMALS) console.log(`Not: decimals=${dec} (beklenen ${DECIMALS})`);

  console.log(`POS listening on ${PORT} @ ${BAUD}`);
  console.log(`Token: ${sym} ${USDC} | Price: ${PRICE}`);
  console.log("Scan the card\n");

  const port = new SerialPort({ path: PORT, baudRate: BAUD });
  const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

  parser.on("data", async (line) => {
    line = line.trim();
    if (!line.startsWith("UID_RAW:")) return;

    const uid = line.slice("UID_RAW:".length).trim();
    const pk = uidToPrivateKey(uid);
    const sk = new SigningKey(pk);
    const addr = computeAddress(sk.publicKey);

    console.log(`UID: ${uid}`);
    await check(addr);
  });
})();