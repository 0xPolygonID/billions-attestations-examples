import { parseArgs } from "node:util";
import { Options } from "../src/utils";
import { ethers } from "ethers";
import { Wallet } from "ethers";
import { JsonRpcProvider } from "ethers";
import attestationRegistryAbi from "../src/abi/AttestationRegistry.json";

const options: Record<string, Options> = {
  id: {
    type: "string",
  },
};

// Check required env variables
const privateKey = process.env.PRIVATE_KEY as string;
const rpcUrl = process.env.BILLIONS_TESTNET_RPC_URL as string;
const attestationRegistryContractAddress = process.env
  .ATTESTATION_REGISTRY_CONTRACT_ADDRESS as string;
const chainId = process.env.CHAIN_ID as string;

function checkRequiredParams() {
  if (!privateKey) {
    throw new Error("PRIVATE_KEY is not defined in .env file");
  }
  if (!rpcUrl) {
    throw new Error("BILLIONS_TESTNET_RPC_URL is not defined in .env file");
  }
  if (!attestationRegistryContractAddress) {
    throw new Error(
      "ATTESTATION_REGISTRY_CONTRACT_ADDRESS is not defined in .env file"
    );
  }
  if (!chainId) {
    throw new Error("CHAIN_ID is not defined in .env file");
  }
}

async function main() {
  checkRequiredParams();

  // Initialize signer wallet
  const wallet = new Wallet(privateKey, new JsonRpcProvider(rpcUrl));

  let { id } = parseArgs({
    options,
    args: process.argv,
    allowPositionals: true,
  }).values;

  if (!id) {
    throw new Error("'id' for the attestation to revoke is required");
  }

  const attestationRegistry = new ethers.Contract(
    attestationRegistryContractAddress,
    attestationRegistryAbi,
    wallet
  );

  console.log(`🆔 Attestation Id: ${id}`);
  console.log(`📋 AttestationRegistry: ${attestationRegistry.target}`);

  // Revoke attestation
  console.log(`\n⏳ Revoking attestation...`);
  const tx = await attestationRegistry.revokeAttestation(id);

  console.log(`📝 Transaction submitted: ${tx.hash}`);
  const receipt = await tx.wait();

  console.log(`✅ Attestation revoked successfully!`);
  console.log(`⛽ Gas used: ${receipt?.gasUsed?.toString()}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
