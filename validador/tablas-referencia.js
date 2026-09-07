// ═══════════════════════════════════════════════════════════════════════════
// TABLAS DE REFERENCIA PARA EL MOTOR RVC
// ═══════════════════════════════════════════════════════════════════════════
// El motor no trae tablas de referencia adentro: las recibe por contexto. Este
// archivo arma ese contexto a partir de lo que ya existe en la app y define la
// forma exacta de las tablas que todavía hay que cargar a mano.
//
// Regla de oro: una tabla vacía NO es una tabla que aprueba todo. El motor
// marca la regla como "no evaluable localmente" y lo dice en el reporte, para
// que nadie confunda "no lo revisé" con "está bien".
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.RipsTablas = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── RVC051: restricciones de sexo y edad por finalidad ──────────────────
  // Forma de cada entrada:
  //
  //   '<codFinalidad>': {
  //     nombre: 'texto que sale en el hallazgo',
  //     sexos: ['F'],          // sexos admitidos; omitir si no hay restricción
  //     edadMinAnios: 0,       // inclusive; omitir si no hay mínimo
  //     edadMaxAnios: 9        // inclusive; omitir si no hay máximo
  //   }
  //
  // Se deja VACÍA a propósito. Los códigos de finalidad de la tecnología en
  // salud y sus rangos de sexo/edad son datos del anexo técnico vigente, y
  // cargarlos de memoria produciría falsos rechazos justo en la regla que
  // menos tolera ruido. Para activar RVC051, copia aquí las filas del anexo
  // (o pásalas por ctx.tablas.finalidadRestricciones desde el llamador).
  //
  // Ejemplo de la forma esperada, con códigos de muestra:
  //   var RESTRICCIONES_FINALIDAD = {
  //     '07': { nombre: 'detección temprana - alteraciones del embarazo', sexos: ['F'], edadMinAnios: 10, edadMaxAnios: 54 },
  //     '05': { nombre: 'detección temprana - alteraciones del crecimiento del menor', edadMaxAnios: 9 }
  //   };
  var RESTRICCIONES_FINALIDAD = {};

  // ── RVC017: CUPS habilitados por cobertura / plan de beneficios ─────────
  // Forma de cada entrada (la clave es el código de COBERTURA_PLAN_BENEFICIOS
  // que trae la FEV, de dos dígitos):
  //
  //   '17': {
  //     nombre: 'UPC Subsidiado',
  //     incluidos: { '890203': 1, '230101': 1 },  // o un Set, o un arreglo
  //     excluidos: { '999999': 1 }                // opcional
  //   }
  //
  // Si `incluidos` está vacío solo se aplican los `excluidos`: sirve para
  // modelar "todo está incluido salvo esta lista", que es lo habitual en los
  // contratos de capitación odontológica.
  var CUPS_POR_COBERTURA = {};

  // ── RVC059: combinaciones válidas por CUPS ──────────────────────────────
  //   '890203': { grupos: ['01'], finalidades: ['10','15'], causas: ['26'] }
  // Cada lista vacía u omitida significa "sin restricción por ese campo".
  var CUPS_GRUPO_SERVICIO = {};

  /** Convierte un arreglo de códigos en un índice para búsqueda por clave. */
  function indice(codigos) {
    var out = {};
    (codigos || []).forEach(function (c) {
      var k = String(c == null ? '' : c).trim();
      if (k) out[k] = 1;
    });
    return out;
  }

  /**
   * Arma el ctx.tablas del motor. Todos los argumentos son opcionales: lo que
   * no se pase deja su regla como no evaluable.
   *
   * En index.html se llama con las tablas que ya están cargadas:
   *   RipsTablas.construir({ cups: CUPS_DATA, cupsCie10: CUPS_CIE10, cupsCodServicio: CSERV_CUPS })
   */
  function construir(fuentes) {
    fuentes = fuentes || {};
    return {
      cups: fuentes.cups || null,
      cupsCie10: fuentes.cupsCie10 || null,
      cupsCodServicio: fuentes.cupsCodServicio || null,
      cupsPorCobertura: fuentes.cupsPorCobertura || CUPS_POR_COBERTURA,
      cupsGrupoServicio: fuentes.cupsGrupoServicio || CUPS_GRUPO_SERVICIO,
      finalidadRestricciones: fuentes.finalidadRestricciones || RESTRICCIONES_FINALIDAD
    };
  }

  return {
    RESTRICCIONES_FINALIDAD: RESTRICCIONES_FINALIDAD,
    CUPS_POR_COBERTURA: CUPS_POR_COBERTURA,
    CUPS_GRUPO_SERVICIO: CUPS_GRUPO_SERVICIO,
    indice: indice,
    construir: construir
  };
});
