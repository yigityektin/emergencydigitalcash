const solc = require("solc");
const { ethers } = require("ethers");
const RPC = process.env.RPC_URL;
const MASTER_PK = process.env.MASTER_PK;

if (!RPC || !MASTER_PK) {
  console.log("Missing env: RPC_URL, MASTER_PK");
  process.exit(1);
}

const source = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
  function transfer(address to, uint256 amount) external returns (bool);
  function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract TreasuryPayout {
  address public owner;

  event Paid(address indexed token, address indexed to, uint256 amount);
  event BatchPaid(address indexed token, uint256 count);

  modifier onlyOwner() {
    require(msg.sender == owner, "NOT_OWNER");
    _;
  }

  constructor(address _owner) {
    owner = _owner;
  }

  function setOwner(address _owner) external onlyOwner {
    owner = _owner;
  }

  function payFromTreasury(address token, address to, uint256 amount) external onlyOwner {
    require(IERC20(token).transfer(to, amount), "TRANSFER_FAIL");
    emit Paid(token, to, amount);
  }

  function batchPayFromTreasury(address token, address[] calldata recipients, uint256[] calldata amounts) external onlyOwner {
    require(recipients.length == amounts.length, "LEN_MISMATCH");
    for (uint256 i = 0; i < recipients.length; i++) {
      require(IERC20(token).transfer(recipients[i], amounts[i]), "TRANSFER_FAIL");
      emit Paid(token, recipients[i], amounts[i]);
    }
    emit BatchPaid(token, recipients.length);
  }
}
`;

function compile() {
  const input = {
    language: "Solidity",
    sources: {
      "TreasuryPayout.sol": { content: source },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object"] },
      },
    },
  };

  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  if (out.errors) {
    const fatal = out.errors.filter((e) => e.severity === "error");
    out.errors.forEach((e) => console.log(e.formattedMessage));
    if (fatal.length) process.exit(1);
  }

  const c = out.contracts["TreasuryPayout.sol"]["TreasuryPayout"];
  return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
}

(async () => {
  const { abi, bytecode } = compile();

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(MASTER_PK, provider);

  console.log("Deploying TreasuryPayout");
  console.log("Deployer:", await wallet.getAddress());

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(await wallet.getAddress());
  console.log("TX:", contract.deploymentTransaction().hash);

  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log("TreasuryPayout deployed at:", addr);
})();
