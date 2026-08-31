const LIST_ITEM = /^(?:\d+[.)、]|[-*•])\s+/

export function parseRequirementTexts(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const listItems = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => LIST_ITEM.test(line))
    .map((line) => line.replace(LIST_ITEM, '').trim())
    .filter(Boolean)
  if (listItems.length >= 2) return listItems

  const paragraphs = trimmed
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  if (paragraphs.length >= 2) return paragraphs

  return [trimmed]
}
