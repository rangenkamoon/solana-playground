import { Creator, Metaplex, toBigNumber } from "@metaplex-foundation/js";
import {
  createCreateMetadataAccountV3Instruction,
  createCreateMasterEditionV3Instruction,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";

import { ConfigData } from "../../types";
import { CandyCache } from "../../utils";

export const createCollection = async (
  metaplex: Metaplex,
  cache: CandyCache,
  configData: ConfigData
) => {
  const collectionItem = cache.items["-1"];
  if (!collectionItem) {
    throw new Error(
      "Trying to create and set collection when collection item info isn't in cache! This shouldn't happen!"
    );
  }

  const collectionMintKp = new Keypair();
  const collectionMintPk = collectionMintKp.publicKey;

  const payer = metaplex.identity().publicKey;

  // Create mint account
  const createMintAccountIx = await SystemProgram.createAccount({
    fromPubkey: payer,
    lamports: await metaplex.connection.getMinimumBalanceForRentExemption(
      MINT_SIZE
    ),
    newAccountPubkey: collectionMintPk,
    programId: TOKEN_PROGRAM_ID,
    space: MINT_SIZE,
  });

  // Initialize mint ix
  const initMintIx = await createInitializeMintInstruction(
    collectionMintPk,
    0,
    payer,
    payer
  );

  const ataPk = await getAssociatedTokenAddress(collectionMintPk, payer);

  const createAtaIx = await createAssociatedTokenAccountInstruction(
    payer,
    ataPk,
    payer,
    collectionMintPk
  );

  const mintToIx = await createMintToInstruction(
    collectionMintPk,
    ataPk,
    payer,
    1
  );

  const creator: Creator = {
    address: payer,
    verified: true,
    share: 100,
  };
  const collectionMetadataPk = metaplex
    .nfts()
    .pdas()
    .metadata({ mint: collectionMintPk });

  const createMetadataAccountIx = createCreateMetadataAccountV3Instruction(
    {
      metadata: collectionMetadataPk,
      mint: collectionMintPk,
      mintAuthority: payer,
      payer: payer,
      updateAuthority: payer,
    },
    {
      createMetadataAccountArgsV3: {
        data: {
          name: collectionItem.name,
          symbol: configData.symbol,
          uri: collectionItem.metadata_link,
          creators: [creator],
          sellerFeeBasisPoints: 0,
          collection: null,
          uses: null,
        },
        collectionDetails: { size: 0, __kind: "V1" },
        isMutable: true,
      },
    }
  );

  const collectionEditionPubkey = metaplex
    .nfts()
    .pdas()
    .masterEdition({ mint: collectionMintPk });

  const createMasterEditionIx = createCreateMasterEditionV3Instruction(
    {
      edition: collectionEditionPubkey,
      mint: collectionMintPk,
      updateAuthority: payer,
      mintAuthority: payer,
      metadata: collectionMetadataPk,
      payer,
    },
    { createMasterEditionArgs: { maxSupply: toBigNumber(0) } }
  );

  const tx = new Transaction().add(
    ...[
      createMintAccountIx,
      initMintIx,
      createAtaIx,
      mintToIx,
      createMetadataAccountIx,
      createMasterEditionIx,
    ]
  );
  tx.feePayer = payer;

  const blockhashInfo = await metaplex.connection.getLatestBlockhash();
  tx.recentBlockhash = blockhashInfo.blockhash;

  await metaplex
    .rpc()
    .sendTransaction(tx, {}, [collectionMintKp, metaplex.identity()]);

  collectionItem.onChain = true;
  cache.program.collectionMint = collectionMintPk.toBase58();
  await cache.syncFile();

  return collectionMintPk;
};
