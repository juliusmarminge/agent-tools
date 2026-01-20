export {};
/**
 * Script for bumping the version of the packages to a canary version
 * and then publishing them to NPM and JSR
 */

const packages = ["convex-vite-plugin"];

const commitHash = (await Bun.$`git rev-parse --short HEAD`.text()).trim();

for (const pkg of packages) {
  const pkgJson = await Bun.file(`packages/${pkg}/package.json`).json();
  const jsrJson = await Bun.file(`packages/${pkg}/jsr.json`).json();

  const oldVersion = pkgJson.version;
  const [major, minor, patch] = oldVersion.split(".").map(Number);
  const newVersion = `${major}.${minor}.${patch + 1}-canary.${commitHash}`;

  pkgJson.version = newVersion;
  jsrJson.version = newVersion;

  await Bun.write(`packages/${pkg}/package.json`, `${JSON.stringify(pkgJson, null, "\t")}\n`);
  await Bun.write(`packages/${pkg}/jsr.json`, JSON.stringify(jsrJson, null, 2));

  /**
   * 2. Run prepack (if exists)
   */
  if (pkgJson.scripts?.prepack) {
    await Bun.$`bun run prepack`.cwd(`packages/${pkg}`);
  }

  /**
   * 3. Publish to NPM
   */
  await Bun.$`npm publish --access public --tag canary`.cwd(`packages/${pkg}`);

  /**
   * 4. Publish to JSR
   */
  console.log(`Skipping JSR publish for ${pkg}`);
  // await Bun.$`bunx jsr publish --allow-dirty --allow-slow-types`.cwd(`packages/${pkg}`);
}
