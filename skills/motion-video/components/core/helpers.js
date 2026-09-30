export { RESERVED } from './validate.js';
export function el(parent, tag, attrs = {}, text) {
  const e = tag.startsWith('svg:') ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  parent.appendChild(e);
  return e;
}
