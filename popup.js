// Popup script for DomX Inspector

document.addEventListener('DOMContentLoaded', async () => {
  const startPickerBtn = document.getElementById('startPicker');
  const openPanelBtn = document.getElementById('openPanel');
  const statusDiv = document.getElementById('status');

  function showStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + type;
    setTimeout(() => {
      statusDiv.className = 'status';
    }, 3000);
  }

  async function injectContentScript(tabId) {
    try {
      // Check if already injected by pinging
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      return true; // Already injected
    } catch (e) {
      // Not injected, inject it now
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['contentScript.js']
        });
        // Wait a moment for initialization
        await new Promise(resolve => setTimeout(resolve, 100));
        return true;
      } catch (injectError) {
        console.error('Failed to inject content script:', injectError);
        return false;
      }
    }
  }

  startPickerBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Ensure content script is injected in main frame at least
      const injected = await injectContentScript(tab.id);
      if (!injected) {
        showStatus('Error: Cannot inject on this page. Try a regular website.', 'error');
        return;
      }
      
      // Send message to background to activate picker in all frames
      chrome.runtime.sendMessage({ action: 'activatePicker', tabId: tab.id });
      
      showStatus('Picker mode activated! Click an element on the page.', 'success');
      
      // Close popup after short delay
      setTimeout(() => window.close(), 500);
      
    } catch (error) {
      showStatus('Error: Could not activate picker.', 'error');
      console.error('Picker activation error:', error);
    }
  });

  openPanelBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Ensure content script is injected
      const injected = await injectContentScript(tab.id);
      if (!injected) {
        showStatus('Error: Cannot inject on this page.', 'error');
        return;
      }
      
      // Send message to background to open panel
      chrome.runtime.sendMessage({ action: 'openSidePanel', tabId: tab.id });
      
      window.close();
      
    } catch (error) {
      showStatus('Error: Could not open panel.', 'error');
      console.error('Panel open error:', error);
    }
  });
});
