import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Textarea,
} from "@stdlib/shadcn"
import { ArrowLeft, Store } from "lucide-react"
import { useEffect, useState } from "react"

import { api } from "./api"

interface MarketplaceTemplate {
  id: string
  sourceGroupId: string | null
  publisherName: string | null
  name: string
  category: string
  outcome: string
  agents: readonly { agentId: string; responsibility: string }[]
  published: boolean
}

interface MarketplaceEditorAgent {
  id: string
  name: string
  headline: string
  responsibility: string
}

export interface MarketplaceEditor {
  template: MarketplaceTemplate | null
  group: { id: string; name: string }
  agents: readonly MarketplaceEditorAgent[]
}

export async function loadMarketplaceEditor(groupId: string) {
  const response: unknown = await api.request(
    "GET /groups/{groupId}/marketplace-template",
    { groupId }
  )
  return readMarketplaceEditor(response)
}

export function MarketplaceTemplateDialog({
  open,
  editor,
  loading,
  error,
  onOpenChange,
  onEditorChange,
  onRetry,
}: {
  open: boolean
  editor: MarketplaceEditor | null
  loading: boolean
  error: string | null
  onOpenChange(open: boolean): void
  onEditorChange(editor: MarketplaceEditor | null): void
  onRetry(): void
}) {
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [outcome, setOutcome] = useState("")
  const [responsibilities, setResponsibilities] = useState<
    Record<string, string>
  >({})
  const [previewing, setPreviewing] = useState(false)
  const [pending, setPending] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !editor) return
    setName(editor.template?.name ?? editor.group.name)
    setCategory(editor.template?.category ?? "")
    setOutcome(editor.template?.outcome ?? "")
    setResponsibilities(
      Object.fromEntries(
        editor.agents.map(({ id, responsibility }) => [id, responsibility])
      )
    )
    setPreviewing(false)
    setSubmitError(null)
  }, [editor, open])

  async function save() {
    if (!editor) return
    setPending(true)
    setSubmitError(null)
    try {
      const agents = editor.agents.map(({ id }) => ({
        agentId: id,
        responsibility: responsibilities[id],
      }))
      let template: MarketplaceTemplate
      if (editor.template?.sourceGroupId === null) {
        template = readMarketplaceTemplate(
          await api.request("PUT /group-templates/{templateId}", {
            templateId: editor.template.id,
            name,
            category,
            outcome,
            agents,
          })
        )
      } else {
        const saved = readMarketplaceTemplate(
          await api.request("PUT /groups/{groupId}/marketplace-template", {
            groupId: editor.group.id,
            category,
            outcome,
            agents,
          })
        )
        template = saved.published
          ? saved
          : readMarketplaceTemplate(
              await api.request("POST /group-templates/{templateId}/publish", {
                templateId: saved.id,
              })
            )
      }
      onEditorChange({
        ...editor,
        group: { ...editor.group, name },
        template,
        agents: editor.agents.map((agent) => ({
          ...agent,
          responsibility: responsibilities[agent.id],
        })),
      })
      onOpenChange(false)
    } catch {
      setSubmitError("Could not save this template. Try again.")
    } finally {
      setPending(false)
    }
  }

  async function withdraw() {
    if (!editor?.template) return
    setPending(true)
    setSubmitError(null)
    try {
      if (editor.template.sourceGroupId === null) {
        await api.request("DELETE /group-templates/{templateId}", {
          templateId: editor.template.id,
        })
        onEditorChange(null)
      } else {
        const template = readMarketplaceTemplate(
          await api.request("POST /group-templates/{templateId}/unpublish", {
            templateId: editor.template.id,
          })
        )
        onEditorChange({ ...editor, template })
      }
      onOpenChange(false)
    } catch {
      setSubmitError(
        editor.template.sourceGroupId === null
          ? "Could not delete this template. Try again."
          : "Could not withdraw this template. Try again."
      )
    } finally {
      setPending(false)
    }
  }

  const published = editor?.template?.published === true
  const detached = editor?.template?.sourceGroupId === null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        {loading && !editor ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Loading template…
          </div>
        ) : error && !editor ? (
          <div className="py-6 text-center">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            <Button className="mt-4" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : editor && previewing ? (
          <>
            <DialogHeader>
              <DialogTitle>Review marketplace template</DialogTitle>
              <DialogDescription>
                Other people receive a fresh group with this roster. Messages,
                files, and agent memory stay private.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              <div>
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {category}
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  {name}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">{outcome}</p>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Team
                </p>
                {editor.agents.map((agent) => (
                  <div key={agent.id} className="border-t py-3">
                    <p className="text-sm font-medium">{agent.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {responsibilities[agent.id]}
                    </p>
                  </div>
                ))}
              </div>
              {submitError && (
                <p role="alert" className="text-sm text-destructive">
                  {submitError}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setPreviewing(false)}
              >
                <ArrowLeft aria-hidden="true" />
                Back
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={() => void save()}
              >
                <Store aria-hidden="true" />
                {pending
                  ? "Saving…"
                  : published
                    ? "Save changes"
                    : "Publish template"}
              </Button>
            </DialogFooter>
          </>
        ) : editor ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const nextCategory = category.trim()
              const nextOutcome = outcome.trim()
              const nextName = name.trim()
              const nextResponsibilities = Object.fromEntries(
                editor.agents.map(({ id }) => [
                  id,
                  (responsibilities[id] ?? "").trim(),
                ])
              )
              if (
                !nextName ||
                !nextCategory ||
                !nextOutcome ||
                Object.values(nextResponsibilities).some(
                  (responsibility) => !responsibility
                )
              ) {
                setSubmitError("Complete every marketplace field.")
                return
              }
              setName(nextName)
              setCategory(nextCategory)
              setOutcome(nextOutcome)
              setResponsibilities(nextResponsibilities)
              setPreviewing(true)
              setSubmitError(null)
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {published
                  ? "Manage marketplace template"
                  : "Publish as template"}
              </DialogTitle>
              <DialogDescription>
                Describe the reusable team. The conversation and workspace are
                never included.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 space-y-5">
              <Field>
                <FieldLabel htmlFor="marketplace-template-name">
                  Template name
                </FieldLabel>
                <Input
                  id="marketplace-template-name"
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  readOnly={!detached}
                  maxLength={100}
                  required
                />
                {!detached && (
                  <FieldDescription>
                    Uses the current group name.
                  </FieldDescription>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="marketplace-template-category">
                  Category
                </FieldLabel>
                <Input
                  id="marketplace-template-category"
                  value={category}
                  onChange={(event) => setCategory(event.currentTarget.value)}
                  placeholder="e.g. Strategy"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="marketplace-template-outcome">
                  Promised outcome
                </FieldLabel>
                <Textarea
                  id="marketplace-template-outcome"
                  value={outcome}
                  onChange={(event) => setOutcome(event.currentTarget.value)}
                  placeholder="What job should this team accomplish?"
                  required
                />
              </Field>
              <fieldset>
                <legend className="text-sm font-medium">
                  Agent responsibilities
                </legend>
                <p className="mt-1 text-sm text-muted-foreground">
                  Explain the distinct job each agent performs.
                </p>
                <div className="mt-3 space-y-4">
                  {editor.agents.map((agent) => (
                    <Field key={agent.id}>
                      <FieldLabel htmlFor={`marketplace-agent-${agent.id}`}>
                        {agent.name}
                      </FieldLabel>
                      <Input
                        id={`marketplace-agent-${agent.id}`}
                        value={responsibilities[agent.id] ?? ""}
                        onChange={(event) =>
                          setResponsibilities((current) => ({
                            ...current,
                            [agent.id]: event.currentTarget.value,
                          }))
                        }
                        placeholder={agent.headline}
                        required
                      />
                    </Field>
                  ))}
                </div>
              </fieldset>
              {submitError && (
                <p role="alert" className="text-sm text-destructive">
                  {submitError}
                </p>
              )}
            </div>

            <DialogFooter className="mt-6">
              {published && (
                <Button
                  type="button"
                  variant="destructive"
                  className="sm:mr-auto"
                  disabled={pending}
                  onClick={() => void withdraw()}
                >
                  {pending
                    ? detached
                      ? "Deleting…"
                      : "Withdrawing…"
                    : detached
                      ? "Delete template"
                      : "Withdraw template"}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                Preview
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function readMarketplaceEditor(value: unknown): MarketplaceEditor {
  if (
    !isRecord(value) ||
    !isRecord(value.group) ||
    !Array.isArray(value.agents)
  ) {
    throw new Error("Invalid marketplace editor")
  }
  const agents = value.agents.map((agent) => {
    if (
      !isRecord(agent) ||
      typeof agent.id !== "string" ||
      typeof agent.name !== "string" ||
      typeof agent.headline !== "string" ||
      typeof agent.responsibility !== "string"
    ) {
      throw new Error("Invalid marketplace editor agent")
    }
    return {
      id: agent.id,
      name: agent.name,
      headline: agent.headline,
      responsibility: agent.responsibility,
    }
  })
  if (
    typeof value.group.id !== "string" ||
    typeof value.group.name !== "string"
  ) {
    throw new Error("Invalid marketplace editor group")
  }
  return {
    group: { id: value.group.id, name: value.group.name },
    agents,
    template:
      value.template === null ? null : readMarketplaceTemplate(value.template),
  }
}

function readMarketplaceTemplate(value: unknown): MarketplaceTemplate {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !(
      value.sourceGroupId === null || typeof value.sourceGroupId === "string"
    ) ||
    !(
      value.publisherName === null || typeof value.publisherName === "string"
    ) ||
    typeof value.name !== "string" ||
    typeof value.category !== "string" ||
    typeof value.outcome !== "string" ||
    !Array.isArray(value.agents) ||
    typeof value.published !== "boolean"
  ) {
    throw new Error("Invalid marketplace template")
  }
  const agents = value.agents.map((agent) => {
    if (
      !isRecord(agent) ||
      typeof agent.agentId !== "string" ||
      typeof agent.responsibility !== "string"
    ) {
      throw new Error("Invalid marketplace template agent")
    }
    return { agentId: agent.agentId, responsibility: agent.responsibility }
  })
  return {
    id: value.id,
    sourceGroupId: value.sourceGroupId,
    publisherName: value.publisherName,
    name: value.name,
    category: value.category,
    outcome: value.outcome,
    agents,
    published: value.published,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
