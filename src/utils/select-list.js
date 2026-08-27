import { sanitize } from './helpers.js';

const ENHANCED_ATTR = 'data-select-list-enhanced';
let initialized = false;

function optionLabel(option) {
  return option?.textContent?.trim() || option?.label || '';
}

function selectedLabel(select) {
  const selected = select.options[select.selectedIndex];
  return optionLabel(selected) || 'Selecionar';
}

function closeAll(except = null) {
  document.querySelectorAll('.select-list.is-open').forEach(wrapper => {
    if (wrapper !== except) wrapper.classList.remove('is-open');
  });
}

function sync(wrapper) {
  const select = wrapper.querySelector('select');
  const value = wrapper.querySelector('[data-select-list-value]');
  const menu = wrapper.querySelector('[data-select-list-menu]');
  if (!select || !value || !menu) return;

  value.textContent = selectedLabel(select);
  wrapper.classList.toggle('is-disabled', select.disabled);
  menu.querySelectorAll('[data-select-list-option]').forEach(option => {
    const selected = option.dataset.value === select.value;
    option.classList.toggle('is-selected', selected);
    option.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
}

function enhanceSelect(select) {
  if (!select || select.multiple || select.closest('.select-list') || select.hasAttribute(ENHANCED_ATTR)) return;
  select.setAttribute(ENHANCED_ATTR, 'true');

  const wrapper = document.createElement('div');
  wrapper.className = 'select-list';
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'select-list-trigger';
  button.setAttribute('aria-haspopup', 'listbox');
  button.innerHTML = '<span data-select-list-value></span><span class="select-list-arrow">⌄</span>';

  const menu = document.createElement('div');
  menu.className = 'select-list-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('data-select-list-menu', '');

  [...select.options].forEach(option => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'select-list-option';
    item.setAttribute('role', 'option');
    item.setAttribute('data-select-list-option', '');
    item.dataset.value = option.value;
    item.innerHTML = `<span>${sanitize(optionLabel(option))}</span>`;
    item.addEventListener('click', () => {
      if (select.disabled) return;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      wrapper.classList.remove('is-open');
      sync(wrapper);
    });
    menu.appendChild(item);
  });

  button.addEventListener('click', event => {
    event.preventDefault();
    if (select.disabled) return;
    const willOpen = !wrapper.classList.contains('is-open');
    closeAll(wrapper);
    wrapper.classList.toggle('is-open', willOpen);
  });

  select.addEventListener('change', () => sync(wrapper));
  wrapper.append(button, menu);
  sync(wrapper);
}

function enhanceAll(root = document) {
  root.querySelectorAll?.('select').forEach(enhanceSelect);
}

export function initSelectLists() {
  if (initialized) return;
  initialized = true;
  enhanceAll();

  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) enhanceAll(node);
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', event => {
    if (event.target.closest('.select-list')) return;
    closeAll();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeAll();
  });
}
