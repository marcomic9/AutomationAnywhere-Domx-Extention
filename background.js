// Background Service Worker for DomX Inspector

let isPickerActive = false;

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const tabId = request.tabId || (sender.tab ? sender.tab.id : null);
  
  if (!tabId) {
    if (sendResponse) sendResponse({ success: false, error: 'No tab ID found' });
    return false;
  }

  switch (request.action) {
    case 'activatePicker':
      isPickerActive = true;
      if (sendResponse) sendResponse({ success: true });
      injectPickerMode(tabId).catch(() => {});
      return false;

    case 'activatePickerInIframe':
      isPickerActive = true;
      if (sendResponse) sendResponse({ success: true });
      injectPickerModeInSubFrames(tabId).catch(() => {});
      return false;

    case 'deactivatePicker':
      isPickerActive = false;
      if (sendResponse) sendResponse({ success: true });
      chrome.webNavigation.getAllFrames({ tabId: tabId }).then(frames => {
        for (const frame of frames) {
          chrome.tabs.sendMessage(tabId, { action: 'deactivatePicker' }, { frameId: frame.frameId }).catch(() => {});
        }
      }).catch(() => {});
      return false;

    case 'elementSelected':
      isPickerActive = false;
      const originFrameId = sender.frameId;
      console.log(`Element captured in frame ${originFrameId}`);

      // 1. Deactivate picker in ALL frames immediately
      chrome.webNavigation.getAllFrames({ tabId: tabId }).then(frames => {
        for (const frame of frames) {
          chrome.tabs.sendMessage(tabId, { action: 'deactivatePicker' }, { frameId: frame.frameId }).catch(() => {});
        }
      });

      // 2. If element is in an iframe and has cross-origin gaps, resolve frame hierarchy
      if (sendResponse) sendResponse({ success: true });

      if (request.element.inIframe && request.element.frameInfo && request.element.frameInfo.isCrossOrigin) {
        // Resolve cross-origin frame hierarchy via webNavigation API
        resolveFrameHierarchy(tabId, originFrameId, request.element, request.selectors).catch(err => {
          console.warn('Frame hierarchy resolution failed:', err);
          // Send with whatever data we have
          sendToMainFrame(tabId, request.element, request.selectors, originFrameId);
        });
      } else {
        sendToMainFrame(tabId, request.element, request.selectors, originFrameId);
      }
      return false;

    case 'testSelectorInFrame':
      chrome.tabs.sendMessage(tabId, {
        action: 'runTest',
        selector: request.selector,
        index: request.index
      }, { frameId: request.targetFrameId }).catch(() => {
        // Fallback: try running in main frame (content script will attempt same-origin iframes)
        chrome.tabs.sendMessage(tabId, {
          action: 'runTest',
          selector: request.selector,
          index: request.index
        }, { frameId: 0 }).catch(() => {});
      });
      if (sendResponse) sendResponse({ success: true });
      return true;

    case 'testResultFromFrame':
      if (sendResponse) sendResponse({ success: true });
      chrome.tabs.sendMessage(tabId, {
        action: 'showTestResult',
        result: request.result,
        index: request.index
      }, { frameId: 0 }).catch(() => {});
      return false;

    case 'openSidePanel':
      if (sendResponse) sendResponse({ success: true });
      chrome.tabs.sendMessage(tabId, { action: 'showPanel' }, { frameId: 0 }).catch(() => {
        chrome.scripting.executeScript({
          target: { tabId: tabId, frameIds: [0] },
          func: () => {
            if (window.domXPanel) window.domXPanel.showEmpty();
          }
        }).catch(() => {});
      });
      return false;
  }
  return false;
});

/**
 * Send element data to the main frame for panel display.
 */
function sendToMainFrame(tabId, element, selectors, originFrameId) {
  chrome.tabs.sendMessage(tabId, {
    action: 'showPanel',
    element: element,
    selectors: selectors,
    originFrameId: originFrameId
  }, { frameId: 0 }).catch(err => {
    console.warn('Main frame panel update failed, trying injection fallback:', err);
    chrome.scripting.executeScript({
      target: { tabId: tabId, frameIds: [0] },
      func: (data, selectors, fid) => {
        if (window.domXPanel) window.domXPanel.show(data, selectors, fid);
      },
      args: [element, selectors, originFrameId]
    }).catch(() => {});
  });
}

/**
 * Resolve cross-origin frame hierarchy using webNavigation.getAllFrames().
 * Walks from the sender's frameId up through parentFrameId to build the chain,
 * then injects into each parent frame to get the iframe element's attributes.
 */
async function resolveFrameHierarchy(tabId, originFrameId, element, selectors) {
  try {
    const allFrames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!allFrames) throw new Error('No frames found');

    // Build frame map: frameId -> frame info
    const frameMap = {};
    for (const frame of allFrames) {
      frameMap[frame.frameId] = frame;
    }

    // Walk from origin frame up to root (frameId 0)
    const frameChain = [];
    let currentFrameId = originFrameId;
    const MAX_DEPTH = 10;
    let depth = 0;

    while (currentFrameId !== 0 && currentFrameId !== -1 && depth < MAX_DEPTH) {
      const frame = frameMap[currentFrameId];
      if (!frame) break;

      frameChain.unshift({
        frameId: frame.frameId,
        parentFrameId: frame.parentFrameId,
        url: frame.url
      });

      currentFrameId = frame.parentFrameId;
      depth++;
    }

    // For each frame in the chain, inject into the PARENT frame to find the <iframe> element's attributes
    const resolvedFramePath = [];
    for (const frameInfo of frameChain) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabId, frameIds: [frameInfo.parentFrameId] },
          func: (childUrl, childFrameId) => {
            // Find the iframe element in this document that points to the child frame
            const iframes = document.querySelectorAll('iframe');
            for (let i = 0; i < iframes.length; i++) {
              const iframe = iframes[i];
              // Match by src URL or by checking contentWindow
              let isMatch = false;
              try {
                // Try same-origin contentWindow check
                if (iframe.contentWindow) {
                  // We can't directly compare frameIds, but we can check src
                  const iframeSrc = iframe.src || iframe.getAttribute('src') || '';
                  if (childUrl && (iframeSrc === childUrl || childUrl.includes(iframeSrc) || iframeSrc.includes(childUrl.split('/').pop()))) {
                    isMatch = true;
                  }
                }
              } catch (e) { /* cross-origin */ }

              // Fallback: match by src attribute
              if (!isMatch) {
                const iframeSrc = iframe.src || iframe.getAttribute('src') || '';
                if (childUrl && childUrl !== 'about:blank' && iframeSrc && (
                  iframeSrc === childUrl ||
                  childUrl.endsWith(new URL(iframeSrc, document.location.href).pathname)
                )) {
                  isMatch = true;
                }
              }

              if (isMatch) {
                return {
                  found: true,
                  id: iframe.id || '',
                  name: iframe.getAttribute('name') || '',
                  src: iframe.getAttribute('src') || '',
                  title: iframe.getAttribute('title') || '',
                  index: i,
                  totalIframes: iframes.length
                };
              }
            }

            // If no match by URL, try matching by index (if only one iframe)
            if (iframes.length === 1) {
              const iframe = iframes[0];
              return {
                found: true,
                id: iframe.id || '',
                name: iframe.getAttribute('name') || '',
                src: iframe.getAttribute('src') || '',
                title: iframe.getAttribute('title') || '',
                index: 0,
                totalIframes: 1
              };
            }

            return { found: false };
          },
          args: [frameInfo.url, frameInfo.frameId]
        });

        if (results && results[0] && results[0].result && results[0].result.found) {
          const attrs = results[0].result;
          // Generate XPath for this iframe using same priority as content script
          let xpath = '';
          let method = '';
          if (attrs.id && !/\d{2,}/.test(attrs.id)) {
            xpath = `//iframe[@id='${attrs.id}']`;
            method = 'id';
          } else if (attrs.name) {
            xpath = `//iframe[@name='${attrs.name}']`;
            method = 'name';
          } else if (attrs.src && attrs.src !== 'about:blank') {
            xpath = attrs.src.length < 80
              ? `//iframe[@src='${attrs.src}']`
              : `//iframe[contains(@src, '${attrs.src.substring(0, 60)}')]`;
            method = 'src';
          } else if (attrs.title) {
            xpath = `//iframe[@title='${attrs.title}']`;
            method = 'title';
          } else if (attrs.id) {
            xpath = `//iframe[@id='${attrs.id}']`;
            method = 'id-dynamic';
          } else {
            xpath = `(//iframe)[${attrs.index + 1}]`;
            method = 'index';
          }

          resolvedFramePath.push({
            xpath, method,
            id: attrs.id,
            name: attrs.name,
            src: attrs.src,
            index: attrs.index
          });
        } else {
          resolvedFramePath.push({
            xpath: null,
            method: 'unresolved',
            id: '',
            name: '',
            src: frameInfo.url,
            index: null
          });
        }
      } catch (e) {
        resolvedFramePath.push({
          xpath: null,
          method: 'injection-failed',
          id: '',
          name: '',
          src: frameInfo.url,
          index: null
        });
      }
    }

    // Merge resolved data into element's frameInfo
    if (element.frameInfo) {
      // Replace any null xpaths in the content script's framePath with resolved ones
      const mergedPath = element.frameInfo.framePath.map((entry, i) => {
        if (!entry.xpath && resolvedFramePath[i] && resolvedFramePath[i].xpath) {
          return { ...entry, ...resolvedFramePath[i] };
        }
        return entry;
      });

      // If content script path is shorter (couldn't walk cross-origin), use resolved path
      if (resolvedFramePath.length > element.frameInfo.framePath.length) {
        element.frameInfo.framePath = resolvedFramePath;
        element.frameInfo.depth = resolvedFramePath.length;
      } else {
        element.frameInfo.framePath = mergedPath;
      }

      // Rebuild frameDomPath
      element.frameInfo.frameDomPath = element.frameInfo.framePath
        .filter(f => f.xpath)
        .map(f => f.xpath)
        .join('|');
    }

    sendToMainFrame(tabId, element, selectors, originFrameId);
  } catch (err) {
    console.error('Frame hierarchy resolution error:', err);
    sendToMainFrame(tabId, element, selectors, originFrameId);
  }
}

async function injectPickerMode(tabId) {
  try {
    // 1. Try to activate in all frames. Those that don't have it will return an error or null results.
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      func: () => {
        if (window.domXPicker) {
          window.domXPicker.activate();
          return { active: true };
        }
        return { active: false };
      }
    }).catch(() => []);

    // 2. Identify frames that failed and inject script there
    // Actually, it's safer and faster to just try injecting in all frames.
    // executeScript with files won't re-inject if already there due to our wrapper.
    await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      files: ['contentScript.js']
    }).catch(err => console.warn('Injection failed in some frames:', err));

    // 3. Activate in all frames again
    await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      func: () => {
        if (window.domXPicker) {
          window.domXPicker.activate();
        }
      }
    }).catch(err => console.error('Activation failed:', err));

  } catch (err) {
    console.error('Failed to inject picker:', err);
  }
}

async function injectPickerModeInSubFrames(tabId) {
  injectPickerMode(tabId);
}
