import {
  definePlugin,
  runWorker,
  type PluginApiRequestInput,
  type PluginContext,
  type PluginIssueSubtree,
} from "@paperclipai/plugin-sdk";
import {
  buildBriefCardDraft,
  findExistingBriefCard,
  getBriefPreferences,
  listBriefCards,
  setBriefCardHidden,
  setBriefCardPinned,
  upsertBriefCard,
  type BriefSourceCollections,
} from "./briefs.js";

function stringField(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (Array.isArray(value)) return stringField(value[0]);
  return null;
}

function boolField(value: unknown): boolean {
  return value === true || value === "true";
}

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readCompanyId(params: Record<string, unknown>): string {
  const companyId = stringField(params.companyId);
  if (!companyId) throw new Error("companyId is required");
  return companyId;
}

function readUserId(params: Record<string, unknown>, fallback?: string | null): string {
  const userId = stringField(params.userId) ?? fallback;
  if (!userId) throw new Error("userId is required");
  return userId;
}

async function collectTreeSources(ctx: PluginContext, companyId: string, subtree: PluginIssueSubtree): Promise<BriefSourceCollections> {
  const [commentPairs, orchestration] = await Promise.all([
    Promise.all(
      subtree.issueIds.map(async (issueId) => [
        issueId,
        await ctx.issues.listComments(issueId, companyId),
      ] as const),
    ),
    ctx.issues.summaries.getOrchestration({
      issueId: subtree.rootIssueId,
      companyId,
      includeSubtree: true,
    }),
  ]);

  return {
    commentsByIssueId: Object.fromEntries(commentPairs),
    documentsByIssueId: subtree.documents,
    activeRunsByIssueId: subtree.activeRuns,
    runs: orchestration.runs,
    approvals: orchestration.approvals,
  };
}

async function refreshTreeCard(ctx: PluginContext, input: {
  companyId: string;
  userId: string;
  rootIssueId: string;
  companyIssuePrefix?: string | null;
  forceRelevant?: boolean;
}) {
  const preferences = await getBriefPreferences(ctx.db, input);
  const subtree = await ctx.issues.getSubtree(input.rootIssueId, input.companyId, {
    includeRoot: true,
    includeRelations: true,
    includeDocuments: true,
    includeActiveRuns: true,
    includeAssignees: true,
  });
  const sources = await collectTreeSources(ctx, input.companyId, subtree);
  const initialDraft = buildBriefCardDraft({
    ...input,
    subtree,
    sources,
    preferences,
  });
  if (!initialDraft) {
    return { refreshed: false, reason: "not-relevant-or-stale", card: null };
  }
  const existingCard = await findExistingBriefCard(ctx.db, {
    companyId: input.companyId,
    userId: input.userId,
    groupingHash: initialDraft.groupingHash,
  });
  const draft = existingCard
    ? buildBriefCardDraft({
        ...input,
        subtree,
        sources,
        preferences,
        existingCard,
      }) ?? initialDraft
    : initialDraft;
  const result = await upsertBriefCard(ctx.db, draft);
  await ctx.activity.log({
    companyId: input.companyId,
    message: "briefs.card_refreshed",
    entityType: "brief",
    entityId: result.cardId,
    metadata: {
      rootIssueId: input.rootIssueId,
      userId: input.userId,
      state: draft.state,
      summaryStatus: draft.summaryStatus,
      sourceCount: draft.sources.length,
    },
  });
  return { refreshed: true, cardId: result.cardId, snapshotId: result.snapshotId, card: draft };
}

async function discoverCandidateRootIds(ctx: PluginContext, companyId: string, sinceIso: string, limit: number): Promise<string[]> {
  const rows = await ctx.db.query<{ root_id: string }>(
    `WITH RECURSIVE recent AS (
       SELECT id, parent_id
       FROM public.issues
       WHERE company_id = $1 AND hidden_at IS NULL AND updated_at >= $2::timestamptz
       ORDER BY updated_at DESC
       LIMIT $3
     ),
     chain AS (
       SELECT id, parent_id, id AS leaf_id
       FROM recent
       UNION ALL
       SELECT parent.id, parent.parent_id, chain.leaf_id
       FROM public.issues parent
       INNER JOIN chain ON chain.parent_id = parent.id
       WHERE parent.company_id = $1 AND parent.hidden_at IS NULL
     )
     SELECT DISTINCT id AS root_id
     FROM chain
     WHERE parent_id IS NULL
     ORDER BY id`,
    [companyId, sinceIso, limit],
  );
  return rows.map((row) => row.root_id);
}

let currentContext: PluginContext | null = null;

const plugin = definePlugin({
  async setup(ctx) {
    currentContext = ctx;
    ctx.logger.info("Briefs plugin setup");

    ctx.data.register("cards", async (params) => {
      const companyId = readCompanyId(params);
      const userId = readUserId(params);
      return {
        cards: await listBriefCards(ctx.db, {
          companyId,
          userId,
          includeHidden: boolField(params.includeHidden),
          limit: Number(params.limit ?? 100),
        }),
      };
    });

    ctx.actions.register("refresh-tree", async (params) => {
      const companyId = readCompanyId(params);
      const userId = readUserId(params);
      const rootIssueId = stringField(params.rootIssueId);
      if (!rootIssueId) throw new Error("rootIssueId is required");
      return refreshTreeCard(ctx, {
        companyId,
        userId,
        rootIssueId,
        companyIssuePrefix: stringField(params.companyIssuePrefix),
        forceRelevant: boolField(params.forceRelevant),
      });
    });

    ctx.actions.register("discover-cards", async (params) => {
      const companyId = readCompanyId(params);
      const userId = readUserId(params);
      const preferences = await getBriefPreferences(ctx.db, { companyId, userId });
      const since = new Date(Date.now() - preferences.discoveryWindowDays * 24 * 60 * 60 * 1000).toISOString();
      const rootIssueIds = await discoverCandidateRootIds(ctx, companyId, since, Number(params.limit ?? 100));
      const results = [];
      for (const rootIssueId of rootIssueIds.slice(0, preferences.maxUnpinnedCards)) {
        results.push(await refreshTreeCard(ctx, {
          companyId,
          userId,
          rootIssueId,
          companyIssuePrefix: stringField(params.companyIssuePrefix),
        }));
      }
      return { rootIssueIds, results };
    });

    ctx.actions.register("pin-card", async (params) => {
      const companyId = readCompanyId(params);
      const userId = readUserId(params);
      const cardId = stringField(params.cardId);
      if (!cardId) throw new Error("cardId is required");
      const pinned = boolField(params.pinned);
      await setBriefCardPinned(ctx.db, { companyId, userId, cardId, pinned });
      await ctx.activity.log({
        companyId,
        message: pinned ? "briefs.card_pinned" : "briefs.card_unpinned",
        entityType: "brief",
        entityId: cardId,
        metadata: { userId },
      });
      return { cardId, pinned };
    });

    ctx.actions.register("hide-card", async (params) => {
      const companyId = readCompanyId(params);
      const userId = readUserId(params);
      const cardId = stringField(params.cardId);
      if (!cardId) throw new Error("cardId is required");
      const hidden = boolField(params.hidden);
      await setBriefCardHidden(ctx.db, { companyId, userId, cardId, hidden });
      await ctx.activity.log({
        companyId,
        message: hidden ? "briefs.card_hidden" : "briefs.card_unhidden",
        entityType: "brief",
        entityId: cardId,
        metadata: { userId },
      });
      return { cardId, hidden };
    });
  },

  async onApiRequest(input: PluginApiRequestInput) {
    if (input.routeKey === "cards") {
      const userId = readUserId(input.query as Record<string, unknown>, input.actor.userId ?? input.actor.agentId ?? null);
      return {
        body: {
          cards: await listBriefCards(activeContext(input).db, {
            companyId: input.companyId,
            userId,
            includeHidden: boolField(input.query.includeHidden),
            limit: Number(input.query.limit ?? 100),
          }),
        },
      };
    }

    if (input.routeKey === "refresh-tree") {
      const body = objectBody(input.body);
      const rootIssueId = stringField(input.params.rootIssueId);
      if (!rootIssueId) throw new Error("rootIssueId is required");
      const userId = readUserId(body, input.actor.userId ?? input.actor.agentId ?? null);
      return {
        status: 202,
        body: await refreshTreeCard(activeContext(input), {
          companyId: input.companyId,
          userId,
          rootIssueId,
          companyIssuePrefix: stringField(body.companyIssuePrefix),
          forceRelevant: boolField(body.forceRelevant),
        }),
      };
    }

    return { status: 404, body: { error: `Unknown Briefs route: ${input.routeKey}` } };
  },

  async onHealth() {
    return {
      status: "ok",
      message: "Briefs worker is running",
      details: {
        surfaces: ["database", "deterministic-cards", "scoped-api-route"],
      },
    };
  },
});

function activeContext(_input?: PluginApiRequestInput): PluginContext {
  if (!currentContext) throw new Error("Briefs plugin has not been set up");
  return currentContext;
}

export default plugin;
runWorker(plugin, import.meta.url);
