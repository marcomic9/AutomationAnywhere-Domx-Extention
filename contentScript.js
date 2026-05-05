// DomX Inspector - Content Script
// Handles picker mode, element highlighting, and selector generation

(function() {
  'use strict';

  if (window.domXPicker) return;

  class DomXPicker {
    constructor() {
      this.isActive = false;
      this.highlightOverlay = null;
      this.escapeHandler = (e) => { if (e.key === 'Escape' && this.isActive) { e.preventDefault(); this.deactivate(); this.showNotification('Cancelled.'); } };
      this.clickHandler = (e) => {
        if (!this.isActive || e.target.tagName === 'IFRAME') return;
        e.preventDefault(); e.stopPropagation();
        this.deactivate();
        this.processElement(e.target);
      };
      this.mouseOverHandler = (e) => {
        if (!this.isActive || e.target.tagName === 'IFRAME') return;
        const target = this.getMeaningfulTarget(e.target);
        this.highlightElement(target);
      };
      this.mouseOutHandler = (e) => {
        if (!this.isActive) return;
        if (this.highlightOverlay) this.highlightOverlay.style.display = 'none';
      };
    }

    activate() {
      if (this.isActive) return;
      this.isActive = true;
      document.addEventListener('keydown', this.escapeHandler, true);
      document.addEventListener('click', this.clickHandler, true);
      document.addEventListener('mouseover', this.mouseOverHandler, true);
      document.addEventListener('mouseout', this.mouseOutHandler, true);
      this.createHighlightOverlay();
      this.showNotification('Click an element to capture. ESC to cancel.');
    }

    deactivate() {
      this.isActive = false;
      document.removeEventListener('keydown', this.escapeHandler, true);
      document.removeEventListener('click', this.clickHandler, true);
      document.removeEventListener('mouseover', this.mouseOverHandler, true);
      document.removeEventListener('mouseout', this.mouseOutHandler, true);
      if (this.highlightOverlay) this.highlightOverlay.style.display = 'none';
      const n = document.getElementById('domx-notification');
      if (n) n.style.display = 'none';
    }

    createHighlightOverlay() {
      if (this.highlightOverlay) return;
      this.highlightOverlay = document.createElement('div');
      this.highlightOverlay.style.cssText = 'position:fixed; pointer-events:none; z-index:2147483647; border:2px solid #3498db; background:rgba(52,152,219,0.1); display:none;';
      (document.body || document.documentElement).appendChild(this.highlightOverlay);
    }

    getMeaningfulTarget(el) {
      const meaningful = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'FORM', 'IMG', 'TABLE', 'TH', 'TD', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
      let current = el;
      let depth = 0;
      while (current && current !== document.body && current !== document.documentElement && depth < 10) {
        if (meaningful.includes(current.tagName)) return current;
        if (current.id && current.id.length > 0 && !current.id.match(/^[0-9]+$/)) return current;
        if (current.getAttribute('data-testid') || current.getAttribute('data-qa') || current.getAttribute('data-automation')) return current;
        if (current.getAttribute('aria-label')) return current;
        if (current.getAttribute('role')) return current;
        
        // Detect non-standard buttons (div/span acting as buttons)
        const className = (current.className || '').toString().toLowerCase();
        if (className.includes('btn') || className.includes('button')) return current;
        
        try {
          if (window.getComputedStyle(current).cursor === 'pointer') return current;
        } catch (e) {}

        current = current.parentElement;
        depth++;
      }
      return el;
    }

    highlightElement(el) {
      if (!this.highlightOverlay) return;
      const r = el.getBoundingClientRect();
      this.highlightOverlay.style.display = 'block';
      this.highlightOverlay.style.top = r.top + 'px';
      this.highlightOverlay.style.left = r.left + 'px';
      this.highlightOverlay.style.width = r.width + 'px';
      this.highlightOverlay.style.height = r.height + 'px';
    }

    showNotification(text) {
      let n = document.getElementById('domx-notification');
      if (!n) {
        n = document.createElement('div');
        n.id = 'domx-notification';
        n.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#333; color:white; padding:10px 20px; border-radius:4px; z-index:2147483647; font-family:sans-serif; font-size:13px;';
        (document.body || document.documentElement).appendChild(n);
      }
      n.textContent = text;
      n.style.display = 'block';
      if (text.includes('captured') || text.includes('Cancelled')) setTimeout(() => n.style.display = 'none', 2000);
    }

    /**
     * Escape a string for use as an XPath 1.0 attribute value.
     * Handles strings with single quotes, double quotes, or both.
     */
    escapeXPathString(str) {
      if (!str) return "''";
      if (!str.includes("'")) return `'${str}'`;
      if (!str.includes('"')) return `"${str}"`;
      // Contains both — use concat()
      const parts = str.split("'").map((part, i) => {
        if (i === 0) return `'${part}`;
        return `"'",'${part}`;
      });
      return `concat(${parts.join('')}')`;
    }

    /**
     * Generate an XPath for an <iframe> element using the same priority as AA's Recorder:
     * id > name > src > title > positional index
     */
    generateIframeXPath(iframeEl) {
      if (!iframeEl) return null;
      const id = iframeEl.id;
      const name = iframeEl.getAttribute('name');
      const src = iframeEl.getAttribute('src');
      const title = iframeEl.getAttribute('title');

      // Priority 1: stable ID
      if (id && id.length > 0 && !id.includes(' ')) {
        const isDynamic = /\d{2,}/.test(id) || /_\d+[_\W]/.test(id) || /[_\W]\d+$/.test(id);
        if (!isDynamic) {
          return { xpath: `//iframe[@id=${this.escapeXPathString(id)}]`, method: 'id', value: id };
        }
      }
      // Priority 2: name attribute
      if (name && name.length > 0) {
        return { xpath: `//iframe[@name=${this.escapeXPathString(name)}]`, method: 'name', value: name };
      }
      // Priority 3: src attribute (use contains for long URLs)
      if (src && src.length > 0 && src !== 'about:blank') {
        if (src.length < 80) {
          return { xpath: `//iframe[@src=${this.escapeXPathString(src)}]`, method: 'src', value: src };
        } else {
          // Extract meaningful part of URL for contains()
          try {
            const url = new URL(src, window.location.href);
            const path = url.pathname.split('/').filter(Boolean).pop() || url.pathname;
            return { xpath: `//iframe[contains(@src, ${this.escapeXPathString(path)})]`, method: 'src-partial', value: path };
          } catch (e) {
            return { xpath: `//iframe[contains(@src, ${this.escapeXPathString(src.substring(0, 60))})]`, method: 'src-partial', value: src.substring(0, 60) };
          }
        }
      }
      // Priority 4: title
      if (title && title.length > 0) {
        return { xpath: `//iframe[@title=${this.escapeXPathString(title)}]`, method: 'title', value: title };
      }
      // Priority 5: stable ID (even dynamic)
      if (id && id.length > 0) {
        return { xpath: `//iframe[@id=${this.escapeXPathString(id)}]`, method: 'id-dynamic', value: id };
      }
      // Priority 6: positional index among sibling iframes
      const parent = iframeEl.parentElement;
      if (parent) {
        const iframes = Array.from(parent.querySelectorAll(':scope > iframe'));
        const idx = iframes.indexOf(iframeEl) + 1;
        return { xpath: `(//iframe)[${idx}]`, method: 'index', value: idx };
      }
      return { xpath: '//iframe', method: 'tag-only', value: null };
    }

    /**
     * Compute the full iframe hierarchy from this window up to the top window.
     * Returns an object compatible with AA's FrameDomPath concept.
     * For same-origin frames, walks window.parent chain and generates XPath per frame.
     * For cross-origin frames, marks isCrossOrigin and requests background resolution.
     */
    computeFrameHierarchy() {
      const isInIframe = window.self !== window.top;
      if (!isInIframe) {
        return { isInIframe: false, frameDepth: 0, framePath: [], frameDomPath: '', isCrossOrigin: false };
      }

      const framePath = [];
      let currentWindow = window;
      let isCrossOrigin = false;
      let depth = 0;
      const MAX_DEPTH = 10;

      while (currentWindow !== window.top && depth < MAX_DEPTH) {
        depth++;
        let frameEntry = null;

        try {
          // window.frameElement is the <iframe> element in the parent document
          // that contains this window. Only accessible for same-origin.
          const frameEl = currentWindow.frameElement;
          if (frameEl) {
            const xpathInfo = this.generateIframeXPath(frameEl);
            frameEntry = {
              xpath: xpathInfo.xpath,
              method: xpathInfo.method,
              id: frameEl.id || '',
              name: frameEl.getAttribute('name') || '',
              src: frameEl.getAttribute('src') || '',
              index: null
            };
            // Calculate index among all iframes in parent document
            const parentDoc = currentWindow.parent.document;
            const allIframes = Array.from(parentDoc.querySelectorAll('iframe'));
            frameEntry.index = allIframes.indexOf(frameEl);
          } else {
            // frameElement is null — cross-origin boundary
            isCrossOrigin = true;
            frameEntry = {
              xpath: null,
              method: 'cross-origin',
              id: '',
              name: currentWindow.name || '',
              src: '',
              index: null
            };
            // We can still get window.name even cross-origin
            if (currentWindow.name) {
              frameEntry.xpath = `//iframe[@name=${this.escapeXPathString(currentWindow.name)}]`;
              frameEntry.method = 'name-from-window';
            }
          }
        } catch (e) {
          isCrossOrigin = true;
          frameEntry = {
            xpath: null,
            method: 'cross-origin-error',
            id: '',
            name: currentWindow.name || '',
            src: '',
            index: null
          };
          if (currentWindow.name) {
            frameEntry.xpath = `//iframe[@name=${this.escapeXPathString(currentWindow.name)}]`;
            frameEntry.method = 'name-from-window';
          }
        }

        framePath.unshift(frameEntry); // prepend — we walk inside-out but want outside-in order

        try {
          currentWindow = currentWindow.parent;
        } catch (e) {
          break; // cross-origin parent access blocked
        }
      }

      // Build AA-style FrameDomPath (pipe-separated XPaths from outermost to innermost)
      const frameDomPath = framePath
        .filter(f => f.xpath)
        .map(f => f.xpath)
        .join('|');

      return {
        isInIframe: true,
        frameDepth: framePath.length,
        framePath: framePath,
        frameDomPath: frameDomPath,
        isCrossOrigin: isCrossOrigin
      };
    }

    processElement(el) {
      const selectors = this.generateSelectors(el, window.domXPanel ? window.domXPanel.settings : null);
      const isCustom = !!(el.closest('[role="listbox"], [role="combobox"]') || el.className?.toString().includes('dropdown'));
      const frameHierarchy = this.computeFrameHierarchy();
      const data = {
        tagName: el.tagName.toLowerCase(),
        id: el.id,
        text: el.textContent?.trim().substring(0, 50),
        isSelect: el.tagName === 'SELECT',
        isCustomDropdown: isCustom,
        options: el.tagName === 'SELECT' ? Array.from(el.options).map(o => ({ value: o.value, text: o.text })) : [],
        inIframe: frameHierarchy.isInIframe,
        frameInfo: frameHierarchy.isInIframe ? {
          depth: frameHierarchy.frameDepth,
          framePath: frameHierarchy.framePath,
          frameDomPath: frameHierarchy.frameDomPath,
          isCrossOrigin: frameHierarchy.isCrossOrigin,
          iframeUrl: window.location.href,
          iframeName: window.name
        } : null,
        // Keep legacy fields for backward compatibility
        iframeUrl: window.location.href,
        iframeName: window.name,
        inShadowDOM: el.getRootNode() !== document
      };
      chrome.runtime.sendMessage({ action: 'elementSelected', element: data, selectors });
      this.showNotification('Element captured!');
      // Auto-highlight if enabled
      if (window.domXPanel && window.domXPanel.settings && window.domXPanel.settings.highlightOnPick && selectors.length > 0) {
        setTimeout(() => {
          if (window.domXPanel && window.domXPanel.container) {
            window.domXPanel.show(data, selectors, 0);
            window.domXPanel.test(0);
          }
        }, 100);
      }
    }

    generateSelectors(el, settings) {
      const selectors = [];
      const tag = el.tagName.toLowerCase();
      const id = el.id;
      const classes = Array.from(el.classList).filter(c => !c.match(/^[0-9]/) && c.length < 20 && !c.includes(' ') && !c.match(/^(css-|Mui|ant-)/));
      const text = el.textContent?.trim().substring(0, 50);
      const hasText = text && text.length > 0 && text.length < 30 && !text.includes('\n') && !/^\s*$/.test(text);
      const ariaLabel = el.getAttribute('aria-label');
      const placeholder = el.getAttribute('placeholder');
      const name = el.getAttribute('name');
      const type = el.getAttribute('type');
      const value = el.getAttribute('value');
      const title = el.getAttribute('title');
      const role = el.getAttribute('role');

      // ID-based selector with dynamic ID detection & hardening
      if (id && id.length > 1 && !id.includes(' ')) {
        const escapedId = this.escapeXPathString(id);
        const isDynamic = /\d{2,}/.test(id) || /_\d+[_\W]/.test(id) || /[_\W]\d+$/.test(id);

        if (!isDynamic) {
          selectors.push({
            selector: `//${tag}[@id=${escapedId}]`,
            type: 'stable',
            reason: 'Unique ID - Best for A360'
          });
        } else {
          // Original ID selector (may break if ID changes)
          selectors.push({
            selector: `//${tag}[@id=${escapedId}]`,
            type: 'moderate',
            reason: 'Dynamic ID - May change between sessions'
          });
          // Auto-hardened version using contains() — only if autoHarden is enabled
          const autoHarden = settings ? settings.autoHarden : true;
          if (autoHarden) {
            const segments = id.split(/[_\W]+/).filter(s => s.length > 2 && !/^\d+$/.test(s));
            if (segments.length > 0) {
              const containsClauses = segments.map(s => {
                const esc = this.escapeXPathString(s);
                return `contains(@id, ${esc})`;
              }).join(' and ');
              selectors.push({
                selector: `//${tag}[${containsClauses}]`,
                type: 'stable',
                reason: 'Hardened ID (auto) - Uses contains() for dynamic segments ✅ Recommended for AA'
              });
            }
          }
        }
      }

      // Test automation attributes (highest priority for Automation Anywhere)
      const testAttrs = ['data-testid', 'data-test', 'data-qa', 'data-automation', 'data-cy', 'test-id', 'automation-id'];
      for (const attr of testAttrs) {
        const val = el.getAttribute(attr);
        if (val && val.length > 0 && val.length < 50) {
          const escapedVal = this.escapeXPathString(val);
          selectors.unshift({
            selector: `//${tag}[@${attr}=${escapedVal}]`,
            type: 'stable',
            reason: `Test automation attribute: ${attr}`
          });
        }
      }

      // Generic data-* attribute scanning (catches any data-* not already handled)
      const handledTestAttrs = new Set(['data-testid', 'data-test', 'data-qa', 'data-automation', 'data-cy', 'test-id', 'automation-id']);
      if (el.dataset) {
        for (const key in el.dataset) {
          const attrName = 'data-' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
          if (handledTestAttrs.has(attrName)) continue;
          const val = el.dataset[key];
          if (val && val.length > 0 && val.length < 50) {
            const escapedVal = this.escapeXPathString(val);
            selectors.push({
              selector: `//${tag}[@${attrName}=${escapedVal}]`,
              type: 'stable',
              reason: `Custom data attribute: ${attrName}`
            });
          }
        }
      }

      // ARIA attributes (very stable for accessibility)
      if (ariaLabel && ariaLabel.trim().length > 0 && ariaLabel.length < 100) {
        const escapedAria = this.escapeXPathString(ariaLabel.trim());
        selectors.push({
          selector: `//${tag}[@aria-label=${escapedAria}]`,
          type: 'stable',
          reason: 'ARIA label - Accessible & stable'
        });
      }

      if (role && role.length > 0) {
        const escapedRole = this.escapeXPathString(role);
        const roleSelector = role === 'button' ? `//${tag}[@role=${escapedRole}]` : `//*[@role=${escapedRole}]`;
        selectors.push({
          selector: roleSelector,
          type: 'moderate',
          reason: `ARIA role: ${role}`
        });
      }

      // Class-based selector (filtered for meaningful classes only)
      if (classes.length > 0 && classes.length <= 2) {
        const meaningfulClasses = classes.filter(c => 
          !c.match(/^(css-|ember|react|angular|vue|ng-)/) && 
          c.length > 2 && 
          !c.match(/^[0-9]/) &&
          !c.includes('--active') &&
          !c.includes('--selected')
        );
        
        if (meaningfulClasses.length > 0) {
          const classSelector = meaningfulClasses.map(c => {
            const esc = this.escapeXPathString(c);
            return `contains(@class, ${esc})`;
          }).join(' and ');
          selectors.push({
            selector: `//${tag}[${classSelector}]`,
            type: meaningfulClasses.length === 1 ? 'stable' : 'moderate',
            reason: meaningfulClasses.length === 1 ? 'Single meaningful class' : 'Multiple meaningful classes'
          });
        }
      }

      // Form-specific selectors
      if (name && name.length > 0 && name.length < 50) {
        const escapedName = this.escapeXPathString(name);
        selectors.push({
          selector: `//${tag}[@name=${escapedName}]`,
          type: 'moderate',
          reason: 'Form name attribute'
        });
      }

      // Input-specific attributes
      if (tag === 'input') {
        if (type && type !== 'text') {
          const escapedType = this.escapeXPathString(type);
          selectors.push({
            selector: `//${tag}[@type=${escapedType}]`,
            type: 'risky',
            reason: `Input type: ${type}`
          });
        }

        if (placeholder && placeholder.trim().length > 0 && placeholder.length < 50) {
          const escapedPh = this.escapeXPathString(placeholder.trim());
          selectors.push({
            selector: `//${tag}[@placeholder=${escapedPh}]`,
            type: 'moderate',
            reason: 'Input placeholder'
          });
        }
      }

      // Select dropdown specific
      if (tag === 'select') {
        if (name) {
          const escapedName = this.escapeXPathString(name);
          selectors.push({
            selector: `//select[@name=${escapedName}]`,
            type: 'stable',
            reason: 'Select dropdown by name'
          });
        }
      }

      // Text-based selector (only for buttons, links, and labels)
      if (hasText && ['button', 'a', 'label', 'span', 'div'].includes(tag)) {
        const cleanText = text.replace(/\s+/g, ' ').trim();
        if (cleanText.length > 2 && !cleanText.match(/^\d+$/) && !cleanText.includes('...')) {
          const escapedText = this.escapeXPathString(cleanText);
          selectors.push({
            selector: `//${tag}[normalize-space(text())=${escapedText}]`,
            type: 'moderate',
            reason: 'Visible text content'
          });
        }
      }

      // Inner Text Context (useful for list items, cards, etc. where the element contains specific text)
      const rawTextContent = el.textContent || '';
      const textLines = rawTextContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      if (textLines.length > 0) {
        const firstLine = textLines[0];
        // Ensure the first line is meaningful
        if (firstLine.length > 2 && firstLine.length < 60 && !firstLine.match(/^\d+$/) && !firstLine.includes('...')) {
          const escapedFirstLine = this.escapeXPathString(firstLine);
          
          // Generic inner text selector
          selectors.push({
            selector: `//${tag}[contains(., ${escapedFirstLine})]`,
            type: 'moderate',
            reason: 'Contains specific inner text'
          });

          // Combine with role if present
          if (role && role.length > 0) {
            const escapedRole = this.escapeXPathString(role);
            selectors.push({
              selector: `//${tag}[@role=${escapedRole} and contains(., ${escapedFirstLine})]`,
              type: 'stable',
              reason: 'Role + Inner text context'
            });
          }

          // Combine with classes if present
          if (classes.length > 0 && classes.length <= 2) {
            const meaningfulClasses = classes.filter(c => 
              !c.match(/^(css-|ember|react|angular|vue|ng-)/) && 
              c.length > 2 && 
              !c.match(/^[0-9]/) &&
              !c.includes('--active') &&
              !c.includes('--selected')
            );
            if (meaningfulClasses.length > 0) {
              const classSelector = meaningfulClasses.map(c => `contains(@class, ${this.escapeXPathString(c)})`).join(' and ');
              selectors.push({
                selector: `//${tag}[${classSelector} and contains(., ${escapedFirstLine})]`,
                type: 'stable',
                reason: 'Class + Inner text context'
              });
            }
          }
        }
      }

      // Title attribute
      if (title && title.trim().length > 0 && title.length < 50) {
        const escapedTitle = this.escapeXPathString(title.trim());
        selectors.push({
          selector: `//${tag}[@title=${escapedTitle}]`,
          type: 'moderate',
          reason: 'Title attribute'
        });
      }

      // Value attribute for specific elements
      if (value && ['input', 'option', 'button'].includes(tag) && value.length < 50) {
        const escapedVal = this.escapeXPathString(value);
        selectors.push({
          selector: `//${tag}[@value=${escapedVal}]`,
          type: 'moderate',
          reason: 'Element value'
        });
      }

      // Hierarchical selectors for better stability
      const parent = el.parentElement;
      if (parent && parent.tagName !== 'BODY' && parent.tagName !== 'HTML') {
        const parentId = parent.id;
        const parentClasses = Array.from(parent.classList).filter(c => 
          !c.match(/^(css-|ember|react|angular|vue|ng-)/) && 
          c.length > 2 && 
          !c.match(/^[0-9]/)
        );
        
        // Parent with ID
        if (parentId && parentId.length > 1) {
          const escapedPId = this.escapeXPathString(parentId);
          selectors.push({
            selector: `//*[@id=${escapedPId}]//${tag}`,
            type: 'moderate',
            reason: 'Parent ID context'
          });
        }

        // Parent with meaningful class
        if (parentClasses.length > 0 && parentClasses.length <= 2) {
          const parentClassSelector = parentClasses.map(c => {
            const esc = this.escapeXPathString(c);
            return `contains(@class, ${esc})`;
          }).join(' and ');
          selectors.push({
            selector: `//*[${parentClassSelector}]//${tag}`,
            type: 'moderate',
            reason: 'Parent class context'
          });
        }
      }

      // Sibling/relational selectors for inputs near labels
      if (['input', 'select', 'textarea'].includes(tag)) {
        // Check for a preceding <label> with a for attribute or as a sibling
        const parent2 = el.parentElement;
        if (parent2) {
          // Pattern: parent > label + input (sibling label)
          const siblingLabel = parent2.querySelector('label');
          if (siblingLabel) {
            const labelText = siblingLabel.textContent?.trim().substring(0, 40);
            if (labelText && labelText.length > 1) {
              const escLabel = this.escapeXPathString(labelText);
              selectors.push({
                selector: `//${parent2.tagName.toLowerCase()}/label[normalize-space(text())=${escLabel}]/following-sibling::${tag}`,
                type: 'moderate',
                reason: 'Sibling label context'
              });
            }
          }
        }

        // Pattern: label[for='id'] + input#id
        if (el.id) {
          const escapedElId = this.escapeXPathString(el.id);

          // Walk up to find a parent with a label pointing to this element's ID
          let ancestor = el.parentElement;
          for (let i = 0; i < 5 && ancestor; i++) {
            const lbl = ancestor.querySelector(`label[for='${el.id.replace(/'/g, "\\'")}']`);
            if (lbl) {
              const labelText = lbl.textContent?.trim().substring(0, 40);
              if (labelText && labelText.length > 1) {
                const escLabel = this.escapeXPathString(labelText);
                selectors.push({
                  selector: `//label[normalize-space(text())=${escLabel}]/..//${tag}[@id=${escapedElId}]`,
                  type: 'stable',
                  reason: 'Label-for association via parent'
                });
              }
              break;
            }
            ancestor = ancestor.parentElement;
          }

          // Pattern: //label[text()='X']/following-sibling::tag
          const prevLabels = [];
          let prev = el.previousElementSibling;
          while (prev) {
            if (prev.tagName === 'LABEL') {
              const lt = prev.textContent?.trim();
              if (lt) prevLabels.push(lt);
            }
            prev = prev.previousElementSibling;
          }
          if (prevLabels.length > 0) {
            const escLabel = this.escapeXPathString(prevLabels[0].substring(0, 40));
            selectors.push({
              selector: `//label[normalize-space(text())=${escLabel}]/following-sibling::${tag}[1]`,
              type: 'moderate',
              reason: 'Preceding label context'
            });
          }
        }
      }

      // Position-based selector using AA-compatible (//xpath)[N] wrapper
      const allMatches = Array.from(document.querySelectorAll(tag));
      const elIndex = allMatches.indexOf(el);
      if (allMatches.length > 1 && elIndex !== -1) {
        const position = elIndex + 1;
        const displayIdx = position === 1 ? '1st' : `${position}${this.getOrdinalSuffix(position)}`;
        
        // Grid/List Item Positional Selector (Useful for dynamic shops)
        // Combine with role
        if (role && role.length > 0) {
          const escapedRole = this.escapeXPathString(role);
          selectors.push({
            selector: `(//${tag}[@role=${escapedRole}])[${position}]`,
            type: 'moderate',
            reason: `${displayIdx} item in list (Change [${position}] to [1] for first item)`
          });
        }

        // Combine with meaningful class
        if (classes.length > 0 && classes.length <= 2) {
          const meaningfulClasses = classes.filter(c => 
            !c.match(/^(css-|ember|react|angular|vue|ng-)/) && 
            c.length > 2 && 
            !c.match(/^[0-9]/) &&
            !c.includes('--active') &&
            !c.includes('--selected')
          );
          if (meaningfulClasses.length > 0) {
            const classSelector = meaningfulClasses.map(c => `contains(@class, ${this.escapeXPathString(c)})`).join(' and ');
            selectors.push({
              selector: `(//${tag}[${classSelector}])[${position}]`,
              type: 'moderate',
              reason: `${displayIdx} matching element (Change [${position}] to [1] for first item)`
            });
          }
        }

        // Tag-only positional selector (highly useful for grids where data/classes change)
        selectors.push({
          selector: `(//${tag})[${position}]`,
          type: 'stable',
          reason: `Exact structure position (Change [${position}] to [1] to always get 1st item)`
        });
      }

      // Tag-only as absolute last resort
      if (!settings || settings.showFragile) {
        selectors.push({
          selector: `//${tag}`,
          type: 'risky',
          reason: 'Tag only - Use only if necessary — ⚠️ FRAGILE'
        });
      }

      // Filter fragile selectors if showFragile is off
      if (settings && !settings.showFragile) {
        const filtered = selectors.filter(s => s.type !== 'risky');
        return filtered.length > 0 ? filtered : selectors;
      }

      return selectors;
    }

    getOrdinalSuffix(num) {
      const j = num % 10;
      const k = num % 100;
      if (j === 1 && k !== 11) return 'st';
      if (j === 2 && k !== 12) return 'nd';
      if (j === 3 && k !== 13) return 'rd';
      return 'th';
    }

    escapeXPathString(str) {
      if (!str) return "''";
      if (str.includes('"') && str.includes("'")) {
        return 'concat(' + str.split(/(["'])/).map((part, i) => {
          if (part === '"') return "'\"'";
          if (part === "'") return '\'"\'"\'';
          return i % 2 === 0 ? `"${part}"` : null;
        }).filter(x => x).join(',') + ')';
      }
      if (str.includes("'")) return `"${str}"`;
      return `'${str}'`;
    }
  }

  class DomXPanel {
    constructor() {
      this.container = null;
      this.currentData = null;
      this.currentSelectors = [];
      this.originFrameId = 0;
      this.hiLoop = null;
      this.lastTestedSelector = null;
      this.lastMatchCount = null;
      this.lastMatchedNodes = [];
      this.settings = {
        autoHarden: true,
        showFragile: false,
        highlightOnPick: true,
        defaultIndex: 1
      };
      this.loadSettings();
    }

    loadSettings() {
      const self = this;
      try {
        chrome.storage.local.get(['domxSettings'], (result) => {
          if (result.domxSettings) {
            self.settings = { ...self.settings, ...result.domxSettings };
          }
        });
      } catch(e) {}
    }

    saveSettings() {
      try {
        chrome.storage.local.set({ domxSettings: this.settings });
      } catch(e) {}
    }

    show(data, selectors, originFrameId = 0) {
      this.currentData = data;
      this.currentSelectors = selectors;
      this.originFrameId = originFrameId;
      if (!this.container) this.createPanel();
      this.render();
      this.container.style.display = 'block';
    }

    showEmpty() {
      this.currentData = null;
      this.currentSelectors = [];
      this.originFrameId = 0;
      if (!this.container) this.createPanel();
      const content = this.container.querySelector('#domx-content');
      content.innerHTML = '<div style="text-align:center;padding:40px 20px;color:#666;"><div style="font-size:24px;margin-bottom:10px;">🔍</div><div style="font-weight:600;margin-bottom:8px;color:#2c3e50;">DomX Inspector</div><div style="font-size:12px;line-height:1.5;">Click "Start Picking" to activate picker mode, then click any element on the page to generate selectors.</div></div>';
      this.container.style.display = 'block';
    }

    createPanel() {
      this.container = document.createElement('div');
      this.container.id = 'domx-panel';
      this.container.style.cssText = 'position:fixed; top:10px; right:10px; width:400px; height:auto; min-width:300px; min-height:200px; max-width:80vw; max-height:95vh; background:white; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,0.2); z-index:2147483646; font-family:sans-serif; overflow:hidden; display:none; resize:none;';
      this.container.innerHTML = `
        <style>
          .domx-resize-handle:hover { background: rgba(44, 62, 80, 0.1) !important; }
        </style>
        <div id="domx-header" style="background:#2c3e50; color:white; padding:16px; text-align:center; cursor:move;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div style="flex:1; display:flex; align-items:flex-start;">
              <div id="domx-drag-handle" style="padding:2px 6px; margin-right:8px; color:rgba(255,255,255,0.5); font-size:14px; line-height:1; user-select:none;" title="Drag to move panel">⠿</div>
            </div>
            <div style="flex:0 1 auto;">
              <div style="font-weight:600; font-size:16px;">DomX Inspector</div>
              <div style="font-size:11px; opacity:0.8; margin-top:4px;">Generate robust selectors for Automation Anywhere</div>
            </div>
            <div style="flex:1; display:flex; justify-content:flex-end; align-items:center; gap:8px;">
              <button id="domx-new-element-btn" style="background:#3498db; border:none; color:white; font-size:12px; cursor:pointer; line-height:1; padding:6px 12px; border-radius:4px; font-weight:600;" title="Pick a new element">+ New Element</button>
              <button id="domx-settings-btn" style="background:none; border:none; color:rgba(255,255,255,0.7); font-size:16px; cursor:pointer; line-height:1; padding:2px 4px;" title="Settings">⚙</button>
              <button id="domx-close" style="background:none; border:none; color:white; font-size:20px; cursor:pointer; line-height:1;">&times;</button>
            </div>
          </div>
          <div style="display:flex; gap:4px; margin-top:12px;">
            <button id="domx-tab-selectors" style="flex:1; padding:6px 12px; background:rgba(255,255,255,0.2); color:white; border:none; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600;">Selectors</button>
            <button id="domx-tab-console" style="flex:1; padding:6px 12px; background:transparent; color:rgba(255,255,255,0.6); border:none; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600;">AA Console</button>
          </div>
        </div>
        <div id="domx-content" style="padding:15px; overflow-y:auto; max-height:calc(90vh - 130px);"></div>
        <div id="domx-resize-r" class="domx-resize-handle" data-dir="r" style="position:absolute; top:0; right:0; width:8px; height:100%; cursor:ew-resize; z-index:1;"></div>
        <div id="domx-resize-b" class="domx-resize-handle" data-dir="b" style="position:absolute; bottom:0; left:0; width:100%; height:8px; cursor:ns-resize; z-index:1;"></div>
        <div id="domx-resize-br" class="domx-resize-handle" data-dir="br" style="position:absolute; bottom:0; right:0; width:18px; height:18px; cursor:nwse-resize; z-index:2; border-radius:0 0 12px 0; background:linear-gradient(135deg, transparent 50%, rgba(44,62,80,0.15) 50%);"></div>
      `;
      (document.body || document.documentElement).appendChild(this.container);
      this.setupResize();
      this.container.querySelector('#domx-close').onclick = () => this.hide();
      this.container.querySelector('#domx-settings-btn').onclick = () => this.toggleSettings();
      this.container.querySelector('#domx-new-element-btn').onclick = () => this.startNewPick();
      this.container.querySelector('#domx-tab-selectors').onclick = () => this.switchTab('selectors');
      this.container.querySelector('#domx-tab-console').onclick = () => this.switchTab('console');
      this.setupDrag();
      this.aaModalContainer = document.createElement('div');
      this.aaModalContainer.id = 'domx-aa-modal-container';
      (document.body || document.documentElement).appendChild(this.aaModalContainer);
      this.createSettingsPanel();
    }

    setupDrag() {
      const header = this.container.querySelector('#domx-header');
      let dragging = false;
      let offsetX = 0;
      let offsetY = 0;

      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('#domx-close') || e.target.closest('.domx-resize-handle')) return;
        dragging = true;
        const rect = this.container.getBoundingClientRect();
        this.container.style.right = 'auto';
        this.container.style.left = rect.left + 'px';
        this.container.style.top = rect.top + 'px';
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        header.style.cursor = 'grabbing';
      });

      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        e.preventDefault();
        this.container.style.left = (e.clientX - offsetX) + 'px';
        this.container.style.top = (e.clientY - offsetY) + 'px';
      });

      document.addEventListener('mouseup', () => {
        if (dragging) {
          dragging = false;
          header.style.cursor = 'move';
        }
      });
    }

    setupResize() {
      const MIN_W = 300, MIN_H = 200;
      let resizing = false;
      let startX = 0, startY = 0;
      let startW = 0, startH = 0;
      let startLeft = 0, startTop = 0;
      let dir = '';

      this.container.querySelectorAll('.domx-resize-handle').forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          resizing = true;
          dir = handle.dataset.dir;
          startX = e.clientX;
          startY = e.clientY;
          const rect = this.container.getBoundingClientRect();
          startW = rect.width;
          startH = rect.height;
          startLeft = rect.left;
          startTop = rect.top;
          document.body.style.cursor = dir === 'r' ? 'ew-resize' : (dir === 'b' ? 'ns-resize' : 'nwse-resize');
          document.body.style.userSelect = 'none';
        });
      });

      document.addEventListener('mousemove', (e) => {
        if (!resizing) return;
        e.preventDefault();
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        if (dir === 'r' || dir === 'br') {
          let newW = startW + dx;
          newW = Math.max(MIN_W, Math.min(newW, vw * 0.8, vw - startLeft));
          this.container.style.width = newW + 'px';
        }
        if (dir === 'b' || dir === 'br') {
          let newH = startH + dy;
          newH = Math.max(MIN_H, Math.min(newH, vh * 0.95, vh - startTop));
          this.container.style.height = newH + 'px';
          const headerH = this.container.querySelector('#domx-header').offsetHeight;
          const content = this.container.querySelector('#domx-content');
          if (content) content.style.maxHeight = Math.max(100, newH - headerH - 20) + 'px';
        }
      });

      document.addEventListener('mouseup', () => {
        if (resizing) {
          resizing = false;
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        }
      });
    }

    hide() {
      this.clearHi();
      if (this.container) this.container.style.display = 'none';
    }

    startNewPick() {
      this.hide();
      if (window.domXPicker) {
        window.domXPicker.activate();
      }
    }

    switchTab(tab) {
      this.activeTab = tab;
      const selBtn = this.container.querySelector('#domx-tab-selectors');
      const conBtn = this.container.querySelector('#domx-tab-console');
      if (tab === 'selectors') {
        selBtn.style.background = 'rgba(255,255,255,0.2)';
        selBtn.style.color = 'white';
        conBtn.style.background = 'transparent';
        conBtn.style.color = 'rgba(255,255,255,0.6)';
        this.render();
      } else {
        conBtn.style.background = 'rgba(255,255,255,0.2)';
        conBtn.style.color = 'white';
        selBtn.style.background = 'transparent';
        selBtn.style.color = 'rgba(255,255,255,0.6)';
        this.renderConsole();
      }
    }

    renderConsole() {
      const content = this.container.querySelector('#domx-content');
      content.innerHTML = `
        <div style="font-size:11px; color:#95a5a6; margin-bottom:8px;">Type any XPath expression to test against the current page</div>
        <textarea id="domx-console-input" style="width:100%; min-height:80px; padding:10px; font-family:monospace; font-size:12px; line-height:1.5; border:1px solid #ced4da; border-radius:4px; background:#1e1e1e; color:#d4d4d4; caret-color:#fff; resize:vertical; box-sizing:border-box; outline:none;" placeholder="//input[@name='username']" spellcheck="false"></textarea>
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button id="domx-console-run" style="flex:1; padding:8px; background:#27ae60; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px; font-weight:600;">▶ Run</button>
          <button id="domx-console-clear" style="padding:8px 16px; background:#ecf0f1; color:#2c3e50; border:1px solid #bdc3c7; border-radius:4px; cursor:pointer; font-size:12px; font-weight:600;">Clear</button>
        </div>
        <div id="domx-console-output" style="margin-top:12px;"></div>
      `;
      const input = content.querySelector('#domx-console-input');
      const self = this;
      content.querySelector('#domx-console-run').onclick = () => { self.runConsole(input.value.trim()); };
      content.querySelector('#domx-console-clear').onclick = () => {
        input.value = '';
        highlight.innerHTML = '';
        content.querySelector('#domx-console-output').innerHTML = '';
        input.focus();
      };
      input.focus();
    }

    runConsole(xpath) {
      const output = this.container.querySelector('#domx-console-output');
      if (!xpath) {
        output.innerHTML = '<div style="padding:8px; background:#fff3cd; color:#856404; border:1px solid #ffeaa7; border-radius:4px; font-size:12px;">Enter an XPath expression above.</div>';
        return;
      }
      let count = 0;
      const matchedNodes = [];
      let error = null;
      try {
        const r = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        count = r.snapshotLength;
        for (let i = 0; i < r.snapshotLength; i++) matchedNodes.push(r.snapshotItem(i));
      } catch(e) { error = e.message; }
      if (error) {
        output.innerHTML = `<div style="padding:10px; background:#fdf2f2; color:#c81e1e; border:1px solid #f9d7d7; border-radius:6px; font-size:12px;"><strong>❌ XPath Error:</strong> ${this.escapeHtml(error)}<br><span style="font-size:11px; color:#999;">Check your syntax — AA uses XPath 1.0 only.</span></div>`;
        return;
      }
      if (count === 0) {
        output.innerHTML = `<div style="padding:10px; background:#fdf2f2; color:#c81e1e; border:1px solid #f9d7d7; border-radius:6px; font-size:12px;"><strong>❌ No match</strong> — Selector returned 0 results on this page.<br><span style="font-size:11px; color:#999;">Check if element is inside an iframe or if page content is dynamically loaded.</span></div>`;
        return;
      }
      const color = count === 1 ? '#27ae60' : '#f39c12';
      const badge = count === 1 ? '✅ Unique match' : `⚡ ${count} matches`;
      const tip = count === 1 ? 'Ideal for AA — no index needed.' : `Multiple matches — use <code>(${this.escapeHtml(xpath)})[N]</code> in AA. AA index starts at 1.`;
      const items = matchedNodes.slice(0, 10).map(node => {
        const tag = node.tagName.toLowerCase();
        const txt = (node.textContent || '').trim().substring(0, 40);
        const nodeId = node.id ? `#${node.id}` : '';
        return `<div style="padding:4px 6px; background:#f8f9fa; border-radius:3px; margin-bottom:3px; font-size:11px; font-family:monospace; border:1px solid #e9ecef;">&lt;${tag}${nodeId ? ` id="${nodeId}"` : ''}&gt;${txt ? ` ${this.escapeHtml(txt)}${txt.length >= 40 ? '...' : ''}` : ''}</div>`;
      }).join('');
      const more = matchedNodes.length > 10 ? `<div style="font-size:11px; color:#666; margin-top:4px;">...and ${matchedNodes.length - 10} more</div>` : '';
      output.innerHTML = `<div style="padding:10px; background:${color}10; color:${color}; border:1px solid ${color}40; border-radius:6px; font-size:12px; margin-bottom:8px;"><strong>${badge}</strong><br><span style="font-size:11px;">${tip}</span></div><div style="padding:8px; background:#f8f9fa; border-radius:6px; border:1px solid #e9ecef;"><div style="font-size:11px; font-weight:bold; color:#495057; margin-bottom:6px;">Matched Elements (${matchedNodes.length}):</div>${items}${more}</div>`;
      this.clearHi();
      this.highlightNodes(matchedNodes);
    }

    highlightNodes(nodes) {
      try {
        const hiElements = nodes.map(node => {
          if (node.nodeType !== 1) return null;
          const hi = document.createElement('div');
          hi.className = 'domx-hi';
          hi.style.cssText = 'position:fixed; pointer-events:none; z-index:2147483647; border:3px solid #27ae60; background:rgba(39,174,96,0.15); box-shadow:0 0 12px rgba(39,174,96,0.5); border-radius:3px; display:none;';
          (document.body || document.documentElement).appendChild(hi);
          return { hi, target: node };
        }).filter(x => x);
        if (hiElements.length > 0) {
          hiElements[0].target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        const update = () => {
          hiElements.forEach(({ hi, target }) => {
            const b = target.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) { hi.style.display = 'none'; }
            else { hi.style.display = 'block'; hi.style.top = `${b.top}px`; hi.style.left = `${b.left}px`; hi.style.width = `${b.width}px`; hi.style.height = `${b.height}px`; }
          });
          this.hiLoop = requestAnimationFrame(update);
        };
        this.hiLoop = requestAnimationFrame(update);
        setTimeout(() => this.clearHi(), 8000);
      } catch(e) {}
    }

    createSettingsPanel() {
      this.settingsPanel = document.createElement('div');
      this.settingsPanel.id = 'domx-settings-panel';
      this.settingsPanel.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:white; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.3); z-index:2147483647; width:340px; font-family:sans-serif; display:none;';
      this.renderSettingsPanel();
      (document.body || document.documentElement).appendChild(this.settingsPanel);
    }

    renderSettingsPanel() {
      const s = this.settings;
      const toggleRow = (id, label, desc, checked) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid #f0f0f0;">
          <div>
            <div style="font-size:13px; font-weight:600; color:#2c3e50;">${label}</div>
            <div style="font-size:11px; color:#95a5a6; margin-top:2px;">${desc}</div>
          </div>
          <label style="position:relative; display:inline-block; width:44px; height:24px; cursor:pointer; flex-shrink:0; margin-left:12px;">
            <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} style="opacity:0; width:0; height:0;">
            <span style="position:absolute; top:0; left:0; right:0; bottom:0; background:${checked ? '#27ae60' : '#bdc3c7'}; border-radius:24px; transition:0.2s;"></span>
            <span style="position:absolute; content:''; height:20px; width:20px; left:${checked ? '22px' : '2px'}; bottom:2px; background:white; border-radius:50%; transition:0.2s; box-shadow:0 1px 3px rgba(0,0,0,0.2);"></span>
          </label>
        </div>`;

      this.settingsPanel.innerHTML = `
        <div style="background:#2c3e50; color:white; padding:16px; border-radius:12px 12px 0 0; display:flex; justify-content:space-between; align-items:center;">
          <div style="font-weight:600; font-size:15px;">⚙ Settings</div>
          <button id="domx-settings-close" style="background:none; border:none; color:white; font-size:22px; cursor:pointer; line-height:1;">&times;</button>
        </div>
        <div style="padding:16px;">
          ${toggleRow('domx-cfg-autoharden', 'Auto-harden dynamic IDs', 'Automatically generate contains() variants for IDs with dynamic segments', s.autoHarden)}
          ${toggleRow('domx-cfg-showfragile', 'Show fragile selectors', 'Display positional/fragile selectors in results', s.showFragile)}
          ${toggleRow('domx-cfg-highlight', 'Highlight on pick', 'Automatically highlight matched elements after picking', s.highlightOnPick)}
          <div style="padding:10px 0;">
            <div style="font-size:13px; font-weight:600; color:#2c3e50;">Default positional index</div>
            <div style="font-size:11px; color:#95a5a6; margin:4px 0 8px;">Default N value for (//xpath)[N] wrapper</div>
            <input type="number" id="domx-cfg-index" value="${s.defaultIndex}" min="1" max="99" style="width:80px; padding:6px 10px; border:1px solid #ced4da; border-radius:4px; font-size:13px;">
          </div>
          <div style="display:flex; gap:8px; margin-top:16px;">
            <button id="domx-settings-save" style="flex:1; padding:10px; background:#27ae60; color:white; border:none; border-radius:6px; cursor:pointer; font-size:13px; font-weight:600;">Save</button>
            <button id="domx-settings-reset" style="flex:1; padding:10px; background:#ecf0f1; color:#2c3e50; border:1px solid #bdc3c7; border-radius:6px; cursor:pointer; font-size:13px; font-weight:600;">Reset</button>
          </div>
        </div>`;

      this.settingsPanel.querySelector('#domx-settings-close').onclick = () => this.toggleSettings();
      this.settingsPanel.querySelector('#domx-settings-save').onclick = () => this.saveSettingsFromUI();
      this.settingsPanel.querySelector('#domx-settings-reset').onclick = () => this.resetSettings();
      this.settingsPanel.addEventListener('click', (e) => { if (e.target === this.settingsPanel) this.toggleSettings(); });
    }

    toggleSettings() {
      if (this.settingsPanel.style.display === 'none') {
        this.renderSettingsPanel();
        this.settingsPanel.style.display = 'block';
      } else {
        this.settingsPanel.style.display = 'none';
      }
    }

    saveSettingsFromUI() {
      this.settings.autoHarden = this.settingsPanel.querySelector('#domx-cfg-autoharden').checked;
      this.settings.showFragile = this.settingsPanel.querySelector('#domx-cfg-showfragile').checked;
      this.settings.highlightOnPick = this.settingsPanel.querySelector('#domx-cfg-highlight').checked;
      const idx = parseInt(this.settingsPanel.querySelector('#domx-cfg-index').value, 10);
      this.settings.defaultIndex = (idx >= 1 && idx <= 99) ? idx : 1;
      this.saveSettings();
      this.settingsPanel.style.display = 'none';
      this.toast('Settings saved.');
    }

    resetSettings() {
      this.settings = { autoHarden: true, showFragile: false, highlightOnPick: true, defaultIndex: 1 };
      this.saveSettings();
      this.renderSettingsPanel();
      this.toast('Settings reset to defaults.');
    }

    /**
     * Render a rich Frame Context card for elements inside iframes.
     * Shows AA-compatible step-by-step frame switching instructions.
     */
    renderFrameContextCard() {
      const fi = this.currentData.frameInfo;
      // Fallback for legacy data without frameInfo
      if (!fi) {
        return `
          <div style="background:#fff3cd; color:#856404; padding:10px; border-radius:6px; font-size:11px; margin-bottom:15px; border:1px solid #ffeaa7;">
            <strong>⚠️ IFRAME DETECTED</strong><br>
            In Automation Anywhere, use <b>"Browser: Switch to frame"</b> before interacting.<br>
            <div style="margin-top:5px; padding:4px; background:rgba(255,255,255,0.5); font-family:monospace; border-radius:3px;">
              URL: ${(this.currentData.iframeUrl || '').substring(0, 40)}...<br>
              Name: ${this.currentData.iframeName || 'none'}
            </div>
          </div>`;
      }

      const depth = fi.depth || 0;
      const framePath = fi.framePath || [];
      const isCrossOrigin = fi.isCrossOrigin || false;
      let stepNumber = 1;

      // Header
      let html = `
        <div style="background:#1a1a2e; border-radius:8px; margin-bottom:15px; overflow:hidden; font-size:11px; border:1px solid #16213e;">
          <div style="background:#16213e; color:#e0e0ff; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong style="font-size:13px;">🔲 IFRAME CONTEXT</strong>
              <span style="opacity:0.7; margin-left:8px;">Depth: ${depth}</span>
            </div>
            <span style="background:#e74c3c; color:white; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:bold;">AA: FRAME SWITCH REQUIRED</span>
          </div>
          <div style="padding:12px 14px;">`;

      // Cross-origin warning
      if (isCrossOrigin) {
        html += `
            <div style="background:#4a1c1c; color:#ff9999; padding:8px; border-radius:4px; margin-bottom:10px; border:1px solid #6b2c2c;">
              <strong>⚠️ Cross-Origin Frame</strong><br>
              Some frame XPaths were resolved via fallback. Verify in AA's recorder if needed.
            </div>`;
      }

      // Step-by-step frame switching
      for (let i = 0; i < framePath.length; i++) {
        const frame = framePath[i];
        const frameXpath = frame.xpath || '(could not resolve)';
        const methodLabel = frame.method || 'unknown';
        const isResolved = !!frame.xpath;
        const borderColor = isResolved ? '#27ae60' : '#e74c3c';
        const bgColor = isResolved ? '#0d2818' : '#2d1117';

        html += `
            <div style="margin-bottom:8px;">
              <div style="color:#8892b0; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">
                AA Step ${stepNumber}: Switch to Frame ${i + 1 < framePath.length ? '' : '(innermost)'}
              </div>
              <div style="display:flex; align-items:center; gap:6px;">
                <code style="flex:1; display:block; background:${bgColor}; color:${isResolved ? '#a8e6cf' : '#ff9999'}; padding:8px 10px; border-radius:4px; font-size:11px; word-break:break-all; border-left:3px solid ${borderColor}; font-family:monospace;">${this.escapeHtml(frameXpath)}</code>
                <button class="domx-frame-copy" data-xpath="${this.escapeHtml(frameXpath)}" style="padding:6px 10px; background:#3498db; color:white; border:none; border-radius:4px; cursor:pointer; font-size:10px; font-weight:600; white-space:nowrap;">Copy</button>
              </div>`;

        // Show additional frame info
        if (frame.id || frame.name) {
          html += `<div style="color:#8892b0; font-size:10px; margin-top:3px; padding-left:4px;">`;
          if (frame.id) html += `ID: <span style="color:#ccd6f6;">${this.escapeHtml(frame.id)}</span> `;
          if (frame.name) html += `Name: <span style="color:#ccd6f6;">${this.escapeHtml(frame.name)}</span> `;
          html += `<span style="color:#5a6380;">(${methodLabel})</span></div>`;
        }

        html += `</div>`;
        stepNumber++;
      }

      // Final step: interact with element
      html += `
            <div style="margin-top:4px; margin-bottom:10px;">
              <div style="color:#8892b0; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">
                AA Step ${stepNumber}: Interact with Element
              </div>
              <div style="background:#0d2818; color:#a8e6cf; padding:8px 10px; border-radius:4px; font-size:11px; border-left:3px solid #27ae60;">
                Use selector below ↓ in the action's DomX field
              </div>
            </div>`;

      // FrameDomPath (combined)
      if (fi.frameDomPath) {
        html += `
            <div style="margin-top:10px; padding-top:10px; border-top:1px solid #2a2a4a;">
              <div style="color:#8892b0; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">
                Combined FrameDomPath (for AA Object Properties)
              </div>
              <div style="display:flex; align-items:center; gap:6px;">
                <code style="flex:1; display:block; background:#1e1e3e; color:#c0c0ff; padding:8px 10px; border-radius:4px; font-size:11px; word-break:break-all; border:1px solid #3a3a5c; font-family:monospace;">${this.escapeHtml(fi.frameDomPath)}</code>
                <button class="domx-frame-copy" data-xpath="${this.escapeHtml(fi.frameDomPath)}" style="padding:6px 10px; background:#8e44ad; color:white; border:none; border-radius:4px; cursor:pointer; font-size:10px; font-weight:600; white-space:nowrap;">Copy</button>
              </div>
            </div>`;
      }

      html += `
          </div>
        </div>`;

      return html;
    }

    render() {
      const content = this.container.querySelector('#domx-content');
      let details = `<div style="margin-bottom:15px; font-size:12px; color:#666;">Captured: <strong>${this.currentData.tagName}</strong>${this.currentData.id ? ` (#${this.currentData.id})` : ''}</div>`;
      
      if (this.currentData.inIframe) {
        details += this.renderFrameContextCard();
      }

      if (this.currentData.isCustomDropdown) {
        details += `<div style="background:#e8f4fd; color:#004085; padding:8px; border-radius:4px; font-size:11px; margin-bottom:15px; border:1px solid #b8daff;">💡 <strong>Custom Dropdown:</strong> Target the toggle first, then the item.</div>`;
      }

      if (this.currentData.inShadowDOM) {
        details += `<div style="background:#f8d7da; color:#721c24; padding:10px; border-radius:6px; font-size:11px; margin-bottom:15px; border:1px solid #f5c6cb;"><strong>⚠️ SHADOW DOM DETECTED</strong><br>This element is inside a Shadow DOM tree. XPath selectors may not penetrate shadow boundaries in Automation Anywhere. Consider using JavaScript-based selection or targeting the shadow host instead.</div>`;
      }

      const selectorsHtml = this.currentSelectors.map((s, i) => {
        const badge = s.type === 'stable' ? {bg:'#27ae60', tip:'Ideal for A360 Recorder'} : 
                     (s.type === 'moderate' ? {bg:'#f39c12', tip:'Stable fallback'} : {bg:'#e74c3c', tip:'Avoid if possible'});
        
        const isPositional = s.selector.includes(')[');
        const aaNote = isPositional ? '<div style="font-size:10px;color:#856404;background:#fff3cd;padding:4px 6px;border-radius:3px;margin-top:6px;border:1px solid #ffeaa7;">⚠️ AA index starts at 1, not 0. Change [N] to target different matches.</div>' : '';
        const isFragile = s.type === 'risky' ? '<div style="font-size:10px;color:#721c24;background:#f8d7da;padding:4px 6px;border-radius:3px;margin-top:4px;border:1px solid #f5c6cb;">⚠️ FRAGILE — May break if page structure changes. Prefer stable selectors above.</div>' : '';

        let dropdown = '';
        if (this.currentData.isSelect) {
          const opts = this.currentData.options.map((o, idx) => `<option value="${idx}">${this.escapeHtml(o.text)}</option>`).join('');
          dropdown = `
            <div style="margin:12px 0; padding:10px; background:#f8f9fa; border-radius:6px; border:1px solid #e9ecef;">
              <div style="font-size:11px; font-weight:bold; color:#7f8c8d; margin-bottom:8px;">TARGET OPTION:</div>
              <select class="domx-opt" data-idx="${i}" style="width:100%; margin-bottom:8px; padding:4px;">${opts}</select>
              <select class="domx-strat" data-idx="${i}" style="width:100%; padding:4px; font-size:11px;">
                <option value="text">Strategy: Select by Text (Best)</option>
                <option value="value">Strategy: Select by Value</option>
                <option value="index">Strategy: Select by Index (Fragile)</option>
              </select>
            </div>`;
        }

        return `
          <div style="background:white; border:1px solid #dee2e6; border-radius:8px; padding:14px; margin-bottom:15px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
            <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
              <span style="background:${badge.bg}; color:white; padding:2px 8px; border-radius:12px; font-size:10px; font-weight:bold;">${s.type.toUpperCase()}</span>
              <span style="color:#95a5a6; font-size:11px;">${s.reason}</span>
            </div>
            <code class="domx-code" data-idx="${i}" style="display:block; background:#f1f3f4; padding:10px; border-radius:4px; font-size:12px; word-break:break-all; font-family:monospace; border:1px solid #eee; white-space:pre-wrap;">${this.escapeHtml(s.selector)}</code>
            <textarea class="domx-editor" data-idx="${i}" style="display:none; width:100%; min-height:60px; padding:10px; border-radius:4px; font-size:12px; font-family:monospace; border:2px solid #3498db; background:#fff; resize:vertical; box-sizing:border-box;">${this.escapeHtml(s.selector)}</textarea>
            <div class="domx-editor-actions" data-idx="${i}" style="display:none; gap:6px; margin-top:6px;">
              <button class="domx-editor-save" data-idx="${i}" style="flex:1; padding:6px; background:#27ae60; color:white; border:none; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;">Save</button>
              <button class="domx-editor-cancel" data-idx="${i}" style="flex:1; padding:6px; background:#95a5a6; color:white; border:none; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;">Cancel</button>
              <button class="domx-editor-retest" data-idx="${i}" style="flex:1; padding:6px; background:#3498db; color:white; border:none; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;">Re-test</button>
            </div>
            ${dropdown}
            ${aaNote}
            ${isFragile}
            <div style="font-size:11px; color:#155724; background:#d4edda; padding:6px; border-radius:4px; margin-top:10px;">${badge.tip}</div>
            <div style="display:flex; gap:8px; margin-top:12px;">
              <button class="domx-copy" data-idx="${i}" style="flex:1; padding:8px; background:#2c3e50; color:white; border:none; border-radius:4px; cursor:pointer;">Copy</button>
              <button class="domx-test" data-idx="${i}" style="flex:1; padding:8px; background:#3498db; color:white; border:none; border-radius:4px; cursor:pointer;">Validate</button>
              <button class="domx-edit" data-idx="${i}" style="flex:1; padding:8px; background:#8e44ad; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px;">Edit</button>
            </div>
            <div style="margin-top:8px;">
              <button class="domx-aa-help" data-idx="${i}" style="width:100%; padding:6px; background:#ecf0f1; color:#2c3e50; border:1px solid #bdc3c7; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;">📖 How to use in AA</button>
            </div>
          </div>`;
      }).join('');
      
      content.innerHTML = details + selectorsHtml + '<div id="domx-res" style="margin-top:20px;"></div>';
      
      this.container.querySelectorAll('.domx-opt, .domx-strat').forEach(el => el.onchange = () => this.update(el.dataset.idx));
      this.container.querySelectorAll('.domx-copy').forEach(el => el.onclick = () => this.copy(el.dataset.idx));
      this.container.querySelectorAll('.domx-test').forEach(el => el.onclick = () => this.test(el.dataset.idx));
      this.container.querySelectorAll('.domx-aa-help').forEach(el => el.onclick = () => this.showAAHelper(el.dataset.idx));
      this.container.querySelectorAll('.domx-edit').forEach(el => el.onclick = () => this.toggleEdit(el.dataset.idx));
      this.container.querySelectorAll('.domx-editor-save').forEach(el => el.onclick = () => this.saveEdit(el.dataset.idx));
      this.container.querySelectorAll('.domx-editor-cancel').forEach(el => el.onclick = () => this.cancelEdit(el.dataset.idx));
      this.container.querySelectorAll('.domx-editor-retest').forEach(el => el.onclick = () => this.retestEdited(el.dataset.idx));
      this.currentSelectors.forEach((_, i) => this.update(i));
      // Frame context copy buttons
      this.container.querySelectorAll('.domx-frame-copy').forEach(el => {
        el.onclick = () => {
          const xpath = el.getAttribute('data-xpath');
          navigator.clipboard.writeText(xpath).then(() => this.toast('Frame XPath copied!')).catch(() => {});
        };
      });
    }

    update(i) {
      const el = this.container.querySelector(`.domx-code[data-idx="${i}"]`);
      if (el) el.textContent = this.getSel(i);
    }

    getSel(i) {
      let sel = this.currentSelectors[i].selector;
      if (this.currentData.isSelect) {
        const oEl = this.container.querySelector(`.domx-opt[data-idx="${i}"]`);
        const sEl = this.container.querySelector(`.domx-strat[data-idx="${i}"]`);
        if (oEl && sEl) {
          const opt = this.currentData.options[oEl.value];
          if (sEl.value === 'index') sel += `/option[${parseInt(oEl.value)+1}]`;
          else if (sEl.value === 'value' && opt.value) sel += `/option[@value='${opt.value}']`;
          else sel += `/option[normalize-space(text())=${window.domXPicker.escapeXPathString(opt.text)}]`;
        }
      }
      return sel;
    }

    copy(i) { navigator.clipboard.writeText(this.getSel(i)).then(() => this.toast('Copied to clipboard!')); }

    toggleEdit(i) {
      const codeEl = this.container.querySelector(`.domx-code[data-idx="${i}"]`);
      const editorEl = this.container.querySelector(`.domx-editor[data-idx="${i}"]`);
      const actionsEl = this.container.querySelector(`.domx-editor-actions[data-idx="${i}"]`);
      if (codeEl && editorEl && actionsEl) {
        codeEl.style.display = 'none';
        editorEl.style.display = 'block';
        actionsEl.style.display = 'flex';
        editorEl.focus();
      }
    }

    cancelEdit(i) {
      const codeEl = this.container.querySelector(`.domx-code[data-idx="${i}"]`);
      const editorEl = this.container.querySelector(`.domx-editor[data-idx="${i}"]`);
      const actionsEl = this.container.querySelector(`.domx-editor-actions[data-idx="${i}"]`);
      if (codeEl && editorEl && actionsEl) {
        editorEl.value = this.currentSelectors[i].selector;
        codeEl.style.display = 'block';
        editorEl.style.display = 'none';
        actionsEl.style.display = 'none';
      }
    }

    saveEdit(i) {
      const editorEl = this.container.querySelector(`.domx-editor[data-idx="${i}"]`);
      if (editorEl) {
        this.currentSelectors[i].selector = editorEl.value.trim();
        this.currentSelectors[i].reason += ' (edited)';
        this.currentSelectors[i].type = 'moderate';
        this.update(i);
        this.cancelEdit(i);
        this.toast('Selector updated.');
      }
    }

    retestEdited(i) {
      const editorEl = this.container.querySelector(`.domx-editor[data-idx="${i}"]`);
      if (editorEl) {
        this.currentSelectors[i].selector = editorEl.value.trim();
      }
      this.test(i);
      this.cancelEdit(i);
    }

    showAAHelper(i) {
      const sel = this.getSel(i);
      const s = this.currentSelectors[i];
      this.aaModalContainer.innerHTML = this.getAAHelper(this.currentData.tagName, sel);
      const modal = this.aaModalContainer.querySelector('.domx-aa-helper');
      modal.style.display = 'block';
      modal.querySelector('.domx-aa-close').onclick = () => {
        modal.style.display = 'none';
        this.aaModalContainer.innerHTML = '';
      };
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.style.display = 'none';
          this.aaModalContainer.innerHTML = '';
        }
      });
    }

    test(i) {
      const sel = this.getSel(i);
      const res = this.container.querySelector('#domx-res');
      res.innerHTML = '<div style="color:#3498db; font-size:13px;">🧪 Validating...</div>';
      if (this.originFrameId > 0) {
        chrome.runtime.sendMessage({ action: 'testSelectorInFrame', targetFrameId: this.originFrameId, selector: sel, index: i });
      } else {
        this.runTest(sel);
      }
    }

    runTest(sel, isSub = false, isRetry = false) {
      let count = 0;
      this.lastMatchedNodes = [];
      let error = null;

      try {
        const r = document.evaluate(sel, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        count = r.snapshotLength;
        for (let i = 0; i < r.snapshotLength; i++) {
          this.lastMatchedNodes.push(r.snapshotItem(i));
        }
      } catch (e) { error = e.message; }

      if (!error) {
        const iframeResults = this.testInSameOriginIframes(sel);
        count += iframeResults.count;
        this.lastMatchedNodes = this.lastMatchedNodes.concat(iframeResults.nodes);
      }

      this.lastTestedSelector = sel;
      this.lastMatchCount = count;

      if (error && count === 0) {
        this.showRes({ success: false, error, isSub });
        return;
      }

      this.highlight(sel);
      const result = { success: true, count, isSub, isRetry };
      if (isSub) chrome.runtime.sendMessage({ action: 'testResultFromFrame', result, index: 0 });
      else this.showRes(result);
    }

    testInSameOriginIframes(sel) {
      let count = 0;
      const nodes = [];
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          const doc = iframe.contentDocument;
          if (!doc) continue;
          const r = doc.evaluate(sel, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          count += r.snapshotLength;
          for (let i = 0; i < r.snapshotLength; i++) {
            nodes.push(r.snapshotItem(i));
          }
        } catch (e) { /* cross-origin or other error — skip silently */ }
      }
      return { count, nodes };
    }

    retryTest() {
      const res = this.container.querySelector('#domx-res');
      res.innerHTML = '<div style="color:#6c757d; font-size:13px;">⏳ Retrying in 2 seconds...</div>';
      setTimeout(() => {
        res.innerHTML = '<div style="color:#3498db; font-size:13px;">🧪 Validating...</div>';
        this.runTest(this.lastTestedSelector, false, true);
      }, 2000);
    }

    showRes(r) {
      const res = this.container.querySelector('#domx-res');
      if (!r.success) {
        res.innerHTML = `<div style="padding:12px; background:#fdf2f2; color:#c81e1e; border:1px solid #f9d7d7; border-radius:6px; font-size:13px;"><strong>XPath Error:</strong> ${r.error}</div>`;
        return;
      }

      const color = r.count === 0 ? '#e74c3c' : (r.count === 1 ? '#27ae60' : '#f39c12');
      const text = r.count === 0 ? 'No match found' : (r.count === 1 ? '✅ Unique match found!' : `⚡ ${r.count} matches found`);
      let automationTip = '';

      if (r.count > 1) {
        automationTip = '<br><span style="font-size:11px;">💡 In Automation Anywhere, use (xpath)[index] to target specific element</span>';
      } else if (r.count === 1) {
        automationTip = '<br><span style="font-size:11px;">✨ Perfect for Automation Anywhere - no index needed</span>';
      }

      let miniList = '';
      if (r.count > 0 && this.lastMatchedNodes.length > 0) {
        const items = this.lastMatchedNodes.slice(0, 10).map(node => {
          const tag = node.tagName.toLowerCase();
          const txt = (node.textContent || '').trim().substring(0, 40);
          const nodeId = node.id ? `#${node.id}` : '';
          return `<div style="padding:4px 6px; background:#f8f9fa; border-radius:3px; margin-bottom:3px; font-size:11px; font-family:monospace; border:1px solid #e9ecef;">&lt;${tag}${nodeId ? ` id="${nodeId}"` : ''}&gt;${txt ? ` ${this.escapeHtml(txt)}${txt.length >= 40 ? '...' : ''}` : ''}</div>`;
        }).join('');
        const more = this.lastMatchedNodes.length > 10 ? `<div style="font-size:11px; color:#666; margin-top:4px;">...and ${this.lastMatchedNodes.length - 10} more</div>` : '';
        miniList = `<div style="margin-top:10px; padding:8px; background:#f8f9fa; border-radius:6px; border:1px solid #e9ecef;"><div style="font-size:11px; font-weight:bold; color:#495057; margin-bottom:6px;">Matched Elements (${this.lastMatchedNodes.length}):</div>${items}${more}</div>`;
      }

      let dynamicWarning = '';
      if (r.isRetry && r.count !== this.lastMatchCount && this.lastMatchCount !== null) {
        dynamicWarning = `<div style="margin-top:10px; padding:8px; background:#fff3cd; color:#856404; border:1px solid #ffeaa7; border-radius:6px; font-size:11px;"><strong>⚠️ Dynamic Content Detected</strong><br>Match count changed between retries (${this.lastMatchCount} → ${r.count}). This selector may be unstable on this page.</div>`;
      }

      let retryButton = '';
      if (r.count === 0 && this.lastTestedSelector && !r.isRetry) {
        retryButton = `<div style="margin-top:10px;"><button id="domx-retry-btn" style="padding:8px 16px; background:#6c757d; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px;">🔄 Retry in 2s</button></div>`;
      }

      res.innerHTML = `<div style="padding:12px; background:${color}10; color:${color}; border:1px solid ${color}40; border-radius:6px; font-size:13px;"><strong>${text}</strong>${automationTip}</div>${miniList}${dynamicWarning}${retryButton}`;

      if (retryButton) {
        this.container.querySelector('#domx-retry-btn').onclick = () => this.retryTest();
      }
    }

    testSelectorInPage(selector) {
      try {
        const result = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        const count = result.snapshotLength;
        
        return {
          success: true,
          count: count,
          selector: selector
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          selector: selector
        };
      }
    }

    highlight(sel) {
      this.clearHi();
      try {
        const r = document.evaluate(sel, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (r.snapshotLength === 0) return;

        const nodes = [];
        for (let i = 0; i < r.snapshotLength; i++) nodes.push(r.snapshotItem(i));

        // Scroll first match into view
        const first = nodes[0].tagName === 'OPTION' ? nodes[0].parentElement : nodes[0];
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });

        const hiElements = nodes.map(node => {
          if (node.nodeType !== 1) return null;
          const hi = document.createElement('div');
          hi.className = 'domx-hi';
          hi.style.cssText = 'position:fixed; pointer-events:none; z-index:2147483647; border:3px solid #27ae60; background:rgba(39,174,96,0.15); box-shadow:0 0 12px rgba(39,174,96,0.5); border-radius:3px; display:none;';
          
          if (node.tagName === 'OPTION' && node.parentElement) {
            const label = document.createElement('div');
            label.style.cssText = 'position:absolute; top:-28px; left:0; background:#27ae60; color:white; padding:3px 8px; font-size:11px; font-weight:bold; border-radius:4px; white-space:nowrap; box-shadow:0 2px 4px rgba(0,0,0,0.2);';
            label.textContent = `✓ Option matched: ${node.text}`;
            hi.appendChild(label);
          }
          
          (document.body || document.documentElement).appendChild(hi);
          return { hi, target: node.tagName === 'OPTION' ? node.parentElement : node };
        }).filter(x => x);

        const update = () => {
          hiElements.forEach(({ hi, target }) => {
            const b = target.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) {
              hi.style.display = 'none';
            } else {
              hi.style.display = 'block';
              hi.style.top = `${b.top}px`;
              hi.style.left = `${b.left}px`;
              hi.style.width = `${b.width}px`;
              hi.style.height = `${b.height}px`;
            }
          });
          this.hiLoop = requestAnimationFrame(update);
        };

        this.hiLoop = requestAnimationFrame(update);
        setTimeout(() => this.clearHi(), 5000);
      } catch(e) { console.error('Highlight error:', e); }
    }

    clearHi() {
      if (this.hiLoop) cancelAnimationFrame(this.hiLoop);
      document.querySelectorAll('.domx-hi').forEach(el => el.remove());
    }

    getAAHelper(tagName, selector) {
      const tag = tagName.toLowerCase();
      const isPositional = selector.includes(')[');
      const actions = [];
      let primaryAction = '';
      let fieldNote = 'Paste into the <b>DomX</b> field of the action.';
      let positionalNote = isPositional ? `
            <div style="margin-top:8px; padding:8px; background:#fff3cd; border:1px solid #ffeeba; border-radius:4px; font-size:11px; color:#856404;">
              <strong>⚠️ Positional Match:</strong> In Automation Anywhere, you might need to use the <code>(xpath)[index]</code> format to target this specific element if there are multiple matches.
            </div>` : '';
      let selectNote = '';
      if (this.currentData && this.currentData.isCustomDropdown) {
        selectNote = `
            <div style="margin-top:8px; padding:8px; background:#e8f4f8; border:1px solid #b8daff; border-radius:4px; font-size:11px; color:#004085;">
              <strong>💡 Custom Dropdown:</strong> This is a custom UI dropdown. In Automation Anywhere, use a two-step process: (1) Click this element to open the menu, then (2) Capture and click the option you want.
            </div>`;
      }


      // Determine AA action by element type
      if (tag === 'input') {
        primaryAction = 'Set Text';
        actions.push({ action: 'Set Text', desc: 'Type text into the input field' });
        actions.push({ action: 'Get Text', desc: 'Read the current value' });
        actions.push({ action: 'Click', desc: 'Click to focus/activate' });
      } else if (tag === 'select') {
        primaryAction = 'Select Item';
        actions.push({ action: 'Select Item', desc: 'Choose an option from the dropdown' });
        actions.push({ action: 'Get Text', desc: 'Read the selected option' });
      } else if (tag === 'button') {
        primaryAction = 'Click';
        actions.push({ action: 'Click', desc: 'Click the button' });
        actions.push({ action: 'Get Text', desc: 'Read the button label' });
      } else if (tag === 'a') {
        primaryAction = 'Click';
        actions.push({ action: 'Click', desc: 'Click the link' });
        actions.push({ action: 'Get Text', desc: 'Read the link text' });
      } else if (tag === 'textarea') {
        primaryAction = 'Set Text';
        actions.push({ action: 'Set Text', desc: 'Type text into the textarea' });
        actions.push({ action: 'Get Text', desc: 'Read the current value' });
      } else if (tag === 'img') {
        primaryAction = 'Get Text';
        actions.push({ action: 'Click', desc: 'Click the image' });
        actions.push({ action: 'Get Text', desc: 'Read the alt attribute' });
      } else if (tag === 'table' || tag === 'tr' || tag === 'td' || tag === 'th') {
        primaryAction = 'Get Text';
        actions.push({ action: 'Get Text', desc: 'Read cell/table content' });
      } else if (tag === 'label' || tag === 'span' || tag === 'div' || tag === 'p' || tag === 'li') {
        primaryAction = 'Get Text';
        actions.push({ action: 'Get Text', desc: 'Read the element text' });
        actions.push({ action: 'Click', desc: 'Click the element' });
      } else {
        primaryAction = 'Click';
        actions.push({ action: 'Click', desc: 'Click the element' });
        actions.push({ action: 'Get Text', desc: 'Read element content' });
      }

      const actionRows = actions.map(a => `
        <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid #f0f0f0;">
          <span style="font-weight:600; color:#2c3e50;">${a.action}</span>
          <span style="color:#666; font-size:11px;">${a.desc}</span>
        </div>
      `).join('');

      // Iframe frame-switching section for AA helper
      let iframeSection = '';
      if (this.currentData && this.currentData.inIframe && this.currentData.frameInfo) {
        const fi = this.currentData.frameInfo;
        const framePath = fi.framePath || [];
        let iframeSteps = '';
        for (let i = 0; i < framePath.length; i++) {
          const frame = framePath[i];
          const fxpath = frame.xpath || '(unresolved — use AA recorder)';
          iframeSteps += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #f0f0f0;">
              <div>
                <span style="font-weight:600; color:#2c3e50;">Step ${i + 1}: Switch Frame</span>
                <div style="font-size:10px; color:#666; font-family:monospace; margin-top:2px;">${this.escapeHtml(fxpath)}</div>
              </div>
            </div>`;
        }
        iframeSteps += `
            <div style="display:flex; justify-content:space-between; padding:6px 0;">
              <div>
                <span style="font-weight:600; color:#27ae60;">Step ${framePath.length + 1}: ${primaryAction}</span>
                <div style="font-size:10px; color:#666;">Use the element selector in DomX field</div>
              </div>
            </div>`;

        iframeSection = `
            <div style="margin-top:12px; padding:10px; background:#fff8e1; border:1px solid #ffe082; border-radius:6px;">
              <div style="font-size:12px; font-weight:700; color:#f57f17; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;">🔲 Iframe Workflow (Required)</div>
              <div style="font-size:11px; color:#856404; margin-bottom:8px;">This element is inside ${framePath.length > 1 ? framePath.length + ' nested iframes' : 'an iframe'}. You must switch frames before interacting.</div>
              ${iframeSteps}
              ${fi.frameDomPath ? `<div style="margin-top:8px; padding:6px; background:rgba(0,0,0,0.05); border-radius:4px; font-size:10px; color:#495057;"><strong>FrameDomPath:</strong> <code>${this.escapeHtml(fi.frameDomPath)}</code></div>` : ''}
            </div>`;
      }

      return `
        <div class="domx-aa-helper" style="position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:white; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.3); z-index:2147483647; width:380px; max-height:80vh; overflow-y:auto; font-family:sans-serif; display:none;">
          <div style="background:#2c3e50; color:white; padding:16px; border-radius:12px 12px 0 0; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-weight:600; font-size:15px;">How to use in AA</div>
              <div style="font-size:11px; opacity:0.8; margin-top:2px;">&lt;${tag}&gt; element${this.currentData && this.currentData.inIframe ? ' (in iframe)' : ''}</div>
            </div>
            <button class="domx-aa-close" style="background:none; border:none; color:white; font-size:22px; cursor:pointer; line-height:1;">&times;</button>
          </div>
          <div style="padding:16px;">
            ${iframeSection}
            <div style="margin-bottom:12px;">
              <div style="font-size:12px; font-weight:700; color:#7f8c8d; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">Recommended Actions</div>
              ${actionRows}
            </div>
            <div style="margin-top:12px; padding:8px; background:#f8f9fa; border-radius:4px; font-size:11px; color:#495057;">
              <strong>📋 DomX Field:</strong> ${fieldNote}
            </div>
            ${positionalNote}
            ${selectNote}
            <div style="margin-top:12px; padding:8px; background:#d4edda; border:1px solid #c3e6cb; border-radius:4px; font-size:11px; color:#155724;">
              <strong>✅ XPath 1.0 Compatible</strong><br>
              This selector uses standard XPath 1.0 syntax, fully supported by Automation Anywhere's DomX engine.
            </div>
          </div>
        </div>
      `;
    }

    escapeHtml(str) { const p = document.createElement('p'); p.textContent = str; return p.innerHTML; }

    toast(msg) {
      const t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#333; color:white; padding:8px 16px; border-radius:20px; font-size:12px; z-index:2147483647;';
      (document.body || document.documentElement).appendChild(t);
      setTimeout(() => t.remove(), 2000);
    }
  }

  window.domXPicker = new DomXPicker();
  window.domXPanel = new DomXPanel();

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'ping') sendResponse({ status: 'ok' });
    else if (req.action === 'activatePicker') window.domXPicker.activate();
    else if (req.action === 'deactivatePicker') window.domXPicker.deactivate();
    else if (req.action === 'showPanel') {
      if (req.element && req.selectors) window.domXPanel.show(req.element, req.selectors, req.originFrameId);
      else window.domXPanel.showEmpty();
    }
    else if (req.action === 'runTest') window.domXPanel.runTest(req.selector, true);
    else if (req.action === 'showTestResult') window.domXPanel.showRes(req.result);
    else if (req.action === 'testSelector') {
      // Handle selector testing from side panel
      const result = window.domXPanel.testSelectorInPage(req.selector);
      sendResponse(result);
    }
    return true;
  });
})();
