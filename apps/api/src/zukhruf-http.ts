export const ZUKHRUF_HTTP_PATH = '/zukhruf/v1';

export function zukhrufSessionStreamPath(sessionId: string) {
  return `${ZUKHRUF_HTTP_PATH}/session/${encodeURIComponent(sessionId)}/stream`;
}
