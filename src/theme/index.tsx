import { createContext, useContext, PropsWithChildren, useMemo } from "react";
import {
  DefaultTheme,
  ThemeProvider as StyledThemeProvider,
} from "styled-components";
import type { BorderRadius, Colors, Gaps, Theme } from "./theme";
import { borderRadius } from "polished";
export type { Color, Colors, Theme } from "./theme";

export interface ThemeProps {
  theme: Theme;
}

export const lightTheme: Colors = {
  primary: "#FFFFFF", // pure white for primary elements
  secondary: "#2ecc71", // a light green for secondary elements
  tertiary: "#f1c40f", // a muted yellow for tertiary accents
  background: "#12131A", // a dark gray for backgrounds
  background2: "#323232", // a very light gray for backgrounds
  text: "#34495e", // a darker gray for regular text, ensuring good readability
  textInverted: "#ffffff", // pure white for text on dark backgrounds
};

export const darkTheme: Colors = {
  primary: "",
  secondary: "",
  tertiary: "",
  background: "",
  background2: "",
  text: "",
  textInverted: "",
};

const defaultBorderRadius: BorderRadius = {
  xsmall: 0.5,
  small: 0.75,
  medium: 1,
  large: 1.5,
};

const gapValues: Gaps = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "24px",
  xl: "32px",
};

export const defaultTheme = {
  grids: gapValues,
  ...lightTheme,
  borderRadius: defaultBorderRadius,
};

const ThemeContext = createContext<DefaultTheme>(toDefaultTheme(defaultTheme));

export function Provider({ theme, children }: PropsWithChildren<ThemeProps>) {
  const themeCtx = useContext(ThemeContext);
  const value = useMemo(() => {
    return toDefaultTheme({
      ...theme,
      ...themeCtx,
    } as Required<Theme>);
  }, [theme, themeCtx]);
  return (
    <ThemeContext.Provider value={value}>
      <StyledThemeProvider theme={value}>{children}</StyledThemeProvider>
    </ThemeContext.Provider>
  );
}

function toDefaultTheme(theme: Required<Theme>): DefaultTheme {
  return {
    ...theme,
    borderRadius: theme.borderRadius
      ? (theme.borderRadius as BorderRadius)
      : defaultBorderRadius,
    grids: theme.grids ? (theme.grids as Gaps) : gapValues,
  };
}
