import ts from "typescript";

const domain = "src/modules/ingestion-core/domain/";
const genericParsers = new Set([
  `${domain}yrl-2010-parser.ts`,
  `${domain}marketplace-xml-parser.ts`,
  `${domain}marketplace-feed-adapters.ts`,
]);
const selectors = new Set(["projectId", "organizationId", "tenantId", "clientSlug"]);

/** Syntax-aware guards: comments and example strings are not executable code. */
export function inspectSource(relativePath, source) {
  const file = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
  const findings = new Set();
  const fail = (message) => findings.add(`${message}: ${relativePath}`);
  const generic = genericParsers.has(relativePath);
  const executable = generic || relativePath === `${domain}executable-adapter-registry.ts`;
  const profile = relativePath.startsWith(`${domain}profiles/`);
  const safeOutbound = /^src\/platform\/http\/safe-outbound(?:-core)?\.ts$/u.test(relativePath);
  const imports = [];
  const memberName = (node) => ts.isIdentifier(node) ? node.text
    : ts.isPropertyAccessExpression(node) ? node.name.text
      : ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)
        ? node.argumentExpression.text : undefined;

  function visit(node) {
    if (!safeOutbound && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      && memberName(node) === "fetch" && ts.isIdentifier(node.expression)
      && ["globalThis", "window", "self"].includes(node.expression.text)) {
      fail("Remote HTTP bypasses Safe Outbound");
    }
    if (!safeOutbound && ts.isIdentifier(node) && node.text === "fetch") {
      const parent = node.parent;
      const namedMember = (ts.isPropertyAccessExpression(parent) && parent.name === node)
        || ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertySignature(parent)) && parent.name === node);
      const declaredName = (ts.isVariableDeclaration(parent) || ts.isParameter(parent)
        || ts.isFunctionDeclaration(parent) || ts.isBindingElement(parent)) && parent.name === node;
      if (!namedMember && !declaredName) fail("Remote HTTP bypasses Safe Outbound");
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const bindings = node.importClause?.namedBindings;
        const inlineTypesOnly = !node.importClause?.name && bindings && ts.isNamedImports(bindings)
          && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
        imports.push({ name: node.moduleSpecifier.text, typeOnly: Boolean(node.isTypeOnly || node.importClause?.isTypeOnly || inlineTypesOnly) });
      }
    }
    if (ts.isCallExpression(node)) {
      const name = memberName(node.expression);
      if ((name === "require" || node.expression.kind === ts.SyntaxKind.ImportKeyword)
        && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        imports.push({ name: node.arguments[0].text, typeOnly: false });
      }
      const receiver = (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))
        ? node.expression.expression : undefined;
      const globalFetch = name === "fetch" && (ts.isIdentifier(node.expression)
        || (receiver && ts.isIdentifier(receiver) && ["globalThis", "window", "self"].includes(receiver.text)));
      if (!safeOutbound && globalFetch) fail("Remote HTTP bypasses Safe Outbound");
      if (name === "$queryRawUnsafe" || name === "$executeRawUnsafe") fail("Unsafe raw SQL");
      if (profile && ["parseYrl2010", "parseMarketplaceXmlRecords"].includes(name)) {
        fail("Producer profile owns XML parsing");
      }
    }
    if (profile && ts.isNewExpression(node) && memberName(node.expression) === "SaxesParser") {
      fail("Producer profile owns XML parsing");
    }
    if (executable && ((ts.isIdentifier(node) && selectors.has(node.text))
      || (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && selectors.has(node.name.text))
      || (ts.isElementAccessExpression(node) && node.argumentExpression
        && ts.isStringLiteral(node.argumentExpression) && selectors.has(node.argumentExpression.text)))) {
      fail("Parser/adapter selects a client or project");
    }
    if (generic && ts.isIdentifier(node) && ["profileKey", "profileVersion"].includes(node.text)) {
      fail("Generic parser depends on producer profile selection");
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  for (const imported of imports) {
    if (generic && /(?:^|\/)(?:profiles\/|adapter-profile-registry|executable-adapter-registry)/u.test(imported.name)) {
      fail("Generic parser depends on producer profile selection");
    }
    if (profile && !imported.typeOnly && /(?:^saxes$|(?:^|\/)(?:yrl-2010-parser|marketplace-xml-parser)(?:\.|$))/u.test(imported.name)) {
      fail("Producer profile owns XML parsing");
    }
    if (!safeOutbound && (/^(?:node:)?(?:dns|http|https|tls)(?:\/|$)/u.test(imported.name)
      || (relativePath !== "src/platform/config/server-environment.ts" && /^(?:node:)?net(?:\/|$)/u.test(imported.name))
      || /^(?:axios|got|undici)(?:\/|$)/u.test(imported.name))) {
      fail("Remote HTTP bypasses Safe Outbound");
    }
  }
  return [...findings];
}
