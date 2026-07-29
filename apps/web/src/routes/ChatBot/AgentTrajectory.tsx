import {
  getToolName,
  isToolUIPart,
  type UIMessage,
} from "ai"
import {
  ActivityIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react"

type ToolPart = Parameters<typeof getToolName>[0]

interface AgentTrajectoryProps {
  active: boolean
  parts: UIMessage["parts"]
}

export function AgentTrajectory({ active, parts }: AgentTrajectoryProps) {
  const steps = parts.filter((part) => part.type === "step-start").length
  const tools = parts.filter(isToolUIPart)

  if (tools.length === 0) return null

  return (
    <section aria-label="Agent activity" className="my-2 text-sm">
      <details className="group overflow-hidden rounded-xl border border-border/70 bg-muted/20">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3 text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
          {active ? (
            <Loader2Icon className="size-4 animate-spin" aria-hidden />
          ) : (
            <ActivityIcon className="size-4" aria-hidden />
          )}
          <span className="font-medium text-foreground">Activity</span>
          <span className="ml-auto text-xs tabular-nums">
            {active
              ? "Working"
              : `${steps} ${steps === 1 ? "step" : "steps"} · ${
                  tools.length
                } ${tools.length === 1 ? "tool" : "tools"}`}
          </span>
          <ChevronDownIcon
            className="size-4 transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>

        <div className="divide-y divide-border/60 border-t border-border/60 px-3">
          {tools.map((part) => (
            <ToolTrajectoryRow key={part.toolCallId} part={part} />
          ))}
        </div>
      </details>
    </section>
  )
}

function ToolTrajectoryRow({ part }: { part: ToolPart }) {
  const failed = part.state === "output-error" || part.state === "output-denied"
  const complete = part.state === "output-available"

  return (
    <details className="group/tool">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 py-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        {failed ? (
          <XCircleIcon
            className="size-4 shrink-0 text-destructive"
            aria-hidden
          />
        ) : complete ? (
          <CheckCircle2Icon
            className="size-4 shrink-0 text-emerald-600"
            aria-hidden
          />
        ) : (
          <Loader2Icon className="size-4 shrink-0 animate-spin" aria-hidden />
        )}
        <span className="font-medium text-foreground">
          {formatToolName(getToolName(part))}
        </span>
        <span className="ml-auto text-xs">{toolStatus(part)}</span>
        <ChevronDownIcon
          className="size-3.5 transition-transform group-open/tool:rotate-180"
          aria-hidden
        />
      </summary>

      <div className="grid gap-3 pb-3 pl-6">
        {part.input !== undefined && (
          <Value label="Input" value={part.input} />
        )}
        {part.state === "output-available" && (
          <Value label="Output" value={part.output} />
        )}
        {part.state === "output-error" && (
          <Value label="Error" value={part.errorText} />
        )}
      </div>
    </details>
  )
}

function formatToolName(name: string) {
  const words = name.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2")
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

function toolStatus(part: ToolPart) {
  switch (part.state) {
    case "input-streaming":
      return "Preparing"
    case "input-available":
      return "Running"
    case "approval-requested":
      return "Awaiting approval"
    case "approval-responded":
      return part.approval.approved ? "Approved" : "Denied"
    case "output-available":
      return "Completed"
    case "output-error":
      return "Failed"
    case "output-denied":
      return "Denied"
  }
}

function Value({ label, value }: { label: string; value: unknown }) {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value, null, 2)

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-foreground/80">
        {serialized ?? String(value)}
      </pre>
    </div>
  )
}
