const expectedNodeVersion = "24.20.0";
const actualNodeVersion = process.versions.node;

if (actualNodeVersion !== expectedNodeVersion) {
  throw new Error(
    `Release requires Node ${expectedNodeVersion}; current runtime is ${actualNodeVersion}.`,
  );
}

console.log(`release_runtime=node-v${actualNodeVersion}`);
