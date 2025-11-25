import { createRoot } from 'react-dom/client';
import { Box, IconButton, TextField, useTheme } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import RefreshIcon from '@mui/icons-material/Refresh';
import HomeIcon from '@mui/icons-material/Home';
import { useState } from 'react';
import { ThemeProvider } from '../theme-provider/theme-provider';

export function SearchBar() {
	const [url, setUrl] = useState('');
	const theme = useTheme();

	const handleBack = () => {
		// Implement back navigation
		console.log('Back');
	};

	const handleForward = () => {
		// Implement forward navigation
		console.log('Forward');
	};

	const handleRefresh = () => {
		// Implement refresh
		console.log('Refresh');
	};

	const handleHome = () => {
		// Implement home navigation
		console.log('Home');
	};

	const handleKeyPress = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			// Navigate to URL
			console.log('Navigate to:', url);
		}
	};

	return (
		<Box
			sx={{
				display: 'flex',
				alignItems: 'center',
				gap: 1,
				padding: '4px 8px',
				backgroundColor: theme.palette.background.paper,
			}}
		>
			<IconButton size="small" onClick={handleBack}>
				<ArrowBackIcon fontSize="small" />
			</IconButton>
			<IconButton size="small" onClick={handleForward}>
				<ArrowForwardIcon fontSize="small" />
			</IconButton>
			<IconButton size="small" onClick={handleRefresh}>
				<RefreshIcon fontSize="small" />
			</IconButton>
			<IconButton size="small" onClick={handleHome}>
				<HomeIcon fontSize="small" />
			</IconButton>
			<TextField
				size="small"
				fullWidth
				value={url}
				onChange={(e) => setUrl(e.target.value)}
				onKeyDown={handleKeyPress}
				placeholder="Search or enter address"
				variant="outlined"
				sx={{
					'& .MuiOutlinedInput-root': {
						backgroundColor: 'white',
						borderRadius: '20px',
					},
				}}
			/>
		</Box>
	);
}

const root = createRoot(document.getElementById('search-bar')!);
root.render(
	<ThemeProvider>
		<SearchBar />
	</ThemeProvider>
);