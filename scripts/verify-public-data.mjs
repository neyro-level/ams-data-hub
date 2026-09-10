import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const forbiddenSignatures = new Set([
  "f27757a3c2307caa4b92dd18f152f195503505bc99284d6c14f88efc2986dc8c",
  "183d804cc0bf0c0a8d5c25b7ec2b0b38350c80f13e1720760d0776bebae7bac7",
  "28210a32e028e02383386d0bee8d81290cd0731d5948d798f979abb4ec7e52f5",
  "a1c509df21cec49af6685ab8e3dbad60dfcb037cc0ab3b0b52c612f2ae6ecca4",
  "9c79d06d5a7e6fbc8e699e05c37b759381eeacad9589af9a482e46ba904e124e",
  "c5086b652749c0b208427081b72d6058d51f5f28652f5b7a7e5b995fe77b44c9",
  "0ace7dca0e8c9a4dd1ff237ec5804dc03fdb4f4caa2ebbd14d370f22a6befaa4",
  "542c3c630f506623454b2689f875c11ffd52bd25a91c1f7b45e5a3c080086567",
  "0837372b44b10827489bbf01cb725cfec24fb56137dc9f9d7ac79cb73424f2af",
  "08bacfd17ca6afa1cd5b99e2c5f1b9390a848da101ba7d64e675a1dd871d680b",
  "7bdbfe89420c9433b1d6efdb3c2c2ffadcef17d49d358b6205f06a585c9687b8",
  "656b5ad88e288c8faf2d0e3330fc63a75e7ee2c2039da300629e8a22b32f237e",
  "bed310bc540ca8519502d4337de53c678756ca49267f2a7b02e0a8ce813aeaf6",
  "fd9222fdaf30d02f602078645418a26aba14d6dea183fb663e824cfa43a3b54c",
  "06b69306852af89a44801efe33fd9dfc86a3250c5af3c55a7d814b85c9b2b40d",
  "9494e20a916cabdf5e14aa472ee4cdafcf452c5c21b3937e3709fec79ed9431f",
  "85fe52b0657ef528ac827ee5d50517674fea33aa2cf560d99ce45feef3b007e3",
  "1a9c6d181360c716462e9a06d673ecfcd697b7947ba69cfb055f9cd5d3d7e6e9",
  "07749a32d2b11f7000d17cac47d968108972bcd02497e0bc0458574b82a95039",
  "539e39b8baff11cd985ca3adcbecf70e22ceb992f1ecec95617feaf4d138c05c",
  "611b3d8a4367f079b9015f50a185494d026ec4bc6aa36b1073ea1c65260ca11a",
  "75c3d373649c1e68b9a516b3efe408d707375b0012805443d3fb279eb9f58c2a",
  "aafa7ca4de5e44f45c0e032cde5d1f84a316942d3f619631642ed63f73ed6b43",
  "aae55e43dd2e817751611659487ad48158c836300768fd8812a3bd930dbea7e3",
  "a3e208fe99d2d8c682313d6efa60d019573401d16f6d01e8b448257c3ca08584",
  "e95c11d094cfd1ef25ba227f07863f3d2f6aac3e9dfbc9a61806269dcfc65214",
  "645eebb88e6475c18353a9601772ae079b2b1ca26b14618403c277711336a490",
  "221305d0c02cc25242eaff199049e455a8a16a5c0b1b8dca523d1a2b98b48321",
  "52f8721770b55c7e1849e464fa2579d5ceeb4e4e2ce510261b116ec4bcd43764",
  "97c6e02abf76c2992afd9122b04e29e813bd43df70cc93cebde3920e065df8d2",
  "36d089e0a0ef95eb7785c9d77d0e07776a84e9f9c6ca32a7d710288ef771877d",
  "bb7133421197f1e3b14a2b1b9c2a0131d1cb18eca884938db2ed7014afba50fb",
  "ad0050dd161b1a8c9a9d63fb04fcba7db8a55504b0849ed30bd44918e85d1414",
]);

const ignoredDirectories = new Set([
  ".git",
  ".local",
  ".next",
  ".release-artifacts",
  "coverage",
  "dist-collector",
  "node_modules",
  "playwright-report",
  "pnpm-store",
  "test-results",
]);

function listContextFiles(root = ".", relativeRoot = "") {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name)
        ? []
        : listContextFiles(path.join(root, entry.name), relativePath);
    }
    if (!entry.isFile() || entry.name === ".env.local" || entry.name.endsWith(".log")) return [];
    return [relativePath];
  });
}

function listFilesForVerification() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\0")
      .filter(Boolean);
  } catch {
    return listContextFiles().sort();
  }
}

const trackedFiles = listFilesForVerification();
const violations = new Set();
const signatureCache = new Map();

function signature(value) {
  const normalized = value.toLocaleLowerCase("und");
  const cached = signatureCache.get(normalized);
  if (cached) return cached;
  const calculated = createHash("sha256").update(normalized, "utf8").digest("hex");
  signatureCache.set(normalized, calculated);
  return calculated;
}

function inspectCandidate(file, candidate) {
  if (forbiddenSignatures.has(signature(candidate))) violations.add(file);
}

for (const file of trackedFiles) {
  // `git ls-files` still reports a tracked file deleted in the current diff.
  // Deleted paths contain no release data and must not make the verifier crash.
  if (!existsSync(file)) continue;
  const normalizedPath = file.replaceAll("\\", "/");
  if (normalizedPath.startsWith("config/") && !normalizedPath.startsWith("config/examples/")) {
    violations.add(normalizedPath);
  }

  for (const candidate of normalizedPath.match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? []) {
    inspectCandidate(normalizedPath, candidate);
  }

  const buffer = readFileSync(file);
  if (buffer.includes(0)) continue;
  const content = buffer.toString("utf8");
  const candidates = [
    ...(content.match(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/giu) ?? []),
    ...(content.match(/\b\d{6,12}\b/g) ?? []),
    ...(content.match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? []),
  ];
  for (const candidate of candidates) inspectCandidate(normalizedPath, candidate);
}

if (violations.size > 0) {
  for (const file of [...violations].sort()) {
    console.error(`Forbidden client-data signature: ${file}`);
  }
  process.exit(1);
}

console.log(`Public-data boundary verified across ${trackedFiles.length} files.`);
