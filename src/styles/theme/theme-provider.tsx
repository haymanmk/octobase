import { ThemeProvider } from "@emotion/react";
import theme from "./theme";

export default function ThemeProviderWrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}