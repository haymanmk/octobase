const { highlighterInit } = require('../../dist/highlighter/highlighter.iife.js');

const addStyleToBody = () => {
  const style = document.createElement('style');
  style.innerHTML = `
    web-highlighter-highlighted {
      background-color: yellow;
    }
  `;
  document.body.appendChild(style);
}

window.addEventListener('DOMContentLoaded', () => {
  addStyleToBody();
  highlighterInit();
});