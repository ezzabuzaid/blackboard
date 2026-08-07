import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  Button,
  FieldError,
  Input,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  cn,
} from "@stdlib/shadcn"
import { ArrowLeft, ArrowRight, Check, Plus, Search } from "lucide-react"
import { useId, useRef, useState } from "react"
import {
  Link,
  useLoaderData,
  useNavigate,
  type LoaderFunctionArgs,
} from "react-router"

import { requireIdentity } from "../../auth"
import { api } from "../ChatBot/api"
import { toggleAgentSelection } from "./selection"

interface GroupAgent {
  id: string
  name: string
  responsibility: string
}

interface CatalogAgent {
  id: string
  name: string
  category: string
  headline: string
  tags: readonly string[]
}

interface GroupTemplate {
  id: string
  name: string
  category: string
  outcome: string
  agents: readonly GroupAgent[]
  source: "prebuilt" | "marketplace" | "custom"
  custom?: boolean
}

const buildOwnTemplate: GroupTemplate = {
  id: "custom",
  name: "Build your own",
  category: "Custom",
  outcome: "Choose up to eight characters from the catalog.",
  source: "custom",
  custom: true,
  agents: [],
}

export async function loader(args: LoaderFunctionArgs) {
  await requireIdentity(args)
  const [{ templates }, catalog] = await Promise.all([
    api.request("GET /group-templates", {}, { signal: args.request.signal }),
    api.request("GET /agents", {}, { signal: args.request.signal }) as Promise<{
      agents: readonly CatalogAgent[]
    }>,
  ])
  const groupTemplates: readonly GroupTemplate[] = [
    ...templates,
    buildOwnTemplate,
  ]
  return { catalogAgents: catalog.agents, groupTemplates }
}

export default function GroupTemplates() {
  const { catalogAgents, groupTemplates } = useLoaderData<typeof loader>()
  const [activeFilter, setActiveFilter] = useState("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])
  const [customName, setCustomName] = useState("")
  const [startingId, setStartingId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const navigate = useNavigate()
  const selectedAgents = selectedAgentIds.flatMap((id) => {
    const agent = catalogAgents.find((candidate) => candidate.id === id)
    return agent
      ? [{ id: agent.id, name: agent.name, responsibility: agent.headline }]
      : []
  })
  const templates = groupTemplates.map((template) =>
    template.custom ? { ...template, agents: selectedAgents } : template
  )
  const filters = [
    { id: "all", label: "All" },
    { id: "source:prebuilt", label: "Prebuilt" },
    ...[...new Set(templates.map(({ category }) => category))].map(
      (category) => ({ id: `category:${category}`, label: category })
    ),
  ]
  const selected = templates.find(({ id }) => id === selectedId) ?? null
  const visibleTemplates = templates.filter(
    ({ source, category }) =>
      activeFilter === "all" ||
      activeFilter === `source:${source}` ||
      activeFilter === `category:${category}`
  )

  function selectTemplate(id: string) {
    setSelectedId(id === selectedId ? null : id)
    setStartError(null)
  }

  async function createGroup(
    input: { templateId?: string; name?: string; agentIds?: string[] },
    startingId: string
  ) {
    setStartingId(startingId)
    setStartError(null)
    try {
      const group = await api.request("POST /groups", input)
      await navigate(`/?${new URLSearchParams({ chatId: group.id })}`)
    } catch {
      setStartError("Could not create this group. Try again.")
      setStartingId(null)
    }
  }

  function toggleAgent(id: string) {
    setSelectedAgentIds((selected) => toggleAgentSelection(selected, id))
    setStartError(null)
  }

  function startSelectedGroup() {
    if (!selected) return
    void createGroup(
      selected.custom
        ? {
            name: customName,
            agentIds: [...selectedAgentIds],
          }
        : { templateId: selected.id },
      selected.id
    )
  }

  function startFactory() {
    void createGroup({ templateId: "scratch" }, "factory")
  }

  return (
    <main className="flex h-svh flex-col bg-background">
      <div className="flex min-h-0 w-full flex-1">
        <section
          aria-labelledby="templates-heading"
          className="min-w-0 flex-1 overflow-y-auto px-4 pt-6 pb-32 sm:px-6 md:px-8 md:pb-12"
        >
          <div className="mb-8 animate-in duration-300 ease-out fade-in slide-in-from-bottom-2">
            <Button variant="ghost" size="sm" className="-ms-2 mb-3" asChild>
              <Link to="/">
                <ArrowLeft aria-hidden="true" />
                Back to group
              </Link>
            </Button>
            <h1
              id="templates-heading"
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              Build your group.
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Choose a ready-made team or select the exact characters you want.
            </p>
          </div>

          <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
            {filters.map((filter) => {
              const active = activeFilter === filter.id

              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setActiveFilter(filter.id)}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {filter.label}
                </button>
              )
            })}
            <span className="ms-auto hidden shrink-0 text-xs text-muted-foreground sm:block">
              {visibleTemplates.length}{" "}
              {visibleTemplates.length === 1 ? "group" : "groups"}
            </span>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3">
            {visibleTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                selected={selectedId === template.id}
                onSelect={() => selectTemplate(template.id)}
              />
            ))}
          </div>
        </section>

        <aside className="hidden w-[clamp(18rem,22vw,22rem)] shrink-0 flex-col border-s bg-card md:flex">
          <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:h-full">
            <div className="flex min-h-full flex-col px-6 pt-6 pb-6">
              <SelectedGroupPanel
                template={selected}
                starting={startingId === selected?.id}
                startingFactory={startingId === "factory"}
                error={startError}
                catalogAgents={catalogAgents}
                selectedAgentIds={selectedAgentIds}
                customName={customName}
                onCustomNameChange={setCustomName}
                onToggleAgent={toggleAgent}
                onStart={startSelectedGroup}
                onStartFactory={startFactory}
              />
            </div>
          </ScrollArea>
        </aside>
      </div>

      {selected && (
        <button
          type="button"
          onClick={() => setReviewOpen(true)}
          className="fixed inset-x-0 bottom-0 z-30 flex animate-in items-center gap-3 border-t bg-card px-4 py-3 text-left transition-colors duration-200 ease-out slide-in-from-bottom focus-visible:outline-2 focus-visible:outline-primary md:hidden"
          style={{
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
          }}
        >
          <AgentAvatarGroup agents={selected.agents} />
          <span
            dir="auto"
            className="min-w-0 flex-1 truncate text-sm font-semibold"
          >
            {selected.name}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
            Review
            <ArrowRight aria-hidden="true" className="size-4" />
          </span>
        </button>
      )}

      <Sheet open={reviewOpen} onOpenChange={setReviewOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[86svh] overflow-y-auto rounded-t-2xl px-4 py-6"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Selected group</SheetTitle>
            <SheetDescription>
              Review the agents in this group.
            </SheetDescription>
          </SheetHeader>
          <SelectedGroupPanel
            template={selected}
            starting={startingId === selected?.id}
            startingFactory={startingId === "factory"}
            error={startError}
            catalogAgents={catalogAgents}
            selectedAgentIds={selectedAgentIds}
            customName={customName}
            onCustomNameChange={setCustomName}
            onToggleAgent={toggleAgent}
            onStart={startSelectedGroup}
            onStartFactory={startFactory}
          />
        </SheetContent>
      </Sheet>
    </main>
  )
}

function TemplateCard({
  template,
  selected,
  onSelect,
}: {
  template: GroupTemplate
  selected: boolean
  onSelect(): void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${template.name} — ${selected ? "selected" : "select"}`}
      onClick={onSelect}
      className={cn(
        "group relative flex h-full animate-in flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors duration-200 ease-out fade-in slide-in-from-bottom-2 focus-visible:outline-2 focus-visible:outline-primary",
        selected
          ? "border-primary/30 bg-primary/5"
          : "border-border hover:border-ring"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-3 right-3 z-10 grid size-5 place-items-center rounded-full border transition-colors",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-background/70"
        )}
      >
        {selected && <Check className="size-3" />}
      </span>
      <TemplateArtwork id={template.id} source={template.source} />

      <div className="flex flex-1 flex-col p-4">
        <h2
          dir="auto"
          className="text-base font-semibold tracking-tight [unicode-bidi:plaintext]"
        >
          {template.name}
        </h2>
        <span className="mt-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {template.source === "marketplace"
            ? `Marketplace · ${template.category}`
            : template.category}
        </span>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {template.outcome}
        </p>

        <div className="mt-auto flex items-center gap-2 pt-4">
          <AgentAvatarGroup agents={template.agents} />
          <span className="text-[11px] text-muted-foreground">
            {template.custom && template.agents.length === 0
              ? "Choose characters"
              : `${template.agents.length} ${
                  template.agents.length === 1 ? "agent" : "agents"
                }`}
          </span>
        </div>
      </div>
    </button>
  )
}

function SelectedGroupPanel({
  template,
  starting,
  startingFactory,
  error,
  catalogAgents,
  selectedAgentIds,
  customName,
  onCustomNameChange,
  onToggleAgent,
  onStart,
  onStartFactory,
}: {
  template: GroupTemplate | null
  starting: boolean
  startingFactory: boolean
  error: string | null
  catalogAgents: readonly CatalogAgent[]
  selectedAgentIds: readonly string[]
  customName: string
  onCustomNameChange(name: string): void
  onToggleAgent(id: string): void
  onStart(): void
  onStartFactory(): void
}) {
  if (template?.custom) {
    return (
      <CustomGroupPanel
        agents={catalogAgents}
        selectedAgentIds={selectedAgentIds}
        name={customName}
        starting={starting}
        startingFactory={startingFactory}
        error={error}
        onNameChange={onCustomNameChange}
        onToggleAgent={onToggleAgent}
        onStart={onStart}
        onStartFactory={onStartFactory}
      />
    )
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {!template ? (
        <div className="grid flex-1 place-items-center py-16 text-center">
          <div>
            <span className="mx-auto grid size-10 place-items-center rounded-full border border-dashed text-muted-foreground">
              <Plus aria-hidden="true" className="size-4" />
            </span>
            <p className="mt-4 text-sm font-medium">Pick a group</p>
            <p className="mt-2 max-w-48 text-xs leading-5 text-muted-foreground">
              Select a template to review its agents and responsibilities.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div>
            <h2
              dir="auto"
              className="text-xl font-semibold tracking-tight [unicode-bidi:plaintext]"
            >
              {template.name}
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {template.outcome}
            </p>
          </div>

          <div className="mt-8 flex-1">
            <p className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {template.agents.length}{" "}
              {template.agents.length === 1 ? "agent" : "agents"}
            </p>
            {template.agents.map((agent) => (
              <div key={agent.name} className="flex gap-3 border-t py-4">
                <AgentAvatar agent={agent} />
                <div className="min-w-0">
                  <h3 dir="auto" className="text-sm font-semibold">
                    {agent.name}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {agent.responsibility}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <Button
            type="button"
            size="lg"
            className="mt-6 w-full"
            onClick={onStart}
            disabled={starting}
          >
            {starting ? "Starting…" : "Start with this group"}
            {!starting && <ArrowRight aria-hidden="true" />}
          </Button>
          {error && (
            <p
              role="alert"
              className="mt-3 animate-in text-xs text-destructive duration-150 ease-out fade-in slide-in-from-top-1"
            >
              {error}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function CustomGroupPanel({
  agents,
  selectedAgentIds,
  name,
  starting,
  startingFactory,
  error,
  onNameChange,
  onToggleAgent,
  onStart,
  onStartFactory,
}: {
  agents: readonly CatalogAgent[]
  selectedAgentIds: readonly string[]
  name: string
  starting: boolean
  startingFactory: boolean
  error: string | null
  onNameChange(name: string): void
  onToggleAgent(id: string): void
  onStart(): void
  onStartFactory(): void
}) {
  const [query, setQuery] = useState("")
  const normalizedQuery = query.trim().toLowerCase()
  const visibleAgents = normalizedQuery
    ? agents.filter((agent) =>
        [agent.name, agent.category, agent.headline, ...agent.tags]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : agents
  const selectionFull = selectedAgentIds.length >= 8
  const nameInputRef = useRef<HTMLInputElement>(null)
  const nameErrorId = useId()
  const [nameError, setNameError] = useState<string | null>(null)
  const [agentsError, setAgentsError] = useState<string | null>(null)

  function startGroup() {
    const missingName = !name.trim()
    const missingAgents = selectedAgentIds.length === 0
    setNameError(missingName ? "Name your group to continue." : null)
    setAgentsError(missingAgents ? "Pick at least one character." : null)
    if (missingName) {
      nameInputRef.current?.focus({ preventScroll: true })
      nameInputRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
      })
    }
    if (missingName || missingAgents) return
    onStart()
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <h2 className="text-xl font-semibold tracking-tight">
        Choose your characters.
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Select up to eight people for this group.
      </p>

      <label className="mt-6 block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        Group name
        <Input
          ref={nameInputRef}
          dir="auto"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? nameErrorId : undefined}
          value={name}
          onChange={(event) => {
            setNameError(null)
            onNameChange(event.target.value)
          }}
          maxLength={100}
          placeholder="e.g. Product council"
          className="mt-2 h-10 border-transparent bg-muted tracking-normal normal-case shadow-none"
        />
      </label>
      {nameError && (
        <FieldError
          id={nameErrorId}
          className="mt-2 animate-in text-xs duration-150 ease-out fade-in slide-in-from-top-1"
        >
          {nameError}
        </FieldError>
      )}

      <div className="mt-6 flex items-center justify-between">
        <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          Characters
        </p>
        <span className="text-xs text-muted-foreground">
          {selectedAgentIds.length}/8 selected
        </span>
      </div>
      <div className="relative mt-3">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Search characters"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search characters"
          className="h-10 rounded-full border-transparent bg-muted pr-4 pl-10 shadow-none"
        />
      </div>

      <div className="mt-3">
        {visibleAgents.map((agent) => {
          const selected = selectedAgentIds.includes(agent.id)
          return (
            <button
              key={agent.id}
              type="button"
              aria-pressed={selected}
              disabled={!selected && selectionFull}
              onClick={() => {
                setAgentsError(null)
                onToggleAgent(agent.id)
              }}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-accent/70 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AgentAvatar
                agent={{
                  id: agent.id,
                  name: agent.name,
                  responsibility: agent.headline,
                }}
              />
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate text-sm font-medium">
                  {agent.name}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {agent.category} · {agent.headline}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full border",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border"
                )}
              >
                {selected && <Check className="size-3" />}
              </span>
            </button>
          )
        })}
        {visibleAgents.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No characters match that search.
          </p>
        )}
      </div>

      <Button
        type="button"
        size="lg"
        className="mt-6 w-full"
        onClick={startGroup}
        disabled={starting}
      >
        {starting ? "Creating…" : "Create group"}
        {!starting && <ArrowRight aria-hidden="true" />}
      </Button>
      {agentsError && (
        <FieldError className="mt-3 animate-in text-xs duration-150 ease-out fade-in slide-in-from-top-1">
          {agentsError}
        </FieldError>
      )}

      <div className="mt-5 border-t pt-5">
        <p className="text-xs leading-5 text-muted-foreground">
          Need a character that is not in the catalog?
        </p>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="mt-2 h-auto p-0"
          onClick={onStartFactory}
          disabled={startingFactory}
        >
          {startingFactory ? "Opening Factory…" : "Create one with Factory"}
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 animate-in text-xs text-destructive duration-150 ease-out fade-in slide-in-from-top-1"
        >
          {error}
        </p>
      )}
    </div>
  )
}

function TemplateArtwork({
  id,
  source,
}: {
  id: string
  source: GroupTemplate["source"]
}) {
  return (
    <div className="relative h-24 w-full shrink-0 overflow-hidden bg-muted/60">
      <svg
        aria-hidden="true"
        viewBox="0 0 400 144"
        preserveAspectRatio="none"
        className="absolute inset-0 size-full text-muted-foreground/30 transition-colors duration-300 group-hover:text-muted-foreground/45"
      >
        {id === "customer-discovery" && <DiscoveryArtwork />}
        {(id === "market-intelligence" || source === "marketplace") && (
          <MarketArtwork />
        )}
        {id === "company-building" && <CompanyArtwork />}
        {id === "content-studio" && <ContentArtwork />}
        {id === "capital-strategy" && <CapitalArtwork />}
        {id === "custom" && <CustomArtwork />}
      </svg>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent via-card/60 to-card" />
    </div>
  )
}

function DiscoveryArtwork() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M-20 118 C54 18 126 15 198 87 S337 147 430 20" />
      <path d="M-26 126 C52 30 124 25 197 94 S337 153 432 31" />
      <path d="M-32 134 C49 42 122 35 195 101 S337 158 434 43" />
      <path d="M-38 142 C47 54 120 46 194 108 S337 163 436 55" />
      <path d="M-44 150 C44 66 118 56 192 115 S337 168 438 67" />
    </g>
  )
}

function MarketArtwork() {
  return (
    <g>
      <path d="M36 118 H372" fill="none" stroke="currentColor" />
      <path
        d="M73 92 L145 69 L218 78 L291 44 L359 27"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect x="55" y="88" width="36" height="30" rx="3" fill="currentColor" />
      <rect x="127" y="70" width="36" height="48" rx="3" fill="currentColor" />
      <rect x="200" y="81" width="36" height="37" rx="3" fill="currentColor" />
      <rect x="273" y="51" width="36" height="67" rx="3" fill="currentColor" />
      <rect x="341" y="34" width="36" height="84" rx="3" fill="currentColor" />
    </g>
  )
}

function ContentArtwork() {
  return (
    <g fill="currentColor">
      <circle cx="205" cy="43" r="7" />
      <rect x="227" y="38" width="132" height="10" rx="5" />
      <circle cx="205" cy="72" r="7" />
      <rect x="227" y="67" width="105" height="10" rx="5" />
      <circle cx="205" cy="101" r="7" />
      <rect x="227" y="96" width="145" height="10" rx="5" />
      <path d="M184 25 V119" fill="none" stroke="currentColor" />
    </g>
  )
}

function CompanyArtwork() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M68 112 V78 H142 V112 M142 112 V48 H224 V112 M224 112 V68 H306 V112 M306 112 V30 H370 V112" />
      <path d="M42 112 H386" />
      <path d="M89 78 V60 H183 V48 M265 68 V50 H337 V30" opacity=".65" />
    </g>
  )
}

function CapitalArtwork() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M30 116 C88 108 101 65 153 70 S220 108 267 72 S327 35 385 30" />
      <path
        d="M30 126 C90 119 111 87 159 90 S226 120 276 87 S333 58 386 52"
        opacity=".65"
      />
      <circle cx="153" cy="70" r="7" fill="currentColor" stroke="none" />
      <circle cx="267" cy="72" r="7" fill="currentColor" stroke="none" />
      <circle cx="385" cy="30" r="7" fill="currentColor" stroke="none" />
    </g>
  )
}

function CustomArtwork() {
  return (
    <g>
      <path d="M184 116 H374 M194 126 V24" fill="none" stroke="currentColor" />
      <path
        d="M207 102 C237 92 248 64 274 71 S319 48 361 34"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="214" cy="96" r="6" fill="currentColor" />
      <circle cx="248" cy="73" r="8" fill="currentColor" />
      <circle cx="280" cy="76" r="5" fill="currentColor" />
      <circle cx="319" cy="51" r="7" fill="currentColor" />
      <circle cx="358" cy="36" r="6" fill="currentColor" />
    </g>
  )
}

function AgentAvatarGroup({ agents }: { agents: readonly GroupAgent[] }) {
  return (
    <AvatarGroup aria-label={agents.map(({ name }) => name).join(", ")}>
      {agents.map((agent) => (
        <AgentAvatar key={agent.name} agent={agent} />
      ))}
    </AvatarGroup>
  )
}

function AgentAvatar({ agent }: { agent: GroupAgent }) {
  const initials = agent.name
    .split(/\s+/u)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <Avatar size="sm" title={agent.name} className="bg-background">
      <AvatarFallback className="bg-muted font-medium text-foreground uppercase">
        {initials}
      </AvatarFallback>
    </Avatar>
  )
}
