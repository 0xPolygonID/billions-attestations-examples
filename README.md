# Billions Attestations Registry example
This repo shows some examples of usage for Billions Attestations Registry.

## Setup
1. Install dependencies
    ```
    npm i
    ```
    
2. Copy `.env.example` to `.env` and replace the values with your specific configuration mainly for `PRIVATE_KEY` that will be used to send transactions for authentication and attestations.

3. Download privado ID circuits. We will need AuthV2 circuit to generate authV2 proof.
    ```
    ./dl_circuits.sh
    ```

## Examples
1. Create review attestation for a specific identity

    ```
    npm run create:review --  --stars 5 --comment "A new comment for the identity" --recipientDid did:iden3:billions:test:2W4c3K3BgksQCSdXCP5LJDDrexPL1gHUfaCHAACE4a
    ```

2. Get review attestations for a specific identity

    ```
    npm run identity:reviews -- --did did:iden3:billions:test:2W4c3K3BgksQCSdXCP5LJDDrexPL1gHUfaCHAACE4a
    ```

## Check attestations
You can check attestations in different ways:
- **Billions Testnet Block Explorer**. In the Attestation Registry contract (https://billions-testnet-blockscout.eu-north-2.gateway.fm/address/0x40Ef525515E409F45659f2d8E9962f9aeA3ab68A?tab=txs)
- **Billions Tesnet Attestations Explorer**. https://attestations-explorer-testnet.billions.network
- **Billions Testnet Attestations API**. Calling the API and filtering by attestations fields.
    ```
    curl https://attestations-api-testnet.billions.network/api/v1/attestations?schemaId=0xc5708478573c079ed58716909734f526d843151672414e7474fadc11e4cb041f&recipientDid=did:iden3:billions:test:2W4c3K3BgksQCSdXCP5LJDDrexPL1gHUfaCHAACE4a&page_number=1&page_size=100
    ```