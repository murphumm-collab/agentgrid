import { createPublicClient, decodeEventLog, http, type Address, type Hex, type Log } from "viem";
import { bscTestnet } from "viem/chains";
import { chainContractAddresses, runtimeConfig } from "./env";
import { agentRegistryAbi, rewardVaultAbi, stakeManagerAbi, taskRegistryAbi } from "./contracts";
import { chainCursor, persistChainBatch, rewindChain, type IndexedChainEvent } from "./store-postgres";
import { dispatchJobOutbox } from "./agent-queue";

const cursorName = "bsc-testnet-protocol-v1";
const reorgRewind = BigInt(20);

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

function decode(log: Log): Pick<IndexedChainEvent, "eventName" | "eventArgs"> {
  for (const abi of [stakeManagerAbi, agentRegistryAbi, taskRegistryAbi, rewardVaultAbi]) {
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
      return { eventName: decoded.eventName, eventArgs: jsonSafe(decoded.args) as Record<string, string | number | boolean | Array<string | number | boolean>> };
    } catch { /* event belongs to another protocol contract */ }
  }
  return {};
}

export async function indexConfirmedChainEvents() {
  const config = runtimeConfig();
  const addresses = chainContractAddresses();
  let dispatchedJobs = await dispatchJobOutbox();
  const client = createPublicClient({ chain: bscTestnet, transport: http(config.BSC_TESTNET_RPC_URL) });
  let cursor = await chainCursor(cursorName, BigInt(config.CHAIN_START_BLOCK));
  if (cursor.nextBlock > BigInt(0) && cursor.lastBlockHash) {
    const previous = await client.getBlock({ blockNumber: cursor.nextBlock - BigInt(1) });
    if (previous.hash.toLowerCase() !== cursor.lastBlockHash.toLowerCase()) {
      const rewindTo = cursor.nextBlock > reorgRewind ? cursor.nextBlock - reorgRewind : BigInt(config.CHAIN_START_BLOCK);
      await rewindChain(cursorName, rewindTo);
      cursor = await chainCursor(cursorName, rewindTo);
    }
  }
  const latest = await client.getBlockNumber();
  const confirmations = BigInt(config.CHAIN_CONFIRMATIONS);
  if (latest < confirmations || cursor.nextBlock > latest - confirmations) return { indexed: 0, dispatchedJobs, nextBlock: cursor.nextBlock.toString() };
  const toBlock = [cursor.nextBlock + BigInt(1_999), latest - confirmations].sort((a, b) => a < b ? -1 : 1)[0];
  const logs = await client.getLogs({
    address: [addresses.stakeManager, addresses.agentRegistry, addresses.taskRegistry, addresses.rewardVault] as Address[],
    fromBlock: cursor.nextBlock,
    toBlock,
  });
  const uniqueBlockNumbers = [...new Set(logs.map((log) => log.blockNumber.toString()))].map(BigInt);
  const blockTimestamps = new Map<string, string>();
  for (let offset = 0; offset < uniqueBlockNumbers.length; offset += 25) {
    const eventBlocks = await Promise.all(uniqueBlockNumbers.slice(offset, offset + 25).map((blockNumber) => client.getBlock({ blockNumber })));
    for (const block of eventBlocks) blockTimestamps.set(block.number.toString(), new Date(Number(block.timestamp) * 1_000).toISOString());
  }
  const lastBlock = await client.getBlock({ blockNumber: toBlock });
  const events: IndexedChainEvent[] = logs.map((log) => ({
    chainId: config.BSC_CHAIN_ID,
    transactionHash: log.transactionHash as Hex,
    logIndex: log.logIndex ?? 0,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash as Hex,
    blockTimestamp: blockTimestamps.get(log.blockNumber.toString()),
    address: log.address,
    topics: log.topics,
    data: log.data,
    ...decode(log),
  }));
  await persistChainBatch(cursorName, cursor.nextBlock, toBlock + BigInt(1), lastBlock.hash, events);
  dispatchedJobs += await dispatchJobOutbox();
  return { indexed: events.length, dispatchedJobs, fromBlock: cursor.nextBlock.toString(), toBlock: toBlock.toString(), nextBlock: (toBlock + BigInt(1)).toString() };
}
