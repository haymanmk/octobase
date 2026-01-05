const { highlighterInit } = require('../../dist/highlighter/highlighter.iife.js');

console.log(`Current document object: ${document}`);

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
  console.log('Injecting highlighter script...');
  addStyleToBody();
  highlighterInit();
  console.log('Highlighter script injected.');
});