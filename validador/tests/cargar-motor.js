// ═══════════════════════════════════════════════════════════════════════════
// CARGA EL MOTOR DESDE index.html
// ═══════════════════════════════════════════════════════════════════════════
// La app es un solo archivo: el motor de validación de capitación vive dentro
// del script de index.html, no en módulos aparte. Para que los tests no sean
// una copia que se desincroniza, este cargador recorta ese bloque del propio
// index.html y lo evalúa en el ámbito de una función, en este mismo realm.
//
// Consecuencia buena: los tests prueban exactamente el código que se despliega.
// Consecuencia a respetar: si alguien borra o renombra los marcadores del
// bloque en index.html, los tests fallan de inmediato con un mensaje claro en
// vez de validar algo viejo.
'use strict';

var fs = require('fs');
var path = require('path');

var INDEX = path.join(__dirname, '..', '..', 'index.html');
var INICIO = '// ═══ INICIO DEL MOTOR DE VALIDACIÓN DE CAPITACIÓN ═══';
var FIN = '// ═══ FIN DEL MOTOR DE VALIDACIÓN DE CAPITACIÓN ═══';

function recortarMotor(html) {
  var i = html.indexOf(INICIO);
  var j = html.indexOf(FIN);
  if (i < 0 || j < 0 || j < i) {
    throw new Error(
      'No se encontraron los marcadores del motor en index.html.\n' +
      'Se esperaba el bloque delimitado por:\n  ' + INICIO + '\n  ' + FIN + '\n' +
      'Si el bloque se movió o se renombró, actualiza validador/tests/cargar-motor.js.');
  }
  return html.slice(i + INICIO.length, j);
}

function cargar() {
  var codigo = recortarMotor(fs.readFileSync(INDEX, 'utf8'));
  // Se evalúa con `new Function`, no con el módulo `vm`, y la diferencia
  // importa: `vm.createContext` crea otro realm, y ahí los objetos que
  // devuelve el motor tienen otro Object.prototype, así que assert.deepEqual
  // —que compara prototipos— fallaría contra los objetos del test. Con
  // `new Function` el motor corre en este mismo realm y los valores se pueden
  // comparar de frente; el aislamiento que sí hace falta lo da el ámbito de la
  // función, que impide que los `var` del bloque se filtren a los tests.
  //
  // El envoltorio UMD de cada módulo publica en `self` cuando no hay CommonJS.
  // Aquí `module` no está en el ámbito de la función, así que toma esa rama y
  // deja los cuatro globales en el objeto que se le pasa.
  var entorno = {};
  var evaluar = new Function('self', 'window',
    '"use strict";\n' + codigo + '\n;return self;');
  evaluar(entorno, entorno);

  ['RipsPeriodo', 'RipsMotorRVC', 'RipsReporte', 'RipsTablas'].forEach(function (n) {
    if (!entorno[n]) throw new Error('El bloque de index.html no definió ' + n + '.');
  });
  return entorno;
}

module.exports = cargar();
