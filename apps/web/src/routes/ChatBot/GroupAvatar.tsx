import { Avatar, AvatarFallback, AvatarGroup, Button, cn } from "@stdlib/shadcn"

import { useAgentTraceSelection } from "./traces/AgentTraceSidebar"

export const groupMembers = ["Maya", "Omar", "Lina", "Paul Graham"] as const

const fallbackTone = {
  avatar: "bg-muted text-foreground",
  name: "text-foreground",
}

const memberTones: Record<
  (typeof groupMembers)[number],
  { avatar: string; name: string }
> = {
  Maya: {
    avatar:
      "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
    name: "text-violet-700 dark:text-violet-300",
  },
  Omar: {
    avatar: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    name: "text-amber-800 dark:text-amber-300",
  },
  Lina: {
    avatar: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
    name: "text-rose-700 dark:text-rose-300",
  },
  "Paul Graham": {
    avatar:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    name: "text-emerald-700 dark:text-emerald-300",
  },
}

function memberTone(name: string) {
  return memberTones[name as (typeof groupMembers)[number]] ?? fallbackTone
}

export function groupMemberNameClass(name: string) {
  return memberTone(name).name
}

export function GroupAvatar({
  name,
  size = "default",
  className,
}: {
  name: string
  size?: "default" | "sm"
  className?: string
}) {
  const { select } = useAgentTraceSelection()
  const parts = name.split(/\s+/u)
  const monogram = `${parts[0]?.at(0) ?? ""}${
    (parts.length === 1 ? parts[0]?.at(-1) : parts.at(-1)?.at(0)) ?? ""
  }`.toUpperCase()

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`View ${name} traces`}
      className="size-auto rounded-full p-0 focus-visible:ring-offset-2"
      onClick={() => select(name)}
    >
      <Avatar
        size={size}
        className={cn("relative z-10 bg-background", className)}
        title={name}
      >
        <AvatarFallback
          className={cn("font-medium uppercase", memberTone(name).avatar)}
        >
          {monogram}
        </AvatarFallback>
      </Avatar>
    </Button>
  )
}

export function GroupAvatarStack({
  members = groupMembers,
  className,
}: {
  members?: readonly string[]
  className?: string
}) {
  return (
    <AvatarGroup
      aria-label={`${members.length} group members`}
      className={className}
    >
      {members.map((name) => (
        <GroupAvatar key={name} name={name} size="sm" />
      ))}
    </AvatarGroup>
  )
}
