const globe = document.getElementById('delivery-globe');
const ctx = globe.getContext('2d');
const globeToggle = document.querySelector('.globe-toggle');
const motion = matchMedia('(prefers-reduced-motion: reduce)');

if (ctx) {
  const count = 3600;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const nodes = Array.from({ length: count }, (_, index) => {
    const y = 1 - 2 * (index + .5) / count;
    const ring = Math.sqrt(1 - y * y);
    return [Math.cos(index * goldenAngle) * ring, y, Math.sin(index * goldenAngle) * ring];
  });
  let angle = .65;
  let frame = 0;
  let previous = 0;
  let visible = false;
  let paused = false;
  let connections = [];

  function newConnection(delay = 0) {
    const from = nodes[Math.floor(Math.random() * count)];
    const to = nodes[Math.floor(Math.random() * count)];
    const separation = from.reduce((sum, value, axis) => sum + value * to[axis], 0);
    if (separation < -.45 || separation > .75) return newConnection(delay);
    const distance = Math.acos(separation);
    const points = Array.from({ length: 25 }, (_, index) => {
      const t = index / 24;
      const lift = 1 + .15 * Math.sin(Math.PI * t);
      const start = Math.sin((1 - t) * distance);
      const end = Math.sin(t * distance);
      return from.map((value, axis) => (value * start + to[axis] * end) * lift / Math.sin(distance));
    });
    return { points, age: -delay, duration: 1.6 + Math.random() * 1.6 };
  }

  function draw(elapsed) {
    const { width, height } = globe;
    const radius = Math.min(width, height) * .37;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    function project([x, y, z]) {
      const depth = z * cos - x * sin;
      return [width / 2 + (x * cos + z * sin) * radius,
        height / 2 - (y * .96 - depth * .28) * radius,
        y * .28 + depth * .96];
    }
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#50a5d8';
    ctx.beginPath();
    const size = Math.max(1, radius / 105);
    for (const node of nodes) {
      const [x, y, z] = project(node);
      if (z > 0) ctx.rect(x, y, size, size);
    }
    ctx.fill();
    ctx.strokeStyle = '#50a5d875';
    ctx.lineWidth = Math.max(1, radius / 150);
    for (let i = 0; i < connections.length; i++) {
      const connection = connections[i];
      connection.age += elapsed;
      if (connection.age > connection.duration) {
        connections[i] = newConnection(Math.random() * .7);
        continue;
      }
      if (connection.age < 0) continue;
      const path = connection.points.map(project);
      ctx.beginPath();
      let previousVisible = false;
      for (const [x, y, z] of path) {
        if (z > 0) {
          if (previousVisible) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        previousVisible = z > 0;
      }
      ctx.stroke();
      const progress = connection.age / connection.duration * (path.length - 1);
      const index = Math.min(Math.floor(progress), path.length - 2);
      const mix = progress - index;
      const [x, y, z] = path[index].map((value, axis) => value + (path[index + 1][axis] - value) * mix);
      if (z <= 0) continue;
      ctx.beginPath();
      ctx.arc(x, y, size * 2.3, 0, Math.PI * 2);
      ctx.fillStyle = '#d9f2ff';
      ctx.fill();
    }
  }

  function tick(now) {
    const elapsed = previous ? Math.min((now - previous) / 1000, .05) : 0;
    previous = now;
    angle += elapsed * .18;
    draw(elapsed);
    frame = requestAnimationFrame(tick);
  }

  function update() {
    cancelAnimationFrame(frame);
    previous = 0;
    globeToggle.hidden = motion.matches;
    if (visible && !paused && !document.hidden && !motion.matches) {
      frame = requestAnimationFrame(tick);
    } else {
      draw(0);
    }
  }

  connections = Array.from({ length: 8 }, (_, index) => newConnection(index * .28));
  new ResizeObserver(([entry]) => {
    const scale = Math.min(devicePixelRatio, 2);
    globe.width = Math.round(entry.contentRect.width * scale);
    globe.height = Math.round(entry.contentRect.height * scale);
    draw(0);
  }).observe(globe);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    update();
  }).observe(globe);
  globeToggle.addEventListener('click', () => {
    paused = !paused;
    globeToggle.textContent = paused ? 'Resume globe' : 'Pause globe';
    update();
  });
  document.addEventListener('visibilitychange', update);
  motion.addEventListener('change', update);
}
