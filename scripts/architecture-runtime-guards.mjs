import ts from "typescript";

const snapshotRoute = "src/app/api/snapshots/[organizationId]/[projectId]/";
const composition = new Map([
  ["src/infrastructure/source-worker-runtime.ts", [
    ["runSourceWorker", ["createProjectObjectStorageResolver", "createSnapshotBuildCapability",
      "createOperationalSnapshotBuildCapability", "createOperationalSnapshotPublishCapability",
      "createOperationalSnapshotRollbackCapability", "createOperationalAckRotationCapability",
      "createSnapshotWebhookCapability", "getPgBoss", "createPrismaSourceJobRepository",
      "createPrismaSourceManualRequests", "runSourceWorkerWithDependencies",
      "dispatchSourceManualRequest", "handleOperationalOutboxEvent", "snapshotBuild", "snapshotWebhook"]],
    ["runSourceWorkerWithDependencies", ["createSourceJobs", "createSourceExecutionServer", "reconcileSchedules",
      "drainOutboxWithDependencies", "drainSourceJobQueue"]],
  ]],
  ["src/worker/main.ts", [["main", ["runSourceWorker", "runWorkerProcessLifecycle"]]]],
  [`${snapshotRoute}current/route.ts`, [["GET", ["handleSnapshotConsumerGet"]]]],
  [`${snapshotRoute}ack/route.ts`, [["POST", ["handleSnapshotConsumerAck"]]]],
  [`${snapshotRoute}[publishSequence]/files/[kind]/route.ts`, [["GET", ["handleSnapshotConsumerGet"]]]],
]);

export const REQUIRED_COMPOSITION_FILES = Object.freeze([...composition.keys()]);

/** Structural removal guard, not a substitute for actual production runtime proof. */
export function inspectRuntimeComposition(relativePath, source) {
  const rules = composition.get(relativePath);
  if (!rules) return [];
  const file = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
  const failures = [];
  for (const [functionName, requiredCalls] of rules) {
    const declaration = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === functionName);
    const calls = new Set();
    const target = (node) => {
      if (ts.isIdentifier(node)) calls.add(node.text);
      else if (ts.isPropertyAccessExpression(node)) calls.add(node.name.text);
      else if (ts.isParenthesizedExpression(node)) target(node.expression);
      else if (ts.isConditionalExpression(node)) { target(node.whenTrue); target(node.whenFalse); }
    };
    const visit = (node) => {
      if (ts.isCallExpression(node)) target(node.expression);
      ts.forEachChild(node, visit);
    };
    if (declaration?.body) visit(declaration.body);
    const exported = declaration?.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!declaration?.body || (functionName !== "main" && !exported)) {
      failures.push(`Missing production entrypoint ${functionName}: ${relativePath}`);
    }
    for (const name of requiredCalls) {
      if (!calls.has(name)) failures.push(`Missing production binding ${functionName} -> ${name}: ${relativePath}`);
    }
  }
  if (relativePath === "src/worker/main.ts") {
    const callsMain = file.statements.some((statement) => {
      let found = false;
      // Do not let a recursive call inside an unused declaration count as CLI startup.
      if (ts.isFunctionDeclaration(statement)) return false;
      const visit = (node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "main") found = true;
        ts.forEachChild(node, visit);
      };
      visit(statement);
      return found;
    });
    if (!callsMain) failures.push(`Missing production CLI startup: ${relativePath}`);
  }
  return failures;
}
