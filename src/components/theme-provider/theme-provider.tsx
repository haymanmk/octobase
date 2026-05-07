import { ThemeProvider } from "@mui/material/styles";
import { CssBaseline } from "@mui/material";
import { createTheme } from "@styles/theme/create-theme";

function ThemeProviderWrapper({ children }: { children: React.ReactNode }) {
    const theme = createTheme();
  return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            {children}
        </ThemeProvider>
    );
}

export { ThemeProviderWrapper as ThemeProvider };