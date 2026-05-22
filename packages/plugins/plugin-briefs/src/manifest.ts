import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "paperclipai.briefs";
export const BRIEFING_ANALYST_AGENT_KEY = "briefing-analyst";
export const BRIEFING_PROJECT_KEY = "briefing-operations";
export const BRIEFS_DISCOVER_ROUTINE_KEY = "briefs-discover-cards";
export const BRIEFS_UPDATE_ROUTINE_KEY = "briefs-update-cards";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Briefs",
  description: "Maintains source-linked Briefing cards for user-relevant Paperclip work.",
  author: "Paperclip",
  categories: ["automation", "ui"],
  capabilities: [
    "api.routes.register",
    "database.namespace.migrate",
    "database.namespace.read",
    "database.namespace.write",
    "companies.read",
    "issues.read",
    "issue.subtree.read",
    "issue.relations.read",
    "issue.comments.read",
    "issue.documents.read",
    "issues.orchestration.read",
    "agents.read",
    "activity.log.write",
    "plugin.state.read",
    "plugin.state.write",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  database: {
    namespaceSlug: "briefs",
    migrationsDir: "migrations",
    coreReadTables: [
      "companies",
      "issues",
      "issue_relations",
      "issue_comments",
      "issue_documents",
      "heartbeat_runs",
      "approvals",
      "issue_approvals",
    ],
  },
  apiRoutes: [
    {
      routeKey: "cards",
      method: "GET",
      path: "/cards",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "refresh-tree",
      method: "POST",
      path: "/trees/:rootIssueId/refresh",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "issue", param: "rootIssueId" },
    },
  ],
};

export default manifest;
