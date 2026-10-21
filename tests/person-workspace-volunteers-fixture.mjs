/** Synthetic readPerson response: no roster, contact details or private notes. */
export function volunteersFixture() {
  return { revision: 4, entries: [{ id: 'synthetic-volunteer', workflowStatus: 'confirmed',
    availability: [{ start: '09:00', end: '18:00' }],
    assignments: [{ id: 'synthetic-assignment', status: 'confirmed', shiftId: 'synthetic-shift', positionId: 'synthetic-position',
      positionName: '签到接待', zone: 'A', location: '签到处', start: '09:30', end: '10:30', shiftStatus: 'active', eligible: true, issues: [] }] }] };
}

export function addVolunteers(value, source = volunteersFixture()) {
  value.permissions.volunteers = true;
  value.availability.volunteers = source.entries.length ? 'available' : 'unlinked';
  value.revisions.volunteers = source.revision;
  value.volunteers = source;
  return value;
}
