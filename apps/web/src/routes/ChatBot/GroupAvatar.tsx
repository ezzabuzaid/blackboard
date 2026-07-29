import { Avatar, AvatarFallback, AvatarGroup, cn } from "@stdlib/shadcn"

export const groupMembers = ["Maya", "Omar", "Lina", "Rami", "Noor"] as const

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
  Rami: {
    avatar: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
    name: "text-sky-700 dark:text-sky-300",
  },
  Noor: {
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
  const monogram = `${name.at(0) ?? ""}${name.at(-1) ?? ""}`.toUpperCase()

  return (
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
