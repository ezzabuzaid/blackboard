export function toggleAgentSelection(
  selected: readonly string[],
  id: string,
  limit = 8
) {
  return selected.includes(id)
    ? selected.filter((selectedId) => selectedId !== id)
    : selected.length < limit
      ? [...selected, id]
      : [...selected]
}

export function matchesTemplateFilter(
  template: { source: string; category: string },
  filter: string
) {
  return (
    filter === "all" ||
    filter === `source:${template.source}` ||
    filter === `category:${template.category}`
  )
}

export function loginPathForTemplate(templateId: string) {
  const redirect = `/groups/new?${new URLSearchParams({
    template: templateId,
  })}`
  return `/login?${new URLSearchParams({ redirect })}`
}
