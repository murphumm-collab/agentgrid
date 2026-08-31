import { createHash } from "node:crypto";
import type { AgentProjectManifest } from "./agent-artifact-builder";

export interface ContributionWork {
  contributor: string;
  manifest: AgentProjectManifest;
}

export interface ContributionWeight {
  contributor: string;
  acceptedBytes: number;
  acceptedFiles: number;
  weightBps: number;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export const contributionFormulaVersion = "incorporated-bytes-v2";
const maxCreditedBytesPerFile = 64 * 1024;
const maxCreditedBytesPerContributor = 512 * 1024;

/**
 * Calculates a tester-verifiable work split from files that were actually
 * incorporated into the accepted final artifact. Identical files claimed by
 * multiple contributors are divided between them, so duplicating another
 * agent's contribution cannot multiply the reward.
 */
export function calculateContributionWeights(
  finalManifest: AgentProjectManifest,
  contributions: ContributionWork[],
  leadExecutor: string,
): ContributionWeight[] {
  if (!contributions.length) throw new Error("CONTRIBUTIONS_REQUIRED");
  const finalFiles = new Map(finalManifest.files.map((file) => [file.path, { hash: digest(file.content), bytes: Buffer.byteLength(file.content) }]));
  const claims = new Map<string, string[]>();
  for (const contribution of contributions) {
    const owner = contribution.contributor.toLowerCase();
    for (const file of contribution.manifest.files) {
      const final = finalFiles.get(file.path);
      if (!final || final.hash !== digest(file.content)) continue;
      const key = `${file.path}:${final.hash}`;
      const owners = claims.get(key) ?? [];
      if (!owners.includes(owner)) owners.push(owner);
      claims.set(key, owners);
    }
  }

  const work = contributions.map((contribution) => ({
    contributor: contribution.contributor,
    acceptedBytes: 0,
    acceptedFiles: 0,
    weightBps: 0,
  }));
  const byOwner = new Map(work.map((item) => [item.contributor.toLowerCase(), item]));
  for (const [key, owners] of claims) {
    const separator = key.lastIndexOf(":");
    const path = key.slice(0, separator);
    const bytes = Math.min(finalFiles.get(path)?.bytes ?? 0, maxCreditedBytesPerFile);
    const share = Math.max(1, Math.floor(bytes / owners.length));
    for (const owner of owners) {
      const item = byOwner.get(owner);
      if (item) {
        item.acceptedBytes = Math.min(maxCreditedBytesPerContributor, item.acceptedBytes + share);
        item.acceptedFiles += 1;
      }
    }
  }

  // The lead performs assembly and conflict resolution. Credit 15% of the
  // incorporated work for integration, without allowing that bonus to exceed
  // the value proven by the team artifacts.
  const rawTotal = work.reduce((sum, item) => sum + item.acceptedBytes, 0);
  const lead = byOwner.get(leadExecutor.toLowerCase());
  if (lead && rawTotal > 0 && work.length > 1) lead.acceptedBytes += Math.floor(rawTotal * 0.15);
  const total = work.reduce((sum, item) => sum + item.acceptedBytes, 0);
  if (total === 0) {
    const base = Math.floor(10_000 / work.length);
    work.forEach((item) => { item.weightBps = base; });
    work[0].weightBps += 10_000 - base * work.length;
    return work;
  }
  let allocated = 0;
  work.forEach((item) => { item.weightBps = Math.floor(item.acceptedBytes * 10_000 / total); allocated += item.weightBps; });
  (lead ?? work[0]).weightBps += 10_000 - allocated;
  return work;
}
