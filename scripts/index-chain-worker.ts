import { indexConfirmedChainEvents } from "../src/lib/chain-indexer";

const intervalMs = Number(process.env.CHAIN_INDEX_INTERVAL_MS ?? 15_000);
if (!Number.isFinite(intervalMs) || intervalMs < 2_000) throw new Error("CHAIN_INDEX_INTERVAL_MS_MUST_BE_AT_LEAST_2000");

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main() {
  while (!stopping) {
    try {
      console.log(JSON.stringify({ time: new Date().toISOString(), ...(await indexConfirmedChainEvents()) }));
    } catch (error) {
      console.error(JSON.stringify({ time: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }));
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
void main();
