

export function getSelectedText(view) {
  view.webContents.executeJavaScript(`
    // Monitor text selection
    document.addEventListener('mouseup', () => {
      const selection = window.getSelection();
      const selectedText = selection.toString();

      if (selectedText.length > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // Debug logging
        console.log('Selected Text:', selectedText);
        console.log('Bounding Rect:', rect);

        // Send selected data to main process
        if (window.electronAPI) {
          window.electronAPI.sendTextSelection({
            text: selectedText,
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            }
          });
        }
      }
    }
    );`)
    .then((result) => {
      console.log('Text selection script executed:', result);
    })
    .catch((error) => {
      console.error('Error executing text selection script:', error);
    });
  }