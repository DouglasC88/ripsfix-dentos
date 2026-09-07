// Tests del cálculo del periodo de prestación en capitación.
'use strict';
var test = require('node:test');
var assert = require('node:assert/strict');
// El motor se lee de index.html, no de un módulo aparte: la app es un solo archivo.
var P = require('./cargar-motor.js').RipsPeriodo;

test('mesAnterior: la FEV de agosto exige el RIPS de julio', function () {
  var r = P.calcularPeriodoEsperado({ inicio: '2026-08-01', fin: '2026-08-31' },
    { estrategia: 'mesAnterior' });
  assert.equal(r.valido, true);
  assert.equal(r.estrategia, 'mesAnterior');
  assert.equal(r.inicio, '2026-07-01');
  assert.equal(r.fin, '2026-07-31');
  assert.deepEqual(r.periodoFactura, { inicio: '2026-08-01', fin: '2026-08-31' });
});

test('mesAnterior: cruza el fin de año hacia diciembre del año previo', function () {
  var r = P.calcularPeriodoEsperado({ inicio: '2026-01-01', fin: '2026-01-31' },
    { estrategia: 'mesAnterior' });
  assert.equal(r.inicio, '2025-12-01');
  assert.equal(r.fin, '2025-12-31');
});

test('mesAnterior: febrero de año bisiesto queda con 29 días', function () {
  var r = P.calcularPeriodoEsperado({ inicio: '2024-03-01', fin: '2024-03-31' },
    { estrategia: 'mesAnterior' });
  assert.equal(r.inicio, '2024-02-01');
  assert.equal(r.fin, '2024-02-29');
});

test('mesAnterior: no depende del día en que arranque el periodo facturado', function () {
  var r = P.calcularPeriodoEsperado({ inicio: '2026-08-15', fin: '2026-09-14' },
    { estrategia: 'mesAnterior' });
  assert.equal(r.inicio, '2026-07-01');
  assert.equal(r.fin, '2026-07-31');
});

test('ventanaPrevia: quincena facturada exige la quincena inmediatamente anterior', function () {
  var r = P.calcularPeriodoEsperado({ inicio: '2026-08-16', fin: '2026-08-31' },
    { estrategia: 'ventanaPrevia' });
  assert.equal(r.inicio, '2026-07-31');
  assert.equal(r.fin, '2026-08-15');
});

test('acepta el periodo tal como lo entrega parseXML() del index.html', function () {
  var r = P.calcularPeriodoEsperado({ periodStart: '2026-08-01', periodEnd: '2026-08-31' },
    { estrategia: 'mesAnterior' });
  assert.equal(r.inicio, '2026-07-01');
});

test('acepta el InvoicePeriod crudo del XML', function () {
  var r = P.calcularPeriodoEsperado({ StartDate: '2026-08-01', EndDate: '2026-08-31' },
    { estrategia: 'mesAnterior' });
  assert.equal(r.inicio, '2026-07-01');
});

test('sin InvoicePeriod válido no inventa periodo: lo declara inválido', function () {
  [null, {}, { inicio: '2026-08-01' }, { inicio: 'ayer', fin: 'hoy' },
   { inicio: '2026-08-31', fin: '2026-08-01' }, { inicio: '2026-02-30', fin: '2026-03-05' }
  ].forEach(function (entrada) {
    var r = P.calcularPeriodoEsperado(entrada);
    assert.equal(r.valido, false, JSON.stringify(entrada));
    assert.equal(r.inicio, null);
    assert.ok(r.motivo);
  });
});

test('estrategia desconocida se rechaza en vez de caer en el default silenciosamente', function () {
  var r = P.calcularPeriodoEsperado({ inicio: '2026-08-01', fin: '2026-08-31' },
    { estrategia: 'loQueSea' });
  assert.equal(r.valido, false);
  assert.match(r.motivo, /desconocida/);
});

test('dentroDelPeriodo compara por día e ignora la hora', function () {
  var per = { inicio: '2026-07-01', fin: '2026-07-31' };
  assert.equal(P.dentroDelPeriodo('2026-07-01 00:00', per), true);
  assert.equal(P.dentroDelPeriodo('2026-07-31 23:59', per), true);
  assert.equal(P.dentroDelPeriodo('2026-06-30 23:59', per), false);
  assert.equal(P.dentroDelPeriodo('2026-08-01 00:00', per), false);
  assert.equal(P.dentroDelPeriodo(null, per), null, 'sin fecha no es evaluable');
});

test('desfaseEnDias dice de qué lado y a cuántos días quedó la atención', function () {
  var per = { inicio: '2026-07-01', fin: '2026-07-31' };
  assert.equal(P.desfaseEnDias('2026-08-04', per), 4);
  assert.equal(P.desfaseEnDias('2026-06-25', per), -6);
  assert.equal(P.desfaseEnDias('2026-07-15', per), 0);
});

test('aDia normaliza las formas de fecha que aparecen en los RIPS reales', function () {
  assert.equal(P.aDia('2026-7-3 08:00'), '2026-07-03');
  assert.equal(P.aDia('2026-07-03T08:00:00'), '2026-07-03');
  assert.equal(P.aDia('2026-07-03'), '2026-07-03');
  assert.equal(P.aDia(''), null);
  assert.equal(P.aDia(null), null);
});

// ── El XML solo trae el periodo facturado ────────────────────────────────
// El InvoicePeriod de la FEV es el periodo FACTURADO. El periodo prestado no
// está en ningún campo del XML: o se deriva (supuesto) o se fija a mano (dato).
test('el periodo derivado queda marcado como derivado, no como dato', function () {
  var r = P.calcularPeriodoEsperado({ inicio: '2026-08-01', fin: '2026-08-31' },
    { estrategia: 'mesAnterior' });
  assert.equal(r.origen, 'derivado');
  assert.equal(r.estrategia, 'mesAnterior');
});

test('el periodo prestado fijado a mano se respeta tal cual y queda marcado', function () {
  var r = P.periodoPrestadoExplicito({ inicio: '2026-06-16', fin: '2026-07-15' },
    { inicio: '2026-08-01', fin: '2026-08-31' });
  assert.equal(r.valido, true);
  assert.equal(r.origen, 'manual');
  assert.equal(r.estrategia, null, 'un dato no viene de ninguna estrategia');
  assert.equal(r.inicio, '2026-06-16');
  assert.equal(r.fin, '2026-07-15');
  // El periodo facturado se conserva, pero solo como referencia del reporte.
  assert.deepEqual(r.periodoFactura, { inicio: '2026-08-01', fin: '2026-08-31' });
});

test('el periodo prestado a mano no necesita el periodo facturado', function () {
  var r = P.periodoPrestadoExplicito({ inicio: '2026-07-01', fin: '2026-07-31' }, null);
  assert.equal(r.valido, true);
  assert.equal(r.periodoFactura, null);
});

test('un periodo prestado a mano incompleto o al revés se rechaza', function () {
  [null, {}, { inicio: '2026-07-01' }, { inicio: '2026-07-31', fin: '2026-07-01' }
  ].forEach(function (entrada) {
    var r = P.periodoPrestadoExplicito(entrada, null);
    assert.equal(r.valido, false, JSON.stringify(entrada));
    assert.equal(r.origen, 'manual');
    assert.ok(r.motivo);
  });
});

test('el periodo prestado a mano puede no tener nada que ver con el facturado', function () {
  // Nada obliga a que el prestado sea el mes anterior: si el contrato dice otra
  // cosa, el dato manda sobre cualquier derivación.
  var r = P.periodoPrestadoExplicito({ inicio: '2025-11-01', fin: '2026-01-31' },
    { inicio: '2026-08-01', fin: '2026-08-31' });
  assert.equal(r.valido, true);
  assert.equal(r.inicio, '2025-11-01');
  assert.equal(r.fin, '2026-01-31');
});

// ── Modalidad de pago: lo único que cambia el periodo esperado ───────────
test('mismoPeriodo: en pago por evento la atención cae dentro del periodo facturado', function () {
  var r = P.calcularPeriodoEsperado({ inicio: '2026-08-01', fin: '2026-08-31' },
    { estrategia: 'mismoPeriodo' });
  assert.equal(r.inicio, '2026-08-01');
  assert.equal(r.fin, '2026-08-31');
});

test('sin modalidad ni estrategia se asume pago por evento', function () {
  // Es el caso general y el que ya asumía el resto de la app; asumir capitación
  // marcaría como rechazo todo un paquete de particulares correcto.
  assert.equal(P.ESTRATEGIA_POR_DEFECTO, 'mismoPeriodo');
  var r = P.calcularPeriodoEsperado({ inicio: '2026-08-01', fin: '2026-08-31' });
  assert.equal(r.estrategia, 'mismoPeriodo');
  assert.equal(r.inicio, '2026-08-01');
});

test('cada modalidad trae su estrategia y si se factura anticipada', function () {
  var esperado = {
    '01': { estrategia: 'mismoPeriodo', anticipada: false },
    '02': { estrategia: 'mesAnterior', anticipada: true },
    '03': { estrategia: 'mesAnterior', anticipada: true },
    '04': { estrategia: 'mismoPeriodo', anticipada: false }
  };
  Object.keys(esperado).forEach(function (cod) {
    var m = P.resolverModalidad(cod, null);
    assert.equal(m.reconocida, true, cod);
    assert.equal(m.estrategia, esperado[cod].estrategia, cod);
    assert.equal(m.anticipada, esperado[cod].anticipada, cod);
  });
});

test('la modalidad la decide el periodo esperado, no al revés', function () {
  var fev = { inicio: '2026-08-01', fin: '2026-08-31' };
  var evento = P.calcularPeriodoEsperado(fev, { modalidad: P.resolverModalidad('04', null) });
  var capita = P.calcularPeriodoEsperado(fev, { modalidad: P.resolverModalidad('03', null) });
  assert.equal(evento.inicio, '2026-08-01');
  assert.equal(capita.inicio, '2026-07-01');
});

test('una estrategia explícita manda sobre la de la modalidad', function () {
  var r = P.calcularPeriodoEsperado({ inicio: '2026-08-01', fin: '2026-08-31' },
    { modalidad: P.resolverModalidad('03', null), estrategia: 'mismoPeriodo' });
  assert.equal(r.estrategia, 'mismoPeriodo');
  assert.equal(r.inicio, '2026-08-01');
});

test('el nombre de la modalidad manda sobre el código, como en el resto de la app', function () {
  // Si el emisor usa otra codificación, el texto del XML sigue reconociéndose.
  assert.equal(P.resolverModalidad('99', 'Pago por Capitación').codigo, '03');
  assert.equal(P.resolverModalidad('03', 'Pago por evento').codigo, '04');
  assert.equal(P.resolverModalidad(null, 'PAGO GLOBAL PROSPECTIVO').codigo, '02');
  assert.equal(P.resolverModalidad(null, 'paquete o canasta').codigo, '01');
});

test('una modalidad desconocida se marca como no reconocida y pide confirmación', function () {
  var m = P.resolverModalidad('99', null);
  assert.equal(m.reconocida, false);
  assert.equal(m.confirmar, true, 'el reporte debe advertirlo');
  assert.equal(m.estrategia, 'mismoPeriodo', 'cae en el caso general, no en capitación');
});

test('las modalidades cuya regla salió por analogía quedan marcadas', function () {
  // Solo hay evidencia directa para capitación (paquetes reales) y evento (el
  // resto de la app). Las otras dos van marcadas para contrastar con el contrato.
  assert.equal(P.resolverModalidad('03', null).confirmar, false);
  assert.equal(P.resolverModalidad('04', null).confirmar, false);
  assert.equal(P.resolverModalidad('01', null).confirmar, true);
  assert.equal(P.resolverModalidad('02', null).confirmar, true);
});

// ── Inversa: con qué factura va un RIPS ─────────────────────────────────
test('periodoFacturaEsperado invierte la estrategia para hallar la factura', function () {
  var julio = { inicio: '2026-07-01', fin: '2026-07-31' };
  assert.deepEqual(P.periodoFacturaEsperado(julio, 'mesAnterior'),
    { inicio: '2026-08-01', fin: '2026-08-31' });
  assert.deepEqual(P.periodoFacturaEsperado(julio, 'mismoPeriodo'), julio);
});

test('la inversa de mesAnterior cruza el fin de año', function () {
  assert.deepEqual(P.periodoFacturaEsperado({ inicio: '2025-12-01', fin: '2025-12-31' }, 'mesAnterior'),
    { inicio: '2026-01-01', fin: '2026-01-31' });
});

test('ida y vuelta: derivar el periodo y volver a la factura da el mismo periodo', function () {
  ['mismoPeriodo', 'mesAnterior', 'ventanaPrevia'].forEach(function (est) {
    var fev = { inicio: '2026-08-01', fin: '2026-08-31' };
    var prestado = P.calcularPeriodoEsperado(fev, { estrategia: est });
    var vuelta = P.periodoFacturaEsperado({ inicio: prestado.inicio, fin: prestado.fin }, est);
    assert.deepEqual(vuelta, fev, est);
  });
});

test('la inversa no inventa nada sin fechas válidas ni con estrategia desconocida', function () {
  assert.equal(P.periodoFacturaEsperado(null, 'mesAnterior'), null);
  assert.equal(P.periodoFacturaEsperado({ inicio: '2026-07-01', fin: '2026-07-31' }, 'loQueSea'), null);
});
