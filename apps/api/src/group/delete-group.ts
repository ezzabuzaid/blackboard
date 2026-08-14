export function createGroupDeletion(options: {
  exists(userId: string, groupId: string): boolean
  clearRuntime(userId: string, groupId: string): Promise<void>
  deleteSandbox(userId: string, groupId: string): Promise<void>
  deleteShares(userId: string, groupId: string): void
  removeMarketplaceSource(userId: string, groupId: string): void
  deleteRecord(userId: string, groupId: string): boolean
}) {
  const active = new Map<string, Promise<boolean>>()
  const groupIds = new Set<string>()

  return {
    delete(userId: string, groupId: string) {
      const key = JSON.stringify([userId, groupId])
      const existing = active.get(key)
      if (existing) return existing
      if (!options.exists(userId, groupId)) return Promise.resolve(false)

      const operation = (async () => {
        await options.clearRuntime(userId, groupId)
        await options.deleteSandbox(userId, groupId)
        options.deleteShares(userId, groupId)
        options.removeMarketplaceSource(userId, groupId)
        return options.deleteRecord(userId, groupId)
      })().finally(() => {
        active.delete(key)
        groupIds.delete(groupId)
      })
      active.set(key, operation)
      groupIds.add(groupId)
      return operation
    },
    has(userId: string, groupId: string) {
      return active.has(JSON.stringify([userId, groupId]))
    },
    hasGroup(groupId: string) {
      return groupIds.has(groupId)
    },
  }
}
