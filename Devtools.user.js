// ==UserScript==
// @name         DevTools Sidebar
// @namespace    http://tampermonkey.net/
// @version      3.6.4
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
// @downloadURL  https://raw.githubusercontent.com/MrNosferatu/DevTools/main/Devtools.user.js
// @updateURL    https://raw.githubusercontent.com/MrNosferatu/DevTools/main/Devtools.user.js
// @require      https://cdn.jsdelivr.net/gh/MrNosferatu/DevTools@v3.6.4/Devtools_constants.js
// @require      https://cdn.jsdelivr.net/gh/MrNosferatu/DevTools@v3.6.4/Devtools_plugins.js
// @require      https://cdn.jsdelivr.net/gh/MrNosferatu/DevTools@v3.6.4/Devtools_css.js
// @require      https://cdn.jsdelivr.net/gh/MrNosferatu/DevTools@v3.6.4/Devtools_html.js
// @require      https://cdn.jsdelivr.net/gh/MrNosferatu/DevTools@v3.6.4/Devtools_baseurl.js
// @require      https://cdn.jsdelivr.net/gh/MrNosferatu/DevTools@v3.6.4/Devtools_formfill.js
// @require      https://cdn.jsdelivr.net/gh/MrNosferatu/DevTools@v3.6.4/Devtools_monitor.js
// @require      https://cdn.jsdelivr.net/gh/MrNosferatu/DevTools@v3.6.4/Devtools_bench.js
// @require      https://cdn.jsdelivr.net/gh/MrNosferatu/DevTools@v3.6.4/Devtools_recorder.js
// @require      https://cdn.jsdelivr.net/gh/MrNosferatu/DevTools@v3.6.4/Devtools.js
// ==/UserScript==

// This entry file intentionally has no body — all logic lives in the @require'd
// files above, with Devtools.js (loaded last) as the main script.
