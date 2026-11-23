// @ts-check
/**
 * P17 · Registro de accesos a credenciales (quién mostró o copió qué contraseña y cuándo).
 * Solo superadmin y gerente.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { pantalla, migasRaiz } from '../assets/js/marco.js';
import { h, tabla, fmtFechaHora, normalizar } from '../assets/js/utiles.js';
import { sinPermiso } from '../assets/js/credenciales.js';

const POR_PAGINA = 100;

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const orgId = sesion.organizacionActiva();
  const migas = await migasRaiz();
  migas.push(['Registro de accesos']);
  pantalla(contenedor, { codigo: 'P17', nombre: 'Registro de accesos', migas });
  if (!puede(u, 'ver_registro_accesos', null, orgId)) { sinPermiso(contenedor, u, 'el Registro de accesos'); return; }

  const [regs, usuarios, creds] = await Promise.all([
    repositorio.listar('registro_accesos', r => !orgId || r.organizacion_id === orgId, { ordenarPor: 'registro_fecha', descendente: true }),
    repositorio.listar('usuarios', null, { incluirBajas: true }), repositorio.listar('credenciales', null, { incluirBajas: true })]);
  const nombreUsuario = new Map(usuarios.map(x => [x.id, x.usuario_nombre]));
  const credPorId = new Map(creds.map(x => [x.id, x]));
  const verCreds = puede(u, 'ver', 'credenciales', orgId);

  const f = { usuario: '', cred: '', accion: '', desde: '', hasta: '', max: POR_PAGINA };
  const zona = h('div');
  const pintar = () => {
    zona.textContent = '';
    const pal = normalizar(f.cred).split(/\s+/).filter(Boolean);
    const lista = regs.filter(r => {
      if (f.usuario && r.usuario_id !== f.usuario) return false;
      if (f.accion && r.registro_accion !== f.accion) return false;
      const dia = r.registro_fecha.slice(0, 10);
      if (f.desde && dia < f.desde) return false;
      if (f.hasta && dia > f.hasta) return false;
      const c = credPorId.get(r.credencial_id);
      const t = normalizar(c ? c.credencial_nombre : '');
      return pal.every(p => t.includes(p));
    });
    if (!regs.length) { zona.appendChild(h('div', { class: 'aviso', text: 'Todavía nadie mostró ni copió contraseñas. Cuando alguien lo haga, queda registrado acá.' })); return; }
    if (!lista.length) { zona.appendChild(h('div', { class: 'mut', style: 'padding:8px', text: 'Ningún acceso coincide con los filtros.' })); return; }
    const visibles = lista.slice(0, f.max);
    zona.appendChild(tabla(['Fecha y hora', 'Usuario', 'Credencial', 'Acción'], visibles.map(r => {
      const c = credPorId.get(r.credencial_id);
      const nombre = c ? c.credencial_nombre + (c.eliminado_en ? ' (dada de baja)' : '') : '(credencial desconocida)';
      return [fmtFechaHora(r.registro_fecha), nombreUsuario.get(r.usuario_id) || '?',
        c && !c.eliminado_en && verCreds ? h('a', { href: '#/credencial/' + c.id, text: nombre }) : nombre, r.registro_accion === 'copiar' ? 'Copió' : 'Mostró'];
    })));
    zona.appendChild(h('div', { class: 'herr' }, [h('span', { class: 'mut', text: 'Se muestran ' + visibles.length + ' de ' + lista.length + ' accesos.' }),
      lista.length > visibles.length ? h('button', { type: 'button', class: 'chico', text: 'Ver más', onclick: () => { f.max += POR_PAGINA; pintar(); } }) : null]));
  };

  const usuariosEnRegistro = Array.from(new Set(regs.map(r => r.usuario_id)));
  const selU = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Usuario' }, [h('option', { value: '', text: 'Todos' })].concat(usuariosEnRegistro.map(id => h('option', { value: id, text: nombreUsuario.get(id) || '?' })))));
  const inpC = /** @type {HTMLInputElement} */ (h('input', { type: 'search', placeholder: 'Credencial…', 'aria-label': 'Credencial', style: 'width:200px' }));
  const selA = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Acción' }, [['', 'Todas'], ['mostrar', 'Mostró'], ['copiar', 'Copió']].map(x => h('option', { value: x[0], text: x[1] }))));
  const inpD = /** @type {HTMLInputElement} */ (h('input', { type: 'date', 'aria-label': 'Desde' }));
  const inpH = /** @type {HTMLInputElement} */ (h('input', { type: 'date', 'aria-label': 'Hasta' }));
  const act = () => { f.usuario = selU.value; f.cred = inpC.value; f.accion = selA.value; f.desde = inpD.value; f.hasta = inpH.value; f.max = POR_PAGINA; pintar(); };
  for (const el of [selU, inpC, selA, inpD, inpH]) { el.addEventListener('input', act); el.addEventListener('change', act); }

  contenedor.appendChild(h('h1', { text: 'Registro de accesos a credenciales' }));
  contenedor.appendChild(h('div', { class: 'herr' }, [h('label', null, ['Usuario ', selU]), inpC, h('label', null, ['Acción ', selA]), h('label', null, ['Desde ', inpD]), h('label', null, ['Hasta ', inpH])]));
  contenedor.appendChild(zona);
  contenedor.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: 'Mostrar o copiar una contraseña desde cualquier ficha suma una fila acá. Nunca se guarda el valor de la contraseña.' }));
  pintar();
}
