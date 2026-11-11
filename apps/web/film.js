const film = document.getElementById('film');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let visible = false;

function updatePlayback() {
  if (!visible || document.hidden || reducedMotion.matches) {
    film.pause();
    return;
  }
  film.play().catch(() => {
    // The poster remains visible if the browser blocks autoplay.
  });
}

new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting;
  updatePlayback();
}).observe(film);

reducedMotion.addEventListener('change', updatePlayback);
document.addEventListener('visibilitychange', updatePlayback);
