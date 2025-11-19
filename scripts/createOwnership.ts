import { parseArgs } from "node:util";
import { checkAuthenticationAuthV2, Options } from "../src/utils";
import { ethers } from "ethers";
import { Wallet } from "ethers";
import { JsonRpcProvider } from "ethers";

const options: Record<string, Options> = {
  recipientDid: {
    type: "string",
  },
  recipientId: {
    type: "string",
  },
  recipientAddress: {
    type: "string",
  },
};

// Check required env variables
const schemaId = process.env.OWNERSHIP_ATTESTATION_SCHEMA as string;
const privateKey = process.env.PRIVATE_KEY as string;
const rpcUrl = process.env.BILLIONS_TESTNET_RPC_URL as string;
const stateContractAddress = process.env.STATE_CONTRACT_ADDRESS as string;
const authVerifierContractAddress = process.env
  .AUTH_VERIFIER_CONTRACT_ADDRESS as string;
const attestationRegistryContractAddress = process.env
  .ATTESTATION_REGISTRY_CONTRACT_ADDRESS as string;
const schemaRegistryContractAddress = process.env
  .SCHEMA_REGISTRY_CONTRACT_ADDRESS as string;
const chainId = process.env.CHAIN_ID as string;
const rhsUrl = process.env.RHS_URL as string;
const circuitsPath = process.env.CIRCUITS_PATH as string;

function checkRequiredParams() {
  if (!privateKey) {
    throw new Error("PRIVATE_KEY is not defined in .env file");
  }
  if (!rpcUrl) {
    throw new Error("BILLIONS_TESTNET_RPC_URL is not defined in .env file");
  }
  if (!stateContractAddress) {
    throw new Error("STATE_CONTRACT_ADDRESS is not defined in .env file");
  }
  if (!authVerifierContractAddress) {
    throw new Error(
      "AUTH_VERIFIER_CONTRACT_ADDRESS is not defined in .env file"
    );
  }
  if (!attestationRegistryContractAddress) {
    throw new Error(
      "ATTESTATION_REGISTRY_CONTRACT_ADDRESS is not defined in .env file"
    );
  }
  if (!schemaRegistryContractAddress) {
    throw new Error(
      "SCHEMA_REGISTRY_CONTRACT_ADDRESS is not defined in .env file"
    );
  }
  if (!chainId) {
    throw new Error("CHAIN_ID is not defined in .env file");
  }
  if (!rhsUrl) {
    throw new Error("RHS_URL is not defined in .env file");
  }
  if (!circuitsPath) {
    throw new Error("CIRCUITS_PATH is not defined in .env file");
  }
  if (!schemaId) {
    throw new Error("OWNERSHIP_ATTESTATION_SCHEMA is not defined in .env file");
  }
}

async function main() {
  checkRequiredParams();

  // Initialize signer wallet
  const wallet = new Wallet(privateKey, new JsonRpcProvider(rpcUrl));

  let { recipientDid, recipientId, recipientAddress } = parseArgs({
    options,
    args: process.argv,
    allowPositionals: true,
  }).values;

  recipientId = recipientId || "0";
  recipientDid = recipientDid || "";
  recipientAddress = recipientAddress || ethers.ZeroAddress;

  if (
    (recipientDid as string).trim() === "" &&
    recipientId === "0" &&
    recipientAddress === "0x0000000000000000000000000000000000000000"
  ) {
    throw new Error(
      "One of the recipient information is required (recipientDid, recipientId or recipientAddress)"
    );
  }

  const { userId, userDid, attestationRegistry, signerAddress } =
    await checkAuthenticationAuthV2(schemaId, wallet, {
      rpcUrl,
      rhsUrl,
      circuitsPath,
      stateContractAddress,
      authVerifierContractAddress,
      attestationRegistryContractAddress,
      schemaRegistryContractAddress,
      chainId,
    });

  const encodedData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes"],
    ["0x"]
  );

  console.log(`\n🔧 Test Attestation Parameters:`);
  console.log(`   - Schema Id: ${schemaId}`);
  console.log(`   - User ID: ${userId}`);
  console.log(`   - Encoded Data: ${encodedData}`);

  // Create attestation
  console.log(`\n⏳ Creating attestation...`);
  const tx = await attestationRegistry.recordAttestation({
    schemaId: schemaId,
    attester: { did: userDid, iden3Id: userId, ethereumAddress: signerAddress },
    recipient: {
      did: recipientDid,
      iden3Id: recipientId,
      ethereumAddress: recipientAddress,
    },
    expirationTime: 0, // No expiration,
    revocable: true,
    refId: ethers.ZeroHash,
    data: encodedData,
  });

  console.log(`📝 Transaction submitted: ${tx.hash}`);
  const receipt = await tx.wait();

  console.log(`✅ Attestation created successfully!`);
  console.log(`⛽ Gas used: ${receipt?.gasUsed?.toString()}`);

  // Extract attestation Id from events
  const attestationRecordedEvent = receipt?.logs.find((log: any) => {
    try {
      const parsed = attestationRegistry.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      return parsed?.name === "AttestationRecorded";
    } catch {
      return false;
    }
  });

  if (attestationRecordedEvent) {
    const parsed = attestationRegistry.interface.parseLog({
      topics: attestationRecordedEvent.topics as string[],
      data: attestationRecordedEvent.data,
    });
    const attestationId = parsed?.args[0];
    console.log(`🆔 Attestation Id: ${attestationId}`);

    // Verify the attestation was stored correctly
    console.log(`\n🔍 Verifying attestation...`);
    const storedAttestation = await attestationRegistry.getAttestation(
      attestationId
    );
    console.log(`✅ Attestation verification successful:`);
    console.log(`   - Id: ${storedAttestation.id}`);
    console.log(`   - Schema: ${storedAttestation.schemaId}`);
    console.log(`   - Attester ID: ${storedAttestation.attester.iden3Id}`);

    const [decodedData] = ethers.AbiCoder.defaultAbiCoder().decode(
      ["bytes"],
      storedAttestation.data
    );
    console.log(`   - Data: ${decodedData}`);
    console.log(
      `   - Valid: ${await attestationRegistry.isAttestationValid(
        attestationId
      )}`
    );
  } else {
    throw new Error("Failed to extract attestation Id from transaction events");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
