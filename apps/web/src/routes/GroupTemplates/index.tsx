import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  cn,
} from "@stdlib/shadcn"
import { ArrowLeft, ArrowRight, Check, MessageCircle, Plus } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useState } from "react"
import { Link, useNavigate } from "react-router"

import { api } from "../ChatBot/api"
import {
  groupTemplates,
  type GroupAgent,
  type GroupTemplate,
} from "./templates"

export { requireIdentity as loader } from "../../auth"

const categories = [
  "All",
  ...new Set(groupTemplates.map(({ category }) => category)),
]

export default function GroupTemplates() {
  const [activeCategory, setActiveCategory] = useState("All")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [startingId, setStartingId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  const selected = groupTemplates.find(({ id }) => id === selectedId) ?? null
  const visibleTemplates =
    activeCategory === "All"
      ? groupTemplates
      : groupTemplates.filter(({ category }) => category === activeCategory)

  function selectTemplate(id: string) {
    setSelectedId(id === selectedId ? null : id)
    setStartError(null)
  }

  async function startGroup(template: GroupTemplate) {
    if (template.scratch) {
      await navigate(
        `/?${new URLSearchParams({ chatId: crypto.randomUUID() })}`
      )
      return
    }

    setStartingId(template.id)
    setStartError(null)
    try {
      const group = await api.request("POST /api/groups", {
        name: template.name,
        agentIds: template.agents.map(({ id }) => id),
      })
      await navigate(`/?${new URLSearchParams({ chatId: group.id })}`)
    } catch {
      setStartError("Could not create this group. Try again.")
      setStartingId(null)
    }
  }

  return (
    <main className="min-h-svh bg-[#03130c] text-[#f5f3ed] selection:bg-[#eef771] selection:text-[#03130c]">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#03130c]/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link
            to="/"
            className="flex items-center gap-2.5 text-sm font-semibold tracking-[0.14em] uppercase focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#eef771]"
          >
            <MessageCircle
              aria-hidden="true"
              className="size-5 text-[#eef771]"
            />
            Baseera
          </Link>
          <Link
            to="/"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-[#b8cdc3] transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#eef771]"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to group
          </Link>
        </div>
      </header>

      <div className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-[1440px]">
        <section
          aria-labelledby="templates-heading"
          className="min-w-0 flex-1 px-5 pt-9 pb-32 sm:px-8 lg:border-r lg:border-[#173429] lg:px-10 lg:pt-11 lg:pb-14"
        >
          <motion.div
            className="mb-8"
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.3 }}
          >
            <h1
              id="templates-heading"
              className="text-3xl leading-none font-medium tracking-[-0.04em] sm:text-4xl"
            >
              Build your group.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[#8ca79a]">
              Choose a ready-made team or start with Factory and assemble your
              own.
            </p>
          </motion.div>

          <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
            {categories.map((category) => {
              const active = activeCategory === category

              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  className={cn(
                    "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#eef771]",
                    active
                      ? "bg-[#d8ede2] text-[#03130c]"
                      : "text-[#9db3a8] hover:bg-[#102a1f] hover:text-white"
                  )}
                >
                  {category}
                </button>
              )
            })}
            <span className="ml-auto hidden shrink-0 text-xs text-[#6f8b7e] sm:block">
              {visibleTemplates.length}{" "}
              {visibleTemplates.length === 1 ? "group" : "groups"}
            </span>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3">
            {visibleTemplates.map((template, index) => (
              <TemplateCard
                key={template.id}
                template={template}
                index={index}
                selected={selectedId === template.id}
                reduceMotion={!!reduceMotion}
                onSelect={() => selectTemplate(template.id)}
              />
            ))}
          </div>
        </section>

        <aside className="hidden w-[340px] shrink-0 lg:block">
          <div className="sticky top-16 h-[calc(100svh-4rem)] overflow-y-auto bg-[#071a12] px-7 py-8">
            <SelectedGroupPanel
              template={selected}
              starting={startingId === selected?.id}
              error={startError}
              onStart={() => selected && void startGroup(selected)}
            />
          </div>
        </aside>
      </div>

      {selected && (
        <button
          type="button"
          onClick={() => setReviewOpen(true)}
          className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-[#29483b] bg-[#d8ede2] px-5 py-3 text-left text-[#03130c] lg:hidden"
          style={{
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
          }}
        >
          <AgentAvatarGroup
            agents={selected.agents}
            ringClassName="ring-[#d8ede2]!"
          />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {selected.name}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold">
            Review
            <ArrowRight aria-hidden="true" className="size-4" />
          </span>
        </button>
      )}

      <Sheet open={reviewOpen} onOpenChange={setReviewOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[86svh] overflow-y-auto rounded-t-2xl border-[#29483b] bg-[#071a12] px-6 py-7 text-[#f5f3ed]"
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
            error={startError}
            onStart={() => selected && void startGroup(selected)}
          />
        </SheetContent>
      </Sheet>
    </main>
  )
}

function TemplateCard({
  template,
  index,
  selected,
  reduceMotion,
  onSelect,
}: {
  template: GroupTemplate
  index: number
  selected: boolean
  reduceMotion: boolean
  onSelect(): void
}) {
  return (
    <motion.button
      type="button"
      aria-pressed={selected}
      aria-label={`${template.name} — ${selected ? "selected" : "select"}`}
      onClick={onSelect}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-[10px] border bg-[#091f16] text-left transition-[border-color,background-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#eef771]",
        selected
          ? "border-[#eef771] bg-[#0c271b]"
          : "border-[#173429] hover:border-[#4d735f]"
      )}
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduceMotion ? 0 : 0.28,
        delay: reduceMotion ? 0 : index * 0.05,
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-3 right-3 z-10 grid size-5 place-items-center rounded-full border transition-colors",
          selected
            ? "border-[#eef771] bg-[#eef771] text-[#03130c]"
            : "border-[#5b776a] bg-[#091f16]/70"
        )}
      >
        {selected && <Check className="size-3" />}
      </span>
      <TemplateArtwork id={template.id} />

      <div className="flex flex-1 flex-col p-4">
        <h2 className="text-base font-semibold tracking-[-0.02em] text-[#d8ede2]">
          {template.name}
        </h2>
        <span className="mt-1 text-[10px] font-semibold tracking-[0.14em] text-[#789487] uppercase">
          {template.category}
        </span>
        <p className="mt-2 text-xs leading-[1.55] text-[#8ca79a]">
          {template.outcome}
        </p>

        <div className="mt-auto flex items-center gap-2 pt-4">
          <AgentAvatarGroup agents={template.agents} />
          <span className="text-[11px] text-[#789487]">
            {template.agents.length}{" "}
            {template.agents.length === 1 ? "agent" : "agents"}
          </span>
        </div>
      </div>
    </motion.button>
  )
}

function SelectedGroupPanel({
  template,
  starting,
  error,
  onStart,
}: {
  template: GroupTemplate | null
  starting: boolean
  error: string | null
  onStart(): void
}) {
  return (
    <div className="flex min-h-full flex-col">
      <p className="text-[10px] font-semibold tracking-[0.16em] text-[#789487] uppercase">
        Selected group
      </p>

      {!template ? (
        <div className="grid flex-1 place-items-center py-16 text-center">
          <div>
            <span className="mx-auto grid size-10 place-items-center rounded-full border border-dashed border-[#4d735f] text-[#789487]">
              <Plus aria-hidden="true" className="size-4" />
            </span>
            <p className="mt-4 text-sm font-medium text-[#d8ede2]">
              Pick a group
            </p>
            <p className="mt-2 max-w-48 text-xs leading-5 text-[#789487]">
              Select a template to review its agents and responsibilities.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <span className="text-[10px] font-semibold tracking-[0.14em] text-[#789487] uppercase">
              {template.category}
            </span>
            <h2 className="mt-2 text-2xl font-medium tracking-[-0.035em] text-[#d8ede2]">
              {template.name}
            </h2>
            <p className="mt-3 text-sm leading-6 text-[#8ca79a]">
              {template.outcome}
            </p>
          </div>

          <div className="mt-8 flex-1">
            <p className="mb-1 text-[10px] font-semibold tracking-[0.14em] text-[#789487] uppercase">
              {template.agents.length}{" "}
              {template.agents.length === 1 ? "agent" : "agents"}
            </p>
            {template.agents.map((agent, index) => (
              <div
                key={agent.name}
                className="flex gap-3 border-t border-[#173429] py-4"
              >
                <AgentAvatar agent={agent} index={index} />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#d8ede2]">
                    {agent.name}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-[#789487]">
                    {agent.responsibility}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={onStart}
            disabled={starting}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#eef771] px-4 py-3 text-sm font-semibold text-[#03130c] transition-colors hover:bg-[#f8fba8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#eef771]"
          >
            {template.scratch ? (
              <Plus aria-hidden="true" className="size-4" />
            ) : null}
            {starting
              ? "Starting…"
              : template.scratch
                ? "Start from scratch"
                : "Start with this group"}
            {!starting && !template.scratch && (
              <ArrowRight aria-hidden="true" className="size-4" />
            )}
          </button>
          {error && (
            <p role="alert" className="mt-3 text-xs text-[#ffb4a8]">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function TemplateArtwork({ id }: { id: string }) {
  return (
    <div className="relative h-24 w-full shrink-0 overflow-hidden bg-[#0d271c]">
      <svg
        aria-hidden="true"
        viewBox="0 0 400 144"
        preserveAspectRatio="none"
        className="absolute inset-0 size-full text-[#5b776a]/40 transition-colors duration-300 group-hover:text-[#789487]/55"
      >
        {id === "customer-discovery" && <DiscoveryArtwork />}
        {id === "market-intelligence" && <MarketArtwork />}
        {id === "company-building" && <CompanyArtwork />}
        {id === "content-studio" && <ContentArtwork />}
        {id === "capital-strategy" && <CapitalArtwork />}
        {id === "scratch" && <ScratchArtwork />}
      </svg>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent via-[#091f16]/60 to-[#091f16]" />
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

function ScratchArtwork() {
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

function AgentAvatarGroup({
  agents,
  ringClassName,
}: {
  agents: readonly GroupAgent[]
  ringClassName?: string
}) {
  return (
    <AvatarGroup aria-label={agents.map(({ name }) => name).join(", ")}>
      {agents.map((agent, index) => (
        <AgentAvatar
          key={agent.name}
          agent={agent}
          index={index}
          ringClassName={ringClassName}
        />
      ))}
    </AvatarGroup>
  )
}

function AgentAvatar({
  agent,
  index,
  ringClassName,
}: {
  agent: GroupAgent
  index: number
  ringClassName?: string
}) {
  const initials = agent.name
    .split(/\s+/u)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <Avatar
      size="sm"
      title={agent.name}
      className={cn("border-0 ring-[#091f16]!", ringClassName)}
    >
      <AvatarFallback
        className={cn(
          "font-semibold",
          index % 2 === 0
            ? "bg-[#dce7c4] text-[#123b28]"
            : "bg-[#9fc9b4] text-[#0b2a1c]"
        )}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  )
}
