/** Strip common markdown so local-model replies read cleanly in the chat panel. */
export function sanitizeModelReply(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*\n?|\n?```/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[\s(])\*(.+?)\*(?=[\s).,]|$)/gm, '$1$2')
    .replace(/^\t?\+\s+/gm, '- ')
    .replace(/^[ \t]*[-*]\s+/gm, '- ')
    .replace(/^[ \t]+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
