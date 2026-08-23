/** Run club coach is off unless RUN_CLUB_ENABLED=true in env. */
export function isRunClubEnabled(): boolean {
  return process.env.RUN_CLUB_ENABLED?.trim().toLowerCase() === "true";
}
