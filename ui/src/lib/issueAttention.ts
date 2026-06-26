import type { Issue } from "@paperclipai/shared";

export type IssueAttentionKind = "needs_go" | "confirmation_required" | "review_requested" | "agent_blocked";

export interface IssueAttentionState {
  kind: IssueAttentionKind;
  label: string;
  description: string;
  tone: "amber" | "orange" | "blue" | "red";
}

export const ISSUE_ATTENTION_STATES: Record<IssueAttentionKind, IssueAttentionState> = {
  needs_go: {
    kind: "needs_go",
    label: "GO requis",
    description: "Action board requise",
    tone: "orange",
  },
  confirmation_required: {
    kind: "confirmation_required",
    label: "Confirmation requise",
    description: "Réponse humaine requise",
    tone: "amber",
  },
  review_requested: {
    kind: "review_requested",
    label: "Révision demandée",
    description: "Revue humaine demandée",
    tone: "blue",
  },
  agent_blocked: {
    kind: "agent_blocked",
    label: "Agent bloqué",
    description: "Intervention requise pour reprendre",
    tone: "red",
  },
};

export function getIssueAttentionState(issue: Pick<Issue, "status" | "blockedInboxAttention" | "executionState">): IssueAttentionState | null {
  const blockedAttention = issue.blockedInboxAttention ?? null;
  if (blockedAttention) {
    if (blockedAttention.approvalId) return ISSUE_ATTENTION_STATES.needs_go;
    if (blockedAttention.interactionId) return ISSUE_ATTENTION_STATES.confirmation_required;
    if (blockedAttention.reason === "pending_board_decision") return ISSUE_ATTENTION_STATES.needs_go;
    if (blockedAttention.reason === "pending_user_decision") return ISSUE_ATTENTION_STATES.confirmation_required;
    if (blockedAttention.owner.type === "agent") return ISSUE_ATTENTION_STATES.agent_blocked;
  }

  const executionState = issue.executionState ?? null;
  if (issue.status === "in_review" && executionState?.status === "pending") {
    if (executionState.currentStageType === "approval") return ISSUE_ATTENTION_STATES.needs_go;
    if (executionState.currentStageType === "review") return ISSUE_ATTENTION_STATES.review_requested;
  }

  if (issue.status === "blocked") return ISSUE_ATTENTION_STATES.agent_blocked;

  return null;
}

export function countIssuesNeedingAttention(issues: readonly Issue[]): number {
  return issues.reduce((count, issue) => count + (getIssueAttentionState(issue) ? 1 : 0), 0);
}

const ATTENTION_PRIORITY: IssueAttentionKind[] = [
  "agent_blocked",
  "needs_go",
  "confirmation_required",
  "review_requested",
];

export function getHighestIssueAttentionState(issues: readonly Issue[]): IssueAttentionState | null {
  const states = new Set(issues.map((issue) => getIssueAttentionState(issue)?.kind).filter(Boolean) as IssueAttentionKind[]);
  const kind = ATTENTION_PRIORITY.find((candidate) => states.has(candidate));
  return kind ? ISSUE_ATTENTION_STATES[kind] : null;
}
