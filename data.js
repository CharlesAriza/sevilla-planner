// Datos del viaje, sacados del Excel "Itinerario Sevilla 7-11 noviembre 2026".
// approx: true = hora orientativa calculada a partir de las duraciones (no venía en el Excel).
// Para cambiar el plan base, edita este archivo; lo que se toca desde la web se guarda en el móvil.

const TRIP = {
  title: 'Sevilla',
  subtitle: '7 – 11 nov 2026',
  people: ['Albert', 'Nuria'],
  tagline: '2 personas · ritmo relajado · Córdoba el martes',
  start: '2026-11-07',
  end: '2026-11-11',
  stay: { name: 'Alojamiento', address: 'Zona San Juan de la Palma, Sevilla' },
};

// Sala compartida donde se sincronizan los dos móviles (Firebase Realtime Database).
// Quien tenga esta dirección puede leer y cambiar lo apuntado: no guardéis aquí nada sensible.
const SYNC_DEFAULT = 'https://sevilla-viaje-default-rtdb.europe-west1.firebasedatabase.app/sevilla-cyxrgdX2g9U5bHR6H1yO6KNR';

const DAYS = [
  {
    date: '2026-11-07', short: 'Sáb', num: 7, name: 'Sábado 7',
    title: 'Llegada + Catedral / Giralda',
    summary: 'Una sola gran visita (Catedral a las 15:30) y bastante margen.',
    pace: 'Tranquilo',
    items: [
      { id: 's1', start: '08:00', end: '10:39', title: 'AVE Madrid → Sevilla', kind: 'train', move: 'AVE 02080', dur: 159, resv: 'Confirmado', note: 'Salida de Madrid-Puerta de Atocha. Llegada a Sevilla-Santa Justa a las 10:39.', map: 'Estación Sevilla Santa Justa' },
      { id: 's2', start: '10:50', end: '11:30', approx: true, title: 'Llegar al alojamiento y dejar equipaje', kind: 'stay', move: 'Taxi con maletas', dur: 40, note: 'Sin prisa; el primer objetivo es instalarse.', map: 'Plaza San Juan de la Palma, Sevilla' },
      { id: 's3', start: '11:30', end: '13:00', approx: true, title: 'Paseo por el centro', kind: 'walk', move: 'A pie', dur: 90, food: 'Café opcional', prio: 'B', note: 'Solo orientarse y disfrutar.', map: 'Plaza del Salvador, Sevilla' },
      { id: 's4', start: '13:15', end: '14:45', approx: true, title: 'Almuerzo (con reserva)', kind: 'food', move: 'A pie', dur: 90, food: 'Comida', resv: 'Con reserva', note: 'Dejar margen real para sentarse.' },
      { id: 's5', start: '15:30', end: '17:15', title: 'Catedral + Giralda', kind: 'visit', zone: 'Centro', move: 'A pie', dur: 105, prio: 'A', resv: 'Confirmado', note: 'Entrada a las 15:30: no dejan entrar fuera de esa hora ni volver a entrar. La visita empieza subiendo a la Giralda. Incluye la Iglesia del Salvador. Una entrada es de estudiante: llevar la acreditación.', map: 'Catedral de Sevilla', web: 'https://www.catedraldesevilla.es/visita-cultural/horarios-y-tarifas/' },
      { id: 's6', start: '17:15', end: '19:00', approx: true, title: 'Paseo: Plaza del Cabildo, Puerta de Jerez, Torre del Oro', kind: 'walk', move: 'A pie', dur: 105, prio: 'B', note: 'Sin checklist; perderse por el barrio.', map: 'Torre del Oro, Sevilla' },
      { id: 's7', start: '19:30', end: '21:00', approx: true, title: 'Cena (en el apartamento)', kind: 'food', move: 'A pie', dur: 90, food: 'Cena' },
    ],
  },
  {
    date: '2026-11-08', short: 'Dom', num: 8, name: 'Domingo 8',
    title: 'Alcázar + Plaza de España + Setas',
    summary: 'Alcázar a las 11:00, comida, Plaza de España y Las Setas a las 18:00.',
    pace: 'Tranquilo',
    items: [
      { id: 'd1', start: '11:00', end: '13:30', title: 'Real Alcázar', kind: 'visit', zone: 'Alcázar', move: 'A pie', dur: 150, prio: 'A', resv: 'Confirmado', note: 'Visita principal del día. Entradas de estudiante / carnet joven: llevar la acreditación.', map: 'Real Alcázar de Sevilla', web: 'https://alcazarsevilla.org/prepara-la-visita/' },
      { id: 'd2', start: '13:30', end: '14:30', approx: true, title: 'Paseo por Santa Cruz', kind: 'walk', zone: 'Santa Cruz', move: 'A pie', dur: 60, food: 'Café', note: 'Sin ruta fija; parar donde os apetezca.', map: 'Barrio de Santa Cruz, Sevilla' },
      { id: 'd3', start: '14:30', end: '16:00', approx: true, title: 'Almuerzo', kind: 'food', zone: 'Puerta de Jerez / Prado', move: 'A pie', dur: 90, food: 'Comida', note: 'Pausa real después del Alcázar.', map: 'Puerta de Jerez, Sevilla' },
      { id: 'd4', start: '16:00', end: '17:30', approx: true, title: 'Plaza de España + Parque de María Luisa', kind: 'walk', zone: 'María Luisa', move: 'A pie', dur: 90, prio: 'B', note: 'Un paseo, no una lista. Salir hacia las 17:30 para llegar a Las Setas a las 18:00 (unos 25 min a pie, o bus).', map: 'Plaza de España, Sevilla' },
      { id: 'd5', start: '18:00', end: '20:00', title: 'Las Setas', kind: 'visit', zone: 'Centro', move: 'A pie / bus', dur: 120, food: 'Aperitivo opcional', resv: 'Confirmado', note: 'Entrada a las 18:00, válida hasta 30 minutos después. Acceso «Mirador» en el nivel -1 de la Plaza de la Encarnación. Incluye mirador 360° y la película «Feeling Sevilla» (12 min).', map: 'Setas de Sevilla', web: 'https://setasdesevilla.com/planifica-tu-visita' },
      { id: 'd6', start: '20:30', end: '22:00', approx: true, title: 'Cena', kind: 'food', zone: 'Encarnación / Feria / Alameda', move: 'A pie', dur: 90, food: 'Cena', note: 'No hace falta añadir nada más.', map: 'Alameda de Hércules, Sevilla' },
    ],
  },
  {
    date: '2026-11-09', short: 'Lun', num: 9, name: 'Lunes 9',
    title: 'Centro + flamenco + Triana',
    summary: 'Día colchón para disfrutar: centro, tarde libre y Triana.',
    pace: 'Muy tranquilo',
    items: [
      { id: 'l1', start: '10:30', end: '12:15', approx: true, title: 'Centro histórico y mercado', kind: 'walk', zone: 'Encarnación / Salvador / Sierpes', move: 'A pie', dur: 105, food: 'Café opcional', note: 'Compras, café, calles o volver al alojamiento.', map: 'Mercado de la Encarnación, Sevilla' },
      { id: 'l2', start: '13:30', end: '15:30', approx: true, title: 'Almuerzo (en el apartamento)', kind: 'food', move: 'A pie', dur: 120, food: 'Comida', note: 'Sin prisa.' },
      { id: 'l3', title: 'Espectáculo de flamenco gratis', kind: 'show', note: 'Sin hora ni sitio todavía. Cuando lo tengáis, poned la hora aquí.' },
      { id: 'l4', start: '17:00', end: '20:00', approx: true, title: 'Triana', kind: 'walk', zone: 'Triana', move: 'A pie / bus', dur: 180, food: 'Aperitivo opcional', prio: 'B', note: 'Ambiente y río; sin entradas.', map: 'Puente de Triana, Sevilla' },
      { id: 'l5', start: '20:30', end: '22:00', approx: true, title: 'Cena', kind: 'food', move: 'A pie', dur: 90, food: 'Cena', note: 'Las Setas solo después si todavía os apetece.' },
    ],
  },
  {
    date: '2026-11-10', short: 'Mar', num: 10, name: 'Martes 10',
    title: 'Excursión a Córdoba',
    summary: 'Tren a las 09:34, Mezquita a las 11:30, Judería y Puente Romano. Vuelta a las 19:04.',
    pace: 'Medio',
    items: [
      { id: 'm1', start: '09:34', end: '10:15', title: 'Tren Sevilla → Córdoba', kind: 'train', zone: 'Sevilla / Córdoba', move: 'Taxi + tren', dur: 41, resv: 'Pendiente', note: 'Tren de las 09:34, llegada 10:15. En el Excel sigue como pendiente de comprar.', map: 'Estación Sevilla Santa Justa' },
      { id: 'm2', start: '11:30', end: '13:00', title: 'Mezquita-Catedral', kind: 'visit', zone: 'Mezquita', move: 'A pie', dur: 90, prio: 'A', resv: 'Confirmado', note: 'Entrada a las 11:30. Incluye audioguía en el móvil (llevar auriculares y batería) y la Ruta de las Iglesias Fernandinas. No dejan entrar con mochilas voluminosas, gorras ni sombreros. Una entrada es de carnet joven: llevarlo.', map: 'Mezquita-Catedral de Córdoba', web: 'https://www.mezquita-catedraldecordoba.es/organiza-la-visita/entradas-y-horarios/' },
      { id: 'm3', start: '13:15', end: '15:00', approx: true, title: 'Almuerzo', kind: 'food', zone: 'Judería / Ribera', move: 'A pie', dur: 105, food: 'Comida', note: 'Pausa importante del día.', map: 'Judería de Córdoba' },
      { id: 'm4', start: '15:00', end: '16:15', approx: true, title: 'Judería', kind: 'walk', zone: 'Judería', move: 'A pie', dur: 75, food: 'Aperitivo opcional', prio: 'B', note: 'Callejear y parar donde os apetezca.', map: 'Calleja de las Flores, Córdoba' },
      { id: 'm5', title: 'Alcázar de los Reyes Cristianos (opcional)', kind: 'visit', zone: 'Alcázar', move: 'A pie', dur: 70, prio: 'B', resv: 'Opcional', note: 'No está en el horario del Excel, pero con el tren de vuelta a las 19:04 hay hueco por la tarde. Abre los martes de invierno 08:15–20:15 (60–75 min).', map: 'Alcázar de los Reyes Cristianos, Córdoba', web: 'https://alcazardelosreyescristianos.cordoba.es/?id=3' },
      { id: 'm6', start: '16:30', end: '17:30', approx: true, title: 'Puente Romano + paseo por la ribera', kind: 'walk', zone: 'Ribera', move: 'A pie', dur: 60, prio: 'B', note: 'Paseo final bonito; si estáis cansados, acortarlo. Queda margen hasta el tren para un café.', map: 'Puente Romano de Córdoba' },
      { id: 'm7', start: '19:04', end: '19:57', title: 'Tren Córdoba → Sevilla', kind: 'train', move: 'Tren', dur: 53, resv: 'Pendiente', note: 'Tren de las 19:04, llegada 19:57. En el Excel sigue como pendiente de comprar.', map: 'Estación de Córdoba' },
    ],
  },
  {
    date: '2026-11-11', short: 'Mié', num: 11, name: 'Miércoles 11',
    title: 'Última mañana + vuelta',
    summary: 'Casa de Pilatos si apetece, comida y AVE a las 17:53.',
    pace: 'Muy tranquilo',
    items: [
      { id: 'x1', start: '10:30', end: '11:45', approx: true, title: 'Casa de Pilatos', kind: 'visit', zone: 'Centro', move: 'A pie', dur: 75, prio: 'B', resv: 'Opcional', note: 'En lugar del Palacio de las Dueñas: uno u otro, no los dos.', map: 'Casa de Pilatos, Sevilla', web: 'https://www.juntadeandalucia.es/cultura/agendaculturaldeandalucia/evento/casa-de-pilatos' },
      { id: 'x5', title: 'Dejar las cosas en el locker', kind: 'stay', note: 'Sin hora en el Excel: ponedla cuando sepáis a qué hora dejáis el apartamento.' },
      { id: 'x2', start: '13:30', end: '15:00', approx: true, title: 'Comida de despedida', kind: 'food', move: 'A pie', dur: 90, food: 'Comida', note: 'La parte turística debe terminar hacia las 15:30.' },
      { id: 'x3', start: '16:30', end: '17:00', approx: true, title: 'Salir hacia Santa Justa', kind: 'stay', move: 'Taxi con maletas', dur: 30, note: 'Recoger antes las cosas del locker. Estar en la estación sobre las 16:45–17:00.', map: 'Estación Sevilla Santa Justa' },
      { id: 'x4', start: '17:53', end: '20:32', title: 'AVE Sevilla → Madrid', kind: 'train', zone: 'Sevilla / Madrid', move: 'AVE 02171', dur: 159, resv: 'Confirmado', note: 'Llegada a Atocha a las 20:32.', map: 'Estación Sevilla Santa Justa' },
    ],
  },
];

// Reservas y billetes, en el orden en que se usan.
const BOOKINGS = [
  { id: 'b1', date: '2026-11-07', time: '08:00', title: 'AVE Madrid → Sevilla', prio: 'Confirmado', confirmed: true, note: 'AVE 02080 · salida 08:00 · llegada 10:39 · 67,50 € (33,75 €/pers.)' },
  { id: 'b2', date: '2026-11-07', time: '~13:15', title: 'Restaurante para el almuerzo', prio: 'Con reserva', note: 'En el itinerario figura «con reserva»: apuntad aquí sitio y hora.' },
  { id: 'b3', date: '2026-11-07', time: '15:30', title: 'Catedral + Giralda', prio: 'Confirmado', confirmed: true, note: 'Entrada a las 15:30 · 2 personas · 20,00 €. Incluye Iglesia del Salvador.', web: 'https://www.catedraldesevilla.es/visita-cultural/horarios-y-tarifas/' },
  { id: 'b4', date: '2026-11-08', time: '11:00', title: 'Real Alcázar de Sevilla', prio: 'Confirmado', confirmed: true, note: 'Entrada a las 11:00 · 2 entradas de estudiante / carnet joven · 16,00 €. Llevar la acreditación.', web: 'https://alcazarsevilla.org/prepara-la-visita/' },
  { id: 'b5', date: '2026-11-08', time: '18:00', title: 'Las Setas', prio: 'Confirmado', confirmed: true, note: 'Entrada a las 18:00 · 2 generales · 16,00 € cada una. Acceso por el nivel -1.', web: 'https://setasdesevilla.com/planifica-tu-visita' },
  { id: 'b7', date: '2026-11-10', time: '09:34', title: 'Tren Sevilla → Córdoba', prio: 'A · importante', when: 'Cuanto antes', note: 'Tren de las 09:34, llegada 10:15.' },
  { id: 'b8', date: '2026-11-10', time: '11:30', title: 'Mezquita-Catedral de Córdoba', prio: 'Confirmado', confirmed: true, note: 'Entrada a las 11:30 · general + carnet joven · 27,00 €. Incluye audioguía.', web: 'https://www.mezquita-catedraldecordoba.es/organiza-la-visita/entradas-y-horarios/' },
  { id: 'b9', date: '2026-11-10', time: 'Tarde', title: 'Alcázar de los Reyes Cristianos', prio: 'B · opcional', optional: true, note: 'Martes de invierno abre 08:15–20:15.', web: 'https://alcazardelosreyescristianos.cordoba.es/?id=3' },
  { id: 'b10', date: '2026-11-10', time: '19:04', title: 'Tren Córdoba → Sevilla', prio: 'A · importante', when: 'Cuanto antes', note: 'Tren de las 19:04, llegada 19:57.' },
  { id: 'b11', date: '2026-11-11', time: 'Mañana', title: 'Casa de Pilatos', prio: 'B · opcional', optional: true, when: 'Puede reservarse más adelante', note: 'En lugar del Palacio de las Dueñas. No reservar ambos.', web: 'https://www.juntadeandalucia.es/cultura/agendaculturaldeandalucia/evento/casa-de-pilatos' },
  { id: 'b12', date: '2026-11-11', time: '17:53', title: 'AVE Sevilla → Madrid', prio: 'Confirmado', confirmed: true, note: 'AVE 02171 · llegada a Atocha 20:32 · 33,80 € aprox. Estar en Santa Justa ~16:45–17:00.' },
];

const PLACES = [
  { name: 'Catedral + Giralda', day: 'Sáb 7 · 15:30', hours: 'L–S aprox. 10:45–19:00', rec: '90–105 min', tip: 'Entrada confirmada a las 15:30; se empieza por la Giralda.', web: 'https://www.catedraldesevilla.es/visita-cultural/horarios-y-tarifas/' },
  { name: 'Real Alcázar de Sevilla', day: 'Dom 8 · 11:00', hours: 'Invierno desde 09:30', rec: '2 h 15 – 2 h 30', tip: 'Entrada confirmada a las 11:00.', web: 'https://alcazarsevilla.org/prepara-la-visita/' },
  { name: 'Palacio de las Dueñas', day: 'Alternativa a Pilatos', hours: 'Invierno aprox. 10:00–18:00', rec: '75 min', tip: 'Está junto al alojamiento; no hacer ambos.', web: 'https://www.lasduenas.es/info-al-visitante' },
  { name: 'Casa de Pilatos', day: 'Mié 11 · opcional', hours: 'Invierno aprox. 09:00–18:00', rec: '75 min', tip: 'Elegida en el Excel en lugar de Dueñas.', web: 'https://www.juntadeandalucia.es/cultura/agendaculturaldeandalucia/evento/casa-de-pilatos' },
  { name: 'Mezquita-Catedral de Córdoba', day: 'Mar 10 · 11:30', hours: 'Noviembre, L–S: 10:00–18:00', rec: '90 min', tip: 'Entrada confirmada a las 11:30.', web: 'https://www.mezquita-catedraldecordoba.es/organiza-la-visita/entradas-y-horarios/' },
  { name: 'Alcázar de los Reyes Cristianos', day: 'Mar 10 · opcional', hours: 'Invierno, M–V: 08:15–20:15', rec: '60–75 min', tip: 'Encaja bien después de comer, ~15:00.', web: 'https://alcazardelosreyescristianos.cordoba.es/?id=3' },
  { name: 'Las Setas', day: 'Dom 8 · 18:00', hours: 'Invierno: hasta medianoche', rec: '60–90 min', tip: 'Entrada confirmada a las 18:00, por el nivel -1.', web: 'https://setasdesevilla.com/planifica-tu-visita' },
];

const TIPS = [
  'Prioridad A = reservar y construir el día alrededor. B = recomendable pero flexible. C = solo si surge y tenéis ganas.',
  'Si un día os apetece parar 90 minutos a comer, tomar algo o volver al alojamiento, el itinerario lo permite.',
  'En Córdoba, pocos bloques: Mezquita, Judería, comida larga y Puente Romano. Nada más.',
  'Pilatos o Dueñas, nunca los dos. Si no os apetece el palacio, se puede omitir.',
  'Los horarios de monumentos son orientativos: comprobadlos en la web oficial antes de ir.',
];

// Sitios y actividades para elegir al añadir algo al plan. Duraciones orientativas.
const CATALOG = [
  { group: 'Sevilla · imprescindibles', name: 'Catedral + Giralda', kind: 'visit', zone: 'Centro', dur: 105, map: 'Catedral de Sevilla' },
  { group: 'Sevilla · imprescindibles', name: 'Real Alcázar', kind: 'visit', zone: 'Santa Cruz', dur: 150, map: 'Real Alcázar de Sevilla' },
  { group: 'Sevilla · imprescindibles', name: 'Plaza de España', kind: 'walk', zone: 'María Luisa', dur: 60, map: 'Plaza de España, Sevilla' },
  { group: 'Sevilla · imprescindibles', name: 'Barrio de Santa Cruz', kind: 'walk', zone: 'Santa Cruz', dur: 60, map: 'Barrio de Santa Cruz, Sevilla' },
  { group: 'Sevilla · imprescindibles', name: 'Las Setas (Metropol Parasol)', kind: 'visit', zone: 'Encarnación', dur: 60, map: 'Setas de Sevilla' },
  { group: 'Sevilla · imprescindibles', name: 'Torre del Oro y paseo del río', kind: 'walk', zone: 'Arenal', dur: 45, map: 'Torre del Oro, Sevilla' },
  { group: 'Sevilla · imprescindibles', name: 'Triana', kind: 'walk', zone: 'Triana', dur: 120, map: 'Puente de Triana, Sevilla' },
  { group: 'Sevilla · palacios y museos', name: 'Palacio de las Dueñas', kind: 'visit', zone: 'Encarnación', dur: 75, map: 'Palacio de las Dueñas, Sevilla' },
  { group: 'Sevilla · palacios y museos', name: 'Casa de Pilatos', kind: 'visit', zone: 'Centro', dur: 75, map: 'Casa de Pilatos, Sevilla' },
  { group: 'Sevilla · palacios y museos', name: 'Archivo de Indias', kind: 'visit', zone: 'Centro', dur: 45, map: 'Archivo General de Indias, Sevilla' },
  { group: 'Sevilla · palacios y museos', name: 'Hospital de los Venerables', kind: 'visit', zone: 'Santa Cruz', dur: 60, map: 'Hospital de los Venerables, Sevilla' },
  { group: 'Sevilla · palacios y museos', name: 'Palacio de la Condesa de Lebrija', kind: 'visit', zone: 'Centro', dur: 60, map: 'Palacio de la Condesa de Lebrija, Sevilla' },
  { group: 'Sevilla · palacios y museos', name: 'Museo de Bellas Artes', kind: 'visit', zone: 'Centro', dur: 90, map: 'Museo de Bellas Artes de Sevilla' },
  { group: 'Sevilla · palacios y museos', name: 'Plaza de toros de la Maestranza', kind: 'visit', zone: 'Arenal', dur: 60, map: 'Plaza de toros de la Real Maestranza, Sevilla' },
  { group: 'Sevilla · palacios y museos', name: 'Museo del Baile Flamenco', kind: 'visit', zone: 'Centro', dur: 60, map: 'Museo del Baile Flamenco, Sevilla' },
  { group: 'Sevilla · iglesias', name: 'Iglesia del Salvador', kind: 'visit', zone: 'Centro', dur: 30, map: 'Iglesia Colegial del Divino Salvador, Sevilla' },
  { group: 'Sevilla · iglesias', name: 'Basílica de la Macarena', kind: 'visit', zone: 'Macarena', dur: 45, map: 'Basílica de la Macarena, Sevilla' },
  { group: 'Sevilla · iglesias', name: 'Iglesia de San Luis de los Franceses', kind: 'visit', zone: 'Macarena', dur: 45, map: 'San Luis de los Franceses, Sevilla' },
  { group: 'Sevilla · pasear', name: 'Parque de María Luisa', kind: 'walk', zone: 'María Luisa', dur: 60, map: 'Parque de María Luisa, Sevilla' },
  { group: 'Sevilla · pasear', name: 'Calle Sierpes y Tetuán (compras)', kind: 'walk', zone: 'Centro', dur: 60, map: 'Calle Sierpes, Sevilla' },
  { group: 'Sevilla · pasear', name: 'Alameda de Hércules', kind: 'walk', zone: 'Alameda', dur: 60, map: 'Alameda de Hércules, Sevilla' },
  { group: 'Sevilla · pasear', name: 'Plaza del Cabildo y Puerta de Jerez', kind: 'walk', zone: 'Arenal', dur: 45, map: 'Plaza del Cabildo, Sevilla' },
  { group: 'Sevilla · pasear', name: 'Mercado de Triana', kind: 'walk', zone: 'Triana', dur: 45, map: 'Mercado de Triana, Sevilla', food: 'Aperitivo' },
  { group: 'Sevilla · pasear', name: 'Calle Betis al atardecer', kind: 'walk', zone: 'Triana', dur: 45, map: 'Calle Betis, Sevilla' },
  { group: 'Sevilla · pasear', name: 'Mercado de Feria', kind: 'walk', zone: 'Macarena', dur: 45, map: 'Mercado de Feria, Sevilla', food: 'Aperitivo' },
  { group: 'Sevilla · pasear', name: 'Murallas y arco de la Macarena', kind: 'walk', zone: 'Macarena', dur: 30, map: 'Arco de la Macarena, Sevilla' },
  { group: 'Sevilla · pasear', name: 'Espectáculo de flamenco', kind: 'show', zone: '', dur: 75, map: '' },
  { group: 'Córdoba', name: 'Mezquita-Catedral', kind: 'visit', zone: 'Córdoba · Mezquita', dur: 90, map: 'Mezquita-Catedral de Córdoba' },
  { group: 'Córdoba', name: 'Alcázar de los Reyes Cristianos', kind: 'visit', zone: 'Córdoba · Judería', dur: 75, map: 'Alcázar de los Reyes Cristianos, Córdoba' },
  { group: 'Córdoba', name: 'Judería y Calleja de las Flores', kind: 'walk', zone: 'Córdoba · Judería', dur: 75, map: 'Calleja de las Flores, Córdoba' },
  { group: 'Córdoba', name: 'Sinagoga de Córdoba', kind: 'visit', zone: 'Córdoba · Judería', dur: 30, map: 'Sinagoga de Córdoba' },
  { group: 'Córdoba', name: 'Puente Romano y Torre de la Calahorra', kind: 'walk', zone: 'Córdoba · Ribera', dur: 60, map: 'Puente Romano de Córdoba' },
  { group: 'Córdoba', name: 'Palacio de Viana', kind: 'visit', zone: 'Córdoba · Centro', dur: 75, map: 'Palacio de Viana, Córdoba' },
  { group: 'Córdoba', name: 'Plaza de la Corredera', kind: 'walk', zone: 'Córdoba · Centro', dur: 30, map: 'Plaza de la Corredera, Córdoba' },
  { group: 'Córdoba', name: 'Templo Romano y Plaza de las Tendillas', kind: 'walk', zone: 'Córdoba · Centro', dur: 30, map: 'Templo Romano de Córdoba' },
  { group: 'Comer y descansar', name: 'Desayuno', kind: 'food', zone: '', dur: 45, food: 'Desayuno' },
  { group: 'Comer y descansar', name: 'Café o merienda', kind: 'food', zone: '', dur: 30, food: 'Café' },
  { group: 'Comer y descansar', name: 'Almuerzo', kind: 'food', zone: '', dur: 90, food: 'Comida' },
  { group: 'Comer y descansar', name: 'Tapas', kind: 'food', zone: '', dur: 90, food: 'Aperitivo' },
  { group: 'Comer y descansar', name: 'Cena', kind: 'food', zone: '', dur: 90, food: 'Cena' },
  { group: 'Comer y descansar', name: 'Descanso en el apartamento', kind: 'stay', zone: '', dur: 60 },
  { group: 'Comer y descansar', name: 'Compras', kind: 'custom', zone: 'Centro', dur: 60 },
  { group: 'Traslados', name: 'Taxi', kind: 'train', zone: '', dur: 15, move: 'Taxi' },
  { group: 'Traslados', name: 'Tren', kind: 'train', zone: 'Santa Justa', dur: 60, move: 'Tren', map: 'Estación Sevilla Santa Justa' },
];
