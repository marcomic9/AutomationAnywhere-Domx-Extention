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
        <strong>Captured:</strong> <span class="tag">${element.tagName}</span>
        ${element.id ? `<span class="id">#${element.id}</span>` : ''}
        ${element.text ? `<br><strong>Text:</strong> ${this.escapeHtml(element.text.substring(0, 50))}${element.text.length > 50 ? '...' : ''}` : ''}
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
              <div style="font-size:10px; font-weight:700; color:#856404; text-transform:uppercase;">Step ${i + 1}: Switch to Frame</div>
              <code style="display:block; background:rgba(255,255,255,0.6); padding:6px; border-radius:3px; font-size:11px; word-break:break-all; margin-top:2px;">${this.escapeHtml(fxpath)}</code>
            </div>`;
        }
        stepsHtml += `
            <div>
              <div style="font-size:10px; font-weight:700; color:#155724; text-transform:uppercase;">Step ${fi.framePath.length + 1}: Interact with Element</div>
              <div style="font-size:10px; color:#666; margin-top:2px;">Use selector below in DomX field</div>
            </div>`;

        html += `
          <div class="iframe-warning" style="background:#fff8e1; border:1px solid #ffe082;">
            <strong>🔲 IFRAME CONTEXT (Depth: ${fi.depth})</strong><br>
            ${fi.isCrossOrigin ? '<div style="color:#c62828; font-size:10px; margin:4px 0;">⚠️ Cross-origin frame detected</div>' : ''}
            <div style="margin-top:8px;">${stepsHtml}</div>
            ${fi.frameDomPath ? `<div style="margin-top:8px; padding:4px; background:rgba(0,0,0,0.05); border-radius:3px; font-size:10px;"><strong>FrameDomPath:</strong> <code>${this.escapeHtml(fi.frameDomPath)}</code></div>` : ''}
          </div>`;
      } else {
        html += `
          <div class="iframe-warning">
            <strong>⚠️ IFRAME DETECTED</strong><br>
            In Automation Anywhere, you must use the <b>"Browser: Switch to frame"</b> action first.<br>
            <div style="margin-top:5px; padding:4px; background:rgba(255,255,255,0.5); font-family:monospace; border-radius:3px;">
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
            <div style="font-size:11px; font-weight:bold; color:#7f8c8d; margin-bottom:8px;">TARGET OPTION:</div>
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
          <textarea class="domx-editor" data-idx="${index}" style="display:none; width:100%; min-height:60px; padding:10px; border-radius:4px; font-size:12px; font-family:monospace; border:2px solid #3498db; background:#fff; resize:vertical; box-sizing:border-box;">${this.escapeHtml(selector.selector)}</textarea>
          <div class="domx-editor-actions" data-idx="${index}" style="display:none; gap:6px; margin-top:6px;">
            <button class="btn domx-editor-save" data-idx="${index}" style="flex:1; padding:6px; background:#27ae60; color:white; border:none; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;">Save</button>
            <button class="btn domx-editor-cancel" data-idx="${index}" style="flex:1; padding:6px; background:#95a5a6; color:white; border:none; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;">Cancel</button>
            <button class="btn domx-editor-retest" data-idx="${index}" style="flex:1; padding:6px; background:#3498db; color:white; border:none; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;">Re-test</button>
          </div>
          ${dropdownHtml}
          <div class="selector-tip">${tip}</div>
          <div class="button-group">
            <button class="btn btn-copy" data-idx="${index}">Copy</button>
            <button class="btn btn-test" data-idx="${index}">Validate</button>
            <button class="btn btn-edit" data-idx="${index}" style="background:#8e44ad; color:white;">Edit</button>
          </div>
          <div style="margin-top:8px;">
          </div>
        </div>`;
    });

    // Results container
    html += '<div id="test-results"></div>';

    // AA Console Simulation
    html += `
      <div style="margin-top:20px; border-top:2px solid #dee2e6; padding-top:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div style="font-size:13px; font-weight:700; color:#2c3e50;">🖥 AA Console</div>
          <button id="domx-console-toggle" style="background:none; border:1px solid #bdc3c7; border-radius:4px; padding:2px 8px; cursor:pointer; font-size:11px; color:#666;">Show</button>
        </div>
        <div id="domx-console-section" style="display:none;">
          <div style="font-size:11px; color:#95a5a6; margin-bottom:8px;">Type any XPath expression to test against the current page</div>
          <div style="position:relative;">
            <div id="domx-console-highlight" aria-hidden="true" style="position:absolute; top:0; left:0; right:0; bottom:0; padding:10px; font-family:monospace; font-size:12px; white-space:pre-wrap; word-break:break-all; color:transparent; pointer-events:none; z-index:1; border:1px solid #ced4da; border-radius:4px; background:#1e1e1e; overflow:hidden;"></div>
            <textarea id="domx-console-input" style="position:relative; width:100%; min-height:70px; padding:10px; font-family:monospace; font-size:12px; border:1px solid #ced4da; border-radius:4px; background:transparent; color:#d4d4d4; resize:vertical; box-sizing:border-box; z-index:2; caret-color:#fff;" placeholder="//input[@name='username']" spellcheck="false"></textarea>
          </div>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button id="domx-console-run" style="flex:1; padding:8px; background:#27ae60; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px; font-weight:600;">▶ Run</button>
            <button id="domx-console-clear" style="padding:8px 16px; background:#ecf0f1; color:#2c3e50; border:1px solid #bdc3c7; border-radius:4px; cursor:pointer; font-size:12px; font-weight:600;">Clear</button>
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
        const color = count === 1 ? '#27ae60' : '#f39c12';
        const badge = count === 1 ? '✅ Unique match' : `⚡ ${count} matches`;
        const tip = count === 1 ? 'Ideal for AA — no index needed.' : `Multiple matches — use <code>(${self.escapeHtml(xpath)})[N]</code> in AA. AA index starts at 1.`;
        output.innerHTML = `<div class="result" style="background:${color}10; color:${color}; border:1px solid ${color}40; font-size:12px;"><strong>${badge}</strong><br><span style="font-size:11px;">${tip}</span></div>`;
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

  getAAHelperData(tagName, selector) {
    const tag = tagName.toLowerCase();
    const isPositional = selector.includes(')[');
    const actions = [];
    let primaryAction = '';

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

    return { tag, actions, primaryAction, isPositional };
  }

  attachEventListeners() {
    // Copy buttons
    this.content.querySelectorAll('.btn-copy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = e.target.dataset.idx;
        this.copySelector(index);
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
        } else         if (strategy === 'value' && option.value) {
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

    this.settingsPanel.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.4); z-index:99999; display:flex; align-items:center; justify-content:center;';
    this.settingsPanel.innerHTML = `
      <div style="background:white; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.3); width:340px; font-family:sans-serif;">
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
