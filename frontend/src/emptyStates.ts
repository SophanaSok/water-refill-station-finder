export function renderNoStationsEmptyState(): string {
  return `
    <div class="empty-state-card empty-state-card--stations" role="status" aria-live="polite">
      <div class="empty-state-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M12 2c-2.8 0-5 2.2-5 5 0 1.7.8 3.2 2 4.2V12H7v3.5c0 2.5 2 4.5 4.5 4.5h1c2.5 0 4.5-2 4.5-4.5V12h-2v-.8c1.2-1 2-2.5 2-4.2 0-2.8-2.2-5-5-5Zm0 2c1.7 0 3 1.3 3 3 0 1.2-.7 2.2-1.7 2.7-.7.3-1.3 1-1.3 1.8V12h-2v-.5c0-.8-.6-1.5-1.3-1.8C9.7 9.2 9 8.2 9 7c0-1.7 1.3-3 3-3Zm-1 10h2v3.5c0 .8-.7 1.5-1.5 1.5s-1.5-.7-1.5-1.5V14Z" fill="currentColor"/>
        </svg>
      </div>
      <div class="empty-state-copy">
        <h2>No stations found here</h2>
        <p>Be the first to add one!</p>
      </div>
      <button class="btn-primary empty-state-action" data-action="open-add-station">+ Add Station</button>
    </div>
  `;
}

export function renderSearchNoResultsEmptyState(query: string): string {
  return `
    <div class="empty-state-card empty-state-card--search" role="status" aria-live="polite">
      <div class="empty-state-copy">
        <h2>No results for &quot;${escapeHtml(query)}&quot;</h2>
        <p>Try a nearby city, ZIP code, or station name.</p>
      </div>
    </div>
  `;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (c) => map[c] ?? c);
}
