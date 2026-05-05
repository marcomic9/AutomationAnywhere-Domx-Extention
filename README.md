# DomX Inspector - Professional RPA Selector Tool

**DomX Inspector** is a premium Chrome Extension designed specifically for Automation Anywhere (AA) developers. It simplifies the creation of "unbreakable" bots by generating robust, stable, and XPath 1.0-compliant selectors for even the most complex web applications.

---

## 🚀 Key Features

### 1. 🛡️ Unbreakable Iframe Spying
Automatically resolves complex iframe hierarchies.
- **FrameDomPath Generation**: Generates the exact pipe-separated path needed for AA.
- **Cross-Origin Support**: Detects and provides instructions for cross-origin frame boundaries.
- **Step-by-Step Guidance**: Tells you exactly which "Switch to Frame" actions you need.

### 2. 💎 Selector Intelligence
Not all XPaths are created equal. DomX Inspector ranks selectors by their "Survival Score":
- **STABLE**: IDs (hardened), unique Test IDs, and ARIA labels.
- **MODERATE**: Contextual selectors, inner-text matching, and stable parent-child relationships.
- **RISKY**: Positional indexes or fragile tag-only paths (flagged with warnings).

### 3. 🛠️ Dynamic ID Hardening
Automatically detects dynamic ID patterns (e.g., `button-12345-submit`) and generates `contains()`-based selectors that won't break when the page reloads.

### 4. 🖥️ AA Console (Built-in Terminal)
Test any XPath expression directly within the side panel. 
- **Real-time Validation**: Instantly see if a selector is unique or returns multiple matches.
- **AA Syntax Support**: Automatically wraps selectors in `(xpath)[N]` for easy copy-pasting.

### 5. 📖 Automation Anywhere Helper
Provides context-aware tips for every captured element:
- Recommends the best AA Action (Set Text, Click, Select Item).
- Handles `<select>` dropdowns with text/value/index strategies.
- Identifies custom dropdowns and shadow DOM elements.

---

## 📦 Installation

1.  Clone this repository or download the source code.
2.  Open Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** in the top-right corner.
4.  Click **Load unpacked** and select the `Chrome Extention` folder.
5.  Pin the DomX Inspector icon to your toolbar.

---

## 🛠 Usage

1.  **Activate**: Click the icon and hit **Start Picking**.
2.  **Capture**: Hover over any element and click. The side panel will slide in.
3.  **Inspect**: View the ranked selectors and frame details.
4.  **Test**: Use the **Validate** button to ensure the selector is unique.
5.  **Copy**: Click **Copy** and paste directly into your Automation Anywhere DomX field.

---

## 🗺 Roadmap

- [ ] **Phase 2 (In Progress)**: Full Shadow DOM traversal support.
- [ ] **Phase 3**: Element History (Save your last 50 captures).
- [ ] **Phase 4**: Export to JSON/CSV for batch bot configuration.
- [ ] **Phase 5**: "Bot Logic Suggest" - generating snippets of AA logic for complex tables.

---

## 🤝 Contributing

We welcome contributions from the RPA community! 
- Found a bug? Open an **Issue**.
- Have a feature idea? Start a **Discussion**.
- Want to add selector logic? Submit a **Pull Request**.

---

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

*Built with ❤️ for the Automation Anywhere Community.*
