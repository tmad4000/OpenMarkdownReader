(function () {
  const SHOW_DELAY_MS = 120;
  const OFFSET = 8;
  const EDGE_PADDING = 8;
  const TOOLTIP_ID = 'fast-tooltip';

  let tooltipEl = null;
  let activeTarget = null;
  let showTimer = null;

  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;

    tooltipEl = document.createElement('div');
    tooltipEl.id = TOOLTIP_ID;
    tooltipEl.className = 'fast-tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    tooltipEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function getTooltipText(target) {
    if (!target) return '';

    const title = target.getAttribute('title');
    if (title) {
      target.dataset.fastTooltipTitle = title;
      target.removeAttribute('title');
      return title;
    }

    return target.dataset.fastTooltipTitle ||
      target.getAttribute('data-tooltip') ||
      target.getAttribute('aria-label') ||
      '';
  }

  function findTooltipTarget(start) {
    if (!start || typeof start.closest !== 'function') return null;
    return start.closest('[title], [data-tooltip], [aria-label]');
  }

  function positionTooltip(target) {
    const tooltip = ensureTooltip();
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
    left = Math.max(EDGE_PADDING, Math.min(left, window.innerWidth - tooltipRect.width - EDGE_PADDING));

    let top = targetRect.bottom + OFFSET;
    if (top + tooltipRect.height + EDGE_PADDING > window.innerHeight) {
      top = targetRect.top - tooltipRect.height - OFFSET;
    }
    top = Math.max(EDGE_PADDING, top);

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function showTooltip(target) {
    const text = getTooltipText(target).trim();
    if (!text) return;

    const tooltip = ensureTooltip();
    activeTarget = target;
    tooltip.textContent = text;
    tooltip.setAttribute('aria-hidden', 'false');
    tooltip.classList.add('visible');
    target.setAttribute('aria-describedby', TOOLTIP_ID);

    requestAnimationFrame(() => positionTooltip(target));
  }

  function scheduleTooltip(target) {
    clearTimeout(showTimer);
    showTimer = setTimeout(() => showTooltip(target), SHOW_DELAY_MS);
  }

  function hideTooltip() {
    clearTimeout(showTimer);
    showTimer = null;

    if (activeTarget) {
      activeTarget.removeAttribute('aria-describedby');
    }
    activeTarget = null;

    if (!tooltipEl) return;
    tooltipEl.classList.remove('visible');
    tooltipEl.setAttribute('aria-hidden', 'true');
  }

  function handleEnter(event) {
    const target = findTooltipTarget(event.target);
    if (!target || target === activeTarget) return;
    scheduleTooltip(target);
  }

  function handleLeave(event) {
    if (!activeTarget) {
      clearTimeout(showTimer);
      showTimer = null;
      return;
    }

    const nextTarget = event.relatedTarget;
    if (nextTarget && activeTarget.contains(nextTarget)) return;
    hideTooltip();
  }

  document.addEventListener('pointerover', handleEnter);
  document.addEventListener('pointerout', handleLeave);
  document.addEventListener('focusin', handleEnter);
  document.addEventListener('focusout', hideTooltip);
  document.addEventListener('mousedown', hideTooltip);
  document.addEventListener('wheel', hideTooltip, { passive: true });
  window.addEventListener('resize', hideTooltip);
  window.addEventListener('scroll', hideTooltip, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideTooltip();
  });
})();
