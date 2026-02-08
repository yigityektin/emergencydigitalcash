# Emergency Cash / Emergency Digital Cash
Offline-first crypto payments with NFC, ENS identity, and USDC on Arc.

    ![Hardware Photo](/docs/images/hackmoney7.jpeg "Hardware Photo")

## Problem:
In emergencies such as earthquakes, wars, or disasters, internet access and
    traditional banking systems can fail. Existing crypto wallets require connectivity,
    while physical cash lacks programmability, auditability, and recovery guarantees.
  ### Main points:
    - Internet dependency
    - No offline crypto payments
    - Physical cash is not programmable or recoverable
    - Emergency funds are hard to distribute transparently

## Solution:
    Emergency Digital Cash turns simple NFC cards into cryptographically secure,
    ENS-linked smart wallets that can hold and spend USDC, authorize payments offline,
    and settle onchain when connectivity is restored.
  ### Key Ideas:
    - NFC card as stateless crypto wallet
    - ENS used as decentralized identity layer
    - USDC-backed balances on Arc
    - Offline authorization with online settlement

## Architecture:
  ### Flow:
    - NFC card scanned by STM32-based reader
    - UID deterministically derives Ethereum private key
    - Address mapped to ENS subname
    - USDC balance lives on Arc
    - Payment signed offline
    - Settlement executed onchain later
  ### Parts:
    - NFC Card (UID)
    - STM32 + RC522 Reader
    - Node.js
    - ENS (NameWrapper + Resolver)
    - Arc (USDC, treasury, payouts)

### Hardware:
  NFC Reader: RC522
  Microcontroller: STM32 (Blue Pill)
  Power: 3.3V
  Connectivity:
    - SPI (RC522)
    - UART (to backend)

    ![Schematic](/docs/images/schematic.jpeg "Schematic")

### Wallet Model:
  Stateless deterministic wallet.
  Key Derivation:
    method: keccak256
    inputs:
      - master_secret
      - uid
  Properties:
    - No key storage on card
    - Recoverable
    - Revocable
    - Replaceable

### Identity:
  By ENS.
  Usage:
    - One ENS subname per card
    - Address resolution
    - Text records for metadata
  Stored Records:
    - uid
    - token
    - chain
    - type
    - optional_app_url
  Example:
    ens_name: ca0f79b4.emergencycash-try.eth

### Payments:
  USDC on Arc or Sepolia.
  Modes:
    Online:
        Card is scanned, balance checked, and USDC transferred immediately onchain.
    Offline:
        Card signs a payment intent offline using EIP-191 signatures.
        Merchant later submits the intent for settlement.
  Intent Fields:
    - card_address
    - merchant_address
    - token
    - amount
    - nonce
    - expiry
    - signature

### DeFi:
  Collateral Flow:
    - ETH wrapped to WETH
    - WETH supplied as collateral
    - USDC borrowed
    - USDC transferred to card wallet
  Purpose:
    - Credit-backed emergency funds
    - Capital-efficient preparation before disasters

### Arc Integration:
  As an execution and settlement layer.
  Used Features:
    - Native USDC transfers
    - Treasury flows
    - Batch payouts

## Security:
  Mechanisms:
    - Deterministic key derivation
    - Nonce-based replay protection
    - Expiry-limited payment intents
    - Revocation list for lost cards
  Recovery:
    - Re-derive wallet from UID
    - Sweep remaining funds if revoked

## Scripts:
  pos_pay: Online NFC payment and ENS resolution
  pos_intent_sign: Offline payment intent signing
  settle_and_pay: Verify intent and settle payment onchain
  arc_borrow: Borrow USDC against collateral and top up card
  arc_batch: Treasury batch payouts on Arc

## Use cases:
  - Disaster relief
  - Emergency kits
  - Aid distribution
  - Offline retail payments

## Tech Stack:
  Blockchain: Arc and Ethereum Sepolia
  Identity: ENS
  Payments: USDC
  Backend: Node.js
  Crypto Library: ethers.js
  Hardware: STM32 + RC522 + FTDI
  Signatures: EIP-191

## Disclaimer:
  - Hackathon prototype
  - Not audited
  - Not production-ready
  - Do not use with real funds

## Status:
  mvp: true
  ens_integrated: true
  arc_integrated: true
  offline_payments: true