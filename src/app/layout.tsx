import '@styles/global.css';
import { Outlet } from 'react-router';
import { Box, Stack } from '@mui/material';
import { Browser } from '@/components/browser/browser';

export default function Layout() {
  return (
    <Box>
        <Stack direction="row" sx={{width: '100vw', height: '100vh'}}>
            <Box sx={{ flexGrow: 1 }}>
                <Outlet />
            </Box>
            <Box sx={{ flexGrow: 1 }}>
                <Browser />
            </Box>
        </Stack>
    </Box>
  );
}
