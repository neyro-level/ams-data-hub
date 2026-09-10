module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-production-imports-from-tests",
      severity: "error",
      from: { path: "^(src|collector)/" },
      to: { path: "^tests/" },
    },
    {
      name: "domain-does-not-depend-on-outer-layers",
      severity: "error",
      from: { path: "^src/domain/" },
      to: {
        path: "^(src/(app|application|components|infrastructure|modules|platform|worker)/|collector/)",
      },
    },
    {
      name: "domain-does-not-depend-on-frameworks",
      severity: "error",
      from: { path: "^src/domain/" },
      to: {
        dependencyTypes: ["npm", "npm-dev"],
        path: "^(next|react|react-dom|@prisma|better-auth|pg)(/|$)",
      },
    },
    {
      name: "application-does-not-depend-on-adapters-or-presentation",
      severity: "error",
      from: { path: "^src/application/" },
      to: {
        path: "^(src/(app|components|infrastructure|modules|platform|worker)/|collector/)",
      },
    },
    {
      name: "shared-does-not-depend-on-business-outer-layers",
      severity: "error",
      from: { path: "^src/shared/" },
      to: {
        path: "^(src/(app|application|components|domain|infrastructure|modules|platform|worker)/|collector/)",
      },
    },
    {
      name: "platform-does-not-depend-on-project-layers",
      severity: "error",
      from: { path: "^src/platform/" },
      to: {
        path: "^(src/(app|application|components|domain|infrastructure|modules|shared|worker)/|collector/)",
      },
    },
    {
      name: "presentation-does-not-import-database-internals",
      severity: "error",
      from: { path: "^src/(app|components)/|^src/modules/[^/]+/(presentation/|presentation\\.ts$|client\\.ts$)" },
      to: { path: "^src/(infrastructure/database|platform/database)/" },
    },
    {
      name: "infrastructure-does-not-depend-on-presentation",
      severity: "error",
      from: { path: "^src/(infrastructure|platform/database)/" },
      to: { path: "^src/(app|components)/|^src/modules/[^/]+/(presentation/|presentation\\.ts$|client\\.ts$)" },
    },
    {
      name: "presentation-modules-do-not-depend-on-app-routes",
      severity: "error",
      from: { path: "^src/components/|^src/modules/[^/]+/(presentation/|presentation\\.ts$|client\\.ts$)" },
      to: { path: "^src/app/" },
    },
    {
      name: "module-domain-does-not-depend-on-outer-layers",
      severity: "error",
      from: { path: "^src/modules/[^/]+/domain/" },
      to: { path: "^src/modules/[^/]+/(application|infrastructure|presentation)/" },
    },
    {
      name: "module-domain-does-not-depend-on-frameworks",
      severity: "error",
      from: { path: "^src/modules/[^/]+/domain/" },
      to: {
        dependencyTypes: ["npm", "npm-dev"],
        path: "^(next|react|react-dom|@prisma|better-auth|pg)(/|$)",
      },
    },
    {
      name: "module-application-does-not-depend-on-adapters-or-presentation",
      severity: "error",
      from: { path: "^src/modules/[^/]+/application/" },
      to: { path: "^src/modules/[^/]+/(infrastructure|presentation)/" },
    },
    {
      name: "identity-access-internals-are-private",
      severity: "error",
      from: { pathNot: "^src/modules/identity-access/" },
      to: { path: "^src/modules/identity-access/(domain|application|infrastructure|presentation)/" },
    },
    {
      name: "project-registry-internals-are-private",
      severity: "error",
      from: { pathNot: "^src/modules/project-registry/" },
      to: { path: "^src/modules/project-registry/(domain|application|infrastructure|presentation)/" },
    },
    {
      name: "reporting-internals-are-private",
      severity: "error",
      from: { pathNot: "^src/modules/reporting/" },
      to: { path: "^src/modules/reporting/(domain|application|infrastructure|presentation)/" },
    },
    {
      name: "ranking-analytics-internals-are-private",
      severity: "error",
      from: { pathNot: "^src/modules/ranking-analytics/" },
      to: { path: "^src/modules/ranking-analytics/(domain|application|infrastructure|presentation)/" },
    },
    {
      name: "data-ingestion-internals-are-private",
      severity: "error",
      from: { pathNot: "^src/modules/data-ingestion/" },
      to: { path: "^src/modules/data-ingestion/(domain|application|infrastructure|presentation)/" },
    },
    {
      name: "platform-operations-internals-are-private",
      severity: "error",
      from: { pathNot: "^src/modules/platform-operations/" },
      to: { path: "^src/modules/platform-operations/(domain|application|infrastructure|presentation)/" },
    },
    {
      name: "admin-cms-internals-are-private",
      severity: "error",
      from: { pathNot: "^src/modules/admin-cms/" },
      to: { path: "^src/modules/admin-cms/(domain|application|infrastructure|presentation)/" },
    },
    {
      name: "only-platform-database-imports-generated-prisma-client",
      severity: "error",
      from: {
        pathNot: "^src/(platform/database|modules/[^/]+/infrastructure|generated)/",
      },
      to: {
        path: "^src/generated/prisma/",
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["types", "import", "require", "default"],
    },
    exclude: {
      path: "(^|/)(node_modules|\.next|dist-collector|generated)(/|$)",
    },
  },
};
