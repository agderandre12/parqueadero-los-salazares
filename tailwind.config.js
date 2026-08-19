/** @type {import('tailwindcss').Config} */

/*
 * Sistema visual "Los Salazares".
 * Base blanca, azul del logo como único acento de acción, oscuro en toques
 * (rail de navegación y celdas ocupadas). El azul se midió del emblema:
 * es el tono dominante de la palabra "LAVADERO" (#0F80D8).
 */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Superficies
        lienzo: '#F6F7F9', // fondo de la aplicación
        blanco: '#FFFFFF', // tarjetas y paneles

        // Oscuros — el "toque" de la paleta
        tinta: {
          DEFAULT: '#0A0A0B', // texto primario y rail de navegación
          800: '#16171A', // celda ocupada
          700: '#242629' // borde sobre oscuro
        },

        // Texto. Los valores están fijados por contraste medido, no a ojo:
        // sobre blanco, grafito da 6.4:1 y niebla 5.1:1 (AA con margen).
        grafito: '#5F6066', // secundario
        niebla: '#6E6F76', // terciario, placeholders
        humo: '#9B9CA4', // terciario SOBRE OSCURO (rail y celdas ocupadas): 6.6:1

        // Líneas
        linea: {
          DEFAULT: '#E4E5E9', // hairline
          fuerte: '#D2D4DA' // hover, divisiones marcadas
        },

        /*
         * Acento de marca. El azul del logo (#0F80D8) sólo alcanza 4.1:1 con
         * texto blanco encima, así que no puede rellenar un botón de 13px.
         * Se reparte: el tono exacto del logo va donde no lleva texto encima
         * (barras de selección, anillo de foco, iconos, bordes) y el relleno
         * de los botones usa un paso más oscuro del mismo tono, que da 5.3:1.
         */
        azul: {
          50: '#EAF4FD', // fondo de selección
          200: '#B9DCF7', // borde tenue y ::selection
          DEFAULT: '#0F80D8', // el azul medido del emblema
          cta: '#0C6FBC', // relleno de botón con texto blanco — 5.3:1
          700: '#0B66AC' // texto azul sobre blanco — 5.9:1
        },

        // Estados. Rojo sólo como texto y borde, nunca como fondo de botón.
        alerta: {
          50: '#FDECEC',
          DEFAULT: '#C62B31'
        }
      },

      fontFamily: {
        sans: ['Geist Variable', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono Variable', 'Consolas', 'ui-monospace', 'monospace']
      },

      // Escala fija, razón ~1.15. En producto una escala fluida sólo agrega ruido.
      fontSize: {
        micro: ['0.6875rem', { lineHeight: '1rem' }], // 11px etiquetas
        mini: ['0.75rem', { lineHeight: '1.125rem' }], // 12px metadatos
        base: ['0.8125rem', { lineHeight: '1.25rem' }], // 13px cuerpo de UI
        cuerpo: ['0.9375rem', { lineHeight: '1.4rem' }], // 15px
        titulo: ['1.0625rem', { lineHeight: '1.5rem' }], // 17px
        dato: ['1.375rem', { lineHeight: '1.6rem' }], // 22px cifras
        cifra: ['2.375rem', { lineHeight: '1' }], // 38px ocupación
        total: ['2.75rem', { lineHeight: '1.05' }] // 44px total a cobrar
      },

      borderRadius: {
        campo: '0.625rem', // 10px — campos y botones
        panel: '0.75rem' // 12px — tarjetas
      },

      transitionTimingFunction: {
        salida: 'cubic-bezier(0.32, 0.72, 0, 1)'
      },

      transitionDuration: {
        // 150-250 ms: el operario está en flujo, no esperando coreografía
        rapido: '160ms',
        DEFAULT: '160ms'
      }
    }
  },
  plugins: []
}
