/**
 * `APPLE_APP_IDS` (wrangler.toml's vars): the apps, as `TEAMID.bundle.id`
 * and separated by spaces or commas, that iOS lets use this site's
 * passkeys (`webcredentials`). An app ID isn't a secret: the file is public
 * by design. Without one, the file isn't served.
 */
const APP_ID = /^[A-Z0-9]{10}\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export function appleAppIds(value = process.env.APPLE_APP_IDS ?? "") {
  const ids = value.split(/[\s,]+/).filter(Boolean);
  for (const id of ids)
    if (!APP_ID.test(id))
      throw new Error(
        `APPLE_APP_IDS has an ID that isn't TEAMID.bundle.id: ${id}`,
      );
  return ids;
}

export function appleAppSiteAssociation(value?: string) {
  const apps = appleAppIds(value);
  return apps.length ? { webcredentials: { apps } } : undefined;
}
