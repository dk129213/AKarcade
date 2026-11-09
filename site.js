// Cabinet sizing + mouse tilt
(() => {
  const stage = document.getElementById('stage');
  const scaler = document.getElementById('scaler');
  const cabinet = document.getElementById('cabinet');
  const CAB_W = 460, CAB_H = 900;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fit() {
    const avail = stage.clientWidth || window.innerWidth;
    if (avail < 50) return;
    const byWidth = (avail - 24) / (CAB_W + 160);
    const byHeight = Math.max(0.6, (window.innerHeight - 110) / (CAB_H + 20));
    const s = Math.min(1, byWidth, byHeight);
    scaler.style.setProperty('--s', s.toFixed(3));
    // the 3D model sticks out toward the viewer, so it renders a little taller than CAB_H
    stage.style.height = Math.ceil(CAB_H * s * 1.08 + 30) + 'px';
  }
  window.addEventListener('resize', fit);
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(stage);
  fit();

  if (!reduceMotion) {
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      cabinet.style.setProperty('--ry', (16 + nx * 22).toFixed(2) + 'deg');
      cabinet.style.setProperty('--rx', (3 - ny * 6).toFixed(2) + 'deg');
    });
  }

  const toCabinet = () => stage.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  document.getElementById('heroStart').addEventListener('click', () => {
    toCabinet();
    document.getElementById('coinSlot').click();
  });
  document.querySelectorAll('[data-play]').forEach(btn => {
    btn.addEventListener('click', () => {
      toCabinet();
      window.AKArcade && window.AKArcade.launch(btn.dataset.play);
    });
  });
})();
