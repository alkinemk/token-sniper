import {
  PDAUtil,
  SwapUtils,
  TickUtil,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  WhirlpoolContext,
  ORCA_WHIRLPOOLS_CONFIG,
  buildWhirlpoolClient,
  PriceMath,
  swapQuoteByInputToken,
  AccountFetcher,
  SwapQuote,
} from "@orca-so/whirlpools-sdk";
import { AnchorProvider } from "@coral-xyz/anchor";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import {
  DecimalUtil,
  Percentage,
  TransactionBuilder,
} from "@orca-so/common-sdk";
import Decimal from "decimal.js";
import { AccountLayout } from "@solana/spl-token"; // 0.3.7

enum AccountState {
  Uninitialized = 0,
  Initialized = 1,
  Frozen = 2,
}

/** Token account as stored by the program */
interface RawAccount {
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  delegateOption: 1 | 0;
  delegate: PublicKey;
  state: AccountState;
  isNativeOption: 1 | 0;
  isNative: bigint;
  delegatedAmount: bigint;
  closeAuthorityOption: 1 | 0;
  closeAuthority: PublicKey;
}

// THIS SCRIPT REQUIRES ENVIRON VARS!!!
// bash$ export ANCHOR_PROVIDER_URL=https://ssc-dao.genesysgo.net
// bash$ export ANCHOR_WALLET=~/.config/solana/id.json
// bash$ ts-node this_script.ts

const provider = AnchorProvider.env();
console.log("connection endpoint", provider.connection.rpcEndpoint);
console.log("wallet", provider.wallet.publicKey.toBase58());

//   const provider = new Provider(connection, wallet, Provider.defaultOptions());

async function main() {
  // with spl-token 0.3.7
  const state: AccountState = AccountState.Initialized;
  // console.log(`AccountState.Initialized = ${state}`);

  // how to create u64 instance ?
  // u64 data type have been removed at spl-token 0.2.0.
  // we can use DecimalUtil.toU64() to create u64 instance without troublesome related to import.
  const u64amount = DecimalUtil.toBN(new Decimal("1000000000"));

  // console.log("u64amount = ", u64amount.toString());
  const ctx = WhirlpoolContext.withProvider(
    provider,
    ORCA_WHIRLPOOL_PROGRAM_ID
  );
  const fetcher = new AccountFetcher(ctx.connection);
  const client = buildWhirlpoolClient(ctx);

  // get pool
  const SOL = {
    mint: new PublicKey("So11111111111111111111111111111111111111112"),
    decimals: 9,
    ticker: "SOL",
  };
  const COCO = {
    mint: new PublicKey("74DSHnK1qqr4z1pXjLjPAVi8XFngZ635jEVpdkJtnizQ"),
    decimals: 9,
    ticker: "COCO",
  };
  // const NANA = {
  //   mint: new PublicKey("HxRELUQfvvjToVbacjr9YECdfQMUqGgPYB68jVDYxkbr"),
  //   decimals: 9,
  //   ticker: "NANA",
  // };

  const tick_spacing = 128;
  const token_a = SOL;
  const token_b = COCO;
  //const token_b = NANA;

  // const whirlpool_pubkey = PDAUtil.getWhirlpool(
  //   ORCA_WHIRLPOOL_PROGRAM_ID,
  //   ORCA_WHIRLPOOLS_CONFIG,
  //   SOL.mint,
  //   COCO.mint,
  //   //NANA.mint,
  //   tick_spacing
  // ).publicKey;

  const whirlpool_pubkey = new PublicKey(
    "Gk5jgVnUxk7QyYhRMrpLDfZq5ztfA5SLpgowPQjKFrth"
  );
  console.log("whirlpool_key", whirlpool_pubkey.toBase58());
  const whirlpool = await client.getPool(whirlpool_pubkey);

  // const whirlpool_data = whirlpool.getData();
  // const liquidity = whirlpool_data.liquidity.toString();

  // //WhirlpoolData type members: https://orca-so.github.io/whirlpools/modules.html#WhirlpoolData
  // console.log("liquidity", liquidity);
  // console.log("sqrtPrice", whirlpool_data.sqrtPrice.toString());
  // console.log("tickCurrentIndex", whirlpool_data.tickCurrentIndex);
  // console.log(
  //   "price (from tickCurrentIndex)",
  //   PriceMath.tickIndexToPrice(
  //     whirlpool_data.tickCurrentIndex,
  //     SOL.decimals,
  //     COCO.decimals
  //     //NANA.decimals
  //   )
  // );

  // get swap quote
  const input_token = token_a; // a:USDC, b: USDT
  const amount_in = new Decimal("0.001");
  const output_token = input_token === token_a ? token_b : token_a;

  // execute transaction
  let retries = 0;
  const maxRetries = 10000;

  while (retries < maxRetries) {
    try {
      const quote = await swapQuoteByInputToken(
        whirlpool,
        input_token.mint,
        DecimalUtil.toBN(amount_in, input_token.decimals),
        Percentage.fromFraction(300, 1000),
        ctx.program.programId,
        fetcher,
        true
      );
      console.log(
        "estimatedAmountIn",
        DecimalUtil.fromBN(
          quote.estimatedAmountIn,
          input_token.decimals
        ).toString(),
        input_token.ticker
      );
      console.log(
        "estimatedAmountOut",
        DecimalUtil.fromBN(
          quote.estimatedAmountOut,
          output_token.decimals
        ).toString(),
        output_token.ticker
      );

      const tx = await whirlpool.swap(quote);

      const signature = await tx.buildAndExecute();
      const latestBlockhash = await ctx.connection.getLatestBlockhash();

      console.log("signature", signature);
      ctx.connection.confirmTransaction(
        {
          signature: signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed"
      );
      break; // Exit the loop since the quote was retrieved
    } catch (error) {
      console.error("Error retrieving swap quote:", error);

      retries++;
      if (retries < maxRetries) {
        console.log(`Retrying (${retries}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, 500)); // Delay for 1 second
      } else {
        console.log(
          `Max retries (${maxRetries}) reached. Unable to retrieve swap quote.`
        );
      }
    }
  }
}

main();
