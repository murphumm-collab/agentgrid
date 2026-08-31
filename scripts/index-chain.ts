import { closePostgresForTests } from "../src/lib/store-postgres";
import { indexConfirmedChainEvents } from "../src/lib/chain-indexer";

try {
  console.log(JSON.stringify(await indexConfirmedChainEvents()));
} finally {
  await closePostgresForTests();
}
