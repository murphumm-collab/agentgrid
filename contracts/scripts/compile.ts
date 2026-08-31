import fs from "node:fs";
import path from "node:path";
import { compileContracts } from "./compiler";

const outputDirectory = path.resolve(process.cwd(), "contracts", "artifacts");
fs.mkdirSync(outputDirectory, { recursive: true });
const artifacts = compileContracts();
for (const [name, artifact] of Object.entries(artifacts)) {
  const deployedBytes = (artifact.deployedBytecode.length - 2) / 2;
  if (deployedBytes > 24_576) throw new Error(`${name} deployed bytecode is ${deployedBytes} bytes; EIP-170 limit is 24576`);
  fs.writeFileSync(path.resolve(outputDirectory, `${name}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
}
console.log(`Compiled ${Object.keys(artifacts).length} deployable contracts.`);
