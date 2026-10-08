// Same roles as the web tokens (apps/web/src/app/globals.css). Moves to packages/ui in M6.
export const color = {
  bg: "#f5f6f8",
  surface: "#ffffff",
  sunken: "#eef0f3",
  border: "#dde1e7",
  ink: "#151a23",
  muted: "#5d6675",
  accent: "#0f6b5c",
  accentSoft: "#e2f1ed",
  warning: "#94620a",
  warningSoft: "#fbf0d9",
  critical: "#b42828",
  criticalSoft: "#fbe6e4",
} as const;

export const space = (n: number) => n * 4;
export const radius = { sm: 4, md: 8, lg: 12 } as const;
