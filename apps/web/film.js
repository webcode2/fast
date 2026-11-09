// Keeps the steps in time with the walkthrough, and lets people pause or jump.
const film = document.getElementById('film');
const toggle = document.getElementById('toggle');
const buttons = [...document.querySelectorAll('#steps button')];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Set once someone pauses, so scrolling back never restarts the video on them.
let pausedByViewer = reducedMotion;

film.controls = false;
toggle.hidden = false;

const showStep = () => {
  const now = film.currentTime;
  const current = buttons.findLast((button) => Number(button.dataset.at) <= now) ?? buttons[0];
  for (const button of buttons) {
    if (button === current) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
};

const showState = () => {
  toggle.textContent = film.paused ? 'Play video' : 'Pause video';
};

const play = () => film.play().catch(() => {
  // Autoplay can be refused, for example in low-power mode. The button still works.
  showState();
});

toggle.addEventListener('click', () => {
  pausedByViewer = !film.paused;
  if (film.paused) play();
  else film.pause();
});

for (const button of buttons) {
  button.addEventListener('click', () => {
    film.currentTime = Number(button.dataset.at);
    showStep();
    pausedByViewer = false;
    play();
  });
}

film.addEventListener('timeupdate', showStep);
film.addEventListener('seeked', showStep);
film.addEventListener('play', showState);
film.addEventListener('pause', showState);

new IntersectionObserver(([entry]) => {
  if (!entry.isIntersecting) film.pause();
  else if (!pausedByViewer) play();
}, { threshold: 0.35 }).observe(film);

showStep();
showState();
