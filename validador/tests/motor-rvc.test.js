// ═══════════════════════════════════════════════════════════════════════════
// Tests del motor de reglas RVC.
// ═══════════════════════════════════════════════════════════════════════════
// El caso que manda es el paquete de capitación de 57 usuarios: 109 registros
// de servicio con la fecha fuera del periodo prestado, de los que el validador
// oficial solo señaló 3 usuarios. El motor local tiene que listar los 109.
'use strict';
var test = require('node:test');
var assert = require('node:assert/strict');
var Motor = require('../motor-rvc.js');
var Tablas = require('../tablas-referencia.js');
var Fixture = require('./fixtures/generar-rips-capitacion.js');
var PAQUETE_57 = require('./fixtures/rips-capitacion-57usuarios.json');

// Tablas mínimas para que las reglas de código sean evaluables en los tests
// sin cargar los 2 MB de CUPS_DATA del index.html.
var CUPS_REF = {
  '890203': 1, '890303': 1, '890224': 1,
  '237101': 1, '242103': 1, '233101': 1, '231100': 1
};
var CUPS_CIE10_REF = {
  '890203': 'K021', '890303': 'K021', '890224': 'K088',
  '237101': 'K040', '242103': 'K053', '233101': 'K083', '231100': 'K029'
};

function contexto(extra) {
  extra = extra || {};
  return {
    fev: {
      numFactura: Fixture.FEV.numFactura,
      periodo: Fixture.FEV.periodo,
      cobertura: Fixture.FEV.cobertura
    },
    tablas: extra.tablas || {},
    opciones: Object.assign({ reportarNoEvaluables: false }, extra.opciones || {})
  };
}

function hallazgosDe(resultado, codigo) {
  return resultado.hallazgos.filter(function (h) { return h.Codigo === codigo; });
}

// ── Estructura del hallazgo ───────────────────────────────────────────────
test('cada hallazgo trae las cinco columnas del reporte oficial', function () {
  var r = Motor.validar(PAQUETE_57, contexto());
  assert.ok(r.hallazgos.length > 0);
  r.hallazgos.forEach(function (h) {
    ['Clase', 'Codigo', 'Descripcion', 'Observaciones', 'PathFuente'].forEach(function (c) {
      assert.equal(typeof h[c], 'string', c + ' debe venir como texto');
      assert.notEqual(h[c], '', c + ' no puede ir vacío');
    });
    assert.ok(h.Clase === Motor.RECHAZADO || h.Clase === Motor.NOTIFICACION, h.Clase);
  });
});

test('las reglas son funciones puras: no mutan el paquete ni el contexto', function () {
  var antes = JSON.stringify(PAQUETE_57);
  var ctx = contexto({ tablas: { cups: CUPS_REF, cupsCie10: CUPS_CIE10_REF } });
  var ctxAntes = JSON.stringify(ctx);
  Motor.validar(PAQUETE_57, ctx);
  Motor.validar(PAQUETE_57, ctx);
  assert.equal(JSON.stringify(PAQUETE_57), antes, 'el paquete quedó modificado');
  assert.equal(JSON.stringify(ctx), ctxAntes, 'el contexto quedó modificado');
});

test('correr dos veces el mismo paquete da exactamente el mismo resultado', function () {
  var a = Motor.validar(PAQUETE_57, contexto());
  var b = Motor.validar(PAQUETE_57, contexto());
  assert.deepEqual(a.hallazgos, b.hallazgos);
});

// ── RVC014: el caso real de 57 usuarios ──────────────────────────────────
test('el fixture reproduce el paquete real: 57 usuarios y 225 registros', function () {
  var r = Motor.validar(PAQUETE_57, contexto());
  assert.equal(r.paquete.usuarios, Fixture.TOTAL_USUARIOS);
  assert.equal(r.paquete.usuarios, 57);
  assert.equal(r.paquete.servicios, 225);
  assert.equal(r.paquete.servicios, Motor.contarServicios(PAQUETE_57));
});

test('RVC014 detecta los 109 registros fuera de periodo, no una muestra', function () {
  var r = Motor.validar(PAQUETE_57, contexto());
  var h = hallazgosDe(r, 'RVC014');
  assert.equal(h.length, Fixture.TOTAL_FUERA_DE_PERIODO);
  assert.equal(h.length, 109);
  var e = r.resumen.porRegla.RVC014;
  assert.equal(e.nRegistros, 109, 'un registro de servicio por hallazgo');
  assert.equal(e.rechazados, 109, 'RVC014 siempre es rechazo');
});

test('RVC014 abarca a los 42 usuarios afectados, no solo a los 3 que reportó SISPRO', function () {
  var r = Motor.validar(PAQUETE_57, contexto());
  var e = r.resumen.porRegla.RVC014;
  assert.equal(e.nUsuarios, 42);
  // Los usuarios que sí señaló el validador oficial tienen que estar dentro…
  Fixture.USUARIOS_SENALADOS_POR_SISPRO.forEach(function (u) {
    assert.ok(e.usuarios[u], 'falta el usuario ' + u + ', que SISPRO sí señaló');
  });
  // …y el motor tiene que ir bastante más allá de esa muestra.
  assert.ok(e.nUsuarios > Fixture.USUARIOS_SENALADOS_POR_SISPRO.length * 10,
    'el motor no debería quedarse en la muestra del validador oficial');
});

test('RVC014 no marca las atenciones que sí están dentro del periodo prestado', function () {
  var r = Motor.validar(PAQUETE_57, contexto());
  var marcados = {};
  hallazgosDe(r, 'RVC014').forEach(function (h) { marcados[h.PathFuente] = h; });
  var dentro = 0;
  Motor.recorrerServicios(PAQUETE_57, function (reg) {
    var dia = String(reg.servicio.fechaInicioAtencion || '').slice(0, 10);
    if (dia >= Fixture.PERIODO_PRESTADO.inicio && dia <= Fixture.PERIODO_PRESTADO.fin) {
      dentro++;
      var path = reg.path + '.fechaInicioAtencion';
      assert.equal(marcados[path], undefined, 'falso positivo en ' + path);
    }
  });
  assert.equal(dentro + 109, Motor.contarServicios(PAQUETE_57),
    'todo registro cae dentro o fuera del periodo, sin zona gris');
});

test('el PathFuente de RVC014 apunta al campo exacto con índices de base 0', function () {
  var r = Motor.validar(PAQUETE_57, contexto());
  hallazgosDe(r, 'RVC014').forEach(function (h) {
    assert.match(h.PathFuente,
      /^usuarios\[\d+\]\.servicios\.(consultas|procedimientos|urgencias|hospitalizacion|medicamentos|otrosServicios|recienNacidos)\[\d+\]\.\w+$/);
  });
  var u14 = hallazgosDe(r, 'RVC014').filter(function (h) {
    return h.PathFuente.indexOf('usuarios[14].') === 0;
  });
  assert.equal(u14.length, 3, 'el usuario 14 tiene 3 registros fuera de periodo');
});

test('RVC014 distingue la atención que cayó en el periodo que la factura factura', function () {
  var r = Motor.validar(PAQUETE_57, contexto());
  var enFacturado = hallazgosDe(r, 'RVC014').filter(function (h) {
    return /dentro del periodo que la factura cubre/.test(h.Observaciones);
  });
  var fuera = hallazgosDe(r, 'RVC014').filter(function (h) {
    return /día\(s\) (anterior|posterior)/.test(h.Observaciones);
  });
  assert.ok(enFacturado.length > 0, 'las fechas de agosto son el error típico de capitación');
  assert.ok(fuera.length > 0, 'las fechas de junio quedan por fuera del periodo prestado');
  assert.equal(enFacturado.length + fuera.length, 109);
});

test('el desfase de numFactura entre RIPS y FEV no genera ningún hallazgo', function () {
  var r = Motor.validar(PAQUETE_57, contexto());
  assert.equal(PAQUETE_57.numFactura, 'FE8');
  assert.equal(Fixture.FEV.numFactura, 'FE10');
  assert.notEqual(PAQUETE_57.numFactura, Fixture.FEV.numFactura);
  var sobreFactura = r.hallazgos.filter(function (h) {
    return /numFactura/i.test(h.Observaciones);
  });
  assert.equal(sobreFactura.length, 0, 'en capitación el desfase de factura es normal');
});

test('sin InvoicePeriod, RVC014 se declara no evaluable en vez de aprobar el paquete', function () {
  var r = Motor.validar(PAQUETE_57, { fev: { numFactura: 'FE10' }, tablas: {} });
  assert.equal(hallazgosDe(r, 'RVC014').filter(function (h) { return !h._noEvaluable; }).length, 0);
  var ne = r.reglasNoEvaluables.filter(function (x) { return x.codigo === 'RVC014'; });
  assert.equal(ne.length, 1);
  assert.match(ne[0].motivo, /InvoicePeriod|periodo/);
  // Y queda dicho en el reporte, no escondido en el resultado.
  var aviso = hallazgosDe(r, 'RVC014').filter(function (h) { return h._noEvaluable; });
  assert.equal(aviso.length, 1);
  assert.equal(aviso[0].Clase, Motor.NOTIFICACION);
});

test('una fecha corrupta se rechaza por RVC014 en vez de pasar de largo', function () {
  var paquete = {
    numFactura: 'FE8',
    usuarios: [{ codSexo: 'F', fechaNacimiento: '1990-01-01', servicios: {
      consultas: [{ codConsulta: '890203', fechaInicioAtencion: 'sin fecha' }]
    } }]
  };
  var r = Motor.validar(paquete, contexto());
  var h = hallazgosDe(r, 'RVC014');
  assert.equal(h.length, 1);
  assert.equal(h[0].Clase, Motor.RECHAZADO);
  assert.match(h[0].Observaciones, /no es una fecha válida/);
});

test('una fecha ausente no es asunto de RVC014', function () {
  var paquete = {
    numFactura: 'FE8',
    usuarios: [{ servicios: { consultas: [{ codConsulta: '890203' }] } }]
  };
  assert.equal(hallazgosDe(Motor.validar(paquete, contexto()), 'RVC014').length, 0);
});

test('RVC014 revisa también fechaEgreso, no solo la fecha de inicio', function () {
  var paquete = {
    numFactura: 'FE8',
    usuarios: [{ servicios: { hospitalizacion: [
      { fechaInicioAtencion: '2026-07-28 08:00', fechaEgreso: '2026-08-03 10:00' }
    ] } }]
  };
  var h = hallazgosDe(Motor.validar(paquete, contexto()), 'RVC014');
  assert.equal(h.length, 1);
  assert.match(h[0].PathFuente, /fechaEgreso$/);
});

test('RVC014 revisa medicamentos y otros servicios con su propio campo de fecha', function () {
  var paquete = {
    numFactura: 'FE8',
    usuarios: [{ servicios: {
      medicamentos: [{ codTecnologiaSalud: 'M01', fechaDispensAdmon: '2026-08-05 09:00' }],
      otrosServicios: [{ codTecnologiaSalud: 'O01', fechaSuministroTecnologia: '2026-08-06 09:00' }]
    } }]
  };
  var h = hallazgosDe(Motor.validar(paquete, contexto()), 'RVC014');
  assert.equal(h.length, 2);
  assert.deepEqual(h.map(function (x) { return x.PathFuente; }).sort(), [
    'usuarios[0].servicios.medicamentos[0].fechaDispensAdmon',
    'usuarios[0].servicios.otrosServicios[0].fechaSuministroTecnologia'
  ]);
});

test('diagnosticarPeriodo muestra qué pasaría con cada estrategia', function () {
  var d = Motor.diagnosticarPeriodo(PAQUETE_57, Fixture.FEV.periodo);
  var porNombre = {};
  d.forEach(function (x) { porNombre[x.estrategia] = x; });
  assert.deepEqual(porNombre.mesAnterior.periodo, { inicio: '2026-07-01', fin: '2026-07-31' });
  assert.equal(porNombre.mesAnterior.registros, 109);
  // Para una FEV de mes calendario completo ambas estrategias coinciden: es la
  // comprobación de que el supuesto por defecto no cambia nada en este caso.
  assert.deepEqual(porNombre.ventanaPrevia.periodo, { inicio: '2026-07-01', fin: '2026-07-31' });
  assert.equal(porNombre.ventanaPrevia.registros, 109);
});

// ── RVC096 ────────────────────────────────────────────────────────────────
test('RVC096 rechaza el CUPS que no existe en la tabla de referencia', function () {
  var r = Motor.validar(PAQUETE_57, contexto({ tablas: { cups: CUPS_REF } }));
  var h = hallazgosDe(r, 'RVC096');
  assert.equal(h.length, 1);
  assert.equal(h[0].Clase, Motor.RECHAZADO);
  assert.match(h[0].Observaciones, /999999/);
  assert.equal(h[0].PathFuente, 'usuarios[2].servicios.procedimientos[' +
    (PAQUETE_57.usuarios[2].servicios.procedimientos.length - 1) + '].codProcedimiento');
});

test('sin tabla CUPS, RVC096 queda como no evaluable y se dice en el reporte', function () {
  var r = Motor.validar(PAQUETE_57, contexto());
  assert.equal(hallazgosDe(r, 'RVC096').length, 0);
  assert.ok(r.reglasNoEvaluables.some(function (x) { return x.codigo === 'RVC096'; }));
});

// ── RVC019 ────────────────────────────────────────────────────────────────
test('RVC019 notifica el diagnóstico ajeno a la categoría CIE-10 del CUPS', function () {
  var r = Motor.validar(PAQUETE_57, contexto({ tablas: { cupsCie10: CUPS_CIE10_REF } }));
  var h = hallazgosDe(r, 'RVC019');
  assert.equal(h.length, 1, 'solo el defecto sembrado en el usuario 3');
  assert.equal(h[0].Clase, Motor.NOTIFICACION);
  assert.match(h[0].Observaciones, /J039/);
  assert.match(h[0].PathFuente, /^usuarios\[3\]\..*codDiagnosticoPrincipal$/);
});

test('RVC019 acepta otro diagnóstico de la misma categoría CIE-10', function () {
  var paquete = {
    numFactura: 'FE8',
    usuarios: [{ servicios: { procedimientos: [
      // K041 en vez del K040 de referencia: misma categoría K04, es coherente.
      { codProcedimiento: '237101', codDiagnosticoPrincipal: 'K041', fechaInicioAtencion: '2026-07-10 08:00' }
    ] } }]
  };
  var r = Motor.validar(paquete, contexto({ tablas: { cupsCie10: CUPS_CIE10_REF } }));
  assert.equal(hallazgosDe(r, 'RVC019').length, 0);
});

test('RVC019 puede endurecerse a rechazo por configuración', function () {
  var r = Motor.validar(PAQUETE_57, contexto({
    tablas: { cupsCie10: CUPS_CIE10_REF },
    opciones: { claseRVC019: Motor.RECHAZADO }
  }));
  assert.equal(hallazgosDe(r, 'RVC019')[0].Clase, Motor.RECHAZADO);
});

test('RVC019 no opina cuando el CUPS no tiene diagnóstico de referencia', function () {
  var paquete = {
    numFactura: 'FE8',
    usuarios: [{ servicios: { procedimientos: [
      { codProcedimiento: '111111', codDiagnosticoPrincipal: 'Z000', fechaInicioAtencion: '2026-07-10 08:00' }
    ] } }]
  };
  var r = Motor.validar(paquete, contexto({ tablas: { cupsCie10: CUPS_CIE10_REF } }));
  assert.equal(hallazgosDe(r, 'RVC019').length, 0);
});

// ── RVC017 ────────────────────────────────────────────────────────────────
test('RVC017 rechaza el CUPS que no está en la cobertura declarada por la FEV', function () {
  var r = Motor.validar(PAQUETE_57, contexto({
    tablas: { cupsPorCobertura: { '17': {
      nombre: 'UPC Subsidiado',
      incluidos: Tablas.indice(['890203', '890303', '890224', '242103', '233101', '231100', '999999'])
    } } }
  }));
  var h = hallazgosDe(r, 'RVC017');
  assert.ok(h.length > 0, '237101 quedó fuera de los incluidos');
  h.forEach(function (x) {
    assert.equal(x.Clase, Motor.RECHAZADO);
    assert.match(x.Observaciones, /237101/);
    assert.match(x.Observaciones, /UPC Subsidiado/);
  });
});

test('RVC017 soporta el contrato "todo incluido salvo estos códigos"', function () {
  var r = Motor.validar(PAQUETE_57, contexto({
    tablas: { cupsPorCobertura: { '17': { incluidos: {}, excluidos: Tablas.indice(['999999']) } } }
  }));
  var h = hallazgosDe(r, 'RVC017');
  assert.equal(h.length, 1);
  assert.match(h[0].Observaciones, /excluido expresamente/);
});

test('RVC017 avisa cuando la FEV no declara cobertura, en vez de aprobar', function () {
  var r = Motor.validar(PAQUETE_57, {
    fev: { numFactura: 'FE10', periodo: Fixture.FEV.periodo },
    tablas: { cupsPorCobertura: { '17': { incluidos: Tablas.indice(['890203']) } } },
    opciones: { reportarNoEvaluables: false }
  });
  var h = hallazgosDe(r, 'RVC017');
  assert.equal(h.length, 1);
  assert.equal(h[0].Clase, Motor.NOTIFICACION);
  assert.match(h[0].Observaciones, /COBERTURA_PLAN_BENEFICIOS/);
});

// ── RVC051 ────────────────────────────────────────────────────────────────
test('RVC051 rechaza la finalidad que no corresponde al sexo del usuario', function () {
  var paquete = {
    numFactura: 'FE8',
    usuarios: [{ codSexo: 'M', fechaNacimiento: '1990-05-10', servicios: { consultas: [
      { codConsulta: '890203', finalidadTecnologiaSalud: '07', fechaInicioAtencion: '2026-07-10 08:00' }
    ] } }]
  };
  var r = Motor.validar(paquete, contexto({ tablas: { finalidadRestricciones: {
    '07': { nombre: 'control prenatal', sexos: ['F'] }
  } } }));
  var h = hallazgosDe(r, 'RVC051');
  assert.equal(h.length, 1);
  assert.equal(h[0].Clase, Motor.RECHAZADO);
  assert.match(h[0].Observaciones, /sexo F/);
  assert.match(h[0].PathFuente, /finalidadTecnologiaSalud$/);
});

test('RVC051 rechaza la finalidad fuera del rango de edad, calculada al día de la atención', function () {
  var paquete = {
    numFactura: 'FE8',
    usuarios: [{ codSexo: 'F', fechaNacimiento: '2015-07-20', servicios: { consultas: [
      // Cumple 11 años el 20 de julio: el día 10 todavía tiene 10 años.
      { codConsulta: '890203', finalidadTecnologiaSalud: '05', fechaInicioAtencion: '2026-07-10 08:00' },
      { codConsulta: '890203', finalidadTecnologiaSalud: '05', fechaInicioAtencion: '2026-07-25 08:00' }
    ] } }]
  };
  var r = Motor.validar(paquete, contexto({ tablas: { finalidadRestricciones: {
    '05': { nombre: 'crecimiento y desarrollo del menor', edadMaxAnios: 10 }
  } } }));
  var h = hallazgosDe(r, 'RVC051');
  assert.equal(h.length, 1, 'solo la atención posterior al cumpleaños queda fuera de rango');
  assert.match(h[0].PathFuente, /consultas\[1\]/);
  assert.match(h[0].Observaciones, /11 año/);
});

test('RVC051 notifica en vez de rechazar cuando falta el dato para evaluar', function () {
  var paquete = {
    numFactura: 'FE8',
    usuarios: [{ servicios: { consultas: [
      { codConsulta: '890203', finalidadTecnologiaSalud: '05', fechaInicioAtencion: '2026-07-10 08:00' },
      { codConsulta: '890203', finalidadTecnologiaSalud: '07', fechaInicioAtencion: '2026-07-10 08:00' }
    ] } }]
  };
  var r = Motor.validar(paquete, contexto({ tablas: { finalidadRestricciones: {
    '05': { nombre: 'menor', edadMaxAnios: 10 },
    '07': { nombre: 'prenatal', sexos: ['F'] }
  } } }));
  var h = hallazgosDe(r, 'RVC051');
  assert.equal(h.length, 2);
  h.forEach(function (x) {
    assert.equal(x.Clase, Motor.NOTIFICACION);
    assert.match(x.Observaciones, /No se pudo evaluar/);
  });
});

test('RVC051 no dice nada de las finalidades sin restricción de sexo ni edad', function () {
  var r = Motor.validar(PAQUETE_57, contexto({ tablas: { finalidadRestricciones: {
    '07': { nombre: 'prenatal', sexos: ['F'] }
  } } }));
  assert.equal(hallazgosDe(r, 'RVC051').length, 0, 'el fixture solo usa la finalidad 15');
});

test('edadEnFecha respeta el cumpleaños y descarta fechas imposibles', function () {
  assert.equal(Motor.edadEnFecha('2015-07-20', '2026-07-19').anios, 10);
  assert.equal(Motor.edadEnFecha('2015-07-20', '2026-07-20').anios, 11);
  assert.equal(Motor.edadEnFecha('2027-01-01', '2026-07-20'), null, 'nacer después de la atención');
  assert.equal(Motor.edadEnFecha(null, '2026-07-20'), null);
});

// ── RVC059 ────────────────────────────────────────────────────────────────
test('RVC059 rechaza el grupo, la finalidad o la causa que el CUPS no admite', function () {
  var paquete = {
    numFactura: 'FE8',
    usuarios: [{ servicios: { consultas: [{
      codConsulta: '890203', fechaInicioAtencion: '2026-07-10 08:00',
      grupoServicios: '02', finalidadTecnologiaSalud: '15', causaMotivoAtencion: '38'
    }] } }]
  };
  var r = Motor.validar(paquete, contexto({ tablas: { cupsGrupoServicio: {
    '890203': { grupos: ['01'], finalidades: ['10', '15'], causas: ['26'] }
  } } }));
  var h = hallazgosDe(r, 'RVC059');
  assert.equal(h.length, 2, 'grupo y causa incorrectos; la finalidad sí está permitida');
  assert.deepEqual(h.map(function (x) { return x.PathFuente.split('.').pop(); }).sort(),
    ['causaMotivoAtencion', 'grupoServicios']);
});

test('RVC059 notifica el codServicio que no corresponde al CUPS', function () {
  var paquete = {
    numFactura: 'FE8',
    usuarios: [{ servicios: { procedimientos: [
      { codProcedimiento: '242103', codServicio: 999, fechaInicioAtencion: '2026-07-10 08:00' },
      { codProcedimiento: '242103', codServicio: 334, fechaInicioAtencion: '2026-07-11 08:00' }
    ] } }]
  };
  var r = Motor.validar(paquete, contexto({ tablas: { cupsCodServicio: { '242103': 334 } } }));
  var h = hallazgosDe(r, 'RVC059');
  assert.equal(h.length, 1);
  assert.equal(h[0].Clase, Motor.NOTIFICACION);
  assert.match(h[0].PathFuente, /procedimientos\[0\]\.codServicio$/);
});

// ── Selección de reglas y reglas fuera de alcance ────────────────────────
test('se puede correr un subconjunto de reglas', function () {
  var r = Motor.validar(PAQUETE_57, contexto({
    tablas: { cups: CUPS_REF, cupsCie10: CUPS_CIE10_REF },
    opciones: { reglas: ['RVC014'] }
  }));
  assert.deepEqual(r.reglasEvaluadas.map(function (x) { return x.codigo; }), ['RVC014']);
  assert.equal(r.hallazgos.length, 109);
});

test('RVG01 y FED137 salen listadas como pendientes de la validación oficial', function () {
  var r = Motor.validar(PAQUETE_57, {
    fev: { numFactura: 'FE10', periodo: Fixture.FEV.periodo, cobertura: '17' },
    tablas: { cups: CUPS_REF }
  });
  ['RVG01', 'FED137'].forEach(function (cod) {
    var h = hallazgosDe(r, cod);
    assert.equal(h.length, 1, 'falta el aviso de ' + cod);
    assert.equal(h[0].Clase, Motor.NOTIFICACION);
    assert.match(h[0].Observaciones, /SISPRO/);
  });
});

test('un paquete limpio no produce hallazgos de rechazo', function () {
  var paquete = {
    numDocumentoIdObligado: '9001234567', numFactura: 'FE8',
    usuarios: [{
      tipoDocumentoIdentificacion: 'CC', numDocumentoIdentificacion: '1010000000',
      codSexo: 'F', fechaNacimiento: '1990-04-02',
      servicios: { consultas: [{
        codConsulta: '890203', fechaInicioAtencion: '2026-07-10 08:00',
        codDiagnosticoPrincipal: 'K021', finalidadTecnologiaSalud: '15',
        grupoServicios: '01', causaMotivoAtencion: '26', codServicio: 334
      }] }
    }]
  };
  var r = Motor.validar(paquete, contexto({
    tablas: { cups: CUPS_REF, cupsCie10: CUPS_CIE10_REF, cupsCodServicio: { '890203': 334 } }
  }));
  assert.equal(r.resumen.rechazados, 0, JSON.stringify(r.hallazgos, null, 2));
});

test('un paquete sin usuarios no revienta el motor', function () {
  [{}, { usuarios: null }, { usuarios: [] }, { usuarios: [null] },
   { usuarios: [{ servicios: null }] }, { usuarios: [{ servicios: { consultas: 'nada' } }] }
  ].forEach(function (paquete) {
    var r = Motor.validar(paquete, contexto());
    assert.equal(r.resumen.rechazados, 0, JSON.stringify(paquete));
  });
});
