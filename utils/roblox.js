// Looks up the Roblox account a Discord user linked through Dock.
// Needs DOCK_API_KEY in your .env (the Dock API key for your server).
const DOCK_URL = 'https://api.docksys.xyz/api/v1/public/discord-to-roblox';

// Returns { id, name, profile } or null when the user has no linked Roblox account.
// Throws if Dock itself can't be reached or rejects the request.
export async function lookupRoblox(guildId, discordId) {
  const apiKey = process.env.DOCK_API_KEY?.trim();
  if (!apiKey) throw new Error('DOCK_API_KEY is not set in the .env file.');

  const url = new URL(DOCK_URL);
  url.searchParams.set('discordId', discordId);
  url.searchParams.set('guildId', guildId);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null; // not linked
  if (!response.ok) throw new Error(`Dock API returned ${response.status}: ${(await response.text()).slice(0, 150)}`);

  const body = await response.json();
  const id = body?.data?.robloxId;
  if (!id) return null;

  // Dock only returns the ID, so the username comes from Roblox's public API.
  let name = null;
  try {
    const roblox = await fetch(`https://users.roblox.com/v1/users/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (roblox.ok) name = (await roblox.json())?.name ?? null;
  } catch (error) {
    console.warn(`[ROBLOX] Could not fetch the username for ${id}: ${error.message}`);
  }

  return { id: String(id), name: name ?? 'Unknown', profile: `https://www.roblox.com/users/${id}/profile` };
}
