import '@styles/global.css';
import { Outlet } from 'react-router';
import { Box } from '@mui/material';

export default function Layout() {
  return (
    <Box sx={{ width: '100vw', height: '100vh' }}>
      <Outlet />
    </Box>
  );
}
