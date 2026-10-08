import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectSource } from "../scripts/architecture-source-guards.mjs";

const domain = "src/modules/ingestion-core/domain/";

describe("mandatory source architecture guards", () => {
  it.each([
    "if (input.projectId === 'client') parseSpecial();",
    "const { projectId: selected } = input; switch (selected) {}",
    "const handlers = { client: parseSpecial }; handlers[input['tenantId']]();",
    "const organizationId = input.scope;",
    "const selector = { 'projectId': input.scope };",
  ])("rejects tenant-specific executable adapters: %s", (source) => {
    expect(inspectSource(`${domain}marketplace-feed-adapters.ts`, source)).toContain(
      `Parser/adapter selects a client or project: ${domain}marketplace-feed-adapters.ts`,
    );
  });

  it.each([
    "import { profile } from './profiles/vladis-vt24-v1.ts';",
    "export { registry } from './adapter-profile-registry.ts';",
    "const registry = await import('./executable-adapter-registry.ts');",
    "if (input.profileKey === 'vladis-vt24-v1') parseSpecial();",
  ])("rejects producer dependencies inside generic parser: %s", (source) => {
    expect(inspectSource(`${domain}yrl-2010-parser.ts`, source)).toHaveLength(1);
  });

  it.each([
    "import { SaxesParser as Parser } from 'saxes'; new Parser();",
    "import { parseYrl2010 as parse } from '../yrl-2010-parser.ts'; parse(input);",
    "new SaxesParser();",
  ])("rejects XML parsing owned by producer profiles: %s", (source) => {
    expect(inspectSource(`${domain}profiles/example.ts`, source)).toHaveLength(1);
  });

  it.each([
    "globalThis.fetch(url);", "globalThis['fetch'](url);",
    "const http = await import('node:https');",
    "const dns = require('node:dns/promises');",
    "tx['$queryRawUnsafe'](query);",
    "const request = fetch; request(url);",
    "const request = globalThis.fetch; request(url);",
    "const request = globalThis['fetch']; request(url);",
    "import https from 'https'; https.request(url);",
    "const http = require('http'); http.get(url);",
  ])("rejects unsafe I/O and SQL syntax variants: %s", (source) => {
    expect(inspectSource('src/modules/example/application/example.ts', source)).toHaveLength(1);
  });

  it("does not treat comments or literal examples as executable selectors", () => {
    expect(inspectSource(`${domain}yrl-2010-parser.ts`,
      "// projectId: fetch(url)\nconst example = 'projectId'; const format = 'Avito.ru';",
    )).toEqual([]);
  });

  it("allows the unrelated native queue fetch method", () => {
    expect(inspectSource('src/modules/ingestion-core/worker.ts',
      "const jobs = await boss.fetch(queue);",
    )).toEqual([]);
  });

  it("allows both approved forms of type-only parser imports in a profile", () => {
    expect(inspectSource(`${domain}profiles/example.ts`,
      "import type { YrlRawOffer } from '../yrl-2010-parser.ts';",
    )).toEqual([]);
    expect(inspectSource(`${domain}profiles/example.ts`,
      "import { type YrlRawOffer } from '../yrl-2010-parser.ts';",
    )).toEqual([]);
    expect(inspectSource(`${domain}profiles/example.ts`,
      "import { type YrlRawOffer, parseYrl2010 } from '../yrl-2010-parser.ts';",
    )).toHaveLength(1);
  });

  it.each([
    "yrl-2010-parser.ts", "marketplace-xml-parser.ts", "marketplace-feed-adapters.ts",
    "executable-adapter-registry.ts", "profiles/vladis-agent-extraction.ts",
    "profiles/vladis-vt24-v1.ts", "profiles/joywork-marketplace-profiles.ts",
  ])("accepts the approved actual parser/profile boundary: %s", (name) => {
    const path = `${domain}${name}`;
    expect(inspectSource(path, readFileSync(path, 'utf8'))).toEqual([]);
  });
});
