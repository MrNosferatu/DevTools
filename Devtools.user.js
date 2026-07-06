// ==UserScript==
// @name         DevTools Sidebar
// @namespace    http://tampermonkey.net/
// @version      3.6.0
// @description  Some tools for web development — request/response interceptor, editor, recorder, and more.
// @author       MrNosferatu
// @match        http://*/*
// @match        https://*/*
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @run-at       document-start
// @downloadURL  http://localhost:8421/Devtools.user.js
// @updateURL    http://localhost:8421/Devtools.user.js
// @require      http://localhost:8421/Devtools_constants.js
// @require      http://localhost:8421/Devtools_plugins.js
// @require      http://localhost:8421/Devtools_css.js
// @require      http://localhost:8421/Devtools_html.js
// @require      http://localhost:8421/Devtools_baseurl.js
// @require      http://localhost:8421/Devtools_formfill.js
// @require      http://localhost:8421/Devtools_monitor.js
// @require      http://localhost:8421/Devtools_bench.js
// @require      http://localhost:8421/Devtools_recorder.js
// @require      http://localhost:8421/Devtools.js
// ==/UserScript==

// This entry file intentionally has no body — all logic lives in the @require'd
// files above, with Devtools.js (loaded last) as the main script.
