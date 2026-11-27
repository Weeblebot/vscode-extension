import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function readSdkRelease(repositoryRoot) {
  const [packageSource, discord, runtime] = await Promise.all([
    readFile(resolve(repositoryRoot, "packages/types/package.json"), "utf8"),
    readFile(resolve(repositoryRoot, "packages/types/lib.weeble.d.ts"), "utf8"),
    readFile(resolve(repositoryRoot, "packages/types/runtime.d.ts"), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);
  const hash = createHash("sha256")
    .update(discord)
    .update("\0")
    .update(runtime)
    .digest("hex");
  return {
    manifest: {
      version: packageJson.version,
      hash,
      discord: "lib.weeble.d.ts",
      runtime: "runtime.d.ts",
    },
    discord,
    runtime,
  };
}

export async function writeSdkRelease(repositoryRoot, outputDirectory) {
  const release = await readSdkRelease(repositoryRoot);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      resolve(outputDirectory, "manifest.json"),
      `${JSON.stringify(release.manifest, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      resolve(outputDirectory, "lib.weeble.d.ts"),
      release.discord,
      "utf8",
    ),
    writeFile(
      resolve(outputDirectory, "runtime.d.ts"),
      release.runtime,
      "utf8",
    ),
  ]);
  return release.manifest;
}
