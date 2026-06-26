// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { CircleDot } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetricCard } from "./MetricCard";

vi.mock("@/lib/router", () => ({
  Link: ({ children, className, ...props }: React.ComponentProps<"a">) => (
    <a className={className} {...props}>
      {children}
    </a>
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("MetricCard", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("renders a dashboard attention badge when supplied", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <MetricCard
          icon={CircleDot}
          value={3}
          label="Tasks In Progress"
          badge={<span data-testid="dashboard-attention-badge">2 issues · GO requis</span>}
        />,
      );
    });

    expect(container.textContent).toContain("Tasks In Progress");
    expect(container.querySelector("[data-testid='dashboard-attention-badge']")?.textContent).toBe("2 issues · GO requis");

    act(() => {
      root.unmount();
    });
  });
});
