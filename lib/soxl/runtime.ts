/** True when executing on Vercel serverless (cron / API routes). */
export function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1";
}
