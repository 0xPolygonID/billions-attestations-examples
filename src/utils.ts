import {
  calcChallengeAuthV2,
  CircuitId,
  core,
  CredentialStatusType,
  IdentityCreationOptions,
  ZeroKnowledgeProofAuthResponse,
} from "@0xpolygonid/js-sdk";
import { ethers, Wallet } from "ethers";
import {
  initCircuitStorage,
  initInMemoryDataStorageAndWallets,
  initProofService,
  packZkpProof,
  prepareZkpProof,
} from "./walletSetup";
import { DID, Id } from "@iden3/js-iden3-core";
import stateAbi from "../src/abi/State.json";
import authVerifierAbi from "../src/abi/AuthVerifier.json";
import attestationRegistryAbi from "../src/abi/AttestationRegistry.json";
import schemaRegistryAbi from "../src/abi/SchemaRegistry.json";

export type Options = {
  type: "boolean" | "string"; // required
  short?: string; // optional
  multiple?: boolean; // optional, default `false`
};

export async function checkAuthenticationAuthV2(
  schemaId: string,
  wallet: Wallet,
  opts: {
    rpcUrl: string;
    rhsUrl: string;
    circuitsPath: string;
    stateContractAddress: string;
    authVerifierContractAddress: string;
    attestationRegistryContractAddress: string;
    schemaRegistryContractAddress: string;
    chainId: string;
  }
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

  const state = new ethers.Contract(opts.stateContractAddress, stateAbi, wallet);

  const defaultNetworkConnection = {
    rpcUrl: opts.rpcUrl,
    contractAddress: state.target as string,
    chainId: parseInt(opts.chainId),
  };

  const defaultIdentityCreationOptions: IdentityCreationOptions = {
    method: core.DidMethod.Iden3,
    blockchain: core.Blockchain.Billions,
    networkId: core.NetworkId.Test,
    revocationOpts: {
      type: CredentialStatusType.Iden3ReverseSparseMerkleTreeProof,
      id: opts.rhsUrl,
    },
  };

  const { dataStorage, credentialWallet, identityWallet } =
    await initInMemoryDataStorageAndWallets(defaultNetworkConnection);
  const circuitStorage = await initCircuitStorage(opts.circuitsPath);
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
    opts.schemaRegistryContractAddress,
    schemaRegistryAbi,
    wallet
  );
  const authVerifier = new ethers.Contract(
    opts.authVerifierContractAddress,
    authVerifierAbi,
    wallet
  );
  const attestationRegistry = new ethers.Contract(
    opts.attestationRegistryContractAddress,
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
