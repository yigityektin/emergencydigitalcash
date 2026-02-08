# Emergency Cash / Emergency Digital Cash

**Offline-first crypto payments with NFC, ENS identity, and USDC on Arc.**

![Hardware Photo](/docs/images/hackmoney7.jpeg "Hardware Photo")

---

## Problem

In emergencies such as earthquakes, wars, or natural disasters, internet access and traditional banking systems can fail.

Existing crypto wallets require continuous connectivity, while physical cash lacks programmability, auditability, and recovery guarantees.

### Main problems

- Strong dependency on the internet
- No native offline crypto payments
- Physical cash is not programmable or recoverable
- Emergency funds are hard to distribute transparently

---

## Solution

**Emergency Digital Cash** turns simple NFC cards into cryptographically secure, ENS-linked smart wallets.

These cards can:
- Hold and spend USDC
- Authorize payments offline
- Settle transactions onchain once connectivity is restored

### Key ideas

- NFC card as a **stateless crypto wallet**
- ENS as a **decentralized identity layer**
- USDC balances on **Arc**
- Offline authorization with online settlement

---

## Architecture

### High-level flow

1. NFC card is scanned by an STM32-based reader  
2. Card UID deterministically derives an Ethereum private key  
3. Address is mapped to an ENS subname  
4. USDC balance lives on Arc  
5. Payment is signed offline  
6. Settlement happens onchain later  

### Components

- NFC Card (UID-based)
- STM32 + RC522 reader
- Node.js backend
- ENS (NameWrapper + Resolver)
- Arc (USDC, treasury, payouts)

---

## Hardware

- **NFC Reader:** RC522  
- **Microcontroller:** STM32 (Blue Pill)  
- **Power:** 3.3V  
- **Connectivity:**
  - SPI (RC522)
  - UART (to backend)

![Schematic](/docs/images/schematic.jpeg "Schematic")

---

## Wallet Model

The system uses a **stateless deterministic wallet** model.

### Key derivation

- **Method:** `keccak256`
- **Inputs:**
  - `master_secret`
  - `uid`

### Properties

- No private key storage on the card
- Wallets are recoverable
- Cards can be revoked
- Lost cards can be replaced safely

---

## Identity (ENS)

ENS is used as a decentralized identity layer.

### Usage

- One ENS subname per card
- Address resolution
- Metadata via ENS text records

### Stored records

- `uid`
- `token`
- `chain`
- `type`
- `optional_app_url`
