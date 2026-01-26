import { parseArgs } from "node:util";
import { checkAuthenticationAuthV2, Options } from "../src/utils";
import { ethers } from "ethers";
import { Wallet } from "ethers";
import { JsonRpcProvider } from "ethers";
import path from "path";
import fs from "fs";

const options: Record<string, Options> = {
  schemaDefinition: {
    type: "string",
  },
  resolver: {
    type: "string",
  },
  revocable: {
    type: "boolean",
  },
};

// Check required env variables
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
      "AUTH_VERIFIER_CONTRACT_ADDRESS is not defined in .env file",
    );
  }
  if (!attestationRegistryContractAddress) {
    throw new Error(
      "ATTESTATION_REGISTRY_CONTRACT_ADDRESS is not defined in .env file",
    );
  }
  if (!schemaRegistryContractAddress) {
    throw new Error(
      "SCHEMA_REGISTRY_CONTRACT_ADDRESS is not defined in .env file",
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
}

async function main() {
  checkRequiredParams();

  // Initialize signer wallet
  const wallet = new Wallet(privateKey, new JsonRpcProvider(rpcUrl));

  let { schemaDefinition, resolver, revocable } = parseArgs({
    options,
    args: process.argv,
    allowPositionals: true,
  }).values;

  schemaDefinition = schemaDefinition || "";
  resolver = resolver || ethers.ZeroAddress;
  revocable = revocable || true;

  if ((schemaDefinition as string).trim() === "") {
    throw new Error("Schema definition is required");
  }

  const { userId, schemaRegistry } = await checkAuthenticationAuthV2(
    "0x",
    wallet,
    {
      rpcUrl,
      rhsUrl,
      circuitsPath,
      stateContractAddress,
      authVerifierContractAddress,
      attestationRegistryContractAddress,
      schemaRegistryContractAddress,
      chainId,
    },
  );

  console.log(`🔗 Registering custom schema in SchemaRegistry...`);
  console.log(`📝 Schema definition: ${schemaDefinition}`);
  console.log(`🔧 Resolver: ${resolver}`);
  console.log(`🔄 Revocable: ${revocable}`);

  // Validate resolver address
  if (!ethers.isAddress(resolver)) {
    throw new Error("Invalid resolver address provided");
  }

  // Register the schema with the authenticated user ID
  console.log(`\n📝 Registering schema with user ID: ${userId}`);
  const tx = await schemaRegistry.register(
    schemaDefinition,
    resolver,
    revocable,
    userId,
  );

  console.log(`\n⏳ Transaction submitted: ${tx.hash}`);
  const receipt = await tx.wait();

  if (!receipt) {
    throw new Error("Transaction receipt is null");
  }

  console.log(`✅ Schema registered successfully!`);
  console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);

  // Extract schema Id from event
  const registeredEvent = receipt.logs.find((log) => {
    try {
      const parsedLog = schemaRegistry.interface.parseLog(log);
      return parsedLog?.name === "Registered";
    } catch {
      return false;
    }
  });

  let schemaId;
  if (registeredEvent) {
    const parsedLog = schemaRegistry.interface.parseLog(registeredEvent);
    if (parsedLog) {
      schemaId = parsedLog.args.id;
      console.log(`🆔 Schema Id: ${schemaId}`);
    }
  }

  // Verify registration
  if (schemaId) {
    console.log(`\n🔍 Verifying registration...`);
    const registeredSchema = await schemaRegistry.getSchema(schemaId);
    console.log(`✅ Schema verification successful:`);
    console.log(`   - Id: ${registeredSchema.id}`);
    console.log(`   - Schema: ${registeredSchema.schema}`);
    console.log(`   - Resolver: ${registeredSchema.resolver}`);
    console.log(`   - Revocable: ${registeredSchema.revocable}`);
  }

  // Save registration info
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(
    __dirname,
    `../scripts/custom_schemas_output/register_custom_schema_${timestamp}_${chainId}.json`,
  );
  const outputJson = {
    registrar: await wallet.getAddress(),
    userId: userId.toString(),
    schemaRegistry: schemaRegistry.target,
    resolver,
    schemaId: schemaId || "unknown",
    schemaDefinition,
    revocable: revocable,
    transactionHash: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    chainId,
    timestamp: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(outputJson, null, 1));
  console.log(`\n📁 Registration details saved to: ${outputPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
