// Datos del viaje, sacados del Excel "Itinerario Sevilla 7-11 noviembre 2026".
// approx: true = hora orientativa calculada a partir de las duraciones (no venía en el Excel).
// Para cambiar el plan base, edita este archivo; lo que se toca desde la web se guarda en el móvil.

const TRIP = {
  title: 'Sevilla',
  subtitle: '7 – 11 de noviembre de 2026',
  tagline: '2 personas · ritmo relajado · Córdoba el martes',
  start: '2026-11-07',
  end: '2026-11-11',
  stay: { name: 'Alojamiento', address: 'Zona San Juan de la Palma, Sevilla' },
};

const DAYS = [
  {
    date: '2026-11-07', short: 'Sáb', num: 7, name: 'Sábado 7',
    title: 'Llegada + Catedral / Giralda',
    summary: 'Una sola gran visita y bastante margen. Las Setas solo si apetece.',
    pace: 'Tranquilo',
    items: [
      { id: 's1', start: '08:00', end: '10:39', title: 'AVE Madrid → Sevilla', kind: 'train', move: 'AVE 02080', dur: 159, resv: 'Confirmado', note: 'Salida de Madrid-Puerta de Atocha. Llegada a Sevilla-Santa Justa a las 10:39.', map: 'Estación Sevilla Santa Justa' },
      { id: 's2', start: '10:50', end: '11:30', approx: true, title: 'Llegar al alojamiento y dejar equipaje', kind: 'stay', move: 'Taxi con maletas', dur: 40, note: 'Sin prisa; el primer objetivo es instalarse.', map: 'Plaza San Juan de la Palma, Sevilla' },
      { id: 's3', start: '11:30', end: '13:00', approx: true, title: 'Paseo por el centro', kind: 'walk', move: 'A pie', dur: 90, food: 'Café opcional', prio: 'B', note: 'Solo orientarse y disfrutar.', map: 'Plaza del Salvador, Sevilla' },
      { id: 's4', start: '13:15', end: '14:45', approx: true, title: 'Almuerzo (con reserva)', kind: 'food', move: 'A pie', dur: 90, food: 'Comida', resv: 'Con reserva', note: 'Dejar margen real para sentarse.' },
      { id: 's5', start: '15:00', end: '16:45', title: 'Catedral + Giralda', kind: 'visit', move: 'A pie', dur: 105, prio: 'A', resv: 'Sí · alta prioridad', note: 'Visita principal del día. No meter el Alcázar el mismo día.', map: 'Catedral de Sevilla', web: 'https://www.catedraldesevilla.es/visita-cultural/horarios-y-tarifas/' },
      { id: 's6', start: '16:45', end: '18:30', approx: true, title: 'Paseo: Plaza del Cabildo, Puerta de Jerez, Torre del Oro', kind: 'walk', move: 'A pie', dur: 105, prio: 'B', note: 'Sin checklist; perderse por el barrio.', map: 'Torre del Oro, Sevilla' },
      { id: 's7', start: '19:30', end: '21:00', approx: true, title: 'Cena (en el apartamento)', kind: 'food', move: 'A pie', dur: 90, food: 'Cena', note: 'Las Setas solo si todavía os apetece; si no, otro día o se omiten.' },
    ],
  },
  {
    date: '2026-11-08', short: 'Dom', num: 8, name: 'Domingo 8',
    title: 'Real Alcázar + Plaza de España',
    summary: 'Sevilla tranquila: una gran visita, comida larga y paseo. Sin excursión.',
    pace: 'Tranquilo',
    items: [
      { id: 'd1', start: '10:00', end: '12:30', title: 'Real Alcázar', kind: 'visit', zone: 'Alcázar', move: 'A pie', dur: 150, prio: 'A', resv: 'Sí · máxima prioridad', note: 'Visita principal del día. No encadenarla con otra entrada importante.\nComentario de Nuria en el Excel: «más tarde» (valorar una entrada posterior a las 10:00).', map: 'Real Alcázar de Sevilla', web: 'https://alcazarsevilla.org/prepara-la-visita/' },
      { id: 'd2', start: '12:30', end: '13:30', approx: true, title: 'Paseo por Santa Cruz', kind: 'walk', zone: 'Santa Cruz', move: 'A pie', dur: 60, food: 'Café', note: 'Sin ruta fija; parar donde os apetezca.', map: 'Barrio de Santa Cruz, Sevilla' },
      { id: 'd3', start: '13:45', end: '15:30', approx: true, title: 'Almuerzo', kind: 'food', zone: 'Puerta de Jerez / Prado', move: 'A pie', dur: 105, food: 'Comida', note: 'Pausa real después del Alcázar.', map: 'Puerta de Jerez, Sevilla' },
      { id: 'd4', start: '15:45', end: '17:45', approx: true, title: 'Plaza de España + Parque de María Luisa', kind: 'walk', zone: 'María Luisa', move: 'A pie', dur: 120, prio: 'B', note: 'Un paseo, no una lista.', map: 'Plaza de España, Sevilla' },
      { id: 'd5', start: '18:15', end: '20:15', approx: true, title: 'Las Setas', kind: 'visit', zone: 'Centro', move: 'A pie / bus', dur: 120, food: 'Aperitivo opcional', prio: 'C', note: 'Hueco deliberado para descansar: subir solo si apetece.', map: 'Setas de Sevilla', web: 'https://setasdesevilla.com/planifica-tu-visita' },
      { id: 'd6', start: '20:30', end: '22:00', approx: true, title: 'Cena', kind: 'food', zone: 'Encarnación / Feria / Alameda', move: 'A pie', dur: 90, food: 'Cena', note: 'No hace falta añadir nada más.', map: 'Alameda de Hércules, Sevilla' },
    ],
  },
  {
    date: '2026-11-09', short: 'Lun', num: 9, name: 'Lunes 9',
    title: 'Centro + flamenco + Triana',
    summary: 'Día colchón para disfrutar: centro, tarde libre y Triana.',
    pace: 'Muy tranquilo',
    items: [
      { id: 'l1', start: '10:30', end: '12:15', approx: true, title: 'Centro histórico · ¿Mercado?', kind: 'walk', zone: 'Encarnación / Salvador / Sierpes', move: 'A pie', dur: 105, food: 'Café opcional', note: 'Compras, café, calles o volver al alojamiento.', map: 'Mercado de la Encarnación, Sevilla' },
      { id: 'l2', start: '13:30', end: '15:30', approx: true, title: 'Almuerzo (en el apartamento)', kind: 'food', move: 'A pie', dur: 120, food: 'Comida', note: 'Sin prisa.' },
      { id: 'l3', title: 'Espectáculo de flamenco', kind: 'show', resv: 'Por decidir', note: 'Sin hora ni sitio todavía. Cuando lo tengáis, poned la hora aquí.' },
      { id: 'l4', start: '17:00', end: '20:00', approx: true, title: 'Triana', kind: 'walk', zone: 'Triana', move: 'A pie / bus', dur: 180, food: 'Aperitivo opcional', prio: 'B', note: 'Ambiente y río; sin entradas.', map: 'Puente de Triana, Sevilla' },
      { id: 'l5', start: '20:30', end: '22:00', approx: true, title: 'Cena', kind: 'food', move: 'A pie', dur: 90, food: 'Cena', note: 'Las Setas solo después si todavía os apetece.' },
    ],
  },
  {
    date: '2026-11-10', short: 'Mar', num: 10, name: 'Martes 10',
    title: 'Excursión a Córdoba',
    summary: 'Mezquita, Judería y Puente Romano, con comida larga y margen.',
    pace: 'Medio',
    items: [
      { id: 'm1', start: '08:15', end: '09:30', approx: true, title: 'Tren Sevilla → Córdoba', kind: 'train', zone: 'Sevilla / Córdoba', move: 'Taxi + tren', dur: 75, resv: 'Pendiente', note: 'Buscar llegada alrededor de 09:15–09:45.\nComentario de Nuria en el Excel: «más tarde» (valorar un tren posterior).', map: 'Estación Sevilla Santa Justa' },
      { id: 'm2', start: '10:15', end: '11:45', approx: true, title: 'Mezquita-Catedral', kind: 'visit', zone: 'Mezquita', move: 'A pie', dur: 90, prio: 'A', resv: 'Sí · alta prioridad', note: 'Visita principal de Córdoba. Reservar en la franja 10:15–10:30 y verla sin prisa.', map: 'Mezquita-Catedral de Córdoba', web: 'https://www.mezquita-catedraldecordoba.es/organiza-la-visita/entradas-y-horarios/' },
      { id: 'm3', start: '13:00', end: '14:45', approx: true, title: 'Almuerzo', kind: 'food', zone: 'Judería / Ribera', move: 'A pie', dur: 105, food: 'Comida', note: 'Pausa importante del día.', map: 'Judería de Córdoba' },
      { id: 'm4', start: '14:45', end: '16:00', approx: true, title: 'Judería', kind: 'walk', zone: 'Judería', move: 'A pie', dur: 75, food: 'Aperitivo opcional', prio: 'B', note: 'Callejear y parar donde os apetezca.', map: 'Calleja de las Flores, Córdoba' },
      { id: 'm5', title: 'Alcázar de los Reyes Cristianos (opcional)', kind: 'visit', zone: 'Alcázar', move: 'A pie', dur: 70, prio: 'B', resv: 'Opcional', note: 'Aparece en el resumen del Excel pero no en el horario del martes. Abre los martes de invierno 08:15–20:15; encajaría hacia las 15:00 (60–75 min) recortando Judería.', map: 'Alcázar de los Reyes Cristianos, Córdoba', web: 'https://alcazardelosreyescristianos.cordoba.es/?id=3' },
      { id: 'm6', start: '16:00', end: '17:00', approx: true, title: 'Puente Romano + paseo por la ribera', kind: 'walk', zone: 'Ribera', move: 'A pie', dur: 60, prio: 'B', note: 'Paseo final bonito; si estáis cansados, acortarlo.', map: 'Puente Romano de Córdoba' },
      { id: 'm7', start: '17:45', end: '18:30', approx: true, title: 'Tren Córdoba → Sevilla', kind: 'train', move: 'Tren', resv: 'Pendiente', note: 'Elegir uno entre ~17:45 y 18:30 que no obligue a correr. Dejar margen para un café antes de volver.', map: 'Estación de Córdoba' },
    ],
  },
  {
    date: '2026-11-11', short: 'Mié', num: 11, name: 'Miércoles 11',
    title: 'Última mañana + vuelta',
    summary: 'Nada que «cumplir»: desayuno, paseo, comida y tren con margen.',
    pace: 'Muy tranquilo',
    items: [
      { id: 'x1', start: '10:30', end: '11:45', title: 'Palacio de las Dueñas (opcional)', kind: 'visit', zone: 'Dueñas', move: 'A pie', dur: 75, prio: 'B', resv: 'Opcional · recomendado', note: 'Elegir Dueñas O Casa de Pilatos, no ambos. Dueñas está junto al alojamiento.', map: 'Palacio de las Dueñas, Sevilla', web: 'https://www.lasduenas.es/info-al-visitante' },
      { id: 'x2', start: '13:30', end: '15:00', approx: true, title: 'Comida de despedida', kind: 'food', move: 'A pie', dur: 90, food: 'Comida', note: 'La parte turística debe terminar hacia las 15:30.' },
      { id: 'x3', start: '16:30', end: '17:00', approx: true, title: 'Salir hacia Santa Justa', kind: 'stay', move: 'Taxi con maletas', dur: 30, note: 'Estar en la estación sobre las 16:45–17:00.', map: 'Estación Sevilla Santa Justa' },
      { id: 'x4', start: '17:53', end: '20:32', title: 'AVE Sevilla → Madrid', kind: 'train', zone: 'Sevilla / Madrid', move: 'AVE 02171', dur: 159, resv: 'Confirmado', note: 'Llegada a Atocha a las 20:32.', map: 'Estación Sevilla Santa Justa' },
    ],
  },
];

// Reservas y billetes, en el orden en que se usan.
const BOOKINGS = [
  { id: 'b1', date: '2026-11-07', time: '08:00', title: 'AVE Madrid → Sevilla', prio: 'Confirmado', confirmed: true, note: 'AVE 02080 · salida 08:00 · llegada 10:39 · 67,50 € (33,75 €/pers.)' },
  { id: 'b2', date: '2026-11-07', time: '~13:15', title: 'Restaurante para el almuerzo', prio: 'Con reserva', note: 'En el itinerario figura «con reserva»: apuntad aquí sitio y hora.' },
  { id: 'b3', date: '2026-11-07', time: '15:00', title: 'Catedral + Giralda', prio: 'A · imprescindible', when: 'Cuanto antes', note: 'Reservar ~15:00. Visita principal del sábado.', web: 'https://www.catedraldesevilla.es/visita-cultural/horarios-y-tarifas/' },
  { id: 'b4', date: '2026-11-08', time: '10:00', title: 'Real Alcázar de Sevilla', prio: 'A · máxima prioridad', when: 'Cuanto antes', note: 'Reservar ~10:00 (Nuria: «más tarde»). No hace falta entrar justo a las 09:30.', web: 'https://alcazarsevilla.org/prepara-la-visita/' },
  { id: 'b5', date: '2026-11-08', time: 'Tarde-noche', title: 'Las Setas', prio: 'C · opcional', optional: true, when: 'No hace falta cerrarlo ya', note: 'Solo si os apetece. Puede pasarse a otro día o eliminarse.', web: 'https://setasdesevilla.com/planifica-tu-visita' },
  { id: 'b6', date: '2026-11-09', time: 'Por decidir', title: 'Espectáculo de flamenco', prio: 'Por decidir', note: 'Sin sitio ni hora todavía.' },
  { id: 'b7', date: '2026-11-10', time: '~08:15–08:45', title: 'Tren Sevilla → Córdoba', prio: 'A · importante', when: 'Cuanto antes', note: 'Buscar llegada ~09:15–09:45 (Nuria: «más tarde»).' },
  { id: 'b8', date: '2026-11-10', time: '10:15–10:30', title: 'Mezquita-Catedral de Córdoba', prio: 'A · imprescindible', when: 'Cuanto antes', note: 'Martes de noviembre: horario turístico 10:00–18:00, sujeto a cambios litúrgicos.', web: 'https://www.mezquita-catedraldecordoba.es/organiza-la-visita/entradas-y-horarios/' },
  { id: 'b9', date: '2026-11-10', time: '~15:00', title: 'Alcázar de los Reyes Cristianos', prio: 'B · opcional', optional: true, when: 'Cuando tengáis trenes', note: 'Martes de invierno abre 08:15–20:15.', web: 'https://alcazardelosreyescristianos.cordoba.es/?id=3' },
  { id: 'b10', date: '2026-11-10', time: '~17:45–18:30', title: 'Tren Córdoba → Sevilla', prio: 'A · importante', when: 'Cuanto antes', note: 'Elegir uno que no obligue a correr.' },
  { id: 'b11', date: '2026-11-11', time: '10:30', title: 'Palacio de las Dueñas', prio: 'B · opcional', optional: true, when: 'Puede reservarse más adelante', note: 'Alternativa: Casa de Pilatos. No reservar ambos.', web: 'https://www.lasduenas.es/info-al-visitante' },
  { id: 'b12', date: '2026-11-11', time: '17:53', title: 'AVE Sevilla → Madrid', prio: 'Confirmado', confirmed: true, note: 'AVE 02171 · llegada a Atocha 20:32 · 33,80 € aprox. Estar en Santa Justa ~16:45–17:00.' },
];

const PLACES = [
  { name: 'Catedral + Giralda', day: 'Sáb 7', hours: 'L–S aprox. 10:45–19:00', rec: '90–105 min', tip: 'Reservar alrededor de las 15:00.', web: 'https://www.catedraldesevilla.es/visita-cultural/horarios-y-tarifas/' },
  { name: 'Real Alcázar de Sevilla', day: 'Dom 8', hours: 'Invierno desde 09:30', rec: '2 h 15 – 2 h 30', tip: 'Entrar sobre las 10:00 para desayunar con calma.', web: 'https://alcazarsevilla.org/prepara-la-visita/' },
  { name: 'Palacio de las Dueñas', day: 'Mié 11 · elegir uno', hours: 'Invierno aprox. 10:00–18:00', rec: '75 min', tip: 'Opción preferida por cercanía y ambiente.', web: 'https://www.lasduenas.es/info-al-visitante' },
  { name: 'Casa de Pilatos', day: 'Alternativa a Dueñas', hours: 'Invierno aprox. 09:00–18:00', rec: '75 min', tip: 'Sustituye a Dueñas si os atrae más la arquitectura; no hacer ambos.', web: 'https://www.juntadeandalucia.es/cultura/agendaculturaldeandalucia/evento/casa-de-pilatos' },
  { name: 'Mezquita-Catedral de Córdoba', day: 'Mar 10', hours: 'Noviembre, L–S: 10:00–18:00', rec: '90 min', tip: 'Ideal ~10:15–10:30.', web: 'https://www.mezquita-catedraldecordoba.es/organiza-la-visita/entradas-y-horarios/' },
  { name: 'Alcázar de los Reyes Cristianos', day: 'Mar 10 · opcional', hours: 'Invierno, M–V: 08:15–20:15', rec: '60–75 min', tip: 'Encaja bien después de comer, ~15:00.', web: 'https://alcazardelosreyescristianos.cordoba.es/?id=3' },
  { name: 'Las Setas', day: 'Cuando apetezca', hours: 'Invierno: hasta medianoche', rec: '60–90 min', tip: 'Improvisar según ganas y energía.', web: 'https://setasdesevilla.com/planifica-tu-visita' },
];

const TIPS = [
  'Prioridad A = reservar y construir el día alrededor. B = recomendable pero flexible. C = solo si surge y tenéis ganas.',
  'Si un día os apetece parar 90 minutos a comer, tomar algo o volver al alojamiento, el itinerario lo permite.',
  'En Córdoba, pocos bloques: Mezquita, Judería, comida larga y Puente Romano. Nada más.',
  'Dueñas o Pilatos, nunca los dos. Si no os apetece el palacio, se puede omitir.',
  'Los horarios de monumentos son orientativos: comprobadlos en la web oficial antes de ir.',
];
