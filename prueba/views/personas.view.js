// @ts-check
/**
 * P22 · Personas (`#/personas`) y Cuentas de dominio (`#/personas/cuentas`): listados con filtro, chips por estado con
 * cantidades (MJ25), columna «Verificado» y alta. Marca a la vista las cuentas habilitadas de personas en baja.
 */

import * as repositorio from '../assets/js/repositorio.js';
import { puede } from '../assets/js/permisos.js';
import { ir } from '../assets/js/marco.js';
import { h, tabla, indicadorVerificacion, normalizar } from '../assets/js/utiles.js';
import { encabezado, leerRuta, pestanas, chipsEstado } from '../assets/js/red.js';
import { cargarContextoPersonas, avisoPersonas, enlaceFila, nombreCuenta, hashDeEquipo, pillPersona, pillCuenta, alertaCuentaDeBaja } from '../assets/js/personas.js';

// Filtros que se recuerdan al volver a la pantalla.
const filtro = { personasTexto: '', sector: '', personasChip: '', cuentasTexto: '', cuentasChip: '' };

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const ctx = await cargarContextoPersonas();
  const tab = leerRuta().partes[0] === 'cuentas' ? 'cuentas' : 'personas';
  await encabezado(contenedor, 'P22', 'Personas', [['Personas', tab === 'cuentas' ? '#/personas' : undefined], ...(tab === 'cuentas' ? /** @type {Array<[string, string?]>} */ ([['Cuentas de dominio']]) : [])]);
  if (!puede(ctx.u, 'ver', 'personas', ctx.org)) { avisoPersonas(contenedor, 'Tu rol no tiene acceso al módulo Personas.'); return; }

  const [personas, cuentas, asignaciones, equipos, puestos] = await Promise.all([
    repositorio.listar('personas', { organizacion_id: ctx.org }, { ordenarPor: 'persona_nombre' }),
    repositorio.listar('cuentas_dominio', { organizacion_id: ctx.org }, { ordenarPor: 'cuenta_usuario' }),
    repositorio.listar('asignaciones', a => a.organizacion_id === ctx.org && !a.asignacion_hasta),
    repositorio.listar('equipos', { organizacion_id: ctx.org }), repositorio.listar('puestos', { organizacion_id: ctx.org })]);
  const mp = new Map(personas.map(p => [p.id, p])), me = new Map(equipos.map(e => [e.id, e])), mpu = new Map(puestos.map(p => [p.id, p]));
  /** @type {Map<string, any[]>} */
  const equiposDe = new Map();
  for (const a of asignaciones) { const e = me.get(a.equipo_id); if (e) equiposDe.set(a.persona_id, (equiposDe.get(a.persona_id) || []).concat([e])); }
  /** @type {Map<string, any[]>} */
  const cuentasDe = new Map();
  for (const c of cuentas) if (c.persona_id) cuentasDe.set(c.persona_id, (cuentasDe.get(c.persona_id) || []).concat([c]));
  const verRed = puede(ctx.u, 'ver', 'red', ctx.org);

  contenedor.appendChild(h('h1', { text: 'Personas' }));
  const barra = pestanas([['personas', 'Personas (' + personas.length + ')'], ['cuentas', 'Cuentas de dominio (' + cuentas.length + ')']], tab, k => (k === 'cuentas' ? '#/personas/cuentas' : '#/personas'));
  barra.style.margin = '4px 0 8px';
  contenedor.appendChild(barra);
  const zonaHerr = h('div', { class: 'herr' });
  const zonaChips = h('div');
  const zonaTabla = h('div');
  contenedor.appendChild(zonaHerr); contenedor.appendChild(zonaChips); contenedor.appendChild(zonaTabla);

  // ------------------------------------------------------------------ Personas
  const pintarPersonas = () => {
    zonaChips.textContent = ''; zonaTabla.textContent = '';
    const pal = normalizar(filtro.personasTexto).split(/\s+/).filter(Boolean);
    const base = personas.filter(p => {
      if (filtro.sector && (p.persona_sector || '') !== filtro.sector) return false;
      if (!pal.length) return true;
      const pu = p.puesto_id ? mpu.get(p.puesto_id) : null;
      const texto = normalizar([p.persona_nombre, p.persona_sector, pu ? pu.puesto_nombre : '', (equiposDe.get(p.id) || []).map(e => e.equipo_nombre).join(' '), (cuentasDe.get(p.id) || []).map(nombreCuenta).join(' ')].join(' '));
      return pal.every(x => texto.includes(x));
    });
    /** @type {Object<string, (p: any) => boolean>} */
    const regla = {
      activa: p => p.persona_estado === 'activa', baja: p => p.persona_estado === 'baja',
      sin_cuenta: p => p.persona_estado === 'activa' && !(cuentasDe.get(p.id) || []).length,
      sin_equipo: p => p.persona_estado === 'activa' && !(equiposDe.get(p.id) || []).length
    };
    zonaChips.appendChild(chipsEstado([['activa', 'Activas'], ['baja', 'En baja'], ['sin_cuenta', 'Sin cuenta'], ['sin_equipo', 'Sin equipo']], k => base.filter(regla[k]).length, base.length, filtro.personasChip, k => { filtro.personasChip = k; pintarPersonas(); }));
    if (!personas.length) {
      zonaTabla.appendChild(h('div', { class: 'estado-vacio', role: 'status' }, [h('h2', { text: 'Todavía no hay personas cargadas' }),
        h('p', { text: 'Cargá a quienes trabajan en la organización para asignarles equipos y cuentas de dominio.' }),
        ctx.modifica ? h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Nueva persona', onclick: () => ir('#/persona/nueva') })]) : h('p', { class: 'mut', text: 'Tu rol no puede cargar personas: pedíselo a un técnico o gerente.' })]));
      return;
    }
    const filas = base.filter(p => !filtro.personasChip || regla[filtro.personasChip](p));
    if (!filas.length) { zonaTabla.appendChild(h('div', { class: 'aviso', text: 'Ninguna persona coincide con el filtro. Probá con otra palabra o tocá «Todos».' })); return; }
    zonaTabla.appendChild(tabla(['Nombre', 'Sector', 'Puesto', 'Equipos hoy', 'Cuentas', 'Estado', 'Verificado'], filas.map(p => {
      const pu = p.puesto_id ? mpu.get(p.puesto_id) : null;
      const eqs = equiposDe.get(p.id) || [], cus = cuentasDe.get(p.id) || [];
      return [enlaceFila(p.persona_nombre, '#/persona/' + p.id), p.persona_sector || '—',
        pu ? (verRed ? enlaceFila(pu.puesto_nombre, '#/puesto/' + pu.id) : pu.puesto_nombre) : '—',
        eqs.length ? h('div', { class: 'pe-celda-equipos' }, eqs.map(e => enlaceFila(e.equipo_nombre, hashDeEquipo(e)))) : h('span', { class: 'mut', text: 'Sin equipo' }),
        cus.length ? h('div', { class: 'pe-celda-equipos' }, cus.map(c => enlaceFila(nombreCuenta(c), '#/cuenta/' + c.id))) : h('span', { class: 'mut', text: 'Sin cuenta' }),
        pillPersona(p.persona_estado), indicadorVerificacion(p.verificado_en, ctx.umbrales, true)];
    }), { tipo: 'persona', onFila: (_f, i) => ir('#/persona/' + filas[i].id) }));
    zonaTabla.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: filas.length + ' de ' + personas.length + ' personas. Tocá una fila para abrir su ficha.' }));
  };

  // ------------------------------------------------------------------ Cuentas
  /** @param {any} c */
  const deBaja = c => !!c.persona_id && !!mp.get(c.persona_id) && /** @type {any} */ (mp.get(c.persona_id)).persona_estado === 'baja' && c.cuenta_estado === 'habilitada';
  const pintarCuentas = () => {
    zonaChips.textContent = ''; zonaTabla.textContent = '';
    const pal = normalizar(filtro.cuentasTexto).split(/\s+/).filter(Boolean);
    const dueno = (/** @type {any} */ c) => (c.persona_id && mp.get(c.persona_id) ? /** @type {any} */ (mp.get(c.persona_id)).persona_nombre : 'Cuenta de servicio');
    const base = cuentas.filter(c => !pal.length || pal.every(x => normalizar([nombreCuenta(c), dueno(c), c.cuenta_unidad_organizativa, (c.cuenta_grupos || []).join(' ')].join(' ')).includes(x)));
    /** @type {Object<string, (c: any) => boolean>} */
    const regla = { habilitada: c => c.cuenta_estado === 'habilitada', deshabilitada: c => c.cuenta_estado === 'deshabilitada', servicio: c => !c.persona_id, revisar: deBaja };
    zonaChips.appendChild(chipsEstado([['habilitada', 'Habilitadas'], ['deshabilitada', 'Deshabilitadas'], ['servicio', 'De servicio'], ['revisar', 'Habilitadas de personas en baja']], k => base.filter(regla[k]).length, base.length, filtro.cuentasChip, k => { filtro.cuentasChip = k; pintarCuentas(); }));
    if (!cuentas.length) {
      zonaTabla.appendChild(h('div', { class: 'estado-vacio', role: 'status' }, [h('h2', { text: 'Todavía no hay cuentas de dominio cargadas' }),
        h('p', { text: 'Cargá las cuentas del dominio con su usuario, unidad organizativa y grupos. Las de servicio no llevan persona.' }),
        ctx.modifica ? h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Nueva cuenta', onclick: () => ir('#/cuenta/nueva') })]) : null]));
      return;
    }
    const filas = base.filter(c => !filtro.cuentasChip || regla[filtro.cuentasChip](c));
    if (!filas.length) { zonaTabla.appendChild(h('div', { class: 'aviso', text: 'Ninguna cuenta coincide con el filtro. Probá con otra palabra o tocá «Todos».' })); return; }
    zonaTabla.appendChild(tabla(['Cuenta', 'Persona', 'Unidad organizativa', 'Grupos', 'Estado', 'Verificado'], filas.map(c => {
      const p = c.persona_id ? mp.get(c.persona_id) : null;
      const g = c.cuenta_grupos || [];
      return [enlaceFila(nombreCuenta(c), '#/cuenta/' + c.id),
        p ? enlaceFila(p.persona_nombre, '#/persona/' + p.id) : h('span', { class: 'mut', text: 'Cuenta de servicio' }),
        c.cuenta_unidad_organizativa || '—', g.length ? g.join(', ') : '—',
        h('span', null, [pillCuenta(c.cuenta_estado), deBaja(c) ? alertaCuentaDeBaja() : null]), indicadorVerificacion(c.verificado_en, ctx.umbrales, true)];
    }), { tipo: 'persona', onFila: (_f, i) => ir('#/cuenta/' + filas[i].id) }));
    zonaTabla.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: filas.length + ' de ' + cuentas.length + ' cuentas. Tocá una fila para abrir su ficha.' }));
  };

  // ------------------------------------------------------------------ Herramientas
  const buscador = /** @type {HTMLInputElement} */ (h('input', { type: 'search', style: 'width:320px', 'aria-label': tab === 'cuentas' ? 'Filtrar cuentas' : 'Filtrar personas',
    placeholder: tab === 'cuentas' ? 'Filtrar por usuario, persona, grupo o unidad…' : 'Filtrar por nombre, sector, puesto, equipo o cuenta…' }));
  buscador.value = tab === 'cuentas' ? filtro.cuentasTexto : filtro.personasTexto;
  buscador.addEventListener('input', () => { if (tab === 'cuentas') { filtro.cuentasTexto = buscador.value; pintarCuentas(); } else { filtro.personasTexto = buscador.value; pintarPersonas(); } });
  zonaHerr.appendChild(buscador);
  if (tab === 'personas') {
    const sectores = Array.from(new Set(personas.map(p => p.persona_sector).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'es'));
    const sel = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Sector' }, [h('option', { value: '', text: 'Todos los sectores' })].concat(sectores.map(s => h('option', { value: String(s), text: String(s) })))));
    if (!sectores.includes(filtro.sector)) filtro.sector = '';
    sel.value = filtro.sector;
    sel.addEventListener('change', () => { filtro.sector = sel.value; pintarPersonas(); });
    zonaHerr.appendChild(sel);
  }
  zonaHerr.appendChild(h('span', { style: 'flex:1' }));
  if (ctx.modifica) zonaHerr.appendChild(h('button', { type: 'button', class: 'primario', text: tab === 'cuentas' ? 'Nueva cuenta' : 'Nueva persona', onclick: () => ir(tab === 'cuentas' ? '#/cuenta/nueva' : '#/persona/nueva') }));
  if (tab === 'cuentas') pintarCuentas(); else pintarPersonas();
}
