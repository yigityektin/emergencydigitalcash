const { ethers } = require("ethers");

const RPC = process.env.RPC_URL;
const ADDR = process.argv[2]; 
const TOKEN = process.env.TOKEN_ADDR;
const DECIMALS = parseInt(process.env.DECIMALS || "18", 10);

if (!RPC || !ADDR || !TOKEN) {
  console.log("Usage:");
  console.log("RPC_URL=... TOKEN_ADDR=... DECIMALS=... node balance_check.cjs <CARD_ADDRESS>");
  process.exit(1);
}

const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const token = new ethers.Contract(TOKEN, erc20Abi, provider);

  let sym = "TOKEN";
  let dec = DECIMALS;
  try { sym = await token.symbol(); } catch {}
  try { dec = await token.decimals(); } catch {}

  const bal = await token.balanceOf(ADDR);
  const human = ethers.formatUnits(bal, dec);

  console.log(`Address : ${ADDR}`);
  console.log(`Token   : ${sym} (${TOKEN})`);
  console.log(`Balance : ${human}`);
})();