import fs from "node:fs";
import path from "node:path";
import solc from "solc";

export type ContractArtifact = {
  abi: readonly unknown[];
  bytecode: `0x${string}`;
  deployedBytecode: `0x${string}`;
  immutableReferences: Array<{ start: number; length: number }>;
};

const contractsRoot = path.resolve(process.cwd(), "contracts");

function findImports(importPath: string): { contents?: string; error?: string } {
  const candidates = [
    path.resolve(contractsRoot, "src", importPath),
    path.resolve(process.cwd(), "node_modules", importPath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { contents: fs.readFileSync(candidate, "utf8") };
  }
  return { error: `Import not found: ${importPath}` };
}

export function compileContracts(): Record<string, ContractArtifact> {
  const sources = Object.fromEntries(
    fs
      .readdirSync(path.resolve(contractsRoot, "src"))
      .filter((file) => file.endsWith(".sol"))
      .map((file) => [file, { content: fs.readFileSync(path.resolve(contractsRoot, "src", file), "utf8") }]),
  );
  const input = {
    language: "Solidity",
    sources,
    settings: {
      viaIR: true,
      // TaskRegistry is feature-dense and must remain below EIP-170's 24 KiB
      // deployed-code limit on BSC. Optimizing for deployment size is the right
      // trade-off here; task lifecycle calls are comparatively infrequent.
      optimizer: { enabled: true, runs: 1 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const fatal = (output.errors ?? []).filter((entry: { severity: string }) => entry.severity === "error");
  if (fatal.length) throw new Error(fatal.map((entry: { formattedMessage: string }) => entry.formattedMessage).join("\n"));

  const artifacts: Record<string, ContractArtifact> = {};
  for (const contracts of Object.values(output.contracts) as Array<Record<string, { abi: unknown[]; evm: { bytecode: { object: string }; deployedBytecode: { object: string; immutableReferences?: Record<string, Record<string, Array<{ start: number; length: number }>>> } } }>>) {
    for (const [name, artifact] of Object.entries(contracts)) {
      if (!artifact.evm.bytecode.object) continue;
      const deployedBytes = artifact.evm.deployedBytecode.object.length / 2;
      if (deployedBytes > 24_576) throw new Error(`${name} deployed bytecode is ${deployedBytes} bytes; EIP-170 limit is 24576`);
      artifacts[name] = {
        abi: artifact.abi,
        bytecode: `0x${artifact.evm.bytecode.object}`,
        deployedBytecode: `0x${artifact.evm.deployedBytecode.object}`,
        immutableReferences: Object.values(artifact.evm.deployedBytecode.immutableReferences ?? {}).flatMap((references) => Object.values(references).flat()),
      };
    }
  }
  return artifacts;
}

export function solidityCompilerVersion() {
  return solc.version();
}
