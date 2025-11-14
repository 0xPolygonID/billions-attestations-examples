/* eslint-disable no-console */

import axios from "axios";
import { Options } from "../src/utils";
import { parseArgs } from "util";


const options: Record<string, Options> = {
  did: {
    type: "string",
    short: "d",
  },
};

const getReviewsForAgent = async (agentDid: string) => {
  const reviews: any[] = [];
  const pageSize = 20;


  const page1Res = await axios.get(
    `${process.env.BILLIONS_ATTESTATIONS_API_URL}/attestations?recipientDid=${agentDid}&schemaId=${process.env.REVIEW_ATTESTATION_SCHEMA}&page_number=1&page_size=${pageSize}`
  );

  reviews.push(...page1Res.data.data);
  const totalPages = page1Res.data.totalPages;

  if (totalPages > 1) {
    for (let page = 2; page <= totalPages; page++) {
      const pagedRes = await axios.get(
        `${process.env.BILLIONS_ATTESTATIONS_API_URL}/attestations?recipientDid=${agentDid}&schemaId=${process.env.REVIEW_ATTESTATION_SCHEMA}&page_number=${page}&page_size=${pageSize}`
      );
      reviews.push(...pagedRes.data.data);
    }
  }

  return reviews;
};

async function main() {
  const { did: agentDid } = parseArgs({
    options,
    args: process.argv,
    allowPositionals: true,
  }).values;

  const reviews = await getReviewsForAgent(agentDid as string);

  const reviewCount = reviews.length;

  const totalStars = reviews.reduce((acc: any, attestation: any) => {
    const decodedDataJson = JSON.parse(attestation.decodedDataJson);
    const starsField = decodedDataJson.find(
      (field: any) => field.value.name === "stars"
    );
    acc += Number(starsField.value.value);
    return acc;
  }, 0);
  const averageStars = reviewCount > 0 ? totalStars / reviewCount : 0;
  console.log(`🆔 Agent DID: ${agentDid}`);
  console.log(`⭐ ${averageStars.toFixed(2)} (${reviewCount} reviews)`);

  for (const review of reviews) {
    const decodedDataJson = JSON.parse(review.decodedDataJson);
    const starsField = decodedDataJson.find(
      (field: any) => field.value.name === "stars"
    );
    const commentField = decodedDataJson.find(
      (field: any) => field.value.name === "comment"
    );

    console.log(
      `  📋 Review by ${review.fromDid}. ⭐ ${starsField.value.value}`
    );
    console.log(`  ${commentField.value.value}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
