import { studioTheme, type AgStudioTheme, type AgStudioThemeParams } from "ag-studio";

/**
 * AG Studio dressed in LicenseGraph's own palette, so the dashboard reads as part of the product
 * rather than a bolted-on widget: warm paper in light mode, deep ink in dark mode, one green accent.
 * The colours mirror the CSS tokens in app/globals.css.
 */
// The app loads its font with next/font under a generated family name, exposed as this CSS variable.
const FONT = 'var(--font-ui, ui-sans-serif), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  ink: string;
  ink2: string;
  muted: string;
  line: string;
  accent: string;
  scheme: "light" | "dark";
}

const LIGHT: Palette = { bg: "#f0f3ef", surface: "#ffffff", surface2: "#f5f7f3", ink: "#111318", ink2: "#343944", muted: "#5a606d", line: "#d8e1d9", accent: "#0a7446", scheme: "light" };
const DARK: Palette = { bg: "#0b1718", surface: "#122426", surface2: "#172d2f", ink: "#eceef2", ink2: "#c2c7d1", muted: "#979eac", line: "#2d4547", accent: "#4ae6a6", scheme: "dark" };

export function themeParams(p: Palette): Partial<AgStudioThemeParams> {
  const border = [1, p.line] as const;
  return {
    fontFamily: FONT,
    fontSize: 13,
    backgroundColor: p.surface,
    foregroundColor: p.ink,
    textColor: p.ink,
    subtleTextColor: p.muted,
    accentColor: p.accent,
    borderColor: p.line,
    borderRadius: 10,
    browserColorScheme: p.scheme,
    rowHoverColor: p.surface2,
    studioWrapperBackgroundColor: p.bg,
    studioWrapperBorder: border,
    studioWrapperBorderRadius: 6,
    studioMinWidth: 0,
    studioCanvasMinWidth: 0,
    studioCanvasBackgroundColor: p.bg,
    studioCanvasFontFamily: FONT,
    studioPanelContainerBackgroundColor: p.surface,
    studioWidgetBackgroundColor: p.surface,
    studioWidgetBorder: border,
    studioWidgetBorderRadius: 6,
    studioWidgetPadding: 8,
    studioWidgetTitleFontFamily: FONT,
    studioWidgetTitleFontSize: 15,
    studioToggleButtonActiveBackgroundColor: p.accent,
    studioToggleButtonActiveBorderColor: p.accent,
    gridFontFamily: FONT,
    gridHeaderFontFamily: FONT,
    gridHeaderFontWeight: 600,
    gridHeaderBackgroundColor: p.surface2,
    gridHeaderTextColor: p.ink2,
    gridDataBackgroundColor: p.surface,
    gridOddRowBackgroundColor: p.surface2,
    gridCellTextColor: p.ink,
    gridAccentColor: p.accent,
    gridRowHoverColor: p.surface2,
    chartFontFamily: FONT,
    chartTextColor: p.ink,
    chartSubtleTextColor: p.muted,
    chartAccentColor: p.accent,
    chartGridLineColor: p.line,
    chartAxisLineColor: p.line,
    chartTooltipBackgroundColor: p.surface,
    chartTooltipTextColor: p.ink,
  } as Partial<AgStudioThemeParams>;
}

export const licenseGraphTheme = (dark: boolean): AgStudioTheme => studioTheme.withParams(themeParams(dark ? DARK : LIGHT) as never) as AgStudioTheme;
