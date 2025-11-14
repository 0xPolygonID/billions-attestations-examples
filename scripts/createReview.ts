import { parseArgs } from "node:util";
import { Options } from "../src/utils";
import { ethers } from "ethers";
import { Wallet } from "ethers";
import { JsonRpcProvider } from "ethers";
import stateAbi from "../src/abi/State.json";
import authVerifierAbi from "../src/abi/AuthVerifier.json";
import attestationRegistryAbi from "../src/abi/AttestationRegistry.json";
import schemaRegistryAbi from "../src/abi/SchemaRegistry.json";
import {
  calcChallengeAuthV2,
  CircuitId,
  core,
  CredentialStatusType,
  IdentityCreationOptions,
  ZeroKnowledgeProofAuthResponse,
} from "@0xpolygonid/js-sdk";
import {
  initCircuitStorage,
  initInMemoryDataStorageAndWallets,
  initProofService,
  packZkpProof,
  prepareZkpProof,
} from "../src/walletSetup";
import { DID, Id } from "@iden3/js-iden3-core";

const options: Record<string, Options> = {
  stars: {
    type: "string",
    short: "s",
  },
  comment: {
    type: "string",
    short: "c",
  },
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
const schemaId = process.env.REVIEW_ATTESTATION_SCHEMA as string;
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

async function checkAuthenticationAuthV2(
  schemaId: string,
  wallet: Wallet
): Promise<{
  userId: bigint;
  userDid: string;
  attestationRegistry: any;
  signerAddress: string;
}> {
  console.log(`🧪 Creating attestation review...`);

  // Validate Id format
  if (!schemaId.startsWith("0x") || schemaId.length !== 66) {
    throw new Error(
      "Invalid schema Id format. Expected 32-byte hex string with 0x prefix"
    );
  }

  const state = new ethers.Contract(stateContractAddress, stateAbi, wallet);

  const defaultNetworkConnection = {
    rpcUrl: rpcUrl,
    contractAddress: state.target as string,
    chainId: parseInt(chainId),
  };

  const defaultIdentityCreationOptions: IdentityCreationOptions = {
    method: core.DidMethod.Iden3,
    blockchain: core.Blockchain.Billions,
    networkId: core.NetworkId.Test,
    revocationOpts: {
      type: CredentialStatusType.Iden3ReverseSparseMerkleTreeProof,
      id: rhsUrl,
    },
  };

  const { dataStorage, credentialWallet, identityWallet } =
    await initInMemoryDataStorageAndWallets(defaultNetworkConnection);
  const circuitStorage = await initCircuitStorage(circuitsPath);
  const proofService = await initProofService(
    identityWallet,
    credentialWallet,
    dataStorage.states,
    circuitStorage
  );

  const { did: userDID, credential: authBJJCredentialUser } =
    await identityWallet.createIdentity({
      ...defaultIdentityCreationOptions,
    });

  console.log("=============== user did ===============");
  console.log(userDID.string());

  // Get contract instances
  const schemaRegistry = new ethers.Contract(
    schemaRegistryContractAddress,
    schemaRegistryAbi,
    wallet
  );
  const authVerifier = new ethers.Contract(
    authVerifierContractAddress,
    authVerifierAbi,
    wallet
  );
  const attestationRegistry = new ethers.Contract(
    attestationRegistryContractAddress,
    attestationRegistryAbi,
    wallet
  );

  console.log(`📋 AttestationRegistry: ${attestationRegistry.target}`);
  console.log(`📋 SchemaRegistry: ${schemaRegistry.target}`);
  console.log(`🔑 AuthVerifier: ${authVerifier.target}`);
  console.log(`🌐 State Contract: ${state.target}`);
  console.log(`🆔 Schema Id: ${schemaId}`);

  // Verify schema exists
  const schemaRecord = await schemaRegistry.getSchema(schemaId);
  if (
    schemaRecord.id ===
    "0x0000000000000000000000000000000000000000000000000000000000000000"
  ) {
    throw new Error(`Schema with Id ${schemaId} not found`);
  }

  console.log(`\n✅ Schema found:`);
  console.log(`   - Schema: ${schemaRecord.schema}`);
  console.log(`   - Resolver: ${schemaRecord.resolver}`);
  console.log(`   - Revocable: ${schemaRecord.revocable}`);

  // Authenticate the user (using ethIdentity method)
  const signerAddress = await wallet.getAddress();
  console.log(`\n🔐 Authenticating user: ${signerAddress}`);

  // Calculate the user ID based on the address

  const defaultIdType = await state.getDefaultIdType();
  console.log(`Default IdType from State: ${defaultIdType}`);

  let userId = DID.idFromDID(userDID).bigInt();
  console.log(`Generated userId from DID: ${userId}`);
  // Generate new userId
  //let userId = await calculateUserIdFromAddress(signerAddress, defaultIdType);
  //console.log(`Generated userId from address: ${userId}`);

  // Check if the user is already authenticated
  let currentUserId = await authVerifier.getIdByAddress(signerAddress);
  console.log(`Current user ID from AuthVerifier: ${currentUserId}`);

  if (currentUserId === 0n || currentUserId != userId) {
    console.log(`🔑 User not authenticated yet, submitting authentication...`);

    try {
      const challengeAuth = calcChallengeAuthV2(signerAddress, []);

      const zkpRes: ZeroKnowledgeProofAuthResponse =
        await proofService.generateAuthProof(CircuitId.AuthV2, userDID, {
          challenge: challengeAuth,
        });

      // First, we need to authenticate with the AuthVerifier
      // Create an auth response with authV2 method, which AuthVerifier will recognize
      const preparedZkpProof = prepareZkpProof(zkpRes.proof);
      const encodedAuthProof = packZkpProof(
        zkpRes.pub_signals,
        preparedZkpProof.a,
        preparedZkpProof.b,
        preparedZkpProof.c
      );

      const authResponse = {
        authMethod: "authV2",
        proof: encodedAuthProof,
      };

      // Check if authVerifier is properly configured
      try {
        // First we need to check if the authV2 method is registered
        console.log(`Checking if authV2 auth method exists...`);

        try {
          // Try to get the auth method info (this will throw if it doesn't exist)
          const authMethodExists = await authVerifier.authMethodExists(
            "authV2"
          );
          if (!authMethodExists) {
            console.log(
              `⚠️ ethIdentity auth method does not exist in AuthVerifier!`
            );
            throw new Error("authV2 auth method not found");
          }
          console.log(`✅ authV2 auth method exists`);

          // Try to submit the authentication response
          console.log(`Submitting authentication response...`);
          const authTx = await authVerifier.submitResponse(
            authResponse,
            [], // Empty responses array
            "0x" // Empty cross chain proofs
          );
          console.log(
            `⏳ Authentication transaction submitted: ${authTx.hash}`
          );
          await authTx.wait();
          console.log(`✅ User authenticated successfully with ID: ${userId}`);

          // Verify authentication worked
          currentUserId = await authVerifier.getIdByAddress(signerAddress);
          console.log(
            `Verified user ID after authentication: ${currentUserId}`
          );

          if (currentUserId === 0n) {
            throw new Error(
              "Authentication failed - user ID is still 0 after authentication"
            );
          }
        } catch (methodError) {
          console.error(`ethIdentity method error: ${methodError}`);
          throw new Error(
            `Authentication failed: The ethIdentity auth method is either not registered or not properly configured in the AuthVerifier contract. Make sure to deploy and register the ethIdentity validator first.`
          );
        }
      } catch (authError) {
        console.error(`Authentication error: ${authError}`);
        throw new Error(`Could not authenticate: ${authError}`);
      }
    } catch (error) {
      console.error(`❌ Authentication process failed: ${error}`);
      throw new Error(
        `User authentication failed. Cannot proceed with attestation creation. Error: ${error}`
      );
    }
  } else {
    console.log(`✅ User already authenticated with ID: ${currentUserId}`);
    // Use the existing user ID from the AuthVerifier
    if (currentUserId.toString() !== userId.toString()) {
      console.log(
        `⚠️ Warning: Current user ID ${currentUserId} differs from generated ID ${userId}`
      );
      console.log(
        `Using the authenticated ID from AuthVerifier: ${currentUserId}`
      );
      userId = currentUserId;
    }
  }

  const userDid = DID.parseFromId(Id.fromBigInt(userId)).string();

  console.log(`📋 AttestationRegistry: ${attestationRegistry.target}`);
  console.log(`📋 SchemaRegistry: ${schemaRegistry.target}`);

  console.log(`📝 Using schema: ${schemaRecord.schema}`);
  console.log(`🔧 Schema resolver: ${schemaRecord.resolver}`);

  return { userId, userDid, attestationRegistry, signerAddress };
}

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
    throw new Error("REVIEW_ATTESTATION_SCHEMA is not defined in .env file");
  }
}

async function main() {
  checkRequiredParams();

  // Initialize signer wallet
  const wallet = new Wallet(privateKey, new JsonRpcProvider(rpcUrl));

  let { stars, comment, recipientDid, recipientId, recipientAddress } =
    parseArgs({
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
    await checkAuthenticationAuthV2(schemaId, wallet);

  const encodedData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint8", "string"],
    [stars, comment]
  );

  console.log(`\n🔧 Test Attestation Parameters:`);
  console.log(`   - Schema Id: ${schemaId}`);
  console.log(`   - User ID: ${userId}`);
  console.log(`   - Stars: ${stars}`);
  console.log(`   - Comment: ${comment}`);
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

    const [decodedStars, decodedComment] =
      ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint8", "string"],
        storedAttestation.data
      );
    console.log(`   - Stars: ${decodedStars}`);
    console.log(`   - Comment: ${decodedComment}`);
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
