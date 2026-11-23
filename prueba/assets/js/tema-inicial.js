// Aplica el tema guardado antes de pintar la página, para que no parpadee. Solo lee una preferencia.
try { document.documentElement.dataset.theme = localStorage.getItem('infradoc.tema') === 'oscuro' ? 'oscuro' : 'claro'; } catch (e) { document.documentElement.dataset.theme = 'claro'; }
