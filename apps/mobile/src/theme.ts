// Same roles as the web tokens (apps/web/src/app/globals.css).
export const color = {
  bg: "#f5f6f8",
  surface: "#ffffff",
  sunken: "#eef0f3",
  border: "#dde1e7",
  ink: "#151a23",
  muted: "#5d6675",
  accent: "#0f6b5c",
  accentSoft: "#e2f1ed",
  info: "#1f5fae",
  infoSoft: "#e3eefb",
  success: "#1d7a43",
  successSoft: "#e2f3e8",
  warning: "#94620a",
  warningSoft: "#fbf0d9",
  critical: "#b42828",
  criticalSoft: "#fbe6e4",
} as const;

export type Tone = "neutral" | "info" | "success" | "warning" | "critical";
export const tones: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: color.muted, bg: color.sunken },
  info: { fg: color.info, bg: color.infoSoft },
  success: { fg: color.success, bg: color.successSoft },
  warning: { fg: color.warning, bg: color.warningSoft },
  critical: { fg: color.critical, bg: color.criticalSoft },
};

export const space = (n: number) => n * 4;
export const radius = { sm: 4, md: 8, lg: 12 } as const;
