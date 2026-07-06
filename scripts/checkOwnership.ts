/* eslint-disable no-console */

import axios from "axios";
import { Options } from "../src/utils";
import { parseArgs } from "node:util";

const options: Record<string, Options> = {
  did: {
    type: "string",
    short: "d",
  },
};

/**
 * Check if an agent DID has ownership attestation
 *
 * This script queries the Billions Attestations API to verify if an agent
 * has a verified human owner by checking for ownership attestations.
 */
async function main() {
  // Parse command line arguments
  const { did: agentDid } = parseArgs({
    options,
    args: process.argv,
    allowPositionals: true,
  }).values;

  if (!agentDid) {
    throw new Error("--did argument is required");
  }

  // Query the Billions Attestations API for ownership attestations
  const response = await axios.get(
    `${process.env.BILLIONS_ATTESTATIONS_API_URL}/attestations?recipientDid=${agentDid}&schemaId=${process.env.OWNERSHIP_ATTESTATION_SCHEMA}&page_number=1&page_size=10`
  );

  const { data, totalItems } = response.data;

  console.log(`Agent DID: ${agentDid}`);

  // Check if ownership attestation exists
  if (totalItems > 0 && data.length > 0) {
    const attestation = data[0];
    console.log(`Status: Has verified human owner`);
    console.log(`Owner DID: ${attestation.fromDid}`);
    console.log(`Agent Name: ${attestation.toName}`);
    console.log(`Attestation ID: ${attestation.id}`);
    console.log(
      `Created: ${new Date(attestation.creationTime * 1000).toISOString()}`
    );
  } else {
    console.log(`Status: No verified human owner`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
