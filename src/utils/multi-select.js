import { sanitize } from './helpers.js';

let initialized = false;

function close(wrapper, { restoreFocus = false } = {}) {
  if (!wrapper?.classList.contains('is-open')) return;
  wrapper.classList.remove('is-open');
  const trigger = wrapper.querySelector('[data-multi-select-trigger]');
  trigger?.setAttribute('aria-expanded', 'false');
  wrapper.dispatchEvent(new CustomEvent('multi-select-toggle', { detail: { open: false } }));
  if (restoreFocus) trigger?.focus();
}

function closeAll(except = null) {
  document.querySelectorAll('[data-multi-select].is-open').forEach(wrapper => {
    if (wrapper !== except) close(wrapper);
  });
}

function open(wrapper, { focusSearch = false } = {}) {
  closeAll(wrapper);
  wrapper.classList.add('is-open');
  wrapper.querySelector('[data-multi-select-trigger]')?.setAttribute('aria-expanded', 'true');
  wrapper.dispatchEvent(new CustomEvent('multi-select-toggle', { detail: { open: true } }));
  if (focusSearch) wrapper.querySelector('[data-multi-select-search]')?.focus();
}

function toggleInput(wrapper, input) {
  if (!input || input.disabled) return;
  input.checked = !input.checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.closest('[role="option"]')?.setAttribute('aria-selected', input.checked ? 'true' : 'false');
}

function filterOptions(wrapper, query) {
  const normalized = query.trim().toLocaleLowerCase('pt-BR');
  let visible = 0;
  wrapper.querySelectorAll('[data-multi-option]').forEach(option => {
    const matches = !normalized || option.textContent.toLocaleLowerCase('pt-BR').includes(normalized);
    option.hidden = !matches;
    if (matches) visible += 1;
  });
  wrapper.querySelector('[data-multi-empty]')?.toggleAttribute('hidden', visible > 0);
}

function visibleOptions(wrapper) {
  return [...wrapper.querySelectorAll('[data-multi-option]')].filter(option => !option.hidden);
}

function focusOption(wrapper, direction = 1) {
  const options = visibleOptions(wrapper);
  if (!options.length) return;
  const currentIndex = options.indexOf(document.activeElement);
  const nextIndex = currentIndex < 0
    ? (direction > 0 ? 0 : options.length - 1)
    : (currentIndex + direction + options.length) % options.length;
  options[nextIndex].focus();
}

export function initMultiSelects() {
  if (initialized) return;
  initialized = true;

  document.addEventListener('click', event => {
    const remove = event.target.closest('[data-multi-remove]');
    if (remove) {
      event.preventDefault();
      event.stopPropagation();
      const wrapper = remove.closest('[data-multi-select]');
      const input = [...wrapper.querySelectorAll('[data-multi-option] input')]
        .find(option => option.value === remove.dataset.multiRemove);
      if (input?.checked) toggleInput(wrapper, input);
      return;
    }

    const trigger = event.target.closest('[data-multi-select-trigger]');
    if (trigger) {
      const wrapper = trigger.closest('[data-multi-select]');
      if (wrapper.classList.contains('is-open')) close(wrapper);
      else open(wrapper);
      return;
    }

    const option = event.target.closest('[data-multi-option], [data-multi-all]');
    if (option && !event.target.matches('input')) {
      event.preventDefault();
      toggleInput(option.closest('[data-multi-select]'), option.querySelector('input'));
      return;
    }

    if (!event.target.closest('[data-multi-select]')) closeAll();
  });

  document.addEventListener('input', event => {
    if (!event.target.matches('[data-multi-select-search]')) return;
    filterOptions(event.target.closest('[data-multi-select]'), event.target.value);
  });

  document.addEventListener('keydown', event => {
    const wrapper = event.target.closest?.('[data-multi-select]');
    if (!wrapper) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close(wrapper, { restoreFocus: true });
      return;
    }
    if (event.target.matches('[data-multi-select-trigger]') && ['Enter', ' ', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      open(wrapper, { focusSearch: true });
      return;
    }
    if (event.target.matches('[data-multi-select-search]') && event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(wrapper, 1);
      return;
    }
    const option = event.target.closest('[data-multi-option], [data-multi-all]');
    if (option && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      toggleInput(wrapper, option.querySelector('input'));
      return;
    }
    if (option && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Home' || event.key === 'End') {
        const options = visibleOptions(wrapper);
        options[event.key === 'Home' ? 0 : options.length - 1]?.focus();
      } else {
        focusOption(wrapper, event.key === 'ArrowDown' ? 1 : -1);
      }
    }
  });
}

function safeDataAttribute(attribute = '') {
  return /^data-[a-z0-9-]+$/.test(attribute) ? attribute : '';
}

export function renderMultiSelect({
  id,
  label,
  options = [],
  selectedValues = [],
  open: isOpen = false,
  allLabel = 'Todos',
  emptyLabel = 'Todos',
  ariaLabel = `Selecionar ${label}`,
  optionDataAttribute = '',
  optionDataValue = '',
  allDataAttribute = '',
  allDataValue = '',
  wrapperDataAttribute = '',
  wrapperDataValue = '',
  className = '',
} = {}) {
  const selected = new Set(selectedValues.map(String));
  const selectedOptions = options.filter(option => selected.has(String(option.value)));
  const allSelected = options.length > 0 && selectedOptions.length === options.length;
  const optionAttr = safeDataAttribute(optionDataAttribute);
  const allAttr = safeDataAttribute(allDataAttribute);
  const wrapperAttr = safeDataAttribute(wrapperDataAttribute);
  const menuId = `${id}-menu`;
  const visibleSelected = selectedOptions.slice(0, 2);
  const hiddenSelectedCount = selectedOptions.length - visibleSelected.length;
  const chips = selectedOptions.length
    ? `${visibleSelected.map(option => `<span class="multi-select-chip"><span>${sanitize(option.label)}</span><button type="button" data-multi-remove="${sanitize(String(option.value))}" aria-label="Remover ${sanitize(option.label)}">×</button></span>`).join('')}${hiddenSelectedCount ? `<span class="multi-select-chip multi-select-more">+${hiddenSelectedCount}</span>` : ''}`
    : `<span class="multi-select-placeholder">${sanitize(emptyLabel)}</span>`;

  return `
    <div class="compact-multi-filter multi-select ${isOpen ? 'is-open' : ''} ${sanitize(className)}" data-multi-select ${wrapperAttr ? `${wrapperAttr}="${sanitize(wrapperDataValue)}"` : ''}>
      <span class="filter-label">${sanitize(label)}</span>
      <div class="multi-select-control" id="${sanitize(id)}" role="combobox" aria-haspopup="listbox" aria-controls="${sanitize(menuId)}" aria-expanded="${isOpen ? 'true' : 'false'}" aria-label="${sanitize(ariaLabel)}" tabindex="0" data-multi-select-trigger>
        <span class="multi-select-tokens">${chips}</span>
        <span class="multi-select-arrow" aria-hidden="true">⌄</span>
      </div>
      <div class="compact-multi-menu multi-select-popover" id="${sanitize(menuId)}" role="listbox" aria-multiselectable="true">
        <div class="multi-select-search"><span aria-hidden="true">⌕</span><input type="search" autocomplete="off" placeholder="Buscar..." aria-label="Buscar em ${sanitize(label)}" data-multi-select-search></div>
        <label class="compact-multi-all" role="option" tabindex="0" aria-selected="${allSelected ? 'true' : 'false'}" data-multi-all>
          <input type="checkbox" ${allAttr}${allAttr && allDataValue ? `="${sanitize(allDataValue)}"` : ''} ${allSelected ? 'checked' : ''} ${options.length ? '' : 'disabled'}>
          <span>${sanitize(allLabel)}</span>
        </label>
        <div class="multi-select-separator"></div>
        ${options.map(option => {
          const value = String(option.value);
          const checked = selected.has(value);
          return `<label data-multi-option data-value="${sanitize(value)}" role="option" tabindex="0" aria-selected="${checked ? 'true' : 'false'}" title="${sanitize(option.title || option.label)}"><input type="checkbox" ${optionAttr}${optionAttr && optionDataValue ? `="${sanitize(optionDataValue)}"` : ''} value="${sanitize(value)}" ${checked ? 'checked' : ''}><span>${sanitize(option.label)}</span></label>`;
        }).join('')}
        <p class="multi-select-empty" data-multi-empty hidden>Nenhuma opção encontrada</p>
      </div>
    </div>`;
}
