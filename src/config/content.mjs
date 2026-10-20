import { CONTENT_SCHEMA_VERSION } from '../../shared/content-schema.mjs';
import { eventConfig, agenda } from './event.mjs';

/**
 * Fresh editable seed each time, with stable IDs derived from the documented
 * agenda slot IDs. No private booth contacts, invented exhibitors, or fake people.
 * @returns {import('../../shared/content-schema.mjs').Content}
 */
export function createInitialContent() {
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    eventId: eventConfig.id,
    event: {
      title: eventConfig.title,
      date: eventConfig.date.value,
      timezone: eventConfig.time.timezone,
      venue: eventConfig.venue.name,
      status: eventConfig.status,
      dateStatus: eventConfig.date.status,
      venueStatus: eventConfig.venue.confirmed ? 'confirmed' : 'tentative',
    },
    sessions: agenda.flatMap((slot) => ['A', 'B', 'C'].flatMap((zone) => {
      const title = slot[/** @type {'A'|'B'|'C'} */ (zone)];
      return title === '—' ? [] : [{
        id: `session-${slot.id}-${zone.toLowerCase()}`,
        start: slot.start,
        end: slot.end,
        zone,
        title,
        // Only explicitly documented formats; the remaining slots await classification.
        format: zone === 'A' && ['ggj-talk', 'speaker-one', 'speaker-two', 'speaker-three'].includes(slot.id) ? 'talk'
          : zone === 'A' && slot.id === 'student-showcase' ? 'showcase'
          : zone === 'B' && slot.id === 'speaker-one' ? 'roundtable' : 'other',
        guestId: '',
        speakerName: '',
        speakerStatus: 'pending',
        status: 'scheduled',
        internalNotes: '',
      }];
    })),
    booths: [],
    guests: [],
    showcases: [],
  };
}
