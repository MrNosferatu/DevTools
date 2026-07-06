// ==UserScript==
// @name         DevTools Sidebar — Plugin Registry
// @namespace    http://tampermonkey.net/
// @version      3.6.1
// @description  Lightweight plugin registry for DevTools Sidebar. Must be @required before any plugin script and before the main DevTools Sidebar script.
// @author       MrNosferatu
// ==/UserScript==

// Plugin scripts are separate @require'd files that execute BEFORE the main
// sidebar script's IIFE runs, so they can't close over its Store/state/$
// helpers directly. Instead each plugin registers a factory function here;
// once the main script has assembled a `ctx` (Store, state, $, shared
// helpers, ...) it calls every factory once and uses the returned plugin
// object to extend its nav bar, panels, settings, and network capture.
window.__DT_PLUGIN_FACTORIES__ = window.__DT_PLUGIN_FACTORIES__ || [];
function DT_registerPlugin(factory) {
  window.__DT_PLUGIN_FACTORIES__.push(factory);
}
