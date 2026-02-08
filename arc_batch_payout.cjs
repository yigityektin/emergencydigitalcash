const { ethers } = require("ethers");
const RPC = process.env.RPC_URL;
const MASTER_PK = process.env.MASTER_PK;
const TOKEN = process.env.TOKEN_ADDR;
const DECIMALS = Number(process.env.DECIMALS || 6);
const TREASURY = process.env.TREASURY_ADDR;

if (!RPC || !MASTER_PK || !TOKEN || !TREASURY) {
  console.log("Missing env: RPC_URL, MASTER_PK, TOKEN_ADDR, TREASURY_ADDR");
  process.exit(1);
}

const abi = [
  "function batchPayFromTreasury(address token, address[] recipients, uint256[] amounts) external",
];

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(MASTER_PK, provider);

  const treasury = new ethers.Contract(TREASURY, abi, wallet);

  const recipients = [
    "0x000000000000000000000000000000000000dEaD",
    "0x0000000000000000000000000000000000000001",
    "0x0000000000000000000000000000000000000002",
  ];

  const amountsHuman = ["1.0", "2.0", "0.5"];
  const amounts = amountsHuman.map((x) => ethers.parseUnits(x, DECIMALS));

  console.log("Batch payout on Arc");
  console.log("Treasury:", TREASURY);
  console.log("Token:", TOKEN);
  console.log("From:", await wallet.getAddress());
  console.log("Recipients:", recipients);
  console.log("Amounts:", amountsHuman);

  const tx = await treasury.batchPayFromTreasury(TOKEN, recipients, amounts);
  console.log("TX:", tx.hash);
  console.log("waiting confirm");
  await tx.wait();
  console.log("Batch payout done");
})();

