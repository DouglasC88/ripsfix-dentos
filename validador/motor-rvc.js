// ═══════════════════════════════════════════════════════════════════════════
// MOTOR DE REGLAS RVC — VALIDACIÓN LOCAL DEL RIPS ANTES DE SUBIRLO A SISPRO
// ═══════════════════════════════════════════════════════════════════════════
// Cada regla es una función pura: recibe el paquete RIPS y un contexto
// (periodo esperado + tablas de referencia) y devuelve una lista de hallazgos
// con el mismo formato que muestra la pantalla "Resultados de Validación del
// Paquete" del MinSalud: Clase, Codigo, Descripcion, Observaciones, PathFuente.
//
// El motor no toca el DOM ni lee archivos: se puede correr en el navegador y
// en Node (tests) con el mismo código.
//
// Las tablas de referencia se INYECTAN por contexto (ctx.tablas). Así el motor
// no arrastra los 2 MB de CUPS/CIE-10 que ya viven en index.html, y una regla
// que no tiene su tabla se reporta como "no evaluable localmente" en vez de
// pasar en silencio y dar una falsa tranquilidad.
//
// FUERA DE ALCANCE LOCAL: RVG01 y FED137 cruzan contra bases del Ministerio
// (BDUA, RUAF, la FEV radicada en la DIAN). Sin conectividad a SISPRO no se
// pueden evaluar y el motor no los simula.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica(require('./periodo.js'));
  else raiz.RipsMotorRVC = fabrica(raiz.RipsPeriodo);
})(typeof self !== 'undefined' ? self : this, function (Periodo) {
  'use strict';

  var RECHAZADO = 'Rechazado';
  var NOTIFICACION = 'Notificación';

  // ── Bloques de servicio del anexo técnico ───────────────────────────────
  // Para cada bloque: el campo que lleva el código de la tecnología en salud
  // y los campos de fecha que deben caer dentro del periodo de prestación.
  // El primer campo de `fechas` es el ancla del registro (el que cuenta como
  // "registro de servicio fuera de periodo").
  var BLOQUES = [
    { clave: 'consultas',      codigo: 'codConsulta',        fechas: ['fechaInicioAtencion'] },
    { clave: 'procedimientos', codigo: 'codProcedimiento',   fechas: ['fechaInicioAtencion'] },
    { clave: 'urgencias',      codigo: null,                 fechas: ['fechaInicioAtencion', 'fechaEgreso'] },
    { clave: 'hospitalizacion',codigo: null,                 fechas: ['fechaInicioAtencion', 'fechaEgreso'] },
    { clave: 'medicamentos',   codigo: 'codTecnologiaSalud', fechas: ['fechaDispensAdmon'] },
    { clave: 'otrosServicios', codigo: 'codTecnologiaSalud', fechas: ['fechaSuministroTecnologia'] },
    { clave: 'recienNacidos',  codigo: null,                 fechas: ['fechaNacimiento'] }
  ];
  var BLOQUE_POR_CLAVE = {};
  BLOQUES.forEach(function (b) { BLOQUE_POR_CLAVE[b.clave] = b; });

  // ── Utilidades ──────────────────────────────────────────────────────────
  function esArreglo(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

  function texto(v) { return v == null ? '' : String(v).trim(); }

  function mostrar(v) {
    var s = texto(v);
    return s === '' ? '(vacío)' : s;
  }

  function claves(tabla) {
    if (!tabla) return null;
    if (typeof tabla.has === 'function') return tabla;         // Set / Map
    if (typeof tabla === 'object') return tabla;
    return null;
  }

  function existeEnTabla(tabla, llave) {
    if (!tabla) return null;
    if (typeof tabla.has === 'function') return tabla.has(llave);
    return Object.prototype.hasOwnProperty.call(tabla, llave);
  }

  function valorDeTabla(tabla, llave) {
    if (!tabla) return undefined;
    if (typeof tabla.get === 'function') return tabla.get(llave);
    return tabla[llave];
  }

  function tablaVacia(tabla) {
    if (!tabla) return true;
    if (typeof tabla.size === 'number') return tabla.size === 0;
    return Object.keys(tabla).length === 0;
  }

  function comoLista(v) {
    if (v == null) return [];
    if (esArreglo(v)) return v;
    if (typeof v.forEach === 'function' && typeof v.size === 'number') { // Set
      var out = []; v.forEach(function (x) { out.push(x); }); return out;
    }
    return [v];
  }

  // Edad del usuario el día de la atención. Devuelve null si falta un dato o
  // si la fecha de nacimiento es posterior a la atención (dato inconsistente).
  function edadEnFecha(fechaNacimiento, fechaAtencion) {
    var nac = Periodo.aDia(fechaNacimiento), att = Periodo.aDia(fechaAtencion);
    if (!Periodo.esDiaValido(nac) || !Periodo.esDiaValido(att)) return null;
    if (nac > att) return null;
    var dias = Periodo.diasEntre(nac, att);
    var a = +nac.slice(0, 4), m = +nac.slice(5, 7), d = +nac.slice(8, 10);
    var a2 = +att.slice(0, 4), m2 = +att.slice(5, 7), d2 = +att.slice(8, 10);
    var anios = a2 - a;
    if (m2 < m || (m2 === m && d2 < d)) anios -= 1;
    return { anios: anios, dias: dias };
  }

  function rutaUsuario(iUsuario) { return 'usuarios[' + iUsuario + ']'; }

  function rutaServicio(iUsuario, bloque, iServicio, campo) {
    var p = rutaUsuario(iUsuario) + '.servicios.' + bloque + '[' + iServicio + ']';
    return campo ? p + '.' + campo : p;
  }

  /**
   * Recorre todos los registros de servicio del paquete en el orden del anexo
   * técnico y llama a `cb` con el contexto de cada uno. Los índices son de base
   * 0, igual que los que reporta el validador oficial ("usuario 0", "usuario 14").
   */
  function recorrerServicios(paquete, cb) {
    var usuarios = (paquete && paquete.usuarios) || [];
    if (!esArreglo(usuarios)) return;
    usuarios.forEach(function (usuario, iUsuario) {
      var servicios = (usuario && usuario.servicios) || {};
      BLOQUES.forEach(function (bloque) {
        var arr = servicios[bloque.clave];
        if (!esArreglo(arr)) return;
        arr.forEach(function (servicio, iServicio) {
          if (servicio == null || typeof servicio !== 'object') return;
          cb({
            paquete: paquete,
            usuario: usuario, iUsuario: iUsuario,
            bloque: bloque.clave, def: bloque,
            servicio: servicio, iServicio: iServicio,
            codigo: bloque.codigo ? texto(servicio[bloque.codigo]) : '',
            campoCodigo: bloque.codigo,
            path: rutaServicio(iUsuario, bloque.clave, iServicio, null)
          });
        });
      });
    });
  }

  function contarServicios(paquete) {
    var n = 0;
    recorrerServicios(paquete, function () { n += 1; });
    return n;
  }

  function hallazgo(regla, clase, observaciones, pathFuente, extra) {
    var h = {
      Clase: clase || regla.clase,
      Codigo: regla.codigo,
      Descripcion: regla.descripcion,
      Observaciones: observaciones,
      PathFuente: pathFuente
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
    return h;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // REGLAS
  // ═══════════════════════════════════════════════════════════════════════
  // `descripcion` es el texto que sale en la columna "Descripción" del
  // reporte. Se puede reemplazar por el literal exacto del validador oficial
  // sin tocar la lógica: ver DESCRIPCIONES al final del archivo.
  // `requiere` lista las tablas de ctx.tablas sin las que la regla no puede
  // evaluarse; si falta alguna, el motor la marca como no evaluable.

  // ── RVC014 ─────────────────────────────────────────────────────────────
  // El hallazgo central de la capitación: la factura va anticipada, el RIPS
  // va atrasado. Cualquier fecha de atención que caiga en el periodo que la
  // factura cubre (o fuera del periodo previo) es un rechazo.
  var RVC014 = {
    codigo: 'RVC014',
    clase: RECHAZADO,
    nombre: 'Fecha de la atención fuera del periodo de prestación',
    descripcion: 'La fecha de la atención debe corresponder al periodo de prestación de servicios que soporta la factura. En pago por capitación ese periodo es el inmediatamente anterior al periodo facturado en la FEV.',
    requiere: [],
    requierePeriodo: true,
    evaluar: function (paquete, ctx) {
      var out = [];
      var periodo = ctx.periodo;
      if (!periodo || !periodo.inicio || !periodo.fin) return out;
      var etqPrev = Periodo.etiqueta(periodo);
      var etqFev = Periodo.etiqueta(periodo.periodoFactura);
      recorrerServicios(paquete, function (reg) {
        reg.def.fechas.forEach(function (campo, iCampo) {
          if (!Object.prototype.hasOwnProperty.call(reg.servicio, campo)) return;
          var bruto = reg.servicio[campo];
          if (texto(bruto) === '') return; // ausencia de fecha es otra regla, no RVC014
          var dia = Periodo.aDia(bruto);
          if (!dia || !Periodo.esDiaValido(dia)) {
            out.push(hallazgo(RVC014, RECHAZADO,
              'El campo ' + campo + ' trae "' + mostrar(bruto) + '", que no es una fecha válida, ' +
              'así que no se puede confirmar que la atención esté dentro del periodo de prestación (' + etqPrev + ').',
              rutaServicio(reg.iUsuario, reg.bloque, reg.iServicio, campo),
              { _regla: 'RVC014', _usuario: reg.iUsuario, _bloque: reg.bloque, _registro: reg.path, _ancla: iCampo === 0 }));
            return;
          }
          if (Periodo.dentroDelPeriodo(dia, periodo)) return;
          var desfase = Periodo.desfaseEnDias(dia, periodo);
          var enPeriodoFacturado = periodo.periodoFactura &&
            Periodo.dentroDelPeriodo(dia, periodo.periodoFactura);
          var detalle = enPeriodoFacturado
            ? 'La fecha cae dentro del periodo que la factura cubre (' + etqFev + '), no en el periodo prestado. ' +
              'En capitación la FEV es anticipada: el RIPS debe traer las atenciones del periodo anterior.'
            : (desfase < 0
              ? 'La atención es ' + Math.abs(desfase) + ' día(s) anterior al inicio del periodo de prestación.'
              : 'La atención es ' + desfase + ' día(s) posterior al fin del periodo de prestación.');
          out.push(hallazgo(RVC014, RECHAZADO,
            campo + ' = ' + dia + ' está fuera del periodo de prestación esperado (' + etqPrev + '). ' + detalle,
            rutaServicio(reg.iUsuario, reg.bloque, reg.iServicio, campo),
            { _regla: 'RVC014', _usuario: reg.iUsuario, _bloque: reg.bloque, _registro: reg.path, _ancla: iCampo === 0 }));
        });
      });
      return out;
    }
  };

  // ── RVC096 ─────────────────────────────────────────────────────────────
  var RVC096 = {
    codigo: 'RVC096',
    clase: RECHAZADO,
    nombre: 'Código CUPS inexistente en la tabla de referencia',
    descripcion: 'El código de la tecnología en salud debe existir en la tabla de referencia CUPSRips vigente.',
    requiere: ['cups'],
    evaluar: function (paquete, ctx) {
      var out = [], tabla = ctx.tablas.cups;
      recorrerServicios(paquete, function (reg) {
        if (!reg.campoCodigo) return;
        var cod = reg.codigo;
        if (cod === '') return; // código ausente lo cubre la validación de obligatoriedad
        if (existeEnTabla(tabla, cod)) return;
        out.push(hallazgo(RVC096, RECHAZADO,
          'El código "' + cod + '" no existe en CUPSRips. Revisa que no le falten ceros a la izquierda ' +
          'ni le sobren separadores; si el código es correcto, la tabla de referencia está desactualizada.',
          rutaServicio(reg.iUsuario, reg.bloque, reg.iServicio, reg.campoCodigo),
          { _regla: 'RVC096', _usuario: reg.iUsuario, _bloque: reg.bloque, _registro: reg.path }));
      });
      return out;
    }
  };

  // ── RVC019 ─────────────────────────────────────────────────────────────
  // Coherencia CUPS ↔ diagnóstico principal. La tabla de referencia da un
  // diagnóstico canónico por CUPS, pero varios diagnósticos pueden ser
  // válidos para el mismo procedimiento: por eso se compara por categoría
  // CIE-10 (los 3 primeros caracteres) y el hallazgo sale como notificación,
  // no como rechazo, salvo que se configure lo contrario.
  var RVC019 = {
    codigo: 'RVC019',
    clase: NOTIFICACION,
    nombre: 'CUPS incoherente con el diagnóstico principal',
    descripcion: 'El código de la tecnología en salud debe ser coherente con el diagnóstico principal reportado en la atención.',
    requiere: ['cupsCie10'],
    evaluar: function (paquete, ctx) {
      var out = [], tabla = ctx.tablas.cupsCie10;
      var largo = ctx.opciones.longitudCategoriaCie10;
      var clase = ctx.opciones.claseRVC019 || RVC019.clase;
      recorrerServicios(paquete, function (reg) {
        if (!reg.campoCodigo) return;
        var cod = reg.codigo;
        if (cod === '') return;
        var esperados = comoLista(valorDeTabla(tabla, cod)).map(function (x) { return texto(x).toUpperCase(); }).filter(Boolean);
        if (!esperados.length) return; // CUPS sin referencia de diagnóstico: nada que afirmar
        var dx = texto(reg.servicio.codDiagnosticoPrincipal).toUpperCase();
        if (dx === '') return;
        var coincide = esperados.some(function (e) {
          return dx === e || dx.slice(0, largo) === e.slice(0, largo);
        });
        if (coincide) return;
        out.push(hallazgo(RVC019, clase,
          'El diagnóstico principal "' + dx + '" no corresponde a la categoría CIE-10 esperada para el CUPS "' + cod +
          '" (referencia: ' + esperados.join(', ') + '). Verifica el diagnóstico antes de radicar: ' +
          'si la atención sí lo justifica, documéntalo; si no, corrígelo.',
          rutaServicio(reg.iUsuario, reg.bloque, reg.iServicio, 'codDiagnosticoPrincipal'),
          { _regla: 'RVC019', _usuario: reg.iUsuario, _bloque: reg.bloque, _registro: reg.path }));
      });
      return out;
    }
  };

  // ── RVC017 ─────────────────────────────────────────────────────────────
  // Coherencia CUPS ↔ cobertura / plan de beneficios. Necesita la tabla de
  // CUPS habilitados por cobertura, que no viene en el paquete: se inyecta.
  var RVC017 = {
    codigo: 'RVC017',
    clase: RECHAZADO,
    nombre: 'CUPS incoherente con la cobertura o plan de beneficios',
    descripcion: 'El código de la tecnología en salud debe estar incluido en la cobertura o plan de beneficios declarado para la atención.',
    requiere: ['cupsPorCobertura'],
    evaluar: function (paquete, ctx) {
      var out = [], tabla = ctx.tablas.cupsPorCobertura;
      var cobertura = texto(ctx.cobertura);
      if (cobertura === '') {
        return [hallazgo(RVC017, NOTIFICACION,
          'No se evaluó: la factura electrónica no declara COBERTURA_PLAN_BENEFICIOS, ' +
          'así que no hay contra qué comparar los CUPS del paquete.',
          'numFactura', { _regla: 'RVC017', _noEvaluable: true })];
      }
      var def = valorDeTabla(tabla, cobertura);
      if (def == null) {
        return [hallazgo(RVC017, NOTIFICACION,
          'No se evaluó: la tabla de CUPS por cobertura no tiene entrada para la cobertura "' + cobertura + '".',
          'numFactura', { _regla: 'RVC017', _noEvaluable: true })];
      }
      var incluidos = claves(def.incluidos != null ? def.incluidos : def);
      var excluidos = def.excluidos ? claves(def.excluidos) : null;
      recorrerServicios(paquete, function (reg) {
        if (!reg.campoCodigo) return;
        var cod = reg.codigo;
        if (cod === '') return;
        var fuera = false, motivo = '';
        if (excluidos && existeEnTabla(excluidos, cod)) {
          fuera = true;
          motivo = 'está excluido expresamente de esa cobertura';
        } else if (incluidos && !tablaVacia(incluidos) && !existeEnTabla(incluidos, cod)) {
          fuera = true;
          motivo = 'no figura entre los CUPS habilitados para esa cobertura';
        }
        if (!fuera) return;
        out.push(hallazgo(RVC017, RVC017.clase,
          'El CUPS "' + cod + '" ' + motivo + ' (cobertura ' + cobertura +
          (def.nombre ? ' — ' + def.nombre : '') + '). El validador rechaza el paquete: ' +
          'corrige el código o factura ese servicio por la cobertura que sí lo incluye.',
          rutaServicio(reg.iUsuario, reg.bloque, reg.iServicio, reg.campoCodigo),
          { _regla: 'RVC017', _usuario: reg.iUsuario, _bloque: reg.bloque, _registro: reg.path }));
      });
      return out;
    }
  };

  // ── RVC051 ─────────────────────────────────────────────────────────────
  // Coherencia finalidad de la tecnología en salud ↔ sexo y edad del usuario.
  // Las restricciones por sexo/edad son datos del anexo técnico, no lógica:
  // se inyectan en ctx.tablas.finalidadRestricciones.
  var RVC051 = {
    codigo: 'RVC051',
    clase: RECHAZADO,
    nombre: 'Finalidad de la tecnología incoherente con el sexo o la edad',
    descripcion: 'La finalidad de la tecnología en salud debe ser coherente con el sexo y la edad del usuario a la fecha de la atención.',
    requiere: ['finalidadRestricciones'],
    evaluar: function (paquete, ctx) {
      var out = [], tabla = ctx.tablas.finalidadRestricciones;
      recorrerServicios(paquete, function (reg) {
        if (!Object.prototype.hasOwnProperty.call(reg.servicio, 'finalidadTecnologiaSalud')) return;
        var fin = texto(reg.servicio.finalidadTecnologiaSalud);
        if (fin === '') return;
        var r = valorDeTabla(tabla, fin);
        if (r == null) return; // finalidad sin restricción de sexo/edad
        var pathFin = rutaServicio(reg.iUsuario, reg.bloque, reg.iServicio, 'finalidadTecnologiaSalud');
        var nombreFin = 'finalidad ' + fin + (r.nombre ? ' (' + r.nombre + ')' : '');

        var sexos = comoLista(r.sexos).map(function (s) { return texto(s).toUpperCase(); }).filter(Boolean);
        if (sexos.length) {
          var sexo = texto(reg.usuario && reg.usuario.codSexo).toUpperCase();
          if (sexo === '') {
            out.push(hallazgo(RVC051, NOTIFICACION,
              'No se pudo evaluar la coherencia por sexo de la ' + nombreFin +
              ': el usuario no trae codSexo.',
              rutaUsuario(reg.iUsuario) + '.codSexo',
              { _regla: 'RVC051', _usuario: reg.iUsuario, _bloque: reg.bloque, _registro: reg.path }));
          } else if (sexos.indexOf(sexo) < 0) {
            out.push(hallazgo(RVC051, RVC051.clase,
              'La ' + nombreFin + ' solo aplica a usuarios de sexo ' + sexos.join(' o ') +
              ', y el usuario está reportado con codSexo "' + sexo + '".',
              pathFin,
              { _regla: 'RVC051', _usuario: reg.iUsuario, _bloque: reg.bloque, _registro: reg.path }));
          }
        }

        var tieneLimiteEdad = r.edadMinAnios != null || r.edadMaxAnios != null;
        if (!tieneLimiteEdad) return;
        var fechaAtencion = reg.servicio[reg.def.fechas[0]];
        var edad = edadEnFecha(reg.usuario && reg.usuario.fechaNacimiento, fechaAtencion);
        if (!edad) {
          out.push(hallazgo(RVC051, NOTIFICACION,
            'No se pudo evaluar la coherencia por edad de la ' + nombreFin +
            ': la fecha de nacimiento del usuario (' + mostrar(reg.usuario && reg.usuario.fechaNacimiento) +
            ') y la fecha de la atención (' + mostrar(fechaAtencion) + ') no permiten calcular la edad.',
            rutaUsuario(reg.iUsuario) + '.fechaNacimiento',
            { _regla: 'RVC051', _usuario: reg.iUsuario, _bloque: reg.bloque, _registro: reg.path }));
          return;
        }
        var rango = (r.edadMinAnios != null ? r.edadMinAnios : 0) + ' a ' +
          (r.edadMaxAnios != null ? r.edadMaxAnios : 'sin límite') + ' años';
        if ((r.edadMinAnios != null && edad.anios < r.edadMinAnios) ||
            (r.edadMaxAnios != null && edad.anios > r.edadMaxAnios)) {
          out.push(hallazgo(RVC051, RVC051.clase,
            'La ' + nombreFin + ' aplica a usuarios de ' + rango +
            ', y el usuario tenía ' + edad.anios + ' año(s) el día de la atención.',
            pathFin,
            { _regla: 'RVC051', _usuario: reg.iUsuario, _bloque: reg.bloque, _registro: reg.path }));
        }
      });
      return out;
    }
  };

  // ── RVC059 ─────────────────────────────────────────────────────────────
  // Coherencia CUPS ↔ grupo de servicios / finalidad / causa externa.
  // Dos fuentes posibles, ambas inyectadas: la tabla de combinaciones válidas
  // (cupsGrupoServicio) y, como apoyo, la derivación de codServicio por CUPS
  // que ya usa el generador (cupsCodServicio).
  var RVC059 = {
    codigo: 'RVC059',
    clase: RECHAZADO,
    nombre: 'CUPS incoherente con grupo de servicios, finalidad o causa',
    descripcion: 'El código de la tecnología en salud debe ser coherente con el grupo de servicios, el servicio, la finalidad de la tecnología y la causa que motiva la atención.',
    requiere: ['cupsGrupoServicio|cupsCodServicio'],
    evaluar: function (paquete, ctx) {
      var out = [];
      var tGrupo = ctx.tablas.cupsGrupoServicio;
      var tServ = ctx.tablas.cupsCodServicio;
      recorrerServicios(paquete, function (reg) {
        if (!reg.campoCodigo) return;
        var cod = reg.codigo;
        if (cod === '') return;

        var def = tGrupo ? valorDeTabla(tGrupo, cod) : null;
        if (def) {
          [['grupos', 'grupoServicios', 'grupo de servicios'],
           ['finalidades', 'finalidadTecnologiaSalud', 'finalidad de la tecnología'],
           ['causas', 'causaMotivoAtencion', 'causa que motiva la atención']
          ].forEach(function (par) {
            var permitidos = comoLista(def[par[0]]).map(texto).filter(Boolean);
            if (!permitidos.length) return;
            if (!Object.prototype.hasOwnProperty.call(reg.servicio, par[1])) return;
            var val = texto(reg.servicio[par[1]]);
            if (val === '' || permitidos.indexOf(val) >= 0) return;
            out.push(hallazgo(RVC059, RVC059.clase,
              'El CUPS "' + cod + '" no admite ' + par[2] + ' "' + val + '"; los valores válidos son ' +
              permitidos.join(', ') + '.',
              rutaServicio(reg.iUsuario, reg.bloque, reg.iServicio, par[1]),
              { _regla: 'RVC059', _usuario: reg.iUsuario, _bloque: reg.bloque, _registro: reg.path }));
          });
        }

        // codServicio: la tabla de derivación por CUPS dice cuál corresponde.
        if (tServ && Object.prototype.hasOwnProperty.call(reg.servicio, 'codServicio')) {
          var esperado = valorDeTabla(tServ, cod);
          if (esperado != null) {
            var declarado = texto(reg.servicio.codServicio);
            if (declarado !== '' && declarado !== texto(esperado)) {
              out.push(hallazgo(RVC059, NOTIFICACION,
                'El CUPS "' + cod + '" corresponde al servicio ' + texto(esperado) +
                ' según la tabla de referencia, y el registro declara codServicio ' + declarado +
                '. Revisa el grupo/servicio antes de radicar.',
                rutaServicio(reg.iUsuario, reg.bloque, reg.iServicio, 'codServicio'),
                { _regla: 'RVC059', _usuario: reg.iUsuario, _bloque: reg.bloque, _registro: reg.path }));
            }
          }
        }
      });
      return out;
    }
  };

  var REGLAS = [RVC014, RVC017, RVC019, RVC051, RVC059, RVC096];
  var REGLAS_POR_CODIGO = {};
  REGLAS.forEach(function (r) { REGLAS_POR_CODIGO[r.codigo] = r; });

  // Reglas que dependen de bases del Ministerio: se listan para que el reporte
  // diga expresamente que quedan pendientes de la validación oficial.
  var FUERA_DE_ALCANCE = [
    { codigo: 'RVG01', motivo: 'cruza el documento del usuario contra BDUA/RUAF en las bases del Ministerio.' },
    { codigo: 'FED137', motivo: 'cruza el paquete contra la factura electrónica radicada ante la DIAN.' }
  ];

  // ═══════════════════════════════════════════════════════════════════════
  // EJECUTOR
  // ═══════════════════════════════════════════════════════════════════════
  function normalizarContexto(ctx) {
    ctx = ctx || {};
    var opciones = ctx.opciones || {};
    var periodo = ctx.periodo;
    // El periodo se puede pasar ya calculado o dejar que el motor lo derive
    // del InvoicePeriod de la FEV.
    if (!periodo && ctx.fev) {
      var fev = ctx.fev.periodo || ctx.fev.invoicePeriod || ctx.fev;
      periodo = Periodo.calcularPeriodoAnterior(fev, { estrategia: opciones.estrategiaPeriodo });
    }
    if (periodo && periodo.valido === false) periodo = periodo; // se conserva el motivo
    return {
      periodo: periodo || null,
      fev: ctx.fev || null,
      cobertura: ctx.cobertura != null ? ctx.cobertura :
        (ctx.fev ? (ctx.fev.cobertura || ctx.fev.coberturaId) : null),
      tablas: ctx.tablas || {},
      opciones: {
        estrategiaPeriodo: opciones.estrategiaPeriodo || Periodo.ESTRATEGIA_POR_DEFECTO,
        longitudCategoriaCie10: opciones.longitudCategoriaCie10 || 3,
        claseRVC019: opciones.claseRVC019 || null,
        reportarNoEvaluables: opciones.reportarNoEvaluables !== false,
        reglas: opciones.reglas || ctx.reglas || null
      }
    };
  }

  // Una regla es evaluable si están todas sus tablas requeridas. En `requiere`
  // un item con "|" significa "cualquiera de estas sirve".
  function tablasFaltantes(regla, tablas) {
    var faltan = [];
    (regla.requiere || []).forEach(function (req) {
      var alternativas = String(req).split('|');
      var alguna = alternativas.some(function (nombre) {
        return !tablaVacia(tablas[nombre]);
      });
      if (!alguna) faltan.push(alternativas.join(' o '));
    });
    return faltan;
  }

  /**
   * Corre las reglas sobre un paquete RIPS.
   *
   * @param {Object} paquete RIPS con la estructura del anexo técnico.
   * @param {Object} ctx
   *   ctx.fev       {numFactura, periodo:{inicio,fin}, cobertura} — o ctx.periodo ya calculado
   *   ctx.tablas    {cups, cupsCie10, cupsPorCobertura, finalidadRestricciones,
   *                  cupsGrupoServicio, cupsCodServicio}
   *   ctx.opciones  {estrategiaPeriodo, longitudCategoriaCie10, claseRVC019,
   *                  reportarNoEvaluables, reglas:[códigos]}
   * @returns {Object} resultado listo para el reporte
   */
  function validar(paquete, ctx) {
    var c = normalizarContexto(ctx);
    var seleccion = c.opciones.reglas;
    var hallazgos = [], evaluadas = [], noEvaluables = [];

    REGLAS.forEach(function (regla) {
      if (seleccion && seleccion.indexOf(regla.codigo) < 0) return;

      if (regla.requierePeriodo && (!c.periodo || !c.periodo.inicio || !c.periodo.fin)) {
        noEvaluables.push({
          codigo: regla.codigo, nombre: regla.nombre,
          motivo: (c.periodo && c.periodo.motivo) ||
            'no se pudo determinar el periodo de prestación esperado: falta el InvoicePeriod de la factura electrónica.'
        });
        return;
      }
      var faltan = tablasFaltantes(regla, c.tablas);
      if (faltan.length) {
        noEvaluables.push({
          codigo: regla.codigo, nombre: regla.nombre,
          motivo: 'falta la tabla de referencia ' + faltan.join(', ') + ' en el contexto.'
        });
        return;
      }
      var propios = regla.evaluar(paquete, c) || [];
      evaluadas.push({ codigo: regla.codigo, nombre: regla.nombre, hallazgos: propios.length });
      hallazgos = hallazgos.concat(propios);
    });

    if (c.opciones.reportarNoEvaluables) {
      noEvaluables.forEach(function (ne) {
        var regla = REGLAS_POR_CODIGO[ne.codigo];
        hallazgos.push(hallazgo(regla, NOTIFICACION,
          'Regla no evaluada localmente: ' + ne.motivo + ' Este paquete puede fallar por ' +
          ne.codigo + ' en la validación oficial sin que este reporte lo anticipe.',
          'numFactura', { _regla: ne.codigo, _noEvaluable: true }));
      });
      FUERA_DE_ALCANCE.forEach(function (f) {
        hallazgos.push({
          Clase: NOTIFICACION, Codigo: f.codigo,
          Descripcion: 'Regla que depende de bases de datos externas del Ministerio.',
          Observaciones: 'No evaluable sin conectividad a SISPRO: ' + f.motivo +
            ' Queda pendiente de la validación oficial.',
          PathFuente: 'numFactura', _regla: f.codigo, _noEvaluable: true, _fueraDeAlcance: true
        });
      });
    }

    return {
      paquete: {
        numDocumentoIdObligado: paquete && paquete.numDocumentoIdObligado,
        numFactura: paquete && paquete.numFactura,
        usuarios: (paquete && esArreglo(paquete.usuarios)) ? paquete.usuarios.length : 0,
        servicios: contarServicios(paquete)
      },
      fev: c.fev ? { numFactura: c.fev.numFactura || c.fev.nF || null } : null,
      periodo: c.periodo,
      estrategiaPeriodo: c.opciones.estrategiaPeriodo,
      hallazgos: hallazgos,
      reglasEvaluadas: evaluadas,
      reglasNoEvaluables: noEvaluables,
      resumen: resumir(hallazgos)
    };
  }

  function resumir(hallazgos) {
    var r = { total: hallazgos.length, rechazados: 0, notificaciones: 0, porRegla: {} };
    hallazgos.forEach(function (h) {
      if (h.Clase === RECHAZADO) r.rechazados += 1; else r.notificaciones += 1;
      var cod = h.Codigo;
      var e = r.porRegla[cod] || (r.porRegla[cod] = {
        codigo: cod, total: 0, rechazados: 0, notificaciones: 0,
        usuarios: {}, registros: {}, nUsuarios: 0, nRegistros: 0
      });
      e.total += 1;
      if (h.Clase === RECHAZADO) e.rechazados += 1; else e.notificaciones += 1;
      if (h._usuario != null && !e.usuarios[h._usuario]) { e.usuarios[h._usuario] = true; e.nUsuarios += 1; }
      if (h._registro && !e.registros[h._registro]) { e.registros[h._registro] = true; e.nRegistros += 1; }
    });
    return r;
  }

  /**
   * Cuántos hallazgos de RVC014 saldrían con cada estrategia de periodo.
   * Sirve para decidir empíricamente cuál corresponde al contrato, sin tener
   * que adivinar: se corre sobre un paquete que ya se sabe cómo cerró.
   */
  function diagnosticarPeriodo(paquete, periodoFEV) {
    return Periodo.ESTRATEGIAS.map(function (estrategia) {
      var res = validar(paquete, {
        fev: { periodo: periodoFEV },
        opciones: { estrategiaPeriodo: estrategia, reglas: ['RVC014'], reportarNoEvaluables: false }
      });
      var e = res.resumen.porRegla.RVC014;
      return {
        estrategia: estrategia,
        periodo: res.periodo ? { inicio: res.periodo.inicio, fin: res.periodo.fin } : null,
        hallazgos: res.resumen.total,
        registros: e ? e.nRegistros : 0,
        usuarios: e ? e.nUsuarios : 0
      };
    });
  }

  return {
    RECHAZADO: RECHAZADO,
    NOTIFICACION: NOTIFICACION,
    BLOQUES: BLOQUES,
    REGLAS: REGLAS,
    REGLAS_POR_CODIGO: REGLAS_POR_CODIGO,
    FUERA_DE_ALCANCE: FUERA_DE_ALCANCE,
    Periodo: Periodo,
    validar: validar,
    diagnosticarPeriodo: diagnosticarPeriodo,
    recorrerServicios: recorrerServicios,
    contarServicios: contarServicios,
    edadEnFecha: edadEnFecha,
    rutaServicio: rutaServicio
  };
});
