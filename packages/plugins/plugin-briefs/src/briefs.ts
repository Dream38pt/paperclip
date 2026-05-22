import { createHash, randomUUID } from "node:crypto";
import type {
  Issue,
  IssueComment,
  IssueDocumentSummary,
  PluginDatabaseClient,
  PluginIssueApprovalSummary,
  PluginIssueRunSummary,
  PluginIssueSubtree,
} from "@paperclipai/plugin-sdk";

export const BRIEF_CARD_STATES = [
  "error",
  "blocked",
  "waiting-user",
  "waiting-reviewer",
  "live",
  "done",
  "stale",
] as const;

export type BriefCardState = (typeof BRIEF_CARD_STATES)[number];

export const BRIEF_SUMMARY_STATUSES = ["ok", "pending", "fallback"] as const;
export type BriefSummaryStatus = (typeof BRIEF_SUMMARY_STATUSES)[number];

export type BriefSummaryFailureReason =
  | "model_error"
  | "truncation_failed"
  | "budget_capped"
  | "safety_block";

export type BriefSourceKind =
  | "issue_tree"
  | "issue"
  | "run"
  | "comment"
  | "document"
  | "work_product"
  | "interaction"
  | "activity_event"
  | "approval";

export interface BriefUserPreferences {
  discoveryWindowDays: number;
  retentionDays: number;
  doneRetentionHours: number;
  staleAfterDays: number;
  maxUnpinnedCards: number;
}

export const DEFAULT_BRIEF_USER_PREFERENCES: BriefUserPreferences = {
  discoveryWindowDays: 14,
  retentionDays: 7,
  doneRetentionHours: 72,
  staleAfterDays: 7,
  maxUnpinnedCards: 50,
};

export interface BriefInteraction {
  id: string;
  companyId: string;
  issueId: string;
  kind: "suggest_tasks" | "ask_user_questions" | "request_confirmation" | string;
  status: string;
  title?: string | null;
  summary?: string | null;
  createdByUserId?: string | null;
  resolvedByUserId?: string | null;
  resolvedAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface BriefWorkProduct {
  id: string;
  companyId: string;
  issueId: string;
  title: string;
  type: string;
  status: string;
  url?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface BriefActivityEvent {
  id: string;
  companyId: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: Date | string;
  details?: Record<string, unknown> | null;
}

export interface BriefSourceCollections {
  commentsByIssueId?: Record<string, IssueComment[]>;
  documentsByIssueId?: Record<string, IssueDocumentSummary[]>;
  activeRunsByIssueId?: Record<string, PluginIssueRunSummary[]>;
  runs?: PluginIssueRunSummary[];
  approvals?: PluginIssueApprovalSummary[];
  interactionsByIssueId?: Record<string, BriefInteraction[]>;
  workProductsByIssueId?: Record<string, BriefWorkProduct[]>;
  activityEvents?: BriefActivityEvent[];
}

export interface BriefTaskRow {
  kind: Exclude<BriefSourceKind, "issue_tree" | "activity_event" | "work_product"> | "work_product";
  sourceId: string;
  identifier: string | null;
  titleLine: string;
  rightTag: string;
  linkPath: string;
  isIntraTreeBlocked?: boolean;
}

export interface BriefCardSourceDraft extends Omit<BriefTaskRow, "kind"> {
  id?: string;
  companyId: string;
  cardId?: string;
  kind: BriefSourceKind;
  sourceIssueId: string | null;
  sourceRunId?: string | null;
  eventAt: string;
  metadata?: Record<string, unknown>;
}

export interface BriefCardDraft {
  id?: string;
  companyId: string;
  userId: string;
  slug: string;
  title: string;
  groupingDescription: string;
  groupingHash: string;
  rootIssueId: string | null;
  state: BriefCardState;
  summaryStatus: BriefSummaryStatus;
  summaryParagraph: string | null;
  summaryModel?: string | null;
  summaryTokensIn?: number | null;
  summaryTokensOut?: number | null;
  summaryFailureReason?: BriefSummaryFailureReason | null;
  pinned: boolean;
  hidden: boolean;
  staleAt: string;
  expiresAt: string | null;
  lastMeaningfulEventAt: string;
  sources: BriefCardSourceDraft[];
  taskRows: BriefTaskRow[];
  evidenceSourceIds: string[];
}

export interface ExistingBriefCardState {
  id?: string;
  slug?: string | null;
  pinned?: boolean | null;
  hidden?: boolean | null;
}

export interface BuildBriefCardInput {
  companyId: string;
  userId: string;
  subtree: PluginIssueSubtree;
  sources?: BriefSourceCollections;
  now?: Date | string;
  preferences?: Partial<BriefUserPreferences>;
  companyIssuePrefix?: string | null;
  existingCard?: ExistingBriefCardState | null;
  forceRelevant?: boolean;
  summary?: {
    status: BriefSummaryStatus;
    paragraph?: string | null;
    model?: string | null;
    tokensIn?: number | null;
    tokensOut?: number | null;
    failureReason?: BriefSummaryFailureReason | null;
    evidenceSourceIds?: string[];
  };
}

export interface BriefRelevanceResult {
  relevant: boolean;
  reasons: string[];
  lastMeaningfulEventAt: string;
}

export interface BriefCursorState {
  lastEventAt: string | null;
  lastEventId: string | null;
  dedupeKeys: string[];
}

export interface BriefCursorEvent {
  id: string;
  eventAt: Date | string;
  dedupeKey?: string | null;
}

export interface BriefCursorAdvanceResult<TEvent extends BriefCursorEvent> {
  acceptedEvents: TEvent[];
  nextCursor: BriefCursorState;
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const ACTIVE_RUN_STATUSES = new Set(["queued", "starting", "running"]);
const FAILED_RUN_STATUSES = new Set(["failed", "error"]);
const PENDING_INTERACTION_STATUSES = new Set(["pending"]);
const NON_TERMINAL_ISSUE_STATUSES = new Set(["backlog", "todo", "in_progress", "in_review", "blocked"]);

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value: Date | string): string {
  const date = toDate(value);
  if (!date) throw new Error(`Invalid date: ${String(value)}`);
  return date.toISOString();
}

function addMs(value: Date, amountMs: number): string {
  return new Date(value.getTime() + amountMs).toISOString();
}

function maxDate(values: Array<Date | string | null | undefined>, fallback: Date): Date {
  let result = fallback;
  for (const value of values) {
    const date = toDate(value);
    if (date && date.getTime() > result.getTime()) result = date;
  }
  return result;
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 56);
  return slug || "brief";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function issuePath(issue: Pick<Issue, "id" | "identifier">, companyIssuePrefix?: string | null): string {
  const ref = issue.identifier ?? issue.id;
  return companyIssuePrefix ? `/${companyIssuePrefix}/issues/${ref}` : `/issues/${ref}`;
}

function runPath(run: Pick<PluginIssueRunSummary, "id" | "agentId">, companyIssuePrefix?: string | null): string {
  const path = `/agents/${run.agentId}/runs/${run.id}`;
  return companyIssuePrefix ? `/${companyIssuePrefix}${path}` : path;
}

function issueById(subtree: PluginIssueSubtree): Map<string, Issue> {
  return new Map(subtree.issues.map((issue) => [issue.id, issue]));
}

function assertCompanyScoped(input: BuildBriefCardInput): void {
  if (input.subtree.companyId !== input.companyId) {
    throw new Error("Brief subtree company does not match requested company");
  }
  for (const issue of input.subtree.issues) {
    if (issue.companyId !== input.companyId) {
      throw new Error(`Brief source issue ${issue.id} belongs to another company`);
    }
  }
  for (const comments of Object.values(input.sources?.commentsByIssueId ?? {})) {
    for (const comment of comments) {
      if (comment.companyId !== input.companyId) {
        throw new Error(`Brief source comment ${comment.id} belongs to another company`);
      }
    }
  }
  for (const docs of Object.values(input.sources?.documentsByIssueId ?? {})) {
    for (const doc of docs) {
      if (doc.companyId !== input.companyId) {
        throw new Error(`Brief source document ${doc.id} belongs to another company`);
      }
    }
  }
  for (const interactions of Object.values(input.sources?.interactionsByIssueId ?? {})) {
    for (const interaction of interactions) {
      if (interaction.companyId !== input.companyId) {
        throw new Error(`Brief source interaction ${interaction.id} belongs to another company`);
      }
    }
  }
  for (const products of Object.values(input.sources?.workProductsByIssueId ?? {})) {
    for (const product of products) {
      if (product.companyId !== input.companyId) {
        throw new Error(`Brief source work product ${product.id} belongs to another company`);
      }
    }
  }
  for (const event of input.sources?.activityEvents ?? []) {
    if (event.companyId !== input.companyId) {
      throw new Error(`Brief source activity event ${event.id} belongs to another company`);
    }
  }
}

function sourceDates(subtree: PluginIssueSubtree, sources: BriefSourceCollections | undefined): Array<Date | string | null | undefined> {
  return [
    ...subtree.issues.flatMap((issue) => [issue.updatedAt, issue.startedAt, issue.completedAt, issue.cancelledAt]),
    ...Object.values(sources?.commentsByIssueId ?? {}).flat().map((comment) => comment.createdAt),
    ...Object.values(sources?.documentsByIssueId ?? subtree.documents ?? {}).flat().map((doc) => doc.updatedAt),
    ...Object.values(sources?.activeRunsByIssueId ?? subtree.activeRuns ?? {}).flat().flatMap((run) => [
      run.startedAt,
      run.finishedAt,
      run.createdAt,
    ]),
    ...(sources?.runs ?? []).flatMap((run) => [run.startedAt, run.finishedAt, run.createdAt]),
    ...(sources?.approvals ?? []).flatMap((approval) => [approval.decidedAt, approval.createdAt]),
    ...Object.values(sources?.interactionsByIssueId ?? {}).flat().flatMap((interaction) => [
      interaction.resolvedAt,
      interaction.updatedAt,
      interaction.createdAt,
    ]),
    ...Object.values(sources?.workProductsByIssueId ?? {}).flat().map((product) => product.updatedAt),
    ...(sources?.activityEvents ?? []).map((event) => event.createdAt),
  ];
}

export function resolveBriefRelevance(input: {
  companyId: string;
  userId: string;
  subtree: PluginIssueSubtree;
  sources?: BriefSourceCollections;
  now?: Date | string;
  preferences?: Partial<BriefUserPreferences>;
}): BriefRelevanceResult {
  const preferences = { ...DEFAULT_BRIEF_USER_PREFERENCES, ...input.preferences };
  const now = toDate(input.now) ?? new Date();
  const root = input.subtree.issues.find((issue) => issue.id === input.subtree.rootIssueId) ?? input.subtree.issues[0];
  const reasons: string[] = [];

  if (root?.createdByUserId === input.userId) reasons.push("root-created-by-user");
  if (input.subtree.issues.some((issue) => issue.createdByUserId === input.userId)) reasons.push("issue-created-by-user");
  if (input.subtree.issues.some((issue) => issue.assigneeUserId === input.userId)) reasons.push("issue-assigned-to-user");
  if (
    input.subtree.issues.some((issue) => {
      const participant = issue.executionState?.currentParticipant;
      const returnAssignee = issue.executionState?.returnAssignee;
      return (
        (participant?.type === "user" && participant.userId === input.userId) ||
        (returnAssignee?.type === "user" && returnAssignee.userId === input.userId)
      );
    })
  ) {
    reasons.push("user-execution-participant");
  }
  if (Object.values(input.sources?.commentsByIssueId ?? {}).flat().some((comment) => comment.authorUserId === input.userId)) {
    reasons.push("user-authored-comment");
  }
  if (
    Object.values(input.sources?.documentsByIssueId ?? input.subtree.documents ?? {})
      .flat()
      .some((doc) => doc.createdByUserId === input.userId || doc.updatedByUserId === input.userId)
  ) {
    reasons.push("user-authored-document");
  }
  if (
    Object.values(input.sources?.interactionsByIssueId ?? {})
      .flat()
      .some((interaction) => interaction.createdByUserId === input.userId || interaction.resolvedByUserId === input.userId)
  ) {
    reasons.push("user-touched-interaction");
  }
  if (
    (input.sources?.approvals ?? []).some(
      (approval) => approval.requestedByUserId === input.userId || approval.decidedByUserId === input.userId,
    )
  ) {
    reasons.push("user-touched-approval");
  }

  const lastMeaningfulEvent = maxDate(sourceDates(input.subtree, input.sources), root ? toDate(root.updatedAt) ?? now : now);
  const fresh = now.getTime() - lastMeaningfulEvent.getTime() <= preferences.discoveryWindowDays * MS_PER_DAY;

  return {
    relevant: reasons.length > 0 && fresh,
    reasons,
    lastMeaningfulEventAt: lastMeaningfulEvent.toISOString(),
  };
}

function failedRunsByIssueWithin(runs: PluginIssueRunSummary[], since: Date): Map<string, number> {
  const counts = new Map<string, number>();
  for (const run of runs) {
    const issueId = run.issueId;
    if (!issueId || !FAILED_RUN_STATUSES.has(run.status)) continue;
    const eventAt = toDate(run.finishedAt) ?? toDate(run.createdAt);
    if (!eventAt || eventAt.getTime() < since.getTime()) continue;
    counts.set(issueId, (counts.get(issueId) ?? 0) + 1);
  }
  return counts;
}

function hasOutOfTreeBlocker(issueId: string, treeIssueIds: Set<string>, relations: PluginIssueSubtree["relations"]): boolean {
  const blockedBy = relations?.[issueId]?.blockedBy ?? [];
  return blockedBy.some((blocker) => !treeIssueIds.has(blocker.id) && blocker.status !== "done");
}

function hasAttentionBlocker(issue: Issue): boolean {
  const attention = issue.blockerAttention;
  if (!attention) return false;
  return attention.state === "stalled" || attention.state === "needs_attention" || attention.reason === "stalled_review" || attention.reason === "attention_required";
}

export function resolveBriefState(input: {
  subtree: PluginIssueSubtree;
  sources?: BriefSourceCollections;
  userId: string;
  now?: Date | string;
  preferences?: Partial<BriefUserPreferences>;
}): BriefCardState {
  const preferences = { ...DEFAULT_BRIEF_USER_PREFERENCES, ...input.preferences };
  const now = toDate(input.now) ?? new Date();
  const treeIssueIds = new Set(input.subtree.issueIds);
  const allRuns = [
    ...Object.values(input.sources?.activeRunsByIssueId ?? input.subtree.activeRuns ?? {}).flat(),
    ...(input.sources?.runs ?? []),
  ];

  if (input.subtree.issues.some((issue) => issue.activeRecoveryAction)) return "error";
  const failedCounts = failedRunsByIssueWithin(allRuns, new Date(now.getTime() - 24 * MS_PER_HOUR));
  if ([...failedCounts.values()].some((count) => count >= 3)) return "error";

  if (
    input.subtree.issues.some((issue) => (
      issue.status === "blocked" &&
      (hasOutOfTreeBlocker(issue.id, treeIssueIds, input.subtree.relations) || hasAttentionBlocker(issue))
    ))
  ) {
    return "blocked";
  }

  const pendingInteractions = Object.values(input.sources?.interactionsByIssueId ?? {})
    .flat()
    .filter((interaction) => PENDING_INTERACTION_STATUSES.has(interaction.status));
  if (pendingInteractions.some((interaction) => (
    interaction.kind === "request_confirmation" ||
    interaction.kind === "ask_user_questions" ||
    interaction.kind === "suggest_tasks"
  ))) {
    return "waiting-user";
  }
  if ((input.sources?.approvals ?? []).some((approval) => approval.status === "pending" && approval.decidedByUserId == null)) {
    return "waiting-user";
  }

  const hasUserReview = input.subtree.issues.some((issue) => {
    const participant = issue.executionState?.currentParticipant;
    return issue.status === "in_review" && participant?.type === "user" && participant.userId === input.userId;
  });
  if (hasUserReview) return "waiting-user";

  const hasReviewerWait = input.subtree.issues.some((issue) => {
    if (issue.status !== "in_review") return false;
    const participant = issue.executionState?.currentParticipant;
    return participant !== null || (input.sources?.approvals ?? []).some((approval) => approval.issueId === issue.id && approval.status === "pending");
  });
  if (hasReviewerWait) return "waiting-reviewer";

  const lastMeaningfulEvent = maxDate(sourceDates(input.subtree, input.sources), now);
  const liveWindowOpen = now.getTime() - lastMeaningfulEvent.getTime() <= 6 * MS_PER_HOUR;
  const hasActiveRun = allRuns.some((run) => ACTIVE_RUN_STATUSES.has(run.status));
  const hasInProgress = input.subtree.issues.some((issue) => issue.status === "in_progress");
  if ((hasActiveRun || hasInProgress) && liveWindowOpen) return "live";

  const root = input.subtree.issues.find((issue) => issue.id === input.subtree.rootIssueId) ?? input.subtree.issues[0];
  const completedAt = toDate(root?.completedAt);
  if (
    root?.status === "done" &&
    completedAt &&
    now.getTime() - completedAt.getTime() <= preferences.doneRetentionHours * MS_PER_HOUR
  ) {
    return "done";
  }

  return "stale";
}

function lifecycle(input: {
  pinned: boolean;
  state: BriefCardState;
  lastMeaningfulEventAt: string;
  preferences: BriefUserPreferences;
}): { staleAt: string; expiresAt: string | null } {
  const last = toDate(input.lastMeaningfulEventAt) ?? new Date();
  const staleAt = addMs(last, input.preferences.staleAfterDays * MS_PER_DAY);
  if (input.pinned) return { staleAt, expiresAt: null };
  const retentionMs = input.state === "done"
    ? input.preferences.doneRetentionHours * MS_PER_HOUR
    : input.preferences.retentionDays * MS_PER_DAY;
  return { staleAt, expiresAt: addMs(last, retentionMs) };
}

function issueRightTag(issue: Issue, treeIssueIds: Set<string>, relations: PluginIssueSubtree["relations"]): { tag: string; isIntraTreeBlocked?: boolean } {
  if (issue.status === "blocked") {
    const blockers = relations?.[issue.id]?.blockedBy ?? [];
    const isIntraTreeBlocked = blockers.length > 0 && blockers.every((blocker) => treeIssueIds.has(blocker.id));
    return { tag: "blocked", isIntraTreeBlocked };
  }
  return { tag: issue.status };
}

function sourcePriority(source: BriefCardSourceDraft): number {
  if (source.rightTag === "blocked") return source.isIntraTreeBlocked ? 2 : 0;
  if (source.rightTag === "pending" || source.rightTag === "asked you" || source.kind === "approval") return 1;
  if (source.rightTag === "failed" || source.rightTag === "error") return 2;
  if (source.rightTag === "running" || source.rightTag === "in_progress") return 3;
  if (source.rightTag === "in_review") return 4;
  return 5;
}

export function buildBriefSources(input: {
  companyId: string;
  subtree: PluginIssueSubtree;
  sources?: BriefSourceCollections;
  companyIssuePrefix?: string | null;
}): BriefCardSourceDraft[] {
  const sources: BriefCardSourceDraft[] = [];
  const issues = issueById(input.subtree);
  const treeIssueIds = new Set(input.subtree.issueIds);
  const root = issues.get(input.subtree.rootIssueId) ?? input.subtree.issues[0];
  const rootEventAt = toIso(root?.updatedAt ?? new Date());

  if (root) {
    sources.push({
      companyId: input.companyId,
      kind: "issue_tree",
      sourceId: root.id,
      sourceIssueId: root.id,
      identifier: root.identifier,
      titleLine: truncate(root.title, 60),
      rightTag: "tree",
      linkPath: issuePath(root, input.companyIssuePrefix),
      eventAt: rootEventAt,
      metadata: { issueCount: input.subtree.issueIds.length },
    });
  }

  for (const issue of input.subtree.issues) {
    const { tag, isIntraTreeBlocked } = issueRightTag(issue, treeIssueIds, input.subtree.relations);
    const shouldShow = issue.status === "blocked" || issue.status === "in_review" || issue.status === "in_progress" || issue.activeRecoveryAction || issue.id === input.subtree.rootIssueId;
    if (!shouldShow) continue;
    sources.push({
      companyId: input.companyId,
      kind: "issue",
      sourceId: issue.id,
      sourceIssueId: issue.id,
      identifier: issue.identifier,
      titleLine: truncate(issue.title, 60),
      rightTag: issue.activeRecoveryAction ? "error" : tag,
      linkPath: issuePath(issue, input.companyIssuePrefix),
      isIntraTreeBlocked,
      eventAt: toIso(issue.updatedAt),
      metadata: { priority: issue.priority, assigneeAgentId: issue.assigneeAgentId },
    });
  }

  for (const [issueId, comments] of Object.entries(input.sources?.commentsByIssueId ?? {})) {
    const issue = issues.get(issueId);
    if (!issue) continue;
    for (const comment of comments.slice(-3)) {
      sources.push({
        companyId: input.companyId,
        kind: "comment",
        sourceId: comment.id,
        sourceIssueId: issue.id,
        identifier: issue.identifier,
        titleLine: truncate(comment.body, 60),
        rightTag: comment.authorType,
        linkPath: `${issuePath(issue, input.companyIssuePrefix)}#comment-${comment.id}`,
        eventAt: toIso(comment.createdAt),
      });
    }
  }

  for (const [issueId, docs] of Object.entries(input.sources?.documentsByIssueId ?? input.subtree.documents ?? {})) {
    const issue = issues.get(issueId);
    if (!issue) continue;
    for (const doc of docs.slice(-3)) {
      sources.push({
        companyId: input.companyId,
        kind: "document",
        sourceId: doc.id,
        sourceIssueId: issue.id,
        identifier: issue.identifier,
        titleLine: truncate(doc.title ?? doc.key, 60),
        rightTag: "document",
        linkPath: `${issuePath(issue, input.companyIssuePrefix)}#document-${encodeURIComponent(doc.key)}`,
        eventAt: toIso(doc.updatedAt),
      });
    }
  }

  const activeRunsByIssue = input.sources?.activeRunsByIssueId ?? input.subtree.activeRuns ?? {};
  for (const [issueId, runs] of Object.entries(activeRunsByIssue)) {
    const issue = issues.get(issueId);
    if (!issue) continue;
    for (const run of runs) {
      sources.push({
        companyId: input.companyId,
        kind: "run",
        sourceId: run.id,
        sourceIssueId: issue.id,
        sourceRunId: run.id,
        identifier: issue.identifier,
        titleLine: truncate(`${issue.title} run`, 60),
        rightTag: run.status,
        linkPath: runPath(run, input.companyIssuePrefix),
        eventAt: toIso(run.startedAt ?? run.createdAt),
      });
    }
  }

  for (const run of input.sources?.runs ?? []) {
    if (!run.issueId || activeRunsByIssue[run.issueId]?.some((activeRun) => activeRun.id === run.id)) continue;
    const issue = issues.get(run.issueId);
    if (!issue) continue;
    sources.push({
      companyId: input.companyId,
      kind: "run",
      sourceId: run.id,
      sourceIssueId: issue.id,
      sourceRunId: run.id,
      identifier: issue.identifier,
      titleLine: truncate(`${issue.title} run`, 60),
      rightTag: run.status,
      linkPath: runPath(run, input.companyIssuePrefix),
      eventAt: toIso(run.finishedAt ?? run.startedAt ?? run.createdAt),
    });
  }

  for (const approval of input.sources?.approvals ?? []) {
    const issue = issues.get(approval.issueId);
    if (!issue) continue;
    sources.push({
      companyId: input.companyId,
      kind: "approval",
      sourceId: approval.id,
      sourceIssueId: issue.id,
      identifier: issue.identifier,
      titleLine: truncate(`${approval.type} approval`, 60),
      rightTag: approval.status === "pending" ? "approval" : approval.status,
      linkPath: input.companyIssuePrefix ? `/${input.companyIssuePrefix}/approvals/${approval.id}` : `/approvals/${approval.id}`,
      eventAt: toIso(approval.decidedAt ?? approval.createdAt),
    });
  }

  for (const [issueId, interactions] of Object.entries(input.sources?.interactionsByIssueId ?? {})) {
    const issue = issues.get(issueId);
    if (!issue) continue;
    for (const interaction of interactions) {
      sources.push({
        companyId: input.companyId,
        kind: "interaction",
        sourceId: interaction.id,
        sourceIssueId: issue.id,
        identifier: issue.identifier,
        titleLine: truncate(interaction.title ?? interaction.summary ?? interaction.kind, 60),
        rightTag: interaction.status === "pending" ? "asked you" : interaction.status,
        linkPath: `${issuePath(issue, input.companyIssuePrefix)}#interaction-${interaction.id}`,
        eventAt: toIso(interaction.updatedAt),
      });
    }
  }

  for (const [issueId, products] of Object.entries(input.sources?.workProductsByIssueId ?? {})) {
    const issue = issues.get(issueId);
    if (!issue) continue;
    for (const product of products) {
      sources.push({
        companyId: input.companyId,
        kind: "work_product",
        sourceId: product.id,
        sourceIssueId: issue.id,
        identifier: issue.identifier,
        titleLine: truncate(product.title, 60),
        rightTag: product.status,
        linkPath: product.url ?? `${issuePath(issue, input.companyIssuePrefix)}#work-product-${product.id}`,
        eventAt: toIso(product.updatedAt),
        metadata: { type: product.type },
      });
    }
  }

  for (const event of input.sources?.activityEvents ?? []) {
    sources.push({
      companyId: input.companyId,
      kind: "activity_event",
      sourceId: event.id,
      sourceIssueId: event.entityType === "issue" ? event.entityId : null,
      identifier: null,
      titleLine: truncate(event.action, 60),
      rightTag: "activity",
      linkPath: input.companyIssuePrefix ? `/${input.companyIssuePrefix}/activity?event=${event.id}` : `/activity?event=${event.id}`,
      eventAt: toIso(event.createdAt),
      metadata: event.details ?? {},
    });
  }

  return sources.sort((a, b) => {
    const byPriority = sourcePriority(a) - sourcePriority(b);
    if (byPriority !== 0) return byPriority;
    return (toDate(b.eventAt)?.getTime() ?? 0) - (toDate(a.eventAt)?.getTime() ?? 0);
  });
}

function toTaskRow(source: BriefCardSourceDraft): BriefTaskRow | null {
  if (source.kind === "issue_tree" || source.kind === "activity_event") return null;
  return {
    kind: source.kind,
    sourceId: source.sourceId,
    identifier: source.identifier,
    titleLine: source.titleLine,
    rightTag: source.rightTag,
    linkPath: source.linkPath,
    ...(source.isIntraTreeBlocked === undefined ? {} : { isIntraTreeBlocked: source.isIntraTreeBlocked }),
  };
}

export function buildBriefCardDraft(input: BuildBriefCardInput): BriefCardDraft | null {
  assertCompanyScoped(input);
  const preferences = { ...DEFAULT_BRIEF_USER_PREFERENCES, ...input.preferences };
  const root = input.subtree.issues.find((issue) => issue.id === input.subtree.rootIssueId) ?? input.subtree.issues[0];
  if (!root) return null;
  const relevance = resolveBriefRelevance(input);
  if (!input.forceRelevant && !relevance.relevant) return null;
  const state = resolveBriefState(input);
  const pinned = input.existingCard?.pinned === true;
  const hidden = input.existingCard?.hidden === true;
  const { staleAt, expiresAt } = lifecycle({
    pinned,
    state,
    lastMeaningfulEventAt: relevance.lastMeaningfulEventAt,
    preferences,
  });
  const groupingDescription = `Issue tree ${root.identifier ?? root.id}: ${root.title}`;
  const groupingHash = hash(`${input.companyId}:${input.userId}:root:${root.id}`);
  const slugBase = input.existingCard?.slug || slugify(root.identifier ? `${root.identifier}-${root.title}` : root.title);
  const slug = truncate(slugBase, 64).replace(/…$/, "");
  const sourceDrafts = buildBriefSources(input);
  const taskRows = sourceDrafts.map(toTaskRow).filter((row): row is BriefTaskRow => row !== null).slice(0, 3);
  const summary = input.summary ?? { status: "pending" as const };

  return {
    id: input.existingCard?.id,
    companyId: input.companyId,
    userId: input.userId,
    slug,
    title: truncate(root.title, 70),
    groupingDescription,
    groupingHash,
    rootIssueId: root.id,
    state,
    summaryStatus: summary.status,
    summaryParagraph: summary.paragraph ?? null,
    summaryModel: summary.model ?? null,
    summaryTokensIn: summary.tokensIn ?? null,
    summaryTokensOut: summary.tokensOut ?? null,
    summaryFailureReason: summary.failureReason ?? null,
    pinned,
    hidden,
    staleAt,
    expiresAt,
    lastMeaningfulEventAt: relevance.lastMeaningfulEventAt,
    sources: sourceDrafts,
    taskRows,
    evidenceSourceIds: summary.evidenceSourceIds ?? [],
  };
}

export function sortBriefCards<T extends Pick<BriefCardDraft, "pinned" | "lastMeaningfulEventAt" | "state">>(cards: T[]): T[] {
  const stateOrder = new Map<BriefCardState, number>(BRIEF_CARD_STATES.map((state, index) => [state, index]));
  return [...cards].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const stateDelta = (stateOrder.get(a.state) ?? 99) - (stateOrder.get(b.state) ?? 99);
    if (stateDelta !== 0) return stateDelta;
    return (toDate(b.lastMeaningfulEventAt)?.getTime() ?? 0) - (toDate(a.lastMeaningfulEventAt)?.getTime() ?? 0);
  });
}

export function advanceBriefCursor<TEvent extends BriefCursorEvent>(input: {
  cursor: BriefCursorState | null;
  events: TEvent[];
  overlapWindowMs?: number;
  dedupeLimit?: number;
}): BriefCursorAdvanceResult<TEvent> {
  const overlapMs = input.overlapWindowMs ?? MS_PER_HOUR;
  const dedupeLimit = input.dedupeLimit ?? 500;
  const previousLastAt = toDate(input.cursor?.lastEventAt ?? null);
  const windowStart = previousLastAt ? new Date(previousLastAt.getTime() - overlapMs) : null;
  const seen = new Set(input.cursor?.dedupeKeys ?? []);
  const ordered = [...input.events].sort((a, b) => {
    const aTime = toDate(a.eventAt)?.getTime() ?? 0;
    const bTime = toDate(b.eventAt)?.getTime() ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.id.localeCompare(b.id);
  });
  const acceptedEvents: TEvent[] = [];
  const nextDedupeKeys = [...seen];

  for (const event of ordered) {
    const eventAt = toDate(event.eventAt);
    if (!eventAt) continue;
    const dedupeKey = event.dedupeKey ?? event.id;
    if (windowStart && eventAt.getTime() < windowStart.getTime()) continue;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    nextDedupeKeys.push(dedupeKey);
    acceptedEvents.push(event);
  }

  const lastAccepted = acceptedEvents[acceptedEvents.length - 1] ?? ordered[ordered.length - 1] ?? null;
  const lastAcceptedAt = lastAccepted ? toDate(lastAccepted.eventAt) : previousLastAt;
  return {
    acceptedEvents,
    nextCursor: {
      lastEventAt: lastAcceptedAt ? lastAcceptedAt.toISOString() : input.cursor?.lastEventAt ?? null,
      lastEventId: lastAccepted?.id ?? input.cursor?.lastEventId ?? null,
      dedupeKeys: nextDedupeKeys.slice(-dedupeLimit),
    },
  };
}

function table(namespace: string, name: string): string {
  return `${namespace}.${name}`;
}

export async function getBriefPreferences(db: PluginDatabaseClient, input: {
  companyId: string;
  userId: string;
}): Promise<BriefUserPreferences> {
  const rows = await db.query<{
    discovery_window_days: number;
    retention_days: number;
    done_retention_hours: number;
    stale_after_days: number;
    max_unpinned_cards: number;
  }>(
    `SELECT discovery_window_days, retention_days, done_retention_hours, stale_after_days, max_unpinned_cards
     FROM ${table(db.namespace, "briefs_user_preferences")}
     WHERE company_id = $1 AND user_id = $2`,
    [input.companyId, input.userId],
  );
  const row = rows[0];
  return row
    ? {
        discoveryWindowDays: Number(row.discovery_window_days),
        retentionDays: Number(row.retention_days),
        doneRetentionHours: Number(row.done_retention_hours),
        staleAfterDays: Number(row.stale_after_days),
        maxUnpinnedCards: Number(row.max_unpinned_cards),
      }
    : DEFAULT_BRIEF_USER_PREFERENCES;
}

export async function listBriefCards(db: PluginDatabaseClient, input: {
  companyId: string;
  userId: string;
  includeHidden?: boolean;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  return db.query(
    `SELECT c.*, s.task_rows, s.summary_paragraph, s.summary_failure_reason, s.created_at AS snapshot_created_at
     FROM ${table(db.namespace, "briefs_cards")} c
     LEFT JOIN ${table(db.namespace, "briefs_card_snapshots")} s ON s.id = c.latest_snapshot_id
     WHERE c.company_id = $1 AND c.user_id = $2 AND ($3::boolean = true OR c.hidden = false)
     ORDER BY c.pinned DESC, c.last_meaningful_event_at DESC, c.id ASC
     LIMIT $4`,
    [input.companyId, input.userId, input.includeHidden === true, input.limit ?? 100],
  );
}

export async function findExistingBriefCard(db: PluginDatabaseClient, input: {
  companyId: string;
  userId: string;
  groupingHash: string;
}): Promise<ExistingBriefCardState | null> {
  const rows = await db.query<{
    id: string;
    slug: string;
    pinned: boolean;
    hidden: boolean;
  }>(
    `SELECT id, slug, pinned, hidden
     FROM ${table(db.namespace, "briefs_cards")}
     WHERE company_id = $1 AND user_id = $2 AND grouping_hash = $3
     LIMIT 1`,
    [input.companyId, input.userId, input.groupingHash],
  );
  return rows[0] ?? null;
}

export async function upsertBriefCard(db: PluginDatabaseClient, draft: BriefCardDraft): Promise<{ cardId: string; snapshotId: string }> {
  const cardId = draft.id ?? randomUUID();
  const snapshotId = randomUUID();

  await db.execute(
    `INSERT INTO ${table(db.namespace, "briefs_cards")} AS cards
       (id, company_id, user_id, slug, title, grouping_description, grouping_hash, root_issue_id, state, summary_status,
        pinned, hidden, stale_at, expires_at, last_meaningful_event_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz, $14::timestamptz, $15::timestamptz, now(), now())
     ON CONFLICT (company_id, user_id, grouping_hash) DO UPDATE SET
       title = EXCLUDED.title,
       grouping_description = EXCLUDED.grouping_description,
       root_issue_id = EXCLUDED.root_issue_id,
       state = EXCLUDED.state,
       summary_status = EXCLUDED.summary_status,
       stale_at = EXCLUDED.stale_at,
       expires_at = CASE WHEN cards.pinned THEN NULL ELSE EXCLUDED.expires_at END,
       last_meaningful_event_at = EXCLUDED.last_meaningful_event_at,
       updated_at = now()`,
    [
      cardId,
      draft.companyId,
      draft.userId,
      draft.slug,
      draft.title,
      draft.groupingDescription,
      draft.groupingHash,
      draft.rootIssueId,
      draft.state,
      draft.summaryStatus,
      draft.pinned,
      draft.hidden,
      draft.staleAt,
      draft.expiresAt,
      draft.lastMeaningfulEventAt,
    ],
  );

  const existing = await findExistingBriefCard(db, {
    companyId: draft.companyId,
    userId: draft.userId,
    groupingHash: draft.groupingHash,
  });
  const resolvedCardId = existing?.id ?? cardId;

  await db.execute(
    `INSERT INTO ${table(db.namespace, "briefs_card_snapshots")}
       (id, company_id, card_id, summary_paragraph, summary_status, summary_model, summary_tokens_in,
        summary_tokens_out, summary_failure_reason, task_rows, evidence_source_ids, generated_by_agent_id, generated_by_run_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, NULL, NULL, now())`,
    [
      snapshotId,
      draft.companyId,
      resolvedCardId,
      draft.summaryParagraph,
      draft.summaryStatus,
      draft.summaryModel ?? null,
      draft.summaryTokensIn ?? null,
      draft.summaryTokensOut ?? null,
      draft.summaryFailureReason ?? null,
      JSON.stringify(draft.taskRows),
      JSON.stringify(draft.evidenceSourceIds),
    ],
  );

  await db.execute(
    `DELETE FROM ${table(db.namespace, "briefs_card_sources")} WHERE card_id = $1`,
    [resolvedCardId],
  );

  for (const source of draft.sources) {
    await db.execute(
      `INSERT INTO ${table(db.namespace, "briefs_card_sources")}
         (id, company_id, card_id, source_kind, source_id, source_issue_id, source_run_id, identifier, title_line,
          right_tag, link_path, is_intra_tree_blocked, event_at, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz, $14::jsonb, now())`,
      [
        randomUUID(),
        draft.companyId,
        resolvedCardId,
        source.kind,
        source.sourceId,
        source.sourceIssueId,
        source.sourceRunId ?? null,
        source.identifier,
        source.titleLine,
        source.rightTag,
        source.linkPath,
        source.isIntraTreeBlocked ?? null,
        source.eventAt,
        JSON.stringify(source.metadata ?? {}),
      ],
    );
  }

  await db.execute(
    `UPDATE ${table(db.namespace, "briefs_cards")}
     SET latest_snapshot_id = $1, updated_at = now()
     WHERE id = $2 AND company_id = $3 AND user_id = $4`,
    [snapshotId, resolvedCardId, draft.companyId, draft.userId],
  );

  return { cardId: resolvedCardId, snapshotId };
}

export async function setBriefCardPinned(db: PluginDatabaseClient, input: {
  companyId: string;
  userId: string;
  cardId: string;
  pinned: boolean;
}): Promise<void> {
  await db.execute(
    `UPDATE ${table(db.namespace, "briefs_cards")}
     SET pinned = $4, expires_at = CASE WHEN $4 THEN NULL ELSE expires_at END, updated_at = now()
     WHERE company_id = $1 AND user_id = $2 AND id = $3`,
    [input.companyId, input.userId, input.cardId, input.pinned],
  );
}

export async function setBriefCardHidden(db: PluginDatabaseClient, input: {
  companyId: string;
  userId: string;
  cardId: string;
  hidden: boolean;
}): Promise<void> {
  await db.execute(
    `UPDATE ${table(db.namespace, "briefs_cards")}
     SET hidden = $4, updated_at = now()
     WHERE company_id = $1 AND user_id = $2 AND id = $3`,
    [input.companyId, input.userId, input.cardId, input.hidden],
  );
}
