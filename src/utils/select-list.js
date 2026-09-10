import { sanitize } from './helpers.js';

const ENHANCED_ATTR = 'data-select-list-enhanced';
const SEARCH_THRESHOLD = 8;
let initialized = false;
let selectListId = 0;

function optionLabel(option) {
  return option?.textContent?.trim() || option?.label || '';
}

function selectedLabel(select) {
  return optionLabel(select.options[select.selectedIndex]) || 'Selecionar';
}

function close(wrapper, { restoreFocus = false } = {}) {
  if (!wrapper?.classList.contains('is-open')) return;
  wrapper.classList.remove('is-open');
  wrapper.querySelector('[data-select-list-trigger]')?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) wrapper.querySelector('[data-select-list-trigger]')?.focus();
}

function closeAll(except = null) {
  document.querySelectorAll('.select-list.is-open').forEach(wrapper => {
    if (wrapper !== except) close(wrapper);
  });
}

function visibleOptions(wrapper) {
  return [...wrapper.querySelectorAll('[data-select-list-option]')]
    .filter(option => !option.hidden && !option.disabled);
}

function focusOption(wrapper, direction = 1) {
  const options = visibleOptions(wrapper);
  if (!options.length) return;
  const currentIndex = options.indexOf(document.activeElement);
  const selectedIndex = options.findIndex(option => option.classList.contains('is-selected'));
  const start = currentIndex >= 0 ? currentIndex : selectedIndex;
  const nextIndex = start < 0
    ? (direction > 0 ? 0 : options.length - 1)
    : (start + direction + options.length) % options.length;
  options[nextIndex].focus();
}

function open(wrapper, { focusMenu = false } = {}) {
  const select = wrapper.querySelector('select');
  if (!select || select.disabled) return;
  closeAll(wrapper);
  wrapper.classList.add('is-open');
  wrapper.querySelector('[data-select-list-trigger]')?.setAttribute('aria-expanded', 'true');
  if (!focusMenu) return;
  const search = wrapper.querySelector('[data-select-list-search]');
  if (search) search.focus();
  else focusOption(wrapper, 1);
}

function sync(wrapper) {
  const select = wrapper.querySelector('select');
  const value = wrapper.querySelector('[data-select-list-value]');
  const menu = wrapper.querySelector('[data-select-list-menu]');
  const trigger = wrapper.querySelector('[data-select-list-trigger]');
  if (!select || !value || !menu || !trigger) return;

  value.textContent = selectedLabel(select);
  wrapper.classList.toggle('is-disabled', select.disabled);
  trigger.disabled = select.disabled;
  trigger.setAttribute('aria-disabled', select.disabled ? 'true' : 'false');
  menu.querySelectorAll('[data-select-list-option]').forEach(option => {
    const selected = option.dataset.value === select.value;
    option.classList.toggle('is-selected', selected);
    option.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
}

function chooseOption(wrapper, item) {
  const select = wrapper.querySelector('select');
  if (!select || select.disabled || item.disabled) return;
  select.value = item.dataset.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  sync(wrapper);
  close(wrapper, { restoreFocus: true });
}

function filterOptions(wrapper, query) {
  const normalized = query.trim().toLocaleLowerCase('pt-BR');
  let visible = 0;
  wrapper.querySelectorAll('[data-select-list-option]').forEach(option => {
    const matches = !normalized || option.textContent.toLocaleLowerCase('pt-BR').includes(normalized);
    option.hidden = !matches;
    if (matches) visible += 1;
  });
  wrapper.querySelector('[data-select-list-empty]')?.toggleAttribute('hidden', visible > 0);
}

function enhanceSelect(select) {
  if (!select || select.multiple || select.closest('.select-list') || select.hasAttribute(ENHANCED_ATTR)) return;
  select.setAttribute(ENHANCED_ATTR, 'true');

  const wrapper = document.createElement('div');
  const menuId = `select-list-${++selectListId}`;
  wrapper.className = 'select-list';
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'select-list-trigger';
  button.setAttribute('data-select-list-trigger', '');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', menuId);
  button.innerHTML = '<span data-select-list-value></span><span class="select-list-arrow" aria-hidden="true">⌄</span>';

  const menu = document.createElement('div');
  menu.id = menuId;
  menu.className = 'select-list-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('data-select-list-menu', '');

  if (select.options.length >= SEARCH_THRESHOLD) {
    const searchWrap = document.createElement('div');
    searchWrap.className = 'select-list-search-wrap';
    searchWrap.innerHTML = '<span aria-hidden="true">⌕</span><input type="search" autocomplete="off" placeholder="Buscar opção..." aria-label="Buscar opção" data-select-list-search>';
    searchWrap.querySelector('input').addEventListener('input', event => filterOptions(wrapper, event.target.value));
    searchWrap.querySelector('input').addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusOption(wrapper, 1);
      }
    });
    menu.appendChild(searchWrap);
  }

  [...select.options].forEach(option => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'select-list-option';
    item.disabled = option.disabled;
    item.setAttribute('role', 'option');
    item.setAttribute('data-select-list-option', '');
    item.dataset.value = option.value;
    item.innerHTML = `<span>${sanitize(optionLabel(option))}</span>`;
    item.addEventListener('click', () => chooseOption(wrapper, item));
    item.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        focusOption(wrapper, event.key === 'ArrowDown' ? 1 : -1);
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const options = visibleOptions(wrapper);
        options[event.key === 'Home' ? 0 : options.length - 1]?.focus();
      }
    });
    menu.appendChild(item);
  });

  const empty = document.createElement('p');
  empty.className = 'select-list-empty';
  empty.setAttribute('data-select-list-empty', '');
  empty.hidden = true;
  empty.textContent = 'Nenhuma opção encontrada';
  menu.appendChild(empty);

  button.addEventListener('click', event => {
    event.preventDefault();
    sync(wrapper);
    if (wrapper.classList.contains('is-open')) close(wrapper);
    else open(wrapper);
  });
  button.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    open(wrapper);
    if (!wrapper.querySelector('[data-select-list-search]')) {
      const options = visibleOptions(wrapper);
      const index = ['ArrowUp', 'End'].includes(event.key) ? options.length - 1 : 0;
      options[index]?.focus();
    }
  });

  select.addEventListener('change', () => sync(wrapper));
  wrapper.append(button, menu);
  sync(wrapper);
}

function enhanceAll(root = document) {
  if (root.matches?.('select')) enhanceSelect(root);
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
    if (event.key !== 'Escape') return;
    const wrapper = document.activeElement?.closest?.('.select-list') || document.querySelector('.select-list.is-open');
    if (wrapper) close(wrapper, { restoreFocus: true });
  });
}
