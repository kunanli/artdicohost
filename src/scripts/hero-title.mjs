// The supplied title artwork is decorative; the H1 always carries the actual
// event name. Error handling also covers clones inserted by a public refresh.
const titleImage = target => target instanceof HTMLImageElement && target.matches('[data-home-title-image]');
function synchronize(image) {
  if (!titleImage(image) || !image.complete) return;
  const fallback = image.parentElement?.querySelector('[data-home-title-fallback]');
  if (!fallback) return;
  const ready = image.naturalWidth > 0;
  image.hidden = !ready;
  fallback.hidden = ready;
}
document.addEventListener('error', event => synchronize(event.target), true);
document.addEventListener('load', event => synchronize(event.target), true);
for (const image of document.querySelectorAll('[data-home-title-image]')) synchronize(image);
