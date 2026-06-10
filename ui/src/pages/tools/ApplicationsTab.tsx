import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppWindow, Boxes, Globe, Network, Plus, Terminal, Upload, type LucideIcon } from "lucide-react";
import type { ToolApplication, ToolApplicationType } from "@paperclipai/shared";
import { queryKeys } from "@/lib/queryKeys";
import { toolsApi, type CreateToolApplicationInput } from "@/api/tools";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/context/ToastContext";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { ToolsPageHeader, LoadingState, ErrorState, RelativeTime } from "./shared";

const APP_TYPES: { value: ToolApplicationType; label: string }[] = [
  { value: "mcp_http", label: "MCP server (remote HTTP)" },
  { value: "mcp_stdio", label: "MCP server (local stdio)" },
  { value: "paperclip_plugin", label: "Paperclip plugin tools" },
];

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "__all", label: "All types" },
  { value: "mcp_http", label: "MCP HTTP" },
  { value: "mcp_stdio", label: "MCP stdio" },
  { value: "paperclip_plugin", label: "Plugin" },
];

const VISIBILITY_FILTERS: { value: string; label: string }[] = [
  { value: "__all", label: "All visibility" },
  { value: "active", label: "Active" },
  { value: "hidden", label: "Hidden" },
];

/** Transport-tinted 28×28 icon, keyed off the application type. */
function appVisual(type: ToolApplicationType): { icon: LucideIcon; tint: string } {
  switch (type) {
    case "mcp_http":
      return { icon: Globe, tint: "bg-blue-500/15 text-blue-600 dark:text-blue-400" };
    case "mcp_stdio":
      return { icon: Terminal, tint: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" };
    case "paperclip_plugin":
      return { icon: Boxes, tint: "bg-violet-500/15 text-violet-600 dark:text-violet-400" };
    default:
      return { icon: Network, tint: "bg-amber-500/15 text-amber-600 dark:text-amber-400" };
  }
}

function typeLabel(type: ToolApplicationType): string {
  switch (type) {
    case "mcp_http":
      return "MCP HTTP";
    case "mcp_stdio":
      return "MCP stdio";
    case "paperclip_plugin":
      return "Plugin";
    default:
      return type;
  }
}

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "active" || status === "enabled") return "default";
  if (status === "archived" || status === "disabled") return "outline";
  return "secondary";
}

function AppIcon({ type }: { type: ToolApplicationType }) {
  const { icon: Icon, tint } = appVisual(type);
  return (
    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-sm", tint)}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

export function ApplicationsTab({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<ToolApplicationType>("mcp_http");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("__all");
  const [visibilityFilter, setVisibilityFilter] = useState("__all");

  const apps = useQuery({
    queryKey: queryKeys.tools.applications(companyId),
    queryFn: () => toolsApi.listApplications(companyId),
  });
  const connections = useQuery({
    queryKey: queryKeys.tools.connections(companyId),
    queryFn: () => toolsApi.listConnections(companyId),
  });

  const connList = connections.data?.connections ?? [];

  // Per-connection catalog counts let us show a real "tools" total per app
  // without inventing a company-wide aggregate endpoint.
  const catalogs = useQueries({
    queries: connList.map((c) => ({
      queryKey: queryKeys.tools.catalog(c.id),
      queryFn: () => toolsApi.listCatalog(c.id),
      staleTime: 60_000,
    })),
  });

  const toolCountByApp = useMemo(() => {
    const counts = new Map<string, number>();
    connList.forEach((c, i) => {
      const n = catalogs[i]?.data?.catalog?.length ?? 0;
      counts.set(c.applicationId, (counts.get(c.applicationId) ?? 0) + n);
    });
    return counts;
  }, [connList, catalogs]);

  const connCountByApp = useMemo(() => {
    const counts = new Map<string, number>();
    connList.forEach((c) => counts.set(c.applicationId, (counts.get(c.applicationId) ?? 0) + 1));
    return counts;
  }, [connList]);

  const create = useMutation({
    mutationFn: (input: CreateToolApplicationInput) => toolsApi.createApplication(companyId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tools.applications(companyId) });
      setOpen(false);
      setName("");
      setDescription("");
      setType("mcp_http");
      pushToast({ title: "Application created", tone: "success" });
    },
    onError: (err) => {
      pushToast({
        title: "Could not create application",
        body: err instanceof ApiError ? err.message : String(err),
        tone: "error",
      });
    },
  });

  const filtered = useMemo(() => {
    let list: ToolApplication[] = apps.data?.applications ?? [];
    if (typeFilter !== "__all") list = list.filter((a) => a.type === typeFilter);
    if (visibilityFilter === "active") list = list.filter((a) => a.status === "active");
    else if (visibilityFilter === "hidden")
      list = list.filter((a) => a.status === "archived" || a.status === "disabled");
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) => a.name.toLowerCase().includes(q) || (a.description ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [apps.data, typeFilter, visibilityFilter, search]);

  if (apps.isLoading) return <LoadingState />;
  if (apps.error) return <ErrorState error={apps.error} onRetry={() => apps.refetch()} />;

  const total = apps.data?.applications.length ?? 0;

  return (
    <div className="space-y-4">
      <ToolsPageHeader
        title="Applications"
        description="External tool sources: MCP servers and Paperclip plugin tool bundles. Add a connection to each application to discover its tools."
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                pushToast({
                  title: "Import manifest",
                  body: "Paste-an-mcp.json import is wired to the existing import endpoint in a follow-up. Use New application for now.",
                  tone: "info",
                })
              }
            >
              <Upload className="mr-1 h-4 w-4" />
              Import manifest
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              New application
            </Button>
          </>
        }
      />

      {total === 0 ? (
        <EmptyState
          icon={AppWindow}
          message="No applications yet"
          description="Register an MCP server or plugin tool bundle to start governing tool access."
          action="New application"
          onAction={() => setOpen(true)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search applications…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_FILTERS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={visibilityFilter} onValueChange={setVisibilityFilter}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIBILITY_FILTERS.map((v) => (
                  <SelectItem key={v.value} value={v.value}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="px-0 py-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Application</th>
                    <th className="px-3 py-2.5 font-medium">Type</th>
                    <th className="px-3 py-2.5 text-right font-medium">Tools</th>
                    <th className="px-3 py-2.5 text-right font-medium">Connections</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((app) => (
                    <tr key={app.id} className="align-top">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <AppIcon type={app.type} />
                          <div className="min-w-0">
                            <div className="font-medium text-foreground">{app.name}</div>
                            {app.description ? (
                              <div className="truncate text-xs text-muted-foreground">{app.description}</div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant="outline">{typeLabel(app.type)}</Badge>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-foreground">
                        {toolCountByApp.get(app.id) ?? 0}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-foreground">
                        {connCountByApp.get(app.id) ?? 0}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={statusVariant(app.status)}>{app.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right text-xs">
                        <RelativeTime value={app.updatedAt} />
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No applications match the current filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New application</DialogTitle>
            <DialogDescription>
              Define a tool source. You will add a connection (credentials + transport) next.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="app-name">Name</Label>
              <Input
                id="app-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. GitHub Triage"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-desc">Description</Label>
              <Input
                id="app-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as ToolApplicationType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APP_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || create.isPending}
              onClick={() =>
                create.mutate({
                  name: name.trim(),
                  description: description.trim() || null,
                  type,
                })
              }
            >
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
