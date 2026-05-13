// Side Panel script - handles communication with content script
class SidePanel {
  constructor() {
    this.currentElement = null;
    this.currentSelectors = [];
    this.content = document.getElementById('content');
    this.settings = {
      autoHarden: true,
      showFragile: false,
      highlightOnPick: true,
      defaultIndex: 1
    };
    this.loadSettings();
    this.setupMessageListener();
    const self = this;
    setTimeout(() => {
      const btn = document.getElementById('domx-settings-btn');
      if (btn) btn.addEventListener('click', () => self.toggleSettings());

      const newBtn = document.getElementById('domx-new-element-btn');
      if (newBtn) newBtn.addEventListener('click', () => self.startNewPick());
    }, 100);
  }

  startNewPick() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        chrome.runtime.sendMessage({ action: 'activatePicker', tabId: tabs[0].id });
        this.showToast('Picker mode activated! Click an element on the page.');
      }
    });
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

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'showElement') {
        this.displayElement(request.element, request.selectors);
      } else if (request.action === 'testResult') {
        this.displayTestResult(request.result);
      }
      return true;
    });
  }

  displayElement(element, selectors) {
    this.currentElement = element;
    // Sort by stability rank: stable first, then moderate, then risky
    const rank = { stable: 0, moderate: 1, risky: 2 };
    this.currentSelectors = [...selectors].sort((a, b) => (rank[a.type] ?? 3) - (rank[b.type] ?? 3));
    
    let html = '';
    
    // Element information
    html += `
      <div class="element-info">
        <div style="display:flex; align-items:center; flex-wrap:wrap; gap:6px;">
          <span style="color:var(--text-muted); font-size:12px;">Captured Element:</span>
          <span class="tag">${element.tagName}</span>
          ${element.id ? `<span class="id">#${element.id}</span>` : ''}
        </div>
        ${element.text ? `<div style="margin-top:8px; font-size:12px;"><strong style="color:var(--text-muted); font-weight:normal;">Text:</strong> ${this.escapeHtml(element.text.substring(0, 50))}${element.text.length > 50 ? '...' : ''}</div>` : ''}
      </div>
    `;

    // IFrame warning — rich frame context when available
    if (element.inIframe) {
      if (element.frameInfo && element.frameInfo.framePath) {
        const fi = element.frameInfo;
        let stepsHtml = '';
        for (let i = 0; i < fi.framePath.length; i++) {
          const frame = fi.framePath[i];
          const fxpath = frame.xpath || '(unresolved)';
          stepsHtml += `
            <div style="margin-bottom:6px;">
              <div style="font-size:10px; font-weight:700; color:var(--warning-text); text-transform:uppercase;">Step ${i + 1}: Switch to Frame</div>
              <code style="display:block; background:var(--bg-color); padding:8px; border:1px solid var(--border-color); border-radius:6px; font-size:11px; word-break:break-all; margin-top:4px;">${this.escapeHtml(fxpath)}</code>
            </div>`;
        }
        stepsHtml += `
            <div>
              <div style="font-size:10px; font-weight:700; color:var(--success-text); text-transform:uppercase;">Step ${fi.framePath.length + 1}: Interact with Element</div>
              <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">Use selector below in DomX field</div>
            </div>`;

        html += `
          <div class="iframe-warning">
            <strong>🔲 IFRAME CONTEXT (Depth: ${fi.depth})</strong><br>
            ${fi.isCrossOrigin ? '<div style="color:var(--error-text); font-size:11px; margin:4px 0; background:var(--error-bg); padding:4px 8px; border-radius:4px;">⚠️ Cross-origin frame detected</div>' : ''}
            <div style="margin-top:8px;">${stepsHtml}</div>
            ${fi.frameDomPath ? `<div style="margin-top:8px; padding:8px; background:var(--bg-color); border-radius:6px; font-size:11px; border:1px solid var(--border-color);"><strong>FrameDomPath:</strong> <code>${this.escapeHtml(fi.frameDomPath)}</code></div>` : ''}
          </div>`;
      } else {
        html += `
          <div class="iframe-warning">
            <strong>⚠️ IFRAME DETECTED</strong><br>
            In Automation Anywhere, you must use the <b>"Browser: Switch to frame"</b> action first.<br>
            <div style="margin-top:8px; padding:8px; background:var(--bg-color); font-family:ui-monospace, monospace; font-size:11px; border-radius:6px; border:1px solid var(--border-color);">
              URL: ${(element.iframeUrl || '').substring(0, 40)}...<br>
              Name: ${element.iframeName || 'none'}
            </div>
          </div>`;
      }
    }

    // Custom dropdown tip
    if (element.isCustomDropdown) {
      html += `<div class="custom-dropdown-tip">💡 <strong>Custom Dropdown:</strong> Target the toggle first, then the item.</div>`;
    }

    // Display selectors
    selectors.forEach((selector, index) => {
      const badgeClass = selector.type;
      const tip = this.getSelectorTip(selector.type);
      
      let dropdownHtml = '';
      if (element.isSelect && element.options && element.options.length > 0) {
        const options = element.options.map((opt, idx) => 
          `<option value="${idx}">${this.escapeHtml(opt.text)}</option>`
        ).join('');
        
        dropdownHtml = `
          <div class="dropdown-options">
            <div style="font-size:11px; font-weight:bold; color:var(--text-muted); margin-bottom:8px;">TARGET OPTION:</div>
            <select class="domx-opt" data-idx="${index}">${options}</select>
            <select class="domx-strat" data-idx="${index}">
              <option value="text">Strategy: Select by Text (Best)</option>
              <option value="value">Strategy: Select by Value</option>
              <option value="index">Strategy: Select by Index (Fragile)</option>
            </select>
          </div>`;
      }

      html += `
        <div class="selector-card">
          <div class="selector-header">
            <span class="badge ${badgeClass}"><span class="badge-dot"></span>${selector.type.toUpperCase()}</span>
            <span class="selector-reason">${selector.reason}</span>
          </div>
          <code class="selector-code" data-idx="${index}">${this.escapeHtml(selector.selector)}</code>
          <textarea class="domx-editor" data-idx="${index}" style="display:none; width:100%; min-height:60px; padding:10px; border-radius:4px; font-size:12px; font-family:ui-monospace, monospace; border:1px solid var(--primary); box-shadow:0 0 0 2px rgba(59,130,246,0.1); background:#fff; resize:vertical; box-sizing:border-box;">${this.escapeHtml(selector.selector)}</textarea>
          <div class="domx-editor-actions" data-idx="${index}" style="display:none; gap:6px; margin-top:6px;">
            <button class="btn domx-editor-save" data-idx="${index}" style="flex:1; padding:6px; background:var(--success-text); color:white; border:none; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;">Save</button>
            <button class="btn domx-editor-cancel" data-idx="${index}" style="flex:1; padding:6px; background:var(--text-muted); color:white; border:none; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;">Cancel</button>
            <button class="btn domx-editor-retest" data-idx="${index}" style="flex:1; padding:6px; background:var(--primary); color:white; border:none; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;">Re-test</button>
          </div>
          ${dropdownHtml}
          <div class="selector-tip">${tip}</div>
          <div class="button-group">
            <button class="btn btn-copy" data-idx="${index}">Copy</button>
            <button class="btn btn-test" data-idx="${index}">Validate</button>
            <button class="btn btn-edit" data-idx="${index}">Edit</button>
          </div>
          <div style="margin-top:8px;">
          </div>
        </div>`;
    });

    // Results container
    html += '<div id="test-results"></div>';

    // AA Console Simulation
    html += `
      <div style="margin-top:24px; border-top:1px solid var(--border-color); padding-top:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div style="font-size:14px; font-weight:600; color:var(--text-main);">🖥 AA Console</div>
          <button id="domx-console-toggle" class="btn btn-copy" style="padding:4px 10px;">Show</button>
        </div>
        <div id="domx-console-section" style="display:none;">
          <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">Type any XPath expression to test against the current page</div>
          <div style="position:relative;">
            <div id="domx-console-highlight" aria-hidden="true" style="position:absolute; top:0; left:0; right:0; bottom:0; padding:10px; font-family:monospace; font-size:12px; white-space:pre-wrap; word-break:break-all; color:transparent; pointer-events:none; z-index:1; border:1px solid #ced4da; border-radius:4px; background:#1f2937; overflow:hidden;"></div>
            <textarea id="domx-console-input" style="position:relative; width:100%; min-height:70px; padding:10px; font-family:monospace; font-size:12px; border:1px solid #ced4da; border-radius:4px; background:transparent; color:#d4d4d4; resize:vertical; box-sizing:border-box; z-index:2; caret-color:#fff;" placeholder="//input[@name='username']" spellcheck="false"></textarea>
          </div>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button id="domx-console-run" class="btn btn-primary" style="flex:2; font-size:13px; font-weight:600;">▶ Run</button>
            <button id="domx-console-clear" class="btn btn-copy" style="flex:1; font-size:13px; font-weight:600;">Clear</button>
          </div>
          <div id="domx-console-output" style="margin-top:12px;"></div>
        </div>
      </div>`;

    this.content.innerHTML = html;
    this.attachEventListeners();
    this.setupConsoleListeners();
  }

  setupConsoleListeners() {
    const self = this;
    const toggle = this.content.querySelector('#domx-console-toggle');
    const section = this.content.querySelector('#domx-console-section');
    if (toggle && section) {
      toggle.addEventListener('click', () => {
        if (section.style.display === 'none') {
          section.style.display = 'block';
          toggle.textContent = 'Hide';
          const inp = section.querySelector('#domx-console-input');
          if (inp) inp.focus();
        } else {
          section.style.display = 'none';
          toggle.textContent = 'Show';
        }
      });
    }
    const input = this.content.querySelector('#domx-console-input');
    const highlight = this.content.querySelector('#domx-console-highlight');
    if (input && highlight) {
      input.addEventListener('input', () => { self.updateConsoleHighlight(input, highlight); });
      input.addEventListener('scroll', () => { highlight.scrollTop = input.scrollTop; highlight.scrollLeft = input.scrollLeft; });
    }
    const runBtn = this.content.querySelector('#domx-console-run');
    const clearBtn = this.content.querySelector('#domx-console-clear');
    if (runBtn) runBtn.addEventListener('click', () => {
      const inp = self.content.querySelector('#domx-console-input');
      if (inp) self.runConsole(inp.value.trim());
    });
    if (clearBtn) clearBtn.addEventListener('click', () => {
      const inp = self.content.querySelector('#domx-console-input');
      const hl = self.content.querySelector('#domx-console-highlight');
      const out = self.content.querySelector('#domx-console-output');
      if (inp) inp.value = '';
      if (hl) hl.innerHTML = '';
      if (out) out.innerHTML = '';
      if (inp) inp.focus();
    });
  }

  updateConsoleHighlight(input, highlight) {
    const val = input.value;
    const escaped = this.escapeHtml(val);
    let colored = escaped
      .replace(/(\/\/)/g, '<span style="color:#6a9955;">$1</span>')
      .replace(/(\/)([a-zA-Z_*][a-zA-Z0-9_-]*)/g, '$1<span style="color:#9cdcfe;">$2</span>')
      .replace(/(@)([a-zA-Z_*][a-zA-Z0-9_-]*)/g, '<span style="color:#c586c0;">$1</span><span style="color:#9cdcfe;">$2</span>')
      .replace(/(\[)([^\]]+)(\])/g, '<span style="color:#d4d4d4;">$1</span><span style="color:#ce9178;">$2</span><span style="color:#d4d4d4;">$3</span>')
      .replace(/(\(|\))/g, '<span style="color:#ffd700;">$1</span>')
      .replace(/(\d+)/g, '<span style="color:#b5cea8;">$1</span>');
    if (!val) colored = '';
    highlight.innerHTML = colored + '\n';
  }

  runConsole(xpath) {
    const output = this.content.querySelector('#domx-console-output');
    if (!xpath) {
      output.innerHTML = '<div class="result error" style="font-size:12px;">Enter an XPath expression above.</div>';
      return;
    }
    output.innerHTML = '<div class="result warning" style="font-size:12px;">🧪 Running...</div>';
    const self = this;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'testSelector', selector: xpath }, (response) => {
        if (chrome.runtime.lastError || !response) {
          output.innerHTML = `<div class="result error" style="font-size:12px;"><strong>❌ Connection Error:</strong> Unable to reach page. Reload and try again.</div>`;
          return;
        }
        if (!response.success) {
          output.innerHTML = `<div class="result error" style="font-size:12px;"><strong>❌ XPath Error:</strong> ${self.escapeHtml(response.error)}<br><span style="font-size:11px;">AA uses XPath 1.0 only.</span></div>`;
          return;
        }
        const count = response.count;
        if (count === 0) {
          output.innerHTML = `<div class="result error" style="font-size:12px;"><strong>❌ No match</strong> — 0 results on this page.<br><span style="font-size:11px;">Check if element is inside an iframe or content is dynamically loaded.</span></div>`;
          return;
        }
        const color = count === 1 ? 'var(--success-text)' : 'var(--warning-text)';
        const badge = count === 1 ? '✅ Unique match' : `⚡ ${count} matches`;
        const tip = count === 1 ? 'Ideal for AA — no index needed.' : `Multiple matches — use <code>(${self.escapeHtml(xpath)})[N]</code> in AA. AA index starts at 1.`;
        output.innerHTML = `<div class="result" style="color:${color}; font-size:12px;"><strong>${badge}</strong><br><span style="font-size:11px; color:var(--text-muted);">${tip}</span></div>`;
      });
    });
  }

  getSelectorTip(type) {
    switch (type) {
      case 'stable':
        return 'Ideal for Automation Anywhere — highly reliable selector';
      case 'moderate':
        return 'Stable fallback — should work in most cases';
      case 'risky':
        return 'Avoid if possible — may break with page changes';
      default:
        return '';
    }
  }

  attachEventListeners() {
    // Copy buttons
    this.content.querySelectorAll('.btn-copy').forEach(btn => {
      if (btn.id === 'domx-console-toggle' || btn.id === 'domx-console-clear') return;
      btn.addEventListener('click', (e) => {
        const index = e.target.dataset.idx;
        if(index) this.copySelector(index);
      });
    });

    // Test buttons
    this.content.querySelectorAll('.btn-test').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = e.target.dataset.idx;
        this.testSelector(index);
      });
    });

    // Dropdown changes
    this.content.querySelectorAll('.domx-opt, .domx-strat').forEach(select => {
      select.addEventListener('change', (e) => {
        const index = e.target.dataset.idx;
        this.updateSelectorDisplay(index);
      });
    });

    // Editor buttons
    this.content.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = e.target.dataset.idx;
        this.toggleEdit(index);
      });
    });
    this.content.querySelectorAll('.domx-editor-save').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = e.target.dataset.idx;
        this.saveEdit(index);
      });
    });
    this.content.querySelectorAll('.domx-editor-cancel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = e.target.dataset.idx;
        this.cancelEdit(index);
      });
    });
    this.content.querySelectorAll('.domx-editor-retest').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = e.target.dataset.idx;
        this.retestEdited(index);
      });
    });
  }

  getFullSelector(index) {
    let selector = this.currentSelectors[index].selector;
    
    if (this.currentElement.isSelect) {
      const optSelect = this.content.querySelector(`.domx-opt[data-idx="${index}"]`);
      const stratSelect = this.content.querySelector(`.domx-strat[data-idx="${index}"]`);
      
      if (optSelect && stratSelect) {
        const option = this.currentElement.options[optSelect.value];
        const strategy = stratSelect.value;
        
        if (strategy === 'index') {
          selector += `/option[${parseInt(optSelect.value) + 1}]`;
        } else if (strategy === 'value' && option.value) {
          selector += `/option[@value=${this.escapeXPath(option.value)}]`;
        } else {
          selector += `/option[normalize-space(text())=${this.escapeXPath(option.text)}]`;
        }
      }
    }
    
    return selector;
  }

  updateSelectorDisplay(index) {
    const codeElement = this.content.querySelector(`.selector-code[data-idx="${index}"]`);
    if (codeElement) {
      codeElement.textContent = this.getFullSelector(index);
    }
  }

  copySelector(index) {
    const selector = this.getFullSelector(index);
    navigator.clipboard.writeText(selector).then(() => {
      this.showToast('Selector copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy:', err);
      this.showToast('Failed to copy selector');
    });
  }

  testSelector(index) {
    const selector = this.getFullSelector(index);
    const resultsDiv = document.getElementById('test-results');
    
    resultsDiv.innerHTML = '<div class="result warning">🧪 Validating selector...</div>';
    
    // Send test request to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'testSelector',
        selector: selector,
        index: index
      }, (response) => {
        if (chrome.runtime.lastError) {
          resultsDiv.innerHTML = `
            <div class="result error">
              <strong>Connection Error:</strong> Unable to reach page. Make sure the content script is loaded.
            </div>`;
        } else if (response) {
          this.displayTestResult(response);
        }
      });
    });
  }

  displayTestResult(result) {
    const resultsDiv = document.getElementById('test-results');
    
    if (!result.success) {
      resultsDiv.innerHTML = `
        <div class="result error">
          <strong>XPath Error:</strong> ${result.error}
        </div>`;
      return;
    }

    const count = result.count;
    let resultClass, resultText, resultMessage;
    
    if (count === 0) {
      resultClass = 'error';
      resultText = '❌ No match found';
      resultMessage = 'This selector does not match any elements on the page.';
    } else if (count === 1) {
      resultClass = 'success';
      resultText = '✅ Unique match found!';
      resultMessage = 'Perfect! This selector matches exactly one element.';
    } else {
      resultClass = 'warning';
      resultText = `⚡ ${count} matches found`;
      resultMessage = 'Multiple matches found. In Automation Anywhere, you may need to use (xpath)[index] to specify which element to target.';
    }

    resultsDiv.innerHTML = `
      <div class="result ${resultClass}">
        <strong>${resultText}</strong><br>
        <span style="font-size:11px;">${resultMessage}</span>
      </div>`;
  }

  toggleEdit(index) {
    const codeEl = this.content.querySelector(`.selector-code[data-idx="${index}"]`);
    const editorEl = this.content.querySelector(`.domx-editor[data-idx="${index}"]`);
    const actionsEl = this.content.querySelector(`.domx-editor-actions[data-idx="${index}"]`);
    if (codeEl && editorEl && actionsEl) {
      codeEl.style.display = 'none';
      editorEl.style.display = 'block';
      actionsEl.style.display = 'flex';
      editorEl.focus();
    }
  }

  cancelEdit(index) {
    const codeEl = this.content.querySelector(`.selector-code[data-idx="${index}"]`);
    const editorEl = this.content.querySelector(`.domx-editor[data-idx="${index}"]`);
    const actionsEl = this.content.querySelector(`.domx-editor-actions[data-idx="${index}"]`);
    if (codeEl && editorEl && actionsEl) {
      editorEl.value = this.currentSelectors[index].selector;
      codeEl.style.display = 'block';
      editorEl.style.display = 'none';
      actionsEl.style.display = 'none';
    }
  }

  saveEdit(index) {
    const editorEl = this.content.querySelector(`.domx-editor[data-idx="${index}"]`);
    if (editorEl) {
      this.currentSelectors[index].selector = editorEl.value.trim();
      this.currentSelectors[index].reason += ' (edited)';
      this.currentSelectors[index].type = 'moderate';
      this.cancelEdit(index);
      this.showToast('Selector updated.');
    }
  }

  retestEdited(index) {
    const editorEl = this.content.querySelector(`.domx-editor[data-idx="${index}"]`);
    if (editorEl) {
      this.currentSelectors[index].selector = editorEl.value.trim();
    }
    this.testSelector(index);
    this.cancelEdit(index);
  }

  toggleSettings() {
    if (this.settingsPanel && this.settingsPanel.parentNode) {
      this.settingsPanel.remove();
      this.settingsPanel = null;
      return;
    }
    this.settingsPanel = document.createElement('div');
    this.renderSettingsPanel();
    document.body.appendChild(this.settingsPanel);
  }

  renderSettingsPanel() {
    const s = this.settings;
    const toggleRow = (id, label, desc, checked) => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border-color);">
        <div>
          <div style="font-size:13px; font-weight:600; color:var(--text-main);">${label}</div>
          <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${desc}</div>
        </div>
        <label style="position:relative; display:inline-block; width:44px; height:24px; cursor:pointer; flex-shrink:0; margin-left:12px;">
          <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} style="opacity:0; width:0; height:0;">
          <span style="position:absolute; top:0; left:0; right:0; bottom:0; background:${checked ? 'var(--primary)' : 'var(--border-color)'}; border-radius:24px; transition:0.2s;"></span>
          <span style="position:absolute; content:''; height:20px; width:20px; left:${checked ? '22px' : '2px'}; bottom:2px; background:white; border-radius:50%; transition:0.2s; box-shadow:0 1px 3px rgba(0,0,0,0.2);"></span>
        </label>
      </div>`;

    this.settingsPanel.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.4); z-index:99999; display:flex; align-items:center; justify-content:center;';
    this.settingsPanel.innerHTML = `
      <div style="background:var(--bg-color); border-radius:12px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1); width:340px; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; border:1px solid var(--border-color); overflow:hidden;">
        <div style="background:var(--surface-color); padding:16px 20px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
          <div style="font-weight:600; font-size:15px; color:var(--text-main);">⚙ Settings</div>
          <button id="domx-settings-close" style="background:none; border:none; color:var(--text-muted); font-size:24px; cursor:pointer; line-height:1; padding:0; display:flex; align-items:center; justify-content:center;">&times;</button>
        </div>
        <div style="padding:20px;">
          ${toggleRow('domx-cfg-autoharden', 'Auto-harden dynamic IDs', 'Automatically generate contains() variants for IDs with dynamic segments', s.autoHarden)}
          ${toggleRow('domx-cfg-showfragile', 'Show fragile selectors', 'Display positional/fragile selectors in results', s.showFragile)}
          ${toggleRow('domx-cfg-highlight', 'Highlight on pick', 'Automatically highlight matched elements after picking', s.highlightOnPick)}
          <div style="padding:16px 0 8px;">
            <div style="font-size:13px; font-weight:600; color:var(--text-main);">Default positional index</div>
            <div style="font-size:12px; color:var(--text-muted); margin:4px 0 10px;">Default N value for (//xpath)[N] wrapper</div>
            <input type="number" id="domx-cfg-index" value="${s.defaultIndex}" min="1" max="99" style="width:100%; padding:8px 12px; border:1px solid var(--border-color); border-radius:6px; font-size:13px; outline:none; background:var(--surface-color); color:var(--text-main);">
          </div>
          <div style="display:flex; gap:10px; margin-top:20px;">
            <button id="domx-settings-save" class="btn btn-primary" style="flex:1; padding:10px; font-size:13px; font-weight:600;">Save</button>
            <button id="domx-settings-reset" class="btn btn-copy" style="flex:1; padding:10px; font-size:13px; font-weight:600;">Reset</button>
          </div>
        </div>
      </div>`;

    const self = this;
    this.settingsPanel.querySelector('#domx-settings-close').addEventListener('click', () => this.toggleSettings());
    this.settingsPanel.querySelector('#domx-settings-save').addEventListener('click', () => this.saveSettingsFromUI());
    this.settingsPanel.querySelector('#domx-settings-reset').addEventListener('click', () => this.resetSettings());
    this.settingsPanel.addEventListener('click', (e) => { if (e.target === this.settingsPanel) self.toggleSettings(); });
  }

  saveSettingsFromUI() {
    this.settings.autoHarden = this.settingsPanel.querySelector('#domx-cfg-autoharden').checked;
    this.settings.showFragile = this.settingsPanel.querySelector('#domx-cfg-showfragile').checked;
    this.settings.highlightOnPick = this.settingsPanel.querySelector('#domx-cfg-highlight').checked;
    const idx = parseInt(this.settingsPanel.querySelector('#domx-cfg-index').value, 10);
    this.settings.defaultIndex = (idx >= 1 && idx <= 99) ? idx : 1;
    this.saveSettings();
    this.toggleSettings();
    this.showToast('Settings saved.');
  }

  resetSettings() {
    this.settings = { autoHarden: true, showFragile: false, highlightOnPick: true, defaultIndex: 1 };
    this.saveSettings();
    this.toggleSettings();
    this.showToast('Settings reset to defaults.');
  }

  showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  escapeXPath(str) {
    if (!str) return "''";
    str = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// Initialize the side panel
const sidePanel = new SidePanel();
