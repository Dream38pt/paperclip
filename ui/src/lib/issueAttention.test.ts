import type { Issue } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { countIssuesNeedingAttention, getHighestIssueAttentionState, getIssueAttentionState } from "./issueAttention";

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    identifier: "PAP-1",
    companyId: "company-1",
    projectId: null,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    title: "Task",
    description: null,
    status: "todo",
    workMode: "standard",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: 1,
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    createdAt: new Date("2026-06-26T00:00:00.000Z"),
    updatedAt: new Date("2026-06-26T00:00:00.000Z"),
    ...overrides,
  };
}

describe("issue attention", () => {
  it("classifies pending approvals as GO required", () => {
    expect(getIssueAttentionState(issue({
      blockedInboxAttention: {
        kind: "blocked",
        state: "awaiting_decision",
        reason: "pending_board_decision",
        severity: "high",
        stoppedSinceAt: null,
        owner: { type: "board", agentId: null, userId: null, label: "Board" },
        action: { label: "Approve", detail: null },
        sourceIssue: null,
        leafIssue: null,
        recoveryIssue: null,
        approvalId: "approval-1",
        interactionId: null,
        sampleIssueIdentifier: "PAP-1",
        redaction: { externalDetailsRedacted: false, secretFieldsOmitted: true },
      },
    }))?.kind).toBe("needs_go");
  });

  it("classifies pending interactions as confirmation required", () => {
    expect(getIssueAttentionState(issue({
      blockedInboxAttention: {
        kind: "blocked",
        state: "awaiting_decision",
        reason: "pending_user_decision",
        severity: "medium",
        stoppedSinceAt: null,
        owner: { type: "user", agentId: null, userId: "user-1", label: "Board" },
        action: { label: "Respond", detail: null },
        sourceIssue: null,
        leafIssue: null,
        recoveryIssue: null,
        approvalId: null,
        interactionId: "interaction-1",
        sampleIssueIdentifier: "PAP-1",
        redaction: { externalDetailsRedacted: false, secretFieldsOmitted: true },
      },
    }))?.kind).toBe("confirmation_required");
  });

  it("uses execution review state as a fallback", () => {
    expect(getIssueAttentionState(issue({
      status: "in_review",
      executionState: {
        status: "pending",
        currentStageId: "review",
        currentStageIndex: 0,
        currentStageType: "review",
        currentParticipant: { type: "user", userId: "user-1", agentId: null },
        returnAssignee: { type: "agent", agentId: "agent-1", userId: null },
        reviewRequest: null,
        completedStageIds: [],
        lastDecisionId: null,
        lastDecisionOutcome: null,
      },
    }))?.kind).toBe("review_requested");
  });

  it("summarizes attention counts and highest priority state", () => {
    const issues = [
      issue({ id: "issue-1", status: "in_review", executionState: {
        status: "pending",
        currentStageId: "review",
        currentStageIndex: 0,
        currentStageType: "review",
        currentParticipant: { type: "user", userId: "user-1", agentId: null },
        returnAssignee: null,
        reviewRequest: null,
        completedStageIds: [],
        lastDecisionId: null,
        lastDecisionOutcome: null,
      } }),
      issue({ id: "issue-2", status: "blocked" }),
      issue({ id: "issue-3", status: "todo" }),
    ];

    expect(countIssuesNeedingAttention(issues)).toBe(2);
    expect(getHighestIssueAttentionState(issues)?.kind).toBe("agent_blocked");
  });
});
