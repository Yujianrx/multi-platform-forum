// Text previews only; full bodies continue through the existing safe renderer.
export function previewText(value: string = '') {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/(^|\s)(?:#{1,6}|>|[-*+]\s|\d+\.\s)\s*/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
