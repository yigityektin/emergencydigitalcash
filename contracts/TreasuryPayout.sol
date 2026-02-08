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
