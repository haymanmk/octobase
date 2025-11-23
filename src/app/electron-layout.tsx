import '@styles/global.css';
import { Box, useTheme, } from '@mui/material';
import Whiteboard from './whiteboard';

export default function Layout() {
  const theme = useTheme();
  return (
    <Box sx={{height: '100vh', bgcolor: theme.palette.background.default }}>
      <Whiteboard />
    </Box>
  );
}
