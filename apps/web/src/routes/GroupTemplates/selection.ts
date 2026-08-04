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
