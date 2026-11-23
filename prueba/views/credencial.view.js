// @ts-check
/**
 * P09 · Ficha de credencial. La contraseña nunca se ve sin «Mostrar» y sin permiso (`puedeVerSecreto`);
 * cada Mostrar y cada Copiar pasa por `repositorio.usarSecreto` y queda en el registro de accesos.
 * Edición en el lugar (D-037), con «Nueva contraseña» solo para quien puede modificar y ver la contraseña.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede, puedeVerSecreto, puedePedirSecreto, puedeQuitarAprobacion } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, repintarMarco, toast } from '../assets/js/marco.js';
import { h, tabla, fmtFechaHora, hoyISO } from '../assets/js/utiles.js';
import { ROTULO_CREDENCIAL_TIPO, ROTULO_PERFIL } from '../assets/js/modelos.js';
import { sinPermiso, enlaceEquipo, textoVencimiento, pestanas, campo, fichaCab, botonBaja, rotuloCampo, valorHistorial } from '../assets/js/credenciales.js';

const SEGUNDOS_VISIBLE = 30;

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  await sesion.refrescar();
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const partes = location.hash.replace(/^#\/?/, '').split('/');
  const idHash = decodeURIComponent(partes[1] || '');
  const nuevo = idHash === 'nuevo';
  let tab = ['quien', 'historial', 'accesos'].includes(partes[2]) ? partes[2] : 'quien';
  const migas = await migasRaiz();
  migas.push(['Credenciales', '#/credenciales']);

  /** @type {any} */
  let c = null;
  let orgId = /** @type {string} */ (sesion.organizacionActiva());
  if (!nuevo) {
    c = await repositorio.obtener('credenciales', idHash);
    if (!c) {
      pantalla(contenedor, { codigo: 'P09', nombre: 'Ficha de credencial', migas: migas.concat([['No encontrada']]) });
      contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Esa credencial no existe o fue dada de baja.' }), h('div', { style: 'margin-top:8px' }, [h('a', { href: '#/credenciales', text: 'Volver al listado de credenciales' })])]));
      return;
    }
    orgId = c.organizacion_id;
  }
  if (!puede(u, nuevo ? 'modificar' : 'ver', 'credenciales', orgId)) {
    pantalla(contenedor, { codigo: 'P09', nombre: 'Ficha de credencial', migas: migas.concat([[nuevo ? 'Nueva' : 'Ficha']]) });
    sinPermiso(contenedor, u, nuevo ? 'cargar credenciales' : 'Credenciales');
    return;
  }

  const [umbrales, usuarios, equipos, configs] = await Promise.all([
    repositorio.umbralesVerificacion(), repositorio.listar('usuarios', null, { incluirBajas: true }),
    repositorio.listar('equipos', { organizacion_id: orgId }, { ordenarPor: 'equipo_nombre' }),
    repositorio.listar('configuraciones', { organizacion_id: orgId }, { ordenarPor: 'configuracion_titulo' })]);
  const nombreUsuario = new Map(usuarios.map(x => [x.id, x.usuario_nombre]));
  const equipoPorId = new Map(equipos.map(e => [e.id, e]));
  const configPorId = new Map(configs.map(x => [x.id, x]));
  const rotuloTipo = (/** @type {string} */ t) => ROTULO_CREDENCIAL_TIPO[t] || t;

  let editando = nuevo || partes[2] === 'editar';
  if (editando && !nuevo && !puede(u, 'modificar', 'credenciales', orgId)) editando = false;
  /** @type {string|null} */
  let valor = null; // contraseña visible ahora (solo en memoria, se borra al ocultar)
  /** @type {number} */
  let temporizador = 0;
  /** @type {any} */
  let ed = null;
  const iniciarEd = () => {
    ed = c ? { nombre: c.credencial_nombre, tipo: c.credencial_tipo, usuario: c.credencial_usuario || '', host: c.credencial_url_o_host || '', equipo: c.equipo_id || '',
      config: c.configuracion_id || '', vence: c.credencial_vence_en || '', notas: c.credencial_notas || '', secreto: '', verSecreto: false }
      : { nombre: '', tipo: 'otro', usuario: '', host: '', equipo: '', config: '', vence: '', notas: '', secreto: '', verSecreto: false };
  };
  if (editando) iniciarEd();

  const ocultar = () => { valor = null; clearTimeout(temporizador); };
  const rerender = async () => {
    if (c) c = (await repositorio.obtener('credenciales', c.id)) || c;
    await pintar();
  };

  async function pintar() {
    contenedor.textContent = '';
    const titulo = nuevo ? 'Nueva credencial' : c.credencial_nombre;
    pantalla(contenedor, { codigo: 'P09', nombre: 'Ficha de credencial', migas: migas.concat([[titulo, !nuevo && tab !== 'quien' ? '#/credencial/' + c.id : undefined]]).concat(tab === 'historial' ? [['Historial']] : tab === 'accesos' ? [['Registro de accesos']] : []) });
    const puedeModificar = puede(u, 'modificar', 'credenciales', orgId);
    const verDirecto = !nuevo && puedeVerSecreto(u, c);
    const puedeCambiarClave = puedeModificar && (nuevo || verDirecto);

    // ---- datos
    const datos = h('div', { class: 'datos' });
    if (editando) {
      const inp = (/** @type {string} */ k, /** @type {string} */ et, /** @type {string} */ tipo) => {
        const i = /** @type {HTMLInputElement} */ (h('input', { type: tipo || 'text', value: ed[k], 'aria-label': et }));
        i.addEventListener('input', () => { ed[k] = i.value; });
        return i;
      };
      const selTipo = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Tipo' }, Object.keys(ROTULO_CREDENCIAL_TIPO).map(k => h('option', { value: k, text: ROTULO_CREDENCIAL_TIPO[k], selected: k === ed.tipo ? 'selected' : null }))));
      selTipo.addEventListener('change', () => { ed.tipo = selTipo.value; });
      const selEq = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Equipo vinculado' }, [h('option', { value: '', text: 'Sin equipo' })].concat(equipos.map(e => h('option', { value: e.id, text: e.equipo_nombre, selected: e.id === ed.equipo ? 'selected' : null })))));
      selEq.addEventListener('change', () => { ed.equipo = selEq.value; });
      const selCf = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Configuración vinculada' }, [h('option', { value: '', text: 'Sin configuración' })].concat(configs.map(x => h('option', { value: x.id, text: x.configuracion_titulo, selected: x.id === ed.config ? 'selected' : null })))));
      selCf.addEventListener('change', () => { ed.config = selCf.value; });
      datos.appendChild(campo('Nombre', inp('nombre', 'Nombre')));
      datos.appendChild(campo('Tipo', selTipo));
      datos.appendChild(campo('Usuario', inp('usuario', 'Usuario')));
      datos.appendChild(campo('Host o URL', inp('host', 'Host o URL')));
      datos.appendChild(campo('Equipo vinculado', selEq));
      datos.appendChild(campo('Configuración vinculada', selCf));
      datos.appendChild(campo('Vence el', inp('vence', 'Vence el', 'date')));
      datos.appendChild(campo('Notas', inp('notas', 'Notas')));
      if (puedeCambiarClave) {
        const i = /** @type {HTMLInputElement} */ (h('input', { type: ed.verSecreto ? 'text' : 'password', value: ed.secreto, autocomplete: 'new-password', 'aria-label': 'Nueva contraseña', placeholder: nuevo ? 'Contraseña' : 'Vacío = no cambia' }));
        i.addEventListener('input', () => { ed.secreto = i.value; });
        const chk = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: ed.verSecreto ? 'checked' : null }));
        chk.addEventListener('change', () => { ed.verSecreto = chk.checked; i.type = chk.checked ? 'text' : 'password'; });
        datos.appendChild(campo(nuevo ? 'Contraseña' : 'Nueva contraseña', h('div', null, [i, h('label', { style: 'display:flex;gap:6px;align-items:center;margin-top:4px;font-size:12.5px' }, [chk, 'Mostrar mientras escribo'])])));
      }
    } else {
      datos.appendChild(campo('Tipo', rotuloTipo(c.credencial_tipo)));
      datos.appendChild(campo('Usuario', c.credencial_usuario || '—'));
      datos.appendChild(campo('Host o URL', c.credencial_url_o_host || '—'));
      datos.appendChild(campo('Equipo vinculado', enlaceEquipo(u, orgId, c.equipo_id ? equipoPorId.get(c.equipo_id) : null)));
      const cf = c.configuracion_id ? configPorId.get(c.configuracion_id) : null;
      datos.appendChild(campo('Configuración vinculada', cf ? (puede(u, 'ver', 'configuraciones', orgId) ? h('a', { href: '#/config/' + cf.id, text: cf.configuracion_titulo }) : cf.configuracion_titulo) : '—'));
      datos.appendChild(campo('Vence el', textoVencimiento(c.credencial_vence_en)));
      datos.appendChild(campo('Notas', c.credencial_notas || '—'));
    }

    const guardar = async () => {
      if (!ed.nombre.trim()) { toast('Escribí el nombre de la credencial.'); return; }
      if (nuevo && !ed.secreto) { toast('Escribí la contraseña de la credencial nueva.'); return; }
      try {
        const base = nuevo ? { organizacion_id: orgId, credencial_notas: null } : c;
        const reg = { ...base, credencial_nombre: ed.nombre.trim(), credencial_tipo: ed.tipo, credencial_usuario: ed.usuario.trim() || null,
          credencial_url_o_host: ed.host.trim() || null, equipo_id: ed.equipo || null, configuracion_id: ed.config || null,
          credencial_vence_en: ed.vence || null, credencial_notas: ed.notas.trim() || null, credencial_secreto: puedeCambiarClave && ed.secreto ? ed.secreto : null };
        const g = await repositorio.guardar('credenciales', reg, u.id);
        toast(nuevo ? 'Credencial creada' : 'Cambios guardados · verificado hoy (' + hoyISO().split('-').reverse().join('/') + ')');
        if (nuevo) { ir('#/credencial/' + g.id); return; }
        editando = false; ed = null; ocultar(); await rerender();
      } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    };
    const botones = editando
      ? [h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: guardar }),
        h('button', { type: 'button', text: 'Cancelar', onclick: () => { if (nuevo) ir('#/credenciales'); else { editando = false; ed = null; pintar(); } } })]
      : [puedeModificar ? h('button', { type: 'button', text: 'Editar', onclick: () => { iniciarEd(); editando = true; pintar(); } }) : null,
        nuevo ? null : await botonBaja({ u, coleccion: 'credenciales', registro: c, modulo: 'credenciales', orgId, nombre: c.credencial_nombre, volver: '#/credenciales', rerender })];
    contenedor.appendChild(fichaCab({ tipo: 'credencial', etiqueta: 'credencial', titulo, datos, botones, modoEdicion: editando, registro: nuevo ? null : c,
      coleccion: 'credenciales', modulo: 'credenciales', u, orgId, umbrales, usuarios: nombreUsuario, rerender }));
    if (nuevo) return;

    // ---- contraseña
    const caja = h('div', { class: 'bloque g1' }, [h('h3', { text: 'Contraseña' })]);
    const msg = h('div');
    if (verDirecto) {
      caja.appendChild(h('div', { class: 'sec', 'aria-live': 'polite', text: valor !== null ? valor : '••••••••' }));
      const acc = h('div', { class: 'herr' });
      acc.appendChild(h('button', { type: 'button', text: valor !== null ? 'Ocultar' : 'Mostrar', onclick: async () => {
        if (valor !== null) { ocultar(); pintar(); return; }
        try {
          valor = await repositorio.usarSecreto(c.id, u.id, 'mostrar');
          temporizador = window.setTimeout(() => { ocultar(); pintar(); }, SEGUNDOS_VISIBLE * 1000);
          pintar();
        } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo mostrar.'); }
      } }));
      acc.appendChild(h('button', { type: 'button', text: 'Copiar', onclick: async () => {
        try {
          const s = await repositorio.usarSecreto(c.id, u.id, 'copiar');
          try { await navigator.clipboard.writeText(s); toast('Contraseña copiada · queda en el registro de accesos'); }
          catch { toast('No se pudo copiar al portapapeles del navegador. El intento quedó en el registro de accesos.'); }
        } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo copiar.'); }
      } }));
      caja.appendChild(acc);
      caja.appendChild(h('div', { class: 'mut', style: 'margin-top:4px', text: u.usuario_perfil === 'superadmin'
        ? 'Cada vez que la mostrás o la copiás queda registrado. Se vuelve a ocultar sola a los ' + SEGUNDOS_VISIBLE + ' segundos.'
        : 'Tenés una aprobación vigente para esta contraseña. Cada vez que la mostrás o la copiás queda registrado.' }));
      caja.appendChild(h('div', { class: 'mut', style: 'margin-top:4px', text: 'Última vez que se cambió: ' + fmtFechaHora(c.credencial_secreto_actualizado_en) }));
    } else {
      caja.appendChild(h('div', { class: 'sec', text: '••••••••' }));
      const pend = await repositorio.listar('solicitudes', s => s.solicitud_tipo === 'ver_secreto' && s.solicitud_estado === 'pendiente' && s.solicitado_por === u.id && s.solicitud_entidad_id === c.id);
      if (pend.length) caja.appendChild(h('div', { class: 'msg', text: 'Ya pediste acceso a esta contraseña el ' + fmtFechaHora(pend[0].solicitado_en) + '. Un rol superior la tiene que revisar; vas a ver el aviso al ingresar.' }));
      else if (puedePedirSecreto(u)) {
        const motivo = /** @type {HTMLInputElement} */ (h('input', { placeholder: 'Motivo (opcional)', 'aria-label': 'Motivo', style: 'width:260px' }));
        caja.appendChild(h('div', { class: 'herr' }, [motivo, h('button', { type: 'button', class: 'primario', text: 'Pedir acceso', onclick: async () => {
          try {
            const r = await repositorio.crearSolicitudVerSecreto({ credencialId: c.id, usuarioId: u.id, motivo: motivo.value });
            toast(r.yaExistia ? 'Ya tenías un pedido pendiente' : 'Solicitud enviada');
            await repintarMarco(); pintar();
          } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo enviar el pedido.'); }
        } })]));
        caja.appendChild(h('div', { class: 'mut', text: 'No tenés acceso a esta contraseña. Pedilo y un rol superior lo aprueba o lo rechaza.' }));
      }
    }
    caja.appendChild(msg);
    contenedor.appendChild(h('div', { style: 'margin-top:10px' }, [caja]));

    // ---- pestañas
    const tabs = /** @type {Array<[string, string]>} */ ([['quien', 'Quién puede ver']]);
    const verHist = puede(u, 'ver_historial', 'credenciales', orgId), verAcc = puede(u, 'ver_registro_accesos', null, orgId);
    if (verHist) tabs.push(['historial', 'Historial']);
    if (verAcc) tabs.push(['accesos', 'Registro de accesos']);
    if ((tab === 'historial' && !verHist) || (tab === 'accesos' && !verAcc)) tab = 'quien';
    contenedor.appendChild(pestanas(tabs, tab, k => { tab = k; history.replaceState(null, '', '#/credencial/' + c.id + '/' + k); pintar(); }));
    const cuerpo = h('div');
    contenedor.appendChild(cuerpo);
    if (tab === 'quien') cuerpo.appendChild(await bloqueQuien());
    else if (tab === 'historial') cuerpo.appendChild(await bloqueHistorial());
    else cuerpo.appendChild(await bloqueAccesos());
  }

  async function bloqueQuien() {
    const caja = h('div', { class: 'bloque' }, [h('h3', { text: 'Quién puede ver esta contraseña hoy' })]);
    const [aprob, credsOrg] = await Promise.all([
      repositorio.listar('solicitudes', s => s.solicitud_tipo === 'ver_secreto' && s.solicitud_estado === 'aprobada' && !s.solicitud_revocada_en && s.organizacion_id === orgId),
      repositorio.listar('credenciales', { organizacion_id: orgId }, { incluirBajas: true })]);
    const tipoDe = new Map(credsOrg.map(x => [x.id, x.credencial_tipo]));
    const vigentes = aprob.filter(s => s.solicitud_alcance === 'tipo_credencial' ? tipoDe.get(s.solicitud_entidad_id) === c.credencial_tipo : s.solicitud_entidad_id === c.id);
    const supers = usuarios.filter(x => x.usuario_perfil === 'superadmin' && x.usuario_estado === 'activo');
    caja.appendChild(h('div', { class: 'mut', style: 'margin-bottom:6px', text: 'Los superadmin la ven siempre' + (supers.length ? ' (' + supers.map(x => x.usuario_nombre).join(', ') + ')' : '') + '. El resto, solo con una aprobación vigente.' }));
    if (!vigentes.length) { caja.appendChild(h('div', { class: 'mut', text: 'Nadie más tiene una aprobación vigente para esta contraseña.' })); return caja; }
    const filas = vigentes.map(s => {
      const titular = usuarios.find(x => x.id === s.solicitado_por);
      const quita = titular && puedeQuitarAprobacion(u, titular);
      return [titular ? titular.usuario_nombre : '?', titular ? ROTULO_PERFIL[titular.usuario_perfil] : '?',
        s.solicitud_alcance === 'tipo_credencial' ? 'Todas las de tipo ' + rotuloTipo(c.credencial_tipo) : 'Solo esta credencial',
        (nombreUsuario.get(s.resuelto_por || '') || '?') + ' · ' + fmtFechaHora(s.resuelto_en),
        h('button', { type: 'button', class: 'chico', text: 'Quitar', disabled: quita ? null : 'disabled', title: quita ? 'Quitar este permiso' : 'Solo un rol superior puede quitarlo', onclick: async () => {
          try { await repositorio.quitarAprobacion(s.id, u.id); toast('Permiso quitado'); await sesion.refrescar(); await repintarMarco(); pintar(); }
          catch (e) { toast(e instanceof Error ? e.message : 'No se pudo quitar.'); }
        } })];
    });
    caja.appendChild(tabla(['Usuario', 'Rol', 'Alcance', 'Aprobó', ''], filas));
    return caja;
  }

  async function bloqueHistorial() {
    const [cambios, todosEq, todasCf] = await Promise.all([
      repositorio.listar('cambios', x => x.cambio_entidad === 'Credencial' && x.entidad_id === c.id, { ordenarPor: 'cambio_fecha', descendente: true }),
      repositorio.listar('equipos', { organizacion_id: orgId }, { incluirBajas: true }), repositorio.listar('configuraciones', { organizacion_id: orgId }, { incluirBajas: true })]);
    const nombres = new Map(todosEq.map(e => [e.id, e.equipo_nombre]).concat(todasCf.map(x => [x.id, x.configuracion_titulo])));
    const caja = h('div');
    if (!cambios.length) { caja.appendChild(h('div', { class: 'mut', text: 'Todavía no hay cambios registrados.' })); return caja; }
    caja.appendChild(tabla(['Fecha', 'Quién', 'Qué', 'Antes', 'Ahora'], cambios.map(x => {
      const op = x.cambio_operacion;
      if (op !== 'modificacion') return [fmtFechaHora(x.cambio_fecha), nombreUsuario.get(x.usuario_id) || '?', op === 'alta' ? 'Alta' : op === 'baja' ? 'Baja' : 'Restauración', '—', op === 'alta' ? 'Creada' : '—'];
      return [fmtFechaHora(x.cambio_fecha), nombreUsuario.get(x.usuario_id) || '?', rotuloCampo(x.cambio_campo),
        x.cambio_valor_oculto ? valorOculto(x) : valorHistorial(x.cambio_valor_anterior, x.cambio_campo, false, nombres),
        x.cambio_valor_oculto ? '••••••••' : valorHistorial(x.cambio_valor_nuevo, x.cambio_campo, false, nombres)];
    })));
    caja.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: 'Los valores anteriores de la contraseña están ocultos.' + (puedeVerSecreto(u, c) ? ' «Mostrar» deja registrado el acceso.' : ' Para verlos hace falta tener acceso a la contraseña.') }));
    return caja;
  }

  /** Valor anterior oculto: «Mostrar» solo con permiso; registra el acceso con el cambio. @param {any} x */
  function valorOculto(x) {
    const span = h('span', { text: '••••••••' });
    if (!puedeVerSecreto(u, c)) return span;
    let visible = false;
    const b = h('button', { type: 'button', class: 'chico', style: 'margin-left:8px', text: 'Mostrar', onclick: async () => {
      if (visible) { visible = false; span.textContent = '••••••••'; b.textContent = 'Mostrar'; return; }
      try {
        const r = await repositorio.usarValorHistorial(x.id, u.id, 'mostrar');
        visible = true; span.textContent = r.anterior == null ? '—' : String(r.anterior); b.textContent = 'Ocultar';
        setTimeout(() => { visible = false; span.textContent = '••••••••'; b.textContent = 'Mostrar'; }, SEGUNDOS_VISIBLE * 1000);
      } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo mostrar.'); }
    } });
    return h('span', null, [span, b]);
  }

  async function bloqueAccesos() {
    const regs = await repositorio.listar('registro_accesos', { credencial_id: c.id }, { ordenarPor: 'registro_fecha', descendente: true });
    const caja = h('div');
    if (!regs.length) { caja.appendChild(h('div', { class: 'mut', text: 'Nadie mostró ni copió esta contraseña todavía.' })); return caja; }
    caja.appendChild(tabla(['Fecha y hora', 'Usuario', 'Acción'], regs.slice(0, 50).map(r => [fmtFechaHora(r.registro_fecha), nombreUsuario.get(r.usuario_id) || '?', r.registro_accion === 'copiar' ? 'Copió la contraseña' : 'Mostró la contraseña'])));
    caja.appendChild(h('div', { class: 'herr' }, [h('a', { href: '#/accesos', text: 'Ver el registro de accesos completo' }), regs.length > 50 ? h('span', { class: 'mut', text: 'Se muestran los 50 más recientes de ' + regs.length + '.' }) : null]));
    return caja;
  }

  await pintar();
}
