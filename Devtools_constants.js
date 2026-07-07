// ==UserScript==
// @name         DevTools Sidebar — Constants
// @namespace    http://tampermonkey.net/
// @version      3.6.7
// @description  Shared constants for DevTools Sidebar. Must be loaded first via @require.
// @author       MrNosferatu
// ==/UserScript==

// Single runtime-readable copy of the script version (shown in the About
// panel). bump-version.mjs rewrites this line together with every @version
// header, so it can never drift from the release version again.
const DT_VERSION = '3.6.7';

const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const BASEURL_COLORS = ['#2563eb','#16a34a','#dc2626','#d97706','#7c3aed','#0891b2','#db2777','#65a30d'];

const ED_THEMES = {
  catppuccin: { name:'Catppuccin',  bg:'#1e1e2e', text:'#cdd6f4', bar:'#181825', bdr:'#313145', caret:'#89b4fa', valid:'#a6e3a1', invalid:'#f38ba8', sWrap:'#12121e', sWrapBdr:'#3a3a55', sBdr:'#313145', sMuColor:'#6c7086', sTxt:'#cdd6f4', hlMark:'rgba(250,204,21,.35)', hlCurrent:'rgba(250,204,21,.75)' },
  vslight:    { name:'VS Light',    bg:'#fffffe', text:'#1e1e1e', bar:'#f3f3f3', bdr:'#ddd',    caret:'#0066bf', valid:'#008000', invalid:'#a31515', sWrap:'#f5f5f5', sWrapBdr:'#ccc',    sBdr:'#ddd',    sMuColor:'#999',    sTxt:'#1e1e1e', hlMark:'rgba(255,200,0,.4)',  hlCurrent:'rgba(255,160,0,.7)' },
  monokai:    { name:'Monokai',     bg:'#272822', text:'#f8f8f2', bar:'#1e1f1c', bdr:'#3e3d32', caret:'#f8f8f0', valid:'#a6e22e', invalid:'#f92672', sWrap:'#1a1b18', sWrapBdr:'#555',    sBdr:'#3e3d32', sMuColor:'#75715e', sTxt:'#f8f8f2', hlMark:'rgba(253,151,31,.35)', hlCurrent:'rgba(253,151,31,.75)' },
  nord:       { name:'Nord',        bg:'#2e3440', text:'#d8dee9', bar:'#242933', bdr:'#3b4252', caret:'#88c0d0', valid:'#a3be8c', invalid:'#bf616a', sWrap:'#1e2128', sWrapBdr:'#4c566a', sBdr:'#3b4252', sMuColor:'#4c566a', sTxt:'#d8dee9', hlMark:'rgba(235,203,139,.35)', hlCurrent:'rgba(235,203,139,.75)' },
  dracula:    { name:'Dracula',     bg:'#282a36', text:'#f8f8f2', bar:'#21222c', bdr:'#44475a', caret:'#bd93f9', valid:'#50fa7b', invalid:'#ff5555', sWrap:'#1a1b22', sWrapBdr:'#6272a4', sBdr:'#44475a', sMuColor:'#6272a4', sTxt:'#f8f8f2', hlMark:'rgba(255,184,108,.35)', hlCurrent:'rgba(255,184,108,.75)' },
};

const ED_FONTS = [
  { id:'ibm',      name:'IBM Plex Mono',  css:"'IBM Plex Mono',monospace" },
  { id:'jetbrain', name:'JetBrains Mono', css:"'JetBrains Mono',monospace" },
  { id:'fira',     name:'Fira Code',      css:"'Fira Code',monospace" },
  { id:'mono',     name:'System Mono',    css:"'Courier New',monospace" },
  { id:'sfmono',   name:'SF Mono',        css:"'SF Mono','SFMono-Regular',monospace" },
];
