const { ethers } = require("ethers");
const RPC = process.env.RPC_URL;
const MASTER_PK = process.env.MASTER_PK;
const TOKEN = process.env.TOKEN_ADDR;
const DECIMALS = Number(process.env.DECIMALS || 6);
const TREASURY = process.env.TREASURY_ADDR;
const AMOUNT = process.env.FUND_AMOUNT || "5.0";

if (!RPC || !MASTER_PK || !TOKEN || !TREASURY) {
  console.log("Missing env: RPC_URL, MASTER_PK, TOKEN_ADDR, TREASURY_ADDR");
  process.exit(1);
}

const erc20Abi = [
  "function transfer(address to, uint256 value) returns (bool)",
];

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(MASTER_PK, provider);
  const token = new ethers.Contract(TOKEN, erc20Abi, wallet);

  const value = ethers.parseUnits(AMOUNT, DECIMALS);

  console.log("Funding treasury...");
  console.log("From:", await wallet.getAddress());
  console.log("To:", TREASURY);
  console.log("Amount:", AMOUNT);

  const tx = await token.transfer(TREASURY, value);
  console.log("TX:", tx.hash);
  await tx.wait();
  console.log("Treasury funded");
})();
