const { ethers } = require("ethers");
const addressBook = require("@bgd-labs/aave-address-book");

const RPC_URL = process.env.RPC_URL;
const MASTER_PK = process.env.MASTER_PK;
const MASTER_SECRET = process.env.MASTER_SECRET;
const UID = process.argv[2];
const BORROW_USDC = process.env.BORROW_USDC || "10";
const SUPPLY_WETH = process.env.SUPPLY_WETH || "0.02";

if (!RPC_URL || !MASTER_PK || !MASTER_SECRET || !UID) {
  console.log("Usage:");
  console.log("RPC_URL=... MASTER_PK=... MASTER_SECRET=... node arc_borrow_to_card.cjs <UID_HEX>");
  console.log("Optional: BORROW_USDC=10 SUPPLY_WETH=0.02");
  process.exit(1);
}

function secretBytes() {
  if (MASTER_SECRET.startsWith("0x") && MASTER_SECRET.length === 66) return ethers.getBytes(MASTER_SECRET);
  return ethers.toUtf8Bytes(MASTER_SECRET);
}

function uidToPrivateKey(uidHex) {
  const uidBytes = ethers.toUtf8Bytes(uidHex.toLowerCase());
  const material = ethers.concat([secretBytes(), uidBytes]);
  return ethers.keccak256(material);
}

function uidToCardAddress(uidHex) {
  const pk = uidToPrivateKey(uidHex);
  const sk = new ethers.SigningKey(pk);
  return ethers.computeAddress(sk.publicKey);
}

const wethAbi = [
  "function deposit() payable",
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const erc20Abi = [
  "function approve(address spender, uint256 value) returns (bool)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

const poolAbi = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase,uint256 totalDebtBase,uint256 availableBorrowsBase,uint256 currentLiquidationThreshold,uint256 ltv,uint256 healthFactor)"
];

function pickSepoliaMarket(book) {
  if (book.AaveV3Sepolia) return book.AaveV3Sepolia;
  console.log("Could not find addressBook.AaveV3Sepolia.");
  console.log("Available exports:", Object.keys(book));
  process.exit(1);
}

function getAssetAddr(market, symbolHint) {
  const k1 = `${symbolHint}_UNDERLYING`;
  if (market[k1] && ethers.isAddress(market[k1])) return market[k1];

  if (market.ASSETS && market.ASSETS[symbolHint] && market.ASSETS[symbolHint].UNDERLYING) {
    const a = market.ASSETS[symbolHint].UNDERLYING;
    if (ethers.isAddress(a)) return a;
  }

  if (market[symbolHint] && ethers.isAddress(market[symbolHint])) return market[symbolHint];

  console.log(`Could not locate ${symbolHint} address in AaveV3Sepolia export.`);
  console.log("Tip: run `node -e \"const b=require('@bgd-labs/aave-address-book'); console.log(Object.keys(b.AaveV3Sepolia));\"`");
  process.exit(1);
}

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const master = new ethers.Wallet(MASTER_PK, provider);

  const market = pickSepoliaMarket(addressBook);

  const POOL = market.POOL;
  if (!POOL || !ethers.isAddress(POOL)) {
    console.log("Could not find POOL address in AaveV3Sepolia export.");
    console.log("Keys:", Object.keys(market));
    process.exit(1);
  }

  const WETH = getAssetAddr(market, "WETH");
  const USDC = getAssetAddr(market, "USDC");

  const cardAddr = uidToCardAddress(UID);

  console.log("ARC/Aave Borrow -> Card Topup (Sepolia)");
  console.log("Master:", await master.getAddress());
  console.log("Card:", cardAddr);
  console.log("POOL:", POOL);
  console.log("WETH:", WETH);
  console.log("USDC:", USDC);

  const pool = new ethers.Contract(POOL, poolAbi, master);
  const weth = new ethers.Contract(WETH, wethAbi, master);
  const usdc = new ethers.Contract(USDC, erc20Abi, master);

  const usdcDec = await usdc.decimals().catch(() => 6);
  const usdcSym = await usdc.symbol().catch(() => "USDC");

  const supplyWethWei = ethers.parseEther(String(SUPPLY_WETH));
  console.log(`\n[1] Wrap ETH -> WETH: ${SUPPLY_WETH} ETH`);
  const txWrap = await weth.deposit({ value: supplyWethWei });
  console.log("TX wrap:", txWrap.hash);
  await txWrap.wait();

  console.log("\n[2] Approve + Supply WETH as collateral");
  const txAppr = await weth.approve(POOL, supplyWethWei);
  console.log("TX approve:", txAppr.hash);
  await txAppr.wait();

  const txSupply = await pool.supply(WETH, supplyWethWei, await master.getAddress(), 0);
  console.log("TX supply:", txSupply.hash);
  await txSupply.wait();

  const borrowAmt = ethers.parseUnits(String(BORROW_USDC), usdcDec);
  console.log(`\n[3] Borrow ${BORROW_USDC} ${usdcSym}`);
  const txBorrow = await pool.borrow(USDC, borrowAmt, 2, 0, await master.getAddress());
  console.log("TX borrow:", txBorrow.hash);
  await txBorrow.wait();

  console.log("\n[4] Transfer USDC -> card");
  const txTopup = await usdc.transfer(cardAddr, borrowAmt);
  console.log("TX topup:", txTopup.hash);
  await txTopup.wait();

  const balCard = await usdc.balanceOf(cardAddr);
  console.log(`\nCard balance: ${ethers.formatUnits(balCard, usdcDec)} ${usdcSym}`);

  const [ , , , , , hf] = await pool.getUserAccountData(await master.getAddress());
  console.log("Master healthFactor:", hf.toString());
  console.log("Done.");
})().catch((e) => {
  console.error("Err:", e?.shortMessage || e?.message || e);
  process.exit(1);
});
