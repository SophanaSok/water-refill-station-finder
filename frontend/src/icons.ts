export const stationTypeIcons = {
  fountain: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2c-2.8 0-5 2.2-5 5 0 1.7.8 3.2 2 4.2V12H7v3.5c0 2.5 2 4.5 4.5 4.5h1c2.5 0 4.5-2 4.5-4.5V12h-2v-.8c1.2-1 2-2.5 2-4.2 0-2.8-2.2-5-5-5Zm0 2c1.7 0 3 1.3 3 3 0 1.2-.7 2.2-1.7 2.7-.7.3-1.3 1-1.3 1.8V12h-2v-.5c0-.8-.6-1.5-1.3-1.8C9.7 9.2 9 8.2 9 7c0-1.7 1.3-3 3-3Zm-1 10h2v3.5c0 .8-.7 1.5-1.5 1.5s-1.5-.7-1.5-1.5V14Z" fill="currentColor"/>
    </svg>
  `,
  bottle_filler: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M15 2H9v2H8v3.1c0 .7.2 1.4.6 2L10 11v11h4V11l1.4-1.9c.4-.6.6-1.3.6-2V4h-1V2Zm-4 2h2v1h-2V4Zm-.4 4.1c-.2-.3-.3-.7-.3-1V7h3v.1c0 .3-.1.7-.3 1L12 10l-1.4-1.9Z" fill="currentColor"/>
    </svg>
  `,
  store_refill: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 10.5 12 4l8 6.5V20H4v-9.5Zm2 1.1V18h12v-6.4L12 6.6 6 11.6Zm2.2 2.4h7.6v2H8.2v-2Z" fill="currentColor"/>
    </svg>
  `,
  tap: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 6h4V4H7.5C6.1 4 5 5.1 5 6.5V9H4v3h1v2.5C5 15.9 6.1 17 7.5 17H9v3h2v-3h2c1.7 0 3-1.3 3-3v-2h2v-3h-2V9c0-1.7-1.3-3-3-3h-2V4h-2v2H5Zm4 5V7h6v1.5c0 .8.7 1.5 1.5 1.5h.5v1h-.5c-.8 0-1.5.7-1.5 1.5V13H9v-1.5c0-.8-.7-1.5-1.5-1.5H7v-1h.5C8.3 10 9 9.3 9 8.5Z" fill="currentColor"/>
    </svg>
  `,
} as const;

export type StationType = keyof typeof stationTypeIcons;

export function getStationTypeIcon(type: string): string {
  return stationTypeIcons[type as StationType] ?? stationTypeIcons.fountain;
}
