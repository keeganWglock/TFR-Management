// Cookie API transcripts (https://docs.cookie-api.com -> Discord -> Transcripts -> Transcript V1).
// The API key is read from COOKIE_API_KEY in your .env - never hard-code it.
const ENDPOINT = 'https://api.cookie-api.com/api/transcript';
const LINK_KEYS = ['url', 'transcript_url', 'transcriptUrl', 'link', 'transcript_link', 'view_url'];

function findLink(value) {
  if (typeof value === 'string') return value.match(/https?:\/\/\S+/)?.[0] ?? null;
  if (!value || typeof value !== 'object') return null;
  for (const key of LINK_KEYS) {
    const found = typeof value[key] === 'string' ? findLink(value[key]) : null;
    if (found) return found;
  }
  for (const inner of Object.values(value)) {
    const found = findLink(inner);
    if (found) return found;
  }
  return null;
}

// Creates a transcript of a channel and returns the link where it can be viewed.
export async function createTranscript(client, channelId) {
  const apiKey = process.env.COOKIE_API_KEY?.trim();
  if (!apiKey) throw new Error('COOKIE_API_KEY is not set in the .env file.');

  const url = new URL(ENDPOINT);
  url.searchParams.set('channel_id', channelId);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    body: JSON.stringify({ bot_token: client.token }),
    signal: AbortSignal.timeout(30_000),
  });

  const raw = await response.text();
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }

  if (!response.ok) throw new Error(`Cookie API returned ${response.status}: ${raw.slice(0, 200)}`);

  const link = findLink(body ?? raw);
  if (!link) {
    console.error('[TRANSCRIPT] Unexpected Cookie API response:', raw.slice(0, 500));
    throw new Error('Cookie API did not return a transcript link.');
  }
  return link;
}
