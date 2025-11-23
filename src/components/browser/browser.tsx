import { Box, TextField, IconButton, Paper } from "@mui/material";
import Stack from "@mui/material/Stack";
import { useState } from "react";
import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

export function Browser() {
    const defaultUrl = 'https://google.com';
    const [url, setUrl] = useState(defaultUrl);
    const [currentUrl, setCurrentUrl] = useState(defaultUrl);

    const handleUrlSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const googleSearchPrefix = 'google.com/search?q=';
        let finalUrl = url;
        
        // Add https:// if no protocol specified
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            finalUrl = 'https://' + googleSearchPrefix + url;
        }
        
        setCurrentUrl(finalUrl);
    };

    const handleRefresh = () => {
        setCurrentUrl(currentUrl + '?refresh=' + Date.now());
    };

    return (
        <Paper elevation={3} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
                <Stack direction="row" spacing={1} alignItems="center">
                    <IconButton size="small" disabled>
                        <ArrowBackIcon />
                    </IconButton>
                    <IconButton size="small" disabled>
                        <ArrowForwardIcon />
                    </IconButton>
                    <IconButton size="small" onClick={handleRefresh}>
                        <RefreshIcon />
                    </IconButton>
                    
                    <Box component="form" onSubmit={handleUrlSubmit} sx={{ flex: 1 }}>
                        <TextField
                            fullWidth
                            size="small"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="Enter URL"
                            variant="outlined"
                        />
                    </Box>
                </Stack>
            </Box>
            
            <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                <iframe
                    src={currentUrl}
                    style={{
                        width: '100%',
                        height: '100%',
                        border: 'none',
                        display: 'block'
                    }}
                    title="Browser"
                    sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                />
            </Box>
        </Paper>
    );
}