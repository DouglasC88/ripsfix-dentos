// Tests del cálculo del periodo de prestación en capitación.
'use strict';
var test = require('node:test');
var assert = require('node:assert/strict');
var P = require('../periodo.js');

test('mesAnterior: la FEV de agosto exige el RIPS de julio', function () {
  var r = P.calcularPeriodoAnterior({ inicio: '2026-08-01', fin: '2026-08-31' });
  assert.equal(r.valido, true);
  assert.equal(r.estrategia, 'mesAnterior');
  assert.equal(r.inicio, '2026-07-01');
  assert.equal(r.fin, '2026-07-31');
  assert.deepEqual(r.periodoFactura, { inicio: '2026-08-01', fin: '2026-08-31' });
});

test('mesAnterior: cruza el fin de año hacia diciembre del año previo', function () {
  var r = P.calcularPeriodoAnterior({ inicio: '2026-01-01', fin: '2026-01-31' });
  assert.equal(r.inicio, '2025-12-01');
  assert.equal(r.fin, '2025-12-31');
});

test('mesAnterior: febrero de año bisiesto queda con 29 días', function () {
  var r = P.calcularPeriodoAnterior({ inicio: '2024-03-01', fin: '2024-03-31' });
  assert.equal(r.inicio, '2024-02-01');
  assert.equal(r.fin, '2024-02-29');
});

test('mesAnterior: no depende del día en que arranque el periodo facturado', function () {
  var r = P.calcularPeriodoAnterior({ inicio: '2026-08-15', fin: '2026-09-14' });
  assert.equal(r.inicio, '2026-07-01');
  assert.equal(r.fin, '2026-07-31');
});

test('ventanaPrevia: quincena facturada exige la quincena inmediatamente anterior', function () {
  var r = P.calcularPeriodoAnterior({ inicio: '2026-08-16', fin: '2026-08-31' },
    { estrategia: 'ventanaPrevia' });
  assert.equal(r.inicio, '2026-07-31');
  assert.equal(r.fin, '2026-08-15');
});

test('acepta el periodo tal como lo entrega parseXML() del index.html', function () {
  var r = P.calcularPeriodoAnterior({ periodStart: '2026-08-01', periodEnd: '2026-08-31' });
  assert.equal(r.inicio, '2026-07-01');
});

test('acepta el InvoicePeriod crudo del XML', function () {
  var r = P.calcularPeriodoAnterior({ StartDate: '2026-08-01', EndDate: '2026-08-31' });
  assert.equal(r.inicio, '2026-07-01');
});

test('sin InvoicePeriod válido no inventa periodo: lo declara inválido', function () {
  [null, {}, { inicio: '2026-08-01' }, { inicio: 'ayer', fin: 'hoy' },
   { inicio: '2026-08-31', fin: '2026-08-01' }, { inicio: '2026-02-30', fin: '2026-03-05' }
  ].forEach(function (entrada) {
    var r = P.calcularPeriodoAnterior(entrada);
    assert.equal(r.valido, false, JSON.stringify(entrada));
    assert.equal(r.inicio, null);
    assert.ok(r.motivo);
  });
});

test('estrategia desconocida se rechaza en vez de caer en el default silenciosamente', function () {
  var r = P.calcularPeriodoAnterior({ inicio: '2026-08-01', fin: '2026-08-31' },
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
