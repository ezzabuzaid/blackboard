import { Avatar, AvatarFallback, AvatarGroup, Button, cn } from "@stdlib/shadcn"

import { useAgentTraceSelection } from "./traces/AgentTraceSidebar"

const groupMemberAvatarClass = "bg-muted text-foreground"
export const groupMemberNameClass = "text-foreground"

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
          className={cn("font-medium uppercase", groupMemberAvatarClass)}
        >
          {monogram}
        </AvatarFallback>
      </Avatar>
    </Button>
  )
}

export function GroupAvatarStack({
  members,
  className,
}: {
  members: readonly string[]
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
