/*
 * Textos con los que arranca una base nueva. Viven aquí y no como DEFAULT en
 * `schema.sql` porque son largos y una migración tendría que repetirlos.
 */

/**
 * Políticas al pie del tiquete de entrada: un párrafo por línea. Lo que va
 * antes de los dos puntos sale en negrilla y `{ticket_perdido}` se reemplaza al
 * imprimir por el recargo configurado, para que el papel nunca diga un valor
 * distinto al que se cobra.
 */
export const POLITICAS_PREDETERMINADAS = [
  'Cascos en custodia: Se garantiza el cuidado de los cascos entregados directamente en la administración.',
  'Cascos en la moto: El parqueadero NO se hace responsable por pérdida o daño de cascos, guantes o impermeables dejados sobre la motocicleta.',
  'Pérdida de tiquete: Tendrá un costo de {ticket_perdido} y se exigirá la tarjeta de propiedad original.',
  'Objetos de valor: No deje dinero, celulares o herramientas en los compartimentos de la moto.',
  'Gracias por confiar en Salazares para el cuidado de su moto.'
].join('\n')
