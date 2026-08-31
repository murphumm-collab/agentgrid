import { describe, expect, it } from "vitest";
import discovery from "../../public/.well-known/agentgrid.json";
import openapi from "../../public/openapi.json";

type Operation = { operationId?: string; security?: unknown[]; responses?: Record<string, unknown> };
type PathItem = Partial<Record<"get" | "post" | "put" | "patch" | "delete", Operation>>;

const paths = openapi.paths as Record<string, PathItem>;
const manifestRoutes = [
  ["publicStatistics", "get"], ["completedTasks", "get"], ["runtimeChainConfig", "get"], ["walletChallenge", "post"], ["walletSession", "post"],
  ["agentRegistration", "post"], ["taskDefinitionReview", "post"], ["taskCommitmentRecovery", "get"],
  ["taskTransactionBinding", "post"], ["jobLease", "post"], ["artifactUpload", "post"],
  ["artifactFinalize", "post"], ["teamContributions", "post"], ["testerArtifactDownload", "post"],
  ["assignedEvaluation", "get"], ["signedTestEvidence", "post"],
] as const;

describe("public Agent discovery contract", () => {
  it("maps every advertised machine endpoint to a documented OpenAPI operation", () => {
    for (const [key, method] of manifestRoutes) {
      const route = discovery[key];
      expect(route, key).toBeTypeOf("string");
      expect(paths[route]?.[method], `${method.toUpperCase()} ${route}`).toBeDefined();
    }
  });

  it("uses unique operation IDs and documents responses for every operation", () => {
    const ids: string[] = [];
    for (const [route, item] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(item) as Array<[string, Operation]>) {
        expect(operation.operationId, `${method.toUpperCase()} ${route}`).toBeTruthy();
        expect(operation.responses, `${method.toUpperCase()} ${route}`).toBeTruthy();
        ids.push(operation.operationId!);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps encrypted delivery private and does not overclaim A2A compatibility", () => {
    expect(discovery.a2aCompatible).toBe(false);
    expect(openapi.components.schemas.ArtifactUploadRequest.properties.contentType.const).toBe("application/gzip");
    expect(openapi.components.schemas.ArtifactUploadRequest.properties.encryptionAlgorithm.const).toBe("AES-256-GCM");
    expect(openapi.components.schemas.ArtifactUploadRequest.properties.encryptionKey.writeOnly).toBe(true);
    expect(openapi.components.schemas.EncryptedArtifactEnvelope.properties.decryptionKey.readOnly).toBe(true);
    expect(openapi.components.schemas.ArtifactUpload.properties.uploadUrl.readOnly).toBe(true);
    expect(JSON.stringify(openapi.components.schemas.CompletedTask)).not.toContain("decryptionKey");
    expect(paths[discovery.artifactUpload]?.post?.security).toEqual([{ AgentId: [], AgentKey: [] }]);
    expect(paths[discovery.testerArtifactDownload]?.post?.security).toEqual([{ AgentId: [], AgentKey: [] }]);
    expect(paths[discovery.agentRegistration]?.post?.security).toEqual([{ WalletSession: [] }]);
    expect(paths[discovery.taskDefinitionReview]?.post?.security).toEqual([{ WalletSession: [] }]);
  });
});
