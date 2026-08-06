/*!
 * ES-module entry for reveal.js-autohide-toolbar (browser/bundler use).
 *
 *   import RevealAutohideToolbar from 'reveal.js-autohide-toolbar';
 *   Reveal.initialize({ plugins: [ RevealAutohideToolbar ] });
 *
 * The plugin is client-only (it touches document/window on load) — in SSR
 * frameworks, import it dynamically on the client.
 */
import './reveal-autohide-toolbar.js';
const RevealAutohideToolbar = window.RevealAutohideToolbar;
export default RevealAutohideToolbar;
