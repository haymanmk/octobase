import { ThemeProvider } from "@mui/material/styles";
import { CssBaseline } from "@mui/material";
import { createTheme } from "@styles/theme/create-theme";

function ThemeProviderWrapper({ children }: { children: React.ReactNode }) {
    const theme = createTheme();
    console.log("Applied theme:", theme);
  return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            {children}
        </ThemeProvider>
    );
}

export { ThemeProviderWrapper as ThemeProvider };