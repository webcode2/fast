// Sends the waitlist form to the API and shows the result in place.
const form = document.getElementById('waitlist-form');
const status = document.getElementById('waitlist-status');
const submit = form.querySelector('button[type="submit"]');

const show = (message, isError) => {
  status.textContent = message;
  status.classList.toggle('is-error', isError);
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const fields = new FormData(form);
  submit.disabled = true;
  show('Sending…', false);
  try {
    const response = await fetch(form.dataset.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact: fields.get('contact'),
        role: fields.get('role'),
        consent: fields.get('consent') === 'yes',
        website: fields.get('website'),
      }),
    });
    if (response.ok) {
      form.reset();
      show('You’re on the list. We’ll let you know when Fast Logistics launches.', false);
      status.focus();
      return;
    }
    const body = await response.json().catch(() => ({}));
    show(body.error ?? 'Something went wrong. Please try again.', true);
  } catch {
    show('We couldn’t reach the server. Check your connection and try again.', true);
  } finally {
    submit.disabled = false;
  }
});
