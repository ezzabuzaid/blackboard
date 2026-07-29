import { useLoaderData } from "react-router"

import { Avatar, AvatarFallback, Badge } from "@stdlib/shadcn"

import type { loader } from "./loader"

export function ChatHeader() {
  const { apiStatus } = useLoaderData<typeof loader>()

  return (
    <header className="border-b border-border/70">
      <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback className="bg-foreground font-heading font-semibold text-background">
              5
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-heading text-sm font-semibold tracking-tight">
              DeepAgents Group
            </p>
            <p className="text-xs text-muted-foreground">Five specialists</p>
          </div>
        </div>
        <Badge variant="outline" className="gap-2 font-normal">
          <span
            className={`size-1.5 rounded-full ${
              apiStatus === "ready" ? "bg-emerald-500" : "bg-destructive"
            }`}
          />
          {apiStatus === "ready" ? "API ready" : "API offline"}
        </Badge>
      </div>
    </header>
  )
}
