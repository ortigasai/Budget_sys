// "3 minutes ago" / "Just now" - deliberately coarse (minutes, not seconds)
// since every caller uses this as a background-sync freshness indicator,
// not a live clock. Shared by UtilizationPage/ForecastPage/
// ManpowerDashboardPage's own "Last synced" labels.
export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
