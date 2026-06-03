export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;

  // Vercel Cron sends a different header — accept that too.
  if (req.headers.get("x-vercel-cron-signature")) return true;

  return false;
}
