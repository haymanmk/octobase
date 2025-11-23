import { createTheme } from "@mui/material";
import { colorSchemes } from "./color-schemes";

function customCreateTheme() {
    // Custom theme creation logic here
    const theme =  createTheme({
        breakpoints: { values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1440 } },
        cssVariables: {
                colorSchemeSelector: "class",
            },
        direction: "ltr",
        shape: { borderRadius: 8 },
        colorSchemes,
});
    return theme;
}

export { customCreateTheme as createTheme };