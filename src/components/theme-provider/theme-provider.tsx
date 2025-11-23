import { ThemeProvider } from "@emotion/react";
import { CssBaseline } from "@mui/material";
import { createTheme } from "@styles/theme/create-theme";

export default function ThemeProviderWrapper({ children }: { children: React.ReactNode }) {
    const theme = createTheme();
  return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            {children}
        </ThemeProvider>
    );
}